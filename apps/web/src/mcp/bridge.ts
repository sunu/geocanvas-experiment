import { useSyncExternalStore } from 'react'
import type { Executor } from './executor'

/**
 * This tab's link to the local MCP companion (apps/mcp, plans/plan-010.md), which an external agent (Claude,
 * Codex) talks to. Only on a local app, and only after the person opened a link the companion gave:
 * #room=<id>&mcp=<port>:<token>. The token pairs this browser with that run of the companion; it is kept in
 * localStorage, so the person's other local tabs connect too, until the companion restarts.
 *
 * One streaming POST carries the companion's requests to the tab, one JSON line each; the tab answers each with
 * a POST. The companion never writes the board: it asks the tab, whose executor writes through ops.
 */

const PAIRING = /&mcp=(\d{1,5}):([\w-]{16,128})(?=&|$)/
const STORAGE_KEY = 'ttx-mcp'
const RETRY_MAX_MS = 30_000

export type BridgeStatus = 'off' | 'connecting' | 'connected' | 'disconnected'

type Pairing = { port: number; token: string }
type Request = { id: string; method: 'snapshot' | 'call' | 'undo'; params: Record<string, unknown> }

const isLocal = (host: string) => ['localhost', '127.0.0.1', '[::1]'].includes(host) || host.endsWith('.localhost')

/** The pairing in the URL (then removed from it, so the link to share has no token), or the one kept. */
function pairing(): Pairing | undefined {
  const m = PAIRING.exec(location.hash)
  try {
    if (m) {
      history.replaceState(null, '', location.hash.replace(PAIRING, ''))
      const p = { port: Number(m[1]), token: m[2]! }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
      return p
    }
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') ?? undefined
  } catch {
    return undefined
  }
}

/** This browser tab, across reloads: the companion gives a reloaded tab back the boards it was serving. */
function tabKey(): string {
  try {
    let key = sessionStorage.getItem('ttx-mcp-tab')
    if (!key) sessionStorage.setItem('ttx-mcp-tab', (key = crypto.randomUUID()))
    return key
  } catch {
    return crypto.randomUUID()
  }
}

let status: BridgeStatus = 'off'
const listeners = new Set<() => void>()
const setStatus = (s: BridgeStatus) => {
  status = s
  for (const l of listeners) l()
}

export function useBridgeStatus(): BridgeStatus {
  return useSyncExternalStore(
    (onChange) => (listeners.add(onChange), () => void listeners.delete(onChange)),
    () => status,
  )
}

/** Connect this tab when it is paired; reconnect when the companion restarts or the connection drops. */
export function startBridge(executor: () => Executor, board: { room: string; person: { id: string; name?: string } }) {
  const pair = isLocal(location.hostname) ? pairing() : undefined
  if (!pair) return
  const run = executor()
  const base = `http://127.0.0.1:${pair.port}/bridge`
  const headers = { authorization: `Bearer ${pair.token}`, 'content-type': 'application/json' }
  const tab = tabKey()

  const answer = (connection: string, id: string, reply: { result: unknown } | { error: string }) =>
    fetch(`${base}/reply`, { method: 'POST', headers, body: JSON.stringify({ connection, id, ...reply }) }).catch(() => {
      // The companion went away; it fails the request itself.
    })

  async function handle(connection: string, { id, method, params }: Request) {
    try {
      const client = typeof params.client === 'string' ? params.client : undefined
      const result =
        method === 'snapshot'
          ? run.snapshot(params as { ids?: string[]; limit?: number })
          : method === 'call'
            ? await run.call(String(params.name), params.input, client)
            : await run.undo(client)
      await answer(connection, id, { result })
    } catch (err) {
      await answer(connection, id, { error: String((err as Error)?.message ?? err) })
    }
  }

  /** One connection, until it ends. False when the companion no longer knows the token. */
  async function connectOnce(): Promise<boolean> {
    const body = { origin: location.origin, room: board.room, tab, person: board.person, manifest: run.manifest() }
    const res = await fetch(`${base}/connect`, { method: 'POST', headers, body: JSON.stringify(body) })
    if (res.status === 401) return false
    if (!res.ok || !res.body) throw new Error(`MCP companion: HTTP ${res.status}`)
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
    let connection = ''
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return true
      buffer += value
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i).trim()
        buffer = buffer.slice(i + 1)
        if (!line) continue
        const msg = JSON.parse(line) as { connection: string } | Request
        if ('connection' in msg) {
          connection = msg.connection
          setStatus('connected')
        } else void handle(connection, msg)
      }
    }
  }

  void (async () => {
    for (let delay = 1000; ; delay = Math.min(delay * 2, RETRY_MAX_MS)) {
      setStatus('connecting')
      try {
        if (!(await connectOnce())) {
          // Another run of the companion: this pairing is over. A new link from the agent pairs again.
          localStorage.removeItem(STORAGE_KEY)
          return setStatus('off')
        }
        delay = 1000
      } catch {
        // Not running yet, or restarting.
      }
      setStatus('disconnected')
      await new Promise((r) => setTimeout(r, delay))
    }
  })()
}
