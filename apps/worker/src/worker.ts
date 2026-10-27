import { DurableObject } from 'cloudflare:workers'
import { DurableObjectSqliteSyncWrapper, SQLiteSyncStorage, TLSocketRoom } from '@tldraw/sync-core'
import type { TLRecord } from '@tldraw/tlschema'
import { schema } from '@ttx/shapes'

/**
 * tldraw sync on Cloudflare. The Worker serves the web app (static assets) and routes
 * /connect/<room>?sessionId=... to that room's Durable Object.
 */

/** One board. Its records live in the Durable Object's SQLite storage. */
export class Room extends DurableObject<Env> {
  private room = new TLSocketRoom<TLRecord, void>({
    schema,
    storage: new SQLiteSyncStorage<TLRecord>({ sql: new DurableObjectSqliteSyncWrapper(this.ctx.storage) }),
    log: console,
  })

  override async fetch(request: Request): Promise<Response> {
    const sessionId = new URL(request.url).searchParams.get('sessionId')
    if (!sessionId) return new Response('Expected ?sessionId=<id>', { status: 400 })
    const { 0: client, 1: server } = new WebSocketPair()
    server.accept()
    this.room.handleSocketConnect({ sessionId, socket: server })
    return new Response(null, { status: 101, webSocket: client })
  }
}

export default {
  async fetch(request, env) {
    const roomId = /^\/connect\/([\w-]{1,64})$/.exec(new URL(request.url).pathname)?.[1]
    if (!roomId) return new Response('Not found', { status: 404 })
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a websocket', { status: 426 })
    return env.ROOMS.get(env.ROOMS.idFromName(roomId)).fetch(request)
  },
} satisfies ExportedHandler<Env>
