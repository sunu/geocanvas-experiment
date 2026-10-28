import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { Agent, AGENT } from './agent/agent'
import { openRouter } from './agent/openrouter'
import { eventsSearch, geocodeSearch } from './agent/tools'
import { geocode } from './geocode'
import { montySearch, stacSearch } from './monty'
import { MontyClient } from '@ttx/plugins/monty/client'
import { UpdateLog } from './updateLog'

/**
 * Multiplayer on Cloudflare. The Worker serves the web app (static assets) and routes
 * /connect/<room> to that room's Durable Object, which speaks the standard y-websocket
 * protocol (sync + awareness), so the browser uses y-websocket's WebsocketProvider.
 * /monty/search proxies Montandon STAC searches with the token added (monty.ts), and
 * /tools/geocode proxies OpenCage with the key added (geocode.ts).
 * Each room also runs the board's agent (agent/agent.ts), which answers the board's chat.
 */

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
/** Merge the stored updates into one row when there are more than this: on load, and while the room runs. */
const COMPACT_AFTER = 500

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

    // After the listeners above, so the agent's writes are stored and sent like anyone's.
    new Agent({
      doc: this.doc,
      complete: env.OPENROUTER_API_KEY ? openRouter(env.OPENROUTER_API_KEY, env.AGENT_MODEL) : undefined,
      tools: [
        geocodeSearch,
        ...(env.MONTANDON_TOKEN ? [eventsSearch(new MontyClient(stacSearch({ baseUrl: env.MONTANDON_BASE_URL, token: env.MONTANDON_TOKEN })))] : []),
      ],
      // The agent's presence: people see "Agent is thinking…" while it works.
      onBusy: (busy) => this.awareness.setLocalState(busy ? { user: AGENT, status: 'thinking' } : null),
      keepAlive: (work) => ctx.waitUntil(work),
    })
  }

  private compact() {
    this.log.replaceAll(Y.encodeStateAsUpdate(this.doc))
    this.logged = 1
  }

  override async fetch(): Promise<Response> {
    const { 0: client, 1: socket } = new WebSocketPair()
    this.ctx.acceptWebSocket(socket)
    socket.serializeAttachment({ presenceIds: [] } satisfies SocketAttachment)

    // Start the sync handshake, and send who else is here.
    socket.send(syncMessage((enc) => syncProtocol.writeSyncStep1(enc, this.doc)))
    const states = [...this.awareness.getStates().keys()]
    if (states.length) socket.send(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)))
    return new Response(null, { status: 101, webSocket: client })
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
    const roomId = /^\/connect\/([\w-]{1,64})$/.exec(path)?.[1]
    if (!roomId) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 })
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request)
  },
} satisfies ExportedHandler<Env>
