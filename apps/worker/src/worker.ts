import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { montySearch } from './monty'

/**
 * Multiplayer on Cloudflare. The Worker serves the web app (static assets) and routes
 * /connect/<room> to that room's Durable Object, which speaks the standard y-websocket
 * protocol (sync + awareness), so the browser uses y-websocket's WebsocketProvider.
 * /monty/search proxies Montandon STAC searches with the token added (monty.ts).
 */

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
/** Merge the stored updates into one row when there are more than this. */
const COMPACT_AFTER = 500

/** One board. Its Yjs updates are appended to the Durable Object's SQLite as they arrive. */
export class Room extends DurableObject<Env> {
  private doc = new Y.Doc()
  private awareness = new awarenessProtocol.Awareness(this.doc)
  /** Open sockets, with the awareness client ids each one controls. */
  private sockets = new Map<WebSocket, Set<number>>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.awareness.setLocalState(null)
    const sql = ctx.storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')
    const rows = sql.exec<{ data: ArrayBuffer }>('SELECT data FROM updates ORDER BY id').toArray()
    for (const row of rows) Y.applyUpdate(this.doc, new Uint8Array(row.data), this)
    if (rows.length > COMPACT_AFTER) this.compact()

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== this) sql.exec('INSERT INTO updates (data) VALUES (?)', toArrayBuffer(update))
      this.broadcast(syncMessage((enc) => syncProtocol.writeUpdate(enc, update)))
    })
    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange, socket: WebSocket | null) => {
      const ids = socket && this.sockets.get(socket)
      if (ids) {
        for (const id of added) ids.add(id)
        for (const id of removed) ids.delete(id)
      }
      const changed = [...added, ...updated, ...removed]
      this.broadcast(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed)))
    })
  }

  override async fetch(): Promise<Response> {
    const { 0: client, 1: socket } = new WebSocketPair()
    // Binary frames as ArrayBuffers; the runtime's default is Blob, which cannot be read synchronously.
    socket.binaryType = 'arraybuffer'
    socket.accept()
    this.sockets.set(socket, new Set())
    socket.addEventListener('message', (e) => {
      // The y-websocket protocol is binary only.
      if (e.data instanceof ArrayBuffer) this.receive(socket, new Uint8Array(e.data))
    })
    socket.addEventListener('close', () => this.disconnect(socket))
    socket.addEventListener('error', () => this.disconnect(socket))

    // Start the sync handshake, and send who else is here.
    socket.send(syncMessage((enc) => syncProtocol.writeSyncStep1(enc, this.doc)))
    const states = [...this.awareness.getStates().keys()]
    if (states.length) socket.send(awarenessMessage(awarenessProtocol.encodeAwarenessUpdate(this.awareness, states)))
    return new Response(null, { status: 101, webSocket: client })
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
    const ids = this.sockets.get(socket)
    if (!ids) return
    this.sockets.delete(socket)
    awarenessProtocol.removeAwarenessStates(this.awareness, [...ids], null)
  }

  private broadcast(message: Uint8Array) {
    for (const socket of this.sockets.keys()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message)
    }
  }

  private compact() {
    const state = Y.encodeStateAsUpdate(this.doc)
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec('DELETE FROM updates')
      this.ctx.storage.sql.exec('INSERT INTO updates (data) VALUES (?)', toArrayBuffer(state))
    })
  }
}

/** SQLite blobs must be ArrayBuffers; a Uint8Array would not be stored as bytes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

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
    const roomId = /^\/connect\/([\w-]{1,64})$/.exec(path)?.[1]
    if (!roomId) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 })
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request)
  },
} satisfies ExportedHandler<Env>
