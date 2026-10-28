import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { BoardError, Boards, boardOf, isLocalOrigin, type Manifest, type Tab } from './boards.ts'
import { mcpServer, type Companion } from './mcp.ts'

/**
 * The local MCP companion (plans/plan-010.md): one process on 127.0.0.1 that MCP clients (Claude, Codex) talk to
 * at /mcp, and that paired browser tabs of the local app connect to at /bridge. It routes each tool call to the
 * tab that shows the board; the tab runs it (apps/web/src/mcp/). It runs no model and holds no board.
 */

export const DEFAULT_PORT = 8790

/** A request a tab has not answered after this long fails. Data tools can take ~10 s on a first load. */
const REQUEST_TIMEOUT_MS = 120_000
/** A blank line to each tab this often, so a dead connection is noticed. */
const HEARTBEAT_MS = 20_000
/** Requests from tabs (a manifest, a snapshot) are at most this large. */
const MAX_BODY = 10_000_000

export interface CompanionOptions {
  /** 0: any free port. */
  port?: number
  /** Where new boards open when no tab is paired yet. */
  appUrl?: string
  /** The pairing secret; new for each run by default. */
  token?: string
}

export async function startCompanion(opts: CompanionOptions = {}) {
  const token = opts.token ?? randomBytes(24).toString('base64url')
  const boards = new Boards()
  const pending = new Map<string, { connection: string; resolve: (v: unknown) => void; reject: (e: Error) => void; write: boolean; timer: NodeJS.Timeout }>()
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: Server }>()
  let port = opts.port ?? DEFAULT_PORT

  const companion: Companion = {
    boards,
    request(tab, method, params, write = false) {
      const id = randomUUID()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => settle(id, { error: lost(write, 'did not answer in time') }), REQUEST_TIMEOUT_MS)
        pending.set(id, { connection: tab.connection, resolve, reject, write, timer })
        tab.send({ id, method, params })
      })
    },
    pairingLink: (board) => `${board}&mcp=${port}:${token}`,
    newBoard() {
      const origin = boards.origin() ?? opts.appUrl ?? 'http://localhost:5173'
      // As the app makes room ids (apps/web/src/board/room.ts): 64 random bits.
      const board = boardOf(`${origin}/#room=${randomUUID().replaceAll('-', '').slice(0, 16)}`).handle
      return { board, open: companion.pairingLink(board) }
    },
  }

  function settle(id: string, answer: { result?: unknown; error?: string | BoardError }) {
    const p = pending.get(id)
    if (!p) return
    pending.delete(id)
    clearTimeout(p.timer)
    if (answer.error === undefined) p.resolve(answer.result)
    else p.reject(typeof answer.error === 'string' ? new Error(answer.error) : answer.error)
  }

  boards.onCatalogChange = () => {
    for (const { server } of sessions.values()) server.sendToolListChanged().catch(() => {})
  }

  async function bridge(req: IncomingMessage, res: ServerResponse, path: string) {
    const origin = req.headers.origin
    // Browsers only: a tab of the local app. Other pages cannot send a local Origin.
    if (!origin) return send(res, 403, 'Origin required')
    res.setHeader('access-control-allow-origin', origin)
    res.setHeader('vary', 'origin')
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'authorization, content-type', 'access-control-max-age': '600' })
      return res.end()
    }
    if (req.method !== 'POST') return send(res, 405, 'POST only')
    if (!sameSecret(req.headers.authorization, `Bearer ${token}`)) return send(res, 401, 'Not paired with this companion')
    const body = (await readJson(req)) as Record<string, any>

    if (path === '/bridge/reply') {
      const p = pending.get(String(body.id))
      // Only the tab that was asked may answer.
      if (p?.connection === body.connection) settle(String(body.id), 'error' in body ? { error: String(body.error) } : { result: body.result })
      return send(res, 204)
    }
    if (path !== '/bridge/connect') return send(res, 404, 'Not found')

    const manifest = body.manifest as Manifest | undefined
    if (body.origin !== origin || typeof body.room !== 'string' || typeof body.tab !== 'string' || !Array.isArray(manifest?.tools) || typeof manifest.fingerprint !== 'string') {
      return send(res, 400, 'Bad registration')
    }
    const board = boardOf(`${origin}/#room=${body.room}`).handle
    const connection = randomUUID()
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
    const tab: Tab = {
      connection,
      key: body.tab,
      board,
      person: { id: String(body.person?.id ?? ''), ...(typeof body.person?.name === 'string' && { name: body.person.name }) },
      manifest,
      send: (message) => res.write(`${JSON.stringify(message)}\n`),
    }
    tab.send({ connection })
    boards.add(tab)
    log(`tab ${connection.slice(0, 8)} serves ${board}`)
    const heartbeat = setInterval(() => res.write('\n'), HEARTBEAT_MS)
    res.on('close', () => {
      clearInterval(heartbeat)
      boards.remove(connection)
      for (const [id, p] of pending) if (p.connection === connection) settle(id, { error: lost(p.write, 'closed') })
      log(`tab ${connection.slice(0, 8)} left ${board}`)
    })
  }

  async function mcp(req: IncomingMessage, res: ServerResponse) {
    const body = req.method === 'POST' ? await readJson(req) : undefined
    const sid = req.headers['mcp-session-id']
    let session = typeof sid === 'string' ? sessions.get(sid) : undefined
    if (!session) {
      if (sid) return sendJson(res, 404, rpcError('Unknown session: initialize again'))
      if (!isInitializeRequest(body)) return sendJson(res, 400, rpcError('Initialize first'))
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => void sessions.set(id, { transport, server }),
      })
      const server = mcpServer(companion)
      transport.onclose = () => void (transport.sessionId && sessions.delete(transport.sessionId))
      await server.connect(transport)
      session = { transport, server }
    }
    await session.transport.handleRequest(req, res, body)
  }

  const http = createServer((req, res) => {
    void (async () => {
      // Against DNS rebinding: a page on another site that resolves to 127.0.0.1 still sends its own Host or Origin.
      if (!isLocalHost(req.headers.host)) return send(res, 403, 'Host not allowed')
      if (req.headers.origin && !isLocalOrigin(req.headers.origin)) return send(res, 403, 'Origin not allowed')
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      if (path.startsWith('/bridge/')) return await bridge(req, res, path)
      if (path === '/mcp') return await mcp(req, res)
      send(res, 404, 'Not found')
    })().catch((err) => {
      if (res.headersSent) return res.end()
      if (err instanceof BoardError) return send(res, 400, err.message)
      send(res, err instanceof SyntaxError ? 400 : 500, String(err?.message ?? err))
    })
  })

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject)
    http.listen(port, '127.0.0.1', () => resolve())
  })
  port = (http.address() as AddressInfo).port

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/mcp`,
    boards,
    async close() {
      for (const { transport } of sessions.values()) await transport.close()
      http.closeAllConnections()
      await new Promise((r) => http.close(r))
    },
  }
}

/** A write whose tab went away may or may not have been applied: say so, and never run it again by itself. */
function lost(write: boolean, what: string): BoardError {
  return write
    ? new BoardError('uncertain', `The tab ${what} while running this change, which may or may not have been applied. Read the board with ttx_snapshot before trying again.`)
    : new BoardError('tab_closed', `The tab ${what}. Ask the person to open the board again.`)
}

function isLocalHost(host: string | undefined): boolean {
  return !!host && isLocalOrigin(`http://${host}`)
}

function sameSecret(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(given ?? '')
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY) throw new BoardError('too_large', 'Request too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null')
}

const rpcError = (message: string) => ({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })

function send(res: ServerResponse, status: number, text?: string) {
  res.writeHead(status, { 'content-type': 'text/plain' }).end(text)
}

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
}

/** stderr: with stdio, stdout is the MCP protocol. */
export const log = (line: string) => console.error(`[ttx-mcp] ${line}`)
