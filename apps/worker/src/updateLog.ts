/**
 * A room's saved Yjs updates, oldest first, in the Durable Object's SQLite.
 *
 * Cloudflare caps a SQLite row (and any one value) at 2 MB. An update bigger than CHUNK_BYTES,
 * such as one huge paste or a whole compacted board, is stored as consecutive rows:
 * `more = 1` means the next row continues the same update.
 */

/** The parts of the Durable Object storage API this uses. */
export interface Storage {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } }
  transactionSync<T>(fn: () => T): T
}

/** Well under the 2 MB row limit. */
export const CHUNK_BYTES = 1_000_000

export class UpdateLog {
  private storage: Storage

  constructor(storage: Storage) {
    this.storage = storage
    const sql = storage.sql
    sql.exec('CREATE TABLE IF NOT EXISTS updates (id INTEGER PRIMARY KEY AUTOINCREMENT, data BLOB NOT NULL, more INTEGER NOT NULL DEFAULT 0)')
    // Rooms saved before updates could span rows have no `more` column: each of their rows is a whole update.
    const columns = sql.exec('PRAGMA table_info(updates)').toArray()
    if (!columns.some((c) => c.name === 'more')) sql.exec('ALTER TABLE updates ADD COLUMN more INTEGER NOT NULL DEFAULT 0')
  }

  /** Every saved update, oldest first. */
  readAll(): Uint8Array[] {
    const updates: Uint8Array[] = []
    let parts: Uint8Array[] = []
    for (const row of this.storage.sql.exec('SELECT data, more FROM updates ORDER BY id').toArray()) {
      parts.push(new Uint8Array(row.data as ArrayBuffer))
      if (!row.more) {
        updates.push(concat(parts))
        parts = []
      }
    }
    return updates
  }

  append(update: Uint8Array) {
    this.storage.transactionSync(() => this.insert(update))
  }

  /** Replace every saved update with one (the compacted board). */
  replaceAll(update: Uint8Array) {
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM updates')
      this.insert(update)
    })
  }

  private insert(update: Uint8Array) {
    let start = 0
    do {
      const end = Math.min(start + CHUNK_BYTES, update.length)
      this.storage.sql.exec('INSERT INTO updates (data, more) VALUES (?, ?)', toArrayBuffer(update.subarray(start, end)), end < update.length ? 1 : 0)
      start = end
    } while (start < update.length)
  }
}

/** SQLite blobs must be ArrayBuffers; a Uint8Array would not be stored as bytes. */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let offset = 0
  for (const p of parts) {
    out.set(p, offset)
    offset += p.length
  }
  return out
}
