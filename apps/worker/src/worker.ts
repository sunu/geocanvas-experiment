import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { geocode } from './geocode'
import { hapiProxy } from './hapi'
import { montySearch, stacSearch } from './monty'
import { notebooksProxy } from './notebooks'
import { reliefwebUpdates } from './reliefweb'
import { json, serveUpload, storeUpload } from './uploads'
import { uploadUrl, Uploads } from '@ttx/core'
import type { Runtime } from '@ttx/core'
import { Agent, AGENT, eventsGet, eventsSearch, forRoom, geocodeTools, OpenCageGeocoder, OPENCAGE_URL, openeoCollections, openeoCoverage, openeoPreview, openRouter, TURNS_PER_HOUR } from '@ttx/plugins'
import { MontyClient } from '@ttx/plugins/monty/client'
import { UpdateLog } from './updateLog'
import { OpenEOServiceManager } from './openeo'
import { OpenEOClient, type OpenEOCredentials } from './openeoClient'
import { previewOpenEOAnalysis } from './openeoPreview'

/**
 * Multiplayer on Cloudflare. The Worker serves the web app (static assets) and routes
 * /connect/<room> to that room's Durable Object, which speaks the standard y-websocket
 * protocol (sync + awareness), so the browser uses y-websocket's WebsocketProvider.
 * /monty/search proxies Montandon STAC searches with the token added (monty.ts),
 * /tools/geocode proxies OpenCage with the key added (geocode.ts), and /notebooks/* and
 * /reliefweb/updates read Notebook Factory and ReliefWeb, which send no CORS headers (notebooks.ts, reliefweb.ts),
 * and /hapi/* reads HDX HAPI with the app identifier added (hapi.ts).
 * POST /uploads goes to the room the file is for, which stores it in R2 and lists it on the board;
 * GET /uploads/<id> serves it (uploads.ts).
 * Each room also runs the board's agent (Agent in @ttx/plugins), which answers the chat messages
 * that no browser tab answers on its own key.
 */

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
/** Merge the stored updates into one row when there are more than this: on load, and while the room runs. */
const COMPACT_AFTER = 500
/** Same rule as the browser's #room=<id>. */
const ROOM_ID = /^[\w-]{1,64}$/

/**
 * One board. Its Yjs updates are appended to the Durable Object's SQLite as they arrive (updateLog.ts).
 *
 * Websockets use the Hibernation API: Cloudflare holds the connections, and the room can leave
 * memory between messages, so an open but idle tab costs no duration. (With socket.accept() the
 * room is billed for as long as any tab is connected, which used up the free plan's daily
 * allowance.) After a wake the constructor runs again and rebuilds the doc from storage. Presence
 * (awareness) is kept in memory only: it starts empty after a wake, and browsers re-send theirs
 * every 15 s.
 */
export class Room extends DurableObject<Env> {
  private doc = new Y.Doc()
  private log: UpdateLog
  /** Updates in the log since it was last compacted. */
  private logged = 0
  private awareness = new awarenessProtocol.Awareness(this.doc)
  private uploads = new Uploads(this.doc)
  private runtime?: Runtime
  private openeo?: OpenEOClient
  private previewRunning = false

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.awareness.setLocalState(null)
    // Its timer expires stale presence; a pending timer would keep the room awake. Presence is
    // removed when a socket closes instead.
    clearInterval(this.awareness._checkInterval)
    this.log = new UpdateLog(ctx.storage)
    const updates = this.log.readAll()
    for (const update of updates) Y.applyUpdate(this.doc, update, this)
    this.logged = updates.length
    if (this.logged > COMPACT_AFTER) this.compact()

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== this) {
        this.log.append(update)
        // A busy room may stay in memory for long (map pans, the agent), so do not wait for a load to compact.
        if (++this.logged > COMPACT_AFTER) this.compact()
      }
      this.broadcast(syncMessage((enc) => syncProtocol.writeUpdate(enc, update)))
    })
    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange, socket: unknown) => {
      // Which presence ids a socket controls is kept on the socket, so it survives hibernation.
      // The origin is the socket for a browser's update, and 'local' for the agent's own presence.
      if (socket instanceof WebSocket) {
        const ids = new Set(presenceIds(socket))
        for (const id of added) ids.add(id)
        for (const id of removed) ids.delete(id)
        socket.serializeAttachment({ presenceIds: [...ids] } satisfies SocketAttachment)
      }
      const changed = [...added, ...updated, ...removed]
      this.broadcast(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)))
    })

    // openEO is optional in deployed previews. Local development supplies the user credentials
    // through npm run sync and apps/worker/.dev.vars; these are never bundled into browser assets.
    const openeo = new OpenEOClient(env as Env & OpenEOCredentials)
    this.openeo = openeo

    // After the listeners above, so the agent's writes are stored and sent like anyone's.
    const agent = new Agent({
      doc: this.doc,
      complete: env.OPENROUTER_API_KEY ? openRouter(env.OPENROUTER_API_KEY, env.AGENT_MODEL) : undefined,
      accepts: forRoom,
      turnsPerHour: TURNS_PER_HOUR,
      tools: [
        ...(env.OPENCAGE_API_KEY ? geocodeTools(new OpenCageGeocoder({ url: OPENCAGE_URL, key: env.OPENCAGE_API_KEY })) : []),
        ...(env.MONTANDON_TOKEN ? montyTools(new MontyClient(stacSearch({ baseUrl: env.MONTANDON_BASE_URL, token: env.MONTANDON_TOKEN }))) : []),
        // Anonymous reads of EOPF's catalog, so an agent checks for scenes before it proposes an openEO layer.
        openeoCollections(env.OPENEO_BASE_URL),
        openeoCoverage(env.OPENEO_BASE_URL),
        // A dry run of a graph needs the Worker's Copernicus login, so only the room's agent has it, and only with one.
        ...(openeo.hasCredentials
          ? [openeoPreview((graph, signal) => openeo.request('/result', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ process: { process_graph: graph } }), signal }))]
          : []),
      ],
      // The agent's presence: people see "Agent is thinking…" while it works.
      onBusy: (busy) => this.awareness.setLocalState(busy ? { user: AGENT, status: 'thinking' } : null),
      keepAlive: (work) => ctx.waitUntil(work),
    })
    this.runtime = agent.runtime
    new OpenEOServiceManager(agent.runtime, openeo, (work) => ctx.waitUntil(work)).start()
  }

  private compact() {
    this.log.replaceAll(Y.encodeStateAsUpdate(this.doc))
    this.logged = 1
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname
    if (path === '/uploads') return this.upload(request)
    if (path === '/openeo/preview') return this.previewOpenEO(request)
    const { 0: client, 1: socket } = new WebSocketPair()
    this.ctx.acceptWebSocket(socket)
    socket.serializeAttachment({ presenceIds: [] } satisfies SocketAttachment)

    // Start the sync handshake, and send who else is here.
    socket.send(syncMessage((enc) => syncProtocol.writeSyncStep1(enc, this.doc)))
    const states = [...this.awareness.getStates().keys()]
    if (states.length) socket.send(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)))
    return new Response(null, { status: 101, webSocket: client })
  }

  /** Explicit user action: render the board's stored proposal once, without creating an openEO service. */
  private async previewOpenEO(request: Request): Promise<Response> {
    if (request.method !== 'POST') return json(405, { error: 'POST only' })
    if (Number(request.headers.get('content-length')) > 2048) return json(413, { error: 'Request is too large' })
    const body = await request.json().catch(() => null) as { analysisId?: unknown } | null
    if (!body || typeof body.analysisId !== 'string' || body.analysisId.length > 128) return json(400, { error: 'Name the proposal to preview' })
    if (!this.runtime || !this.openeo) return json(503, { error: 'openEO preview is not available on this server.' })
    if (this.previewRunning) return json(409, { error: 'An openEO preview is already running on this board; try again when it finishes.' })

    this.previewRunning = true
    try {
      const result = await previewOpenEOAnalysis(this.runtime, this.openeo, body.analysisId)
      return json(result.status, result)
    } finally {
      this.previewRunning = false
    }
  }

  /** Store a file for this board and add it to the board's uploads list, which syncs like any edit. */
  private async upload(request: Request): Promise<Response> {
    const room = new URL(request.url).searchParams.get('room')!
    const upload = await storeUpload(request, this.env.UPLOADS, room)
    if (upload instanceof Response) return upload
    this.uploads.add(upload)
    return json(201, { id: upload.id, url: uploadUrl(upload.id) })
  }

  override webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    // The y-websocket protocol is binary only.
    if (typeof message !== 'string') this.receive(socket, new Uint8Array(message))
  }

  override webSocketClose(socket: WebSocket) {
    this.disconnect(socket)
  }

  override webSocketError(socket: WebSocket) {
    this.disconnect(socket)
  }

  private receive(socket: WebSocket, data: Uint8Array) {
    const decoder = decoding.createDecoder(data)
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      syncProtocol.readSyncMessage(decoder, encoder, this.doc, socket)
      // Only a reply to sync step 1 has a body.
      if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder))
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), socket)
    }
  }

  private disconnect(socket: WebSocket) {
    const ids = presenceIds(socket)
    if (ids.length) awarenessProtocol.removeAwarenessStates(this.awareness, ids, null)
  }

  private broadcast(message: Uint8Array) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }
}

/** Kept on each socket with serializeAttachment, so it survives hibernation. */
interface SocketAttachment {
  presenceIds: number[]
}

/** Montandon search and lookup, on one client so they share its cache. */
const montyTools = (monty: MontyClient) => [eventsSearch(monty), eventsGet(monty)]

const presenceIds = (socket: WebSocket): number[] => (socket.deserializeAttachment() as SocketAttachment | null)?.presenceIds ?? []

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}

function syncMessage(write: (enc: encoding.Encoder) => void): Uint8Array {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MESSAGE_SYNC)
  write(enc)
  return encoding.toUint8Array(enc)
}

function awarenessMessage(update: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(enc, update)
  return encoding.toUint8Array(enc)
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname
    if (path === '/monty/search') return montySearch(request, { baseUrl: env.MONTANDON_BASE_URL, token: env.MONTANDON_TOKEN })
    if (path === '/tools/geocode') return geocode(request, env.OPENCAGE_API_KEY)
    // What the room's agent can do, so the app offers only what works (e.g. a map's "describe it in words").
    if (path === '/agent/status') return json(200, { configured: !!env.OPENROUTER_API_KEY, geocode: !!env.OPENCAGE_API_KEY })
    if (path.startsWith('/notebooks/')) return notebooksProxy(request, env.NOTEBOOK_FACTORY_URL)
    if (path === '/reliefweb/updates') return reliefwebUpdates(request)
    if (path.startsWith('/hapi/')) return hapiProxy(request, env.HAPI_APP_IDENTIFIER)
    if (path === '/uploads') {
      if (request.method !== 'POST') return json(405, { error: 'POST only' })
      const room = new URL(request.url).searchParams.get('room') ?? ''
      if (!ROOM_ID.test(room)) return json(400, { error: 'Name the room the file is for: ?room=<room>' })
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request)
    }
    if (path === '/openeo/preview') {
      if (request.method !== 'POST') return json(405, { error: 'POST only' })
      const room = new URL(request.url).searchParams.get('room') ?? ''
      if (!ROOM_ID.test(room)) return json(400, { error: 'Name the room the proposal is in: ?room=<room>' })
      return env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(request)
    }
    if (path.startsWith('/uploads/')) return serveUpload(request, env.UPLOADS)
    const roomId = /^\/connect\/([\w-]{1,64})$/.exec(path)?.[1]
    if (!roomId) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 })
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request)
  },
} satisfies ExportedHandler<Env>
