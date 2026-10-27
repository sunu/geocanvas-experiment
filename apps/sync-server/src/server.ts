import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

/**
 * Minimal y-websocket compatible server (yjs 13).
 * One Y.Doc per room. Persistence: one snapshot file per room.
 */

const PORT = Number(process.env.PORT ?? 1234)
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(import.meta.dirname, '..', 'data'))
fs.mkdirSync(DATA_DIR, { recursive: true })

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

interface Room {
  name: string
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  conns: Map<WebSocket, Set<number>>
}

const rooms = new Map<string, Room>()
const fileOf = (room: string) => path.join(DATA_DIR, `${encodeURIComponent(room)}.ydoc`)

function send(conn: WebSocket, msg: Uint8Array) {
  if (conn.readyState === conn.OPEN) conn.send(msg, (err) => err && conn.close())
}

function getRoom(name: string): Room {
  let room = rooms.get(name)
  if (room) return room
  const doc = new Y.Doc()
  const file = fileOf(name)
  if (fs.existsSync(file)) Y.applyUpdate(doc, fs.readFileSync(file))
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalState(null)
  room = { name, doc, awareness, conns: new Map() }
  const r = room

  let timer: NodeJS.Timeout | undefined
  doc.on('update', (update: Uint8Array, origin: unknown) => {
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_SYNC)
    syncProtocol.writeUpdate(enc, update)
    const msg = encoding.toUint8Array(enc)
    for (const conn of r.conns.keys()) if (conn !== origin) send(conn, msg)
    clearTimeout(timer)
    timer = setTimeout(() => fs.writeFileSync(file, Y.encodeStateAsUpdate(doc)), 500)
  })

  awareness.on('update', ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
    const changed = [...added!, ...updated!, ...removed!]
    const ids = origin ? r.conns.get(origin as WebSocket) : undefined
    if (ids) {
      for (const id of added!) ids.add(id)
      for (const id of removed!) ids.delete(id)
    }
    const enc = encoding.createEncoder()
    encoding.writeVarUint(enc, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(enc, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
    const msg = encoding.toUint8Array(enc)
    for (const conn of r.conns.keys()) send(conn, msg)
  })

  rooms.set(name, room)
  return room
}

function onConnection(conn: WebSocket, req: http.IncomingMessage) {
  conn.binaryType = 'arraybuffer'
  const name = decodeURIComponent((req.url ?? '/').slice(1).split('?')[0] || 'default')
  const room = getRoom(name)
  room.conns.set(conn, new Set())

  conn.on('message', (data: ArrayBuffer) => {
    try {
      const dec = decoding.createDecoder(new Uint8Array(data))
      const enc = encoding.createEncoder()
      const type = decoding.readVarUint(dec)
      if (type === MESSAGE_SYNC) {
        encoding.writeVarUint(enc, MESSAGE_SYNC)
        syncProtocol.readSyncMessage(dec, enc, room.doc, conn)
        if (encoding.length(enc) > 1) send(conn, encoding.toUint8Array(enc))
      } else if (type === MESSAGE_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(dec), conn)
      }
    } catch (err) {
      console.error(err)
    }
  })

  conn.on('close', () => {
    const ids = room.conns.get(conn)
    room.conns.delete(conn)
    if (ids?.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...ids], null)
    if (room.conns.size === 0) {
      fs.writeFileSync(fileOf(room.name), Y.encodeStateAsUpdate(room.doc))
      room.doc.destroy()
      rooms.delete(room.name)
    }
  })

  // Sync step 1, then the current awareness states.
  const enc = encoding.createEncoder()
  encoding.writeVarUint(enc, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(enc, room.doc)
  send(conn, encoding.toUint8Array(enc))
  const states = room.awareness.getStates()
  if (states.size) {
    const aenc = encoding.createEncoder()
    encoding.writeVarUint(aenc, MESSAGE_AWARENESS)
    encoding.writeVarUint8Array(aenc, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]))
    send(conn, encoding.toUint8Array(aenc))
  }
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' })
  res.end('geo-canvas sync server\n')
})
new WebSocketServer({ server }).on('connection', onConnection)
server.listen(PORT, () => console.log(`sync server on ws://localhost:${PORT}, data in ${DATA_DIR}`))
