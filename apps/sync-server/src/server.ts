import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { WebSocketServer } from 'ws'
import { NodeSqliteWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'
import { schema } from '@ttx/shapes'

/**
 * tldraw sync server. One room per board, stored in data/<room>.db.
 * Clients connect to ws://host:PORT/connect/<room>?sessionId=...
 */

const PORT = Number(process.env.PORT ?? 5858)
const DATA_DIR = new URL('../data/', import.meta.url)
mkdirSync(DATA_DIR, { recursive: true })

interface OpenRoom {
  room: TLSocketRoom<TLRecord, void>
  db: DatabaseSync
}

const rooms = new Map<string, OpenRoom>()

function openRoom(id: string): OpenRoom {
  const open = rooms.get(id)
  if (open) return open
  const db = new DatabaseSync(new URL(`${id}.db`, DATA_DIR).pathname)
  const storage = new SQLiteSyncStorage<TLRecord>({ sql: new NodeSqliteWrapper(db) })
  const room = new TLSocketRoom<TLRecord, void>({
    schema,
    storage,
    log: console,
    // Close the room when the last person leaves. Its state stays in the database.
    onSessionRemoved(r, { numSessionsRemaining }) {
      if (numSessionsRemaining > 0) return
      r.close()
      db.close()
      rooms.delete(id)
    },
  })
  rooms.set(id, { room, db })
  return { room, db }
}

const server = createServer((_req, res) => {
  res.writeHead(404).end()
})
const wss = new WebSocketServer({ server })

wss.on('connection', (socket, req) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const roomId = /^\/connect\/([\w-]{1,64})$/.exec(url.pathname)?.[1]
  const sessionId = url.searchParams.get('sessionId')
  if (!roomId || !sessionId) {
    socket.close(1008, 'Expected /connect/<room>?sessionId=<id>')
    return
  }
  openRoom(roomId).room.handleSocketConnect({ sessionId, socket })
})

server.listen(PORT, () => console.log(`sync server on ws://localhost:${PORT}/connect/<room>`))
