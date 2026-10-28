import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { CHUNK_BYTES, UpdateLog, type Storage } from '../src/updateLog'

/** Cloudflare's limit on one SQLite row or value. */
const ROW_LIMIT = 2_000_000

/** Durable Object storage on an in-memory SQLite, refusing blobs over Cloudflare's row limit. */
function memoryStorage() {
  const db = new DatabaseSync(':memory:')
  const storage: Storage = {
    sql: {
      exec(query, ...bindings) {
        const values = bindings.map((b) => {
          if (!(b instanceof ArrayBuffer)) return b
          if (b.byteLength > ROW_LIMIT) throw new Error('SQLITE_TOOBIG: row over 2 MB')
          return new Uint8Array(b)
        })
        const rows = db.prepare(query).all(...(values as never[]))
        return { toArray: () => rows as Record<string, unknown>[] }
      },
    },
    transactionSync(fn) {
      db.exec('BEGIN')
      try {
        const result = fn()
        db.exec('COMMIT')
        return result
      } catch (err) {
        db.exec('ROLLBACK')
        throw err
      }
    },
  }
  return { db, storage }
}

/** n bytes in a pattern set by seed. A plain loop: building megabytes through a callback is slow on CI. */
function bytes(n: number, seed: number) {
  const out = new Uint8Array(n)
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) % 251
  return out
}

/** Same updates, compared as bytes (toEqual walks megabyte arrays element by element). */
function expectUpdates(actual: Uint8Array[], expected: Uint8Array[]) {
  expect(actual.map((u) => u.length)).toEqual(expected.map((u) => u.length))
  actual.forEach((u, i) => expect(Buffer.compare(u, expected[i]!)).toBe(0))
}

describe('UpdateLog', () => {
  it('keeps small updates whole and in order', () => {
    const log = new UpdateLog(memoryStorage().storage)
    log.append(bytes(10, 1))
    log.append(bytes(20, 2))
    expectUpdates(log.readAll(), [bytes(10, 1), bytes(20, 2)])
  })

  it('splits an update over the row limit across rows and reads it back whole, between small ones', () => {
    const { db, storage } = memoryStorage()
    const log = new UpdateLog(storage)
    const big = bytes(2_500_000, 3)
    log.append(bytes(5, 4))
    log.append(big)
    log.append(bytes(6, 5))

    const rows = db.prepare('SELECT length(data) AS n, more FROM updates ORDER BY id').all() as { n: number; more: number }[]
    expect(rows.map((r) => r.more)).toEqual([0, 1, 1, 0, 0])
    expect(Math.max(...rows.map((r) => r.n))).toBe(CHUNK_BYTES)
    expectUpdates(log.readAll(), [bytes(5, 4), big, bytes(6, 5)])
  })

  it('replaces everything with one compacted update, even one over the row limit', () => {
    const log = new UpdateLog(memoryStorage().storage)
    for (let i = 0; i < 3; i++) log.append(bytes(100, i))
    const state = bytes(3_200_000, 9)
    log.replaceAll(state)
    expectUpdates(log.readAll(), [state])
  })

  it('reads rooms saved before updates could span rows', () => {
    const { db, storage } = memoryStorage()
    db.exec('CREATE TABLE updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL)')
    db.prepare('INSERT INTO updates (data) VALUES (?)').run(bytes(7, 6))
    db.prepare('INSERT INTO updates (data) VALUES (?)').run(bytes(8, 7))

    const log = new UpdateLog(storage)
    log.append(bytes(9, 8))
    expectUpdates(log.readAll(), [bytes(7, 6), bytes(8, 7), bytes(9, 8)])
  })

  it('restores a board whose saved state is over the row limit', () => {
    const doc = new Y.Doc()
    const text = 'Situation report. '.repeat(200_000) // about 3.6 MB
    doc.getMap('objects').set('t', new Y.Map(Object.entries({ type: 'text', text })))
    const log = new UpdateLog(memoryStorage().storage)
    log.replaceAll(Y.encodeStateAsUpdate(doc))

    const restored = new Y.Doc()
    for (const update of log.readAll()) Y.applyUpdate(restored, update)
    expect((restored.getMap('objects').get('t') as Y.Map<string>).get('text')).toBe(text)
  })
})
