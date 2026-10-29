import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ToolListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { boardOf } from '../src/boards.ts'
import { startCompanion } from '../src/companion.ts'

const APP = 'http://localhost:5173'
const A = `${APP}/#room=aaaaaaaaaaaaaaaa`
const B = `${APP}/#room=bbbbbbbbbbbbbbbb`

/** A tool the companion has never heard of: the app's tools reach agents with no change to the companion. */
const fixtureTools = (version = 1) => ({
  fingerprint: `v${version}`,
  tools: [
    {
      name: 'fixture__stamp',
      description: 'Stamp. A fixture op.',
      input_schema: { type: 'object', properties: { args: { type: 'object', properties: { label: { type: 'string' } } } }, required: ['args'] },
    },
    {
      name: 'fixture__echo',
      description: 'Echo. A fixture read tool.',
      input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
      annotations: { readOnlyHint: true },
    },
  ],
})

type Request = { id: string; method: string; params: Record<string, unknown> }

let companion: Awaited<ReturnType<typeof startCompanion>>
let tabs: { close(): void }[]

beforeEach(async () => {
  companion = await startCompanion({ port: 0 })
  tabs = []
})
afterEach(async () => {
  for (const t of tabs) t.close()
  await companion.close()
})

/**
 * A browser tab of the app, as apps/web/src/mcp/bridge.ts connects it. It answers each request with `answer`,
 * or never, when `answer` returns undefined.
 */
async function tab(link: string, opts: { key?: string; version?: number; answer?: (r: Request) => unknown; origin?: string; token?: string } = {}) {
  const { origin, room } = boardOf(link)
  const abort = new AbortController()
  const base = `http://127.0.0.1:${companion.port}/bridge`
  const headers = { origin: opts.origin ?? origin, authorization: `Bearer ${opts.token ?? companion.token}`, 'content-type': 'application/json' }
  const res = await fetch(`${base}/connect`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ origin: opts.origin ?? origin, room, tab: opts.key ?? crypto.randomUUID(), person: { id: 'ada', name: 'Ada' }, manifest: fixtureTools(opts.version) }),
    signal: abort.signal,
  })
  const seen: Request[] = []
  let connection = ''
  if (res.ok) {
    const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader()
    const first = await reader.read()
    connection = JSON.parse(first.value!).connection
    void (async () => {
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read().catch(() => ({ value: '', done: true }))
        if (done) return
        buffer += value
        for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
          const line = buffer.slice(0, i)
          buffer = buffer.slice(i + 1)
          if (!line.trim()) continue
          const r = JSON.parse(line) as Request
          seen.push(r)
          const result = (opts.answer ?? ((r: Request) => ({ room, method: r.method, params: r.params })))(r)
          if (result !== undefined) await fetch(`${base}/reply`, { method: 'POST', headers, body: JSON.stringify({ connection, id: r.id, result }) })
        }
      }
    })()
  }
  const t = { status: res.status, connection, seen, close: () => abort.abort() }
  tabs.push(t)
  return t
}

async function client() {
  const c = new Client({ name: 'test-agent', version: '1.0.0' })
  await c.connect(new StreamableHTTPClientTransport(new URL(companion.url)))
  return c
}

/** The JSON a tool call answered, and whether it is an error. */
async function callTool(c: Client, name: string, args: Record<string, unknown>) {
  const res = (await c.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean }
  return { isError: !!res.isError, body: JSON.parse(res.content[0]!.text) }
}

const settle = () => new Promise((r) => setTimeout(r, 30))

describe('the MCP companion', () => {
  it("lists the app's tools from a tab, each with a board, and routes each call to that board's tab", async () => {
    const a = await tab(A)
    const b = await tab(B)
    const c = await client()

    const { tools } = await c.listTools()
    const stamp = tools.find((t) => t.name === 'fixture__stamp')!
    expect(stamp.inputSchema.required).toEqual(['board', 'args'])
    expect(tools.find((t) => t.name === 'fixture__echo')!.annotations).toEqual({ readOnlyHint: true })
    expect(tools.map((t) => t.name)).toContain('ttx_snapshot')

    const res = await callTool(c, 'fixture__stamp', { board: B, args: { label: 'hi' } })
    expect(res.body).toEqual({ room: 'bbbbbbbbbbbbbbbb', method: 'call', params: { name: 'fixture__stamp', input: { args: { label: 'hi' } }, client: 'test-agent' } })
    expect(a.seen).toEqual([])
    expect(b.seen).toHaveLength(1)

    const snap = await callTool(c, 'ttx_snapshot', { board: A, ids: ['x'] })
    expect(snap.body).toMatchObject({ board: A, tab: a.connection, room: 'aaaaaaaaaaaaaaaa', method: 'snapshot', params: { ids: ['x'] } })

    expect((await callTool(c, 'ttx_boards', {})).body.boards.map((x: { board: string }) => x.board)).toEqual([A, B])
  })

  it('gives a pairing link for a board no tab shows, and refuses links that are not local', async () => {
    const c = await client()
    const res = await callTool(c, 'fixture__stamp', { board: A, args: {} })
    // No tab yet, so no app tools either: the call is refused as unknown.
    expect(res.body.error).toBe('unknown_tool')

    const open = await callTool(c, 'ttx_open_board', { link: `${A}&other=1` })
    expect(open).toMatchObject({ isError: true, body: { error: 'board_not_open', open: `${A}&mcp=${companion.port}:${companion.token}` } })

    expect((await callTool(c, 'ttx_open_board', { link: 'https://evil.example/#room=aaaaaaaaaaaaaaaa' })).body.error).toBe('not_local')

    const created = await callTool(c, 'ttx_new_board', {})
    expect(created.body.board).toMatch(/^http:\/\/localhost:5173\/#room=[0-9a-f]{16}$/)
    expect(created.body.open).toBe(`${created.body.board}&mcp=${companion.port}:${companion.token}`)
  })

  it('tells clients when the tools change, and refuses a tab of an older version', async () => {
    const c = await client()
    let changed = 0
    c.setNotificationHandler(ToolListChangedNotificationSchema, () => void changed++)
    await tab(A, { version: 1 })
    await settle()
    expect(changed).toBe(1)
    await tab(B, { version: 2 })
    await settle()
    expect(changed).toBe(2)

    expect((await callTool(c, 'fixture__stamp', { board: A, args: {} })).body.error).toBe('reload_required')
    expect((await callTool(c, 'fixture__stamp', { board: B, args: {} })).isError).toBe(false)
  })

  it('says a write may or may not have applied when its tab closes before answering', async () => {
    const a = await tab(A, { answer: () => undefined })
    const c = await client()
    const call = callTool(c, 'fixture__stamp', { board: A, args: {} })
    await settle()
    a.close()
    expect((await call).body.error).toBe('uncertain')
  })

  it('keeps a board on its tab: another tab of it is not used silently, and a reload of the tab serves it again', async () => {
    const first = await tab(A, { key: 'tab-1' })
    const second = await tab(A, { key: 'tab-2' })
    const c = await client()
    await callTool(c, 'fixture__echo', { board: A, text: 'x' })
    expect([first.seen.length, second.seen.length]).toEqual([1, 0])

    first.close()
    await settle()
    const closed = await callTool(c, 'fixture__echo', { board: A, text: 'x' })
    expect(closed.body).toMatchObject({ error: 'tab_closed', tabs: [{ tab: second.connection }] })

    const reloaded = await tab(A, { key: 'tab-1' })
    await callTool(c, 'fixture__echo', { board: A, text: 'x' })
    expect(reloaded.seen).toHaveLength(1)

    await callTool(c, 'ttx_open_board', { link: A, tab: second.connection })
    await callTool(c, 'fixture__echo', { board: A, text: 'x' })
    expect(second.seen).toHaveLength(1)
  })

  it('pairs only local tabs that have the token', async () => {
    expect((await tab(A, { token: 'wrong' })).status).toBe(401)
    expect((await tab(A, { origin: 'https://evil.example' })).status).toBe(403)
    const res = await fetch(companion.url, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('keeps a token it is given, so paired tabs reconnect after a restart', async () => {
    const token = 'a-fixed-token-of-32-characters__'
    const fixed = await startCompanion({ port: 0, token })
    await fixed.close()
    expect(fixed.token).toBe(token)
    await expect(startCompanion({ port: 0, token: 'short' })).rejects.toThrow(/pairing token/)
  })
})
