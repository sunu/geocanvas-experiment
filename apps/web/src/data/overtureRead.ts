import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import type { Bbox } from '@ttx/plugins'
import {
  collectionFiles,
  collectionUrl,
  filesInBbox,
  itemAsset,
  latestRelease,
  OVERTURE_STAC_CATALOG,
  type OvertureType,
  type ParquetAsset,
  type StacFile,
} from './overture'
import { rowGroupsInBbox } from './wkb'

/**
 * Reads Overture Maps GeoParquet on S3 for a bbox, for the workers that use it (overture.worker.ts for
 * buildings, routing/routing.worker.ts for road segments). Runs in a worker only: hyparquet and ZSTD stay
 * out of the main bundle.
 *
 * STAC catalog -> latest release -> collection (one bbox per file) -> files that intersect the
 * query -> item JSON (HTTPS href and size, so no HEAD) -> footer -> row groups whose `bbox`
 * statistics intersect -> only the needed columns of those row groups, a few at a time and in
 * order, so a caller that stops early, or an abort, stops further downloads. STAC documents, footers
 * and recent row-group bytes are kept in memory.
 */

/** Network and timing figures (requests and bytes since the worker started; ms of this query). */
export interface OvertureStats {
  requests: number
  bytes: number
  ms: number
}

export const stats: OvertureStats = { requests: 0, bytes: 0, ms: 0 }

/** Footers kept in memory (each ~1.2 MB on the wire). */
const MAX_FOOTERS = 8
/** Compressed row-group bytes kept in memory, so a small pan does not download them again. */
const MAX_CACHED_BYTES = 96 * 2 ** 20
/** Row groups downloaded at the same time (about 2 MB each for buildings, 7 MB for road segments). */
const CONCURRENCY = 4

async function fetchOk(url: string, init?: RequestInit): Promise<Response> {
  stats.requests++
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`Overture: HTTP ${res.status} for ${url}`)
  return res
}

async function json(url: string): Promise<unknown> {
  const res = await fetchOk(url)
  const text = await res.text()
  stats.bytes += text.length
  return JSON.parse(text)
}

/** A memoized async value that is forgotten when it fails, so the next call retries. */
function memo<K, V>(load: (key: K) => Promise<V>, max = Infinity): (key: K) => Promise<V> {
  const cache = new Map<K, Promise<V>>()
  return (key) => {
    let p = cache.get(key)
    if (!p) {
      p = load(key)
      cache.set(key, p)
      p.catch(() => cache.delete(key))
      while (cache.size > max) cache.delete(cache.keys().next().value!)
    }
    return p
  }
}

const release = memo(async (_: void) => latestRelease(await json(OVERTURE_STAC_CATALOG)))
const collection = memo(async (url: string): Promise<StacFile[]> => collectionFiles(await json(url), url))
const asset = memo(async (itemUrl: string): Promise<ParquetAsset> => itemAsset(await json(itemUrl)))

/**
 * A Range GET. A 200 instead of a 206 would be the whole file (~600 MB), so it fails instead
 * (hyparquet's asyncBufferFromUrl would accept it).
 */
async function range(href: string, start: number, end: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetchOk(href, { headers: { Range: `bytes=${start}-${end - 1}` }, signal })
  if (res.status !== 206) {
    await res.body?.cancel()
    throw new Error(`Overture: expected a partial response (206), got ${res.status}`)
  }
  const buf = await res.arrayBuffer()
  stats.bytes += buf.byteLength
  return buf
}

/** LRU of byte ranges by url and range (hyparquet asks for the same ranges for the same row group). */
const ranges = new Map<string, { buf: Promise<ArrayBuffer>; size: number }>()
let cachedBytes = 0

function cachedRange(href: string, start: number, end: number, signal: AbortSignal): Promise<ArrayBuffer> {
  const key = `${href}#${start}-${end}`
  const hit = ranges.get(key)
  if (hit) {
    ranges.delete(key)
    ranges.set(key, hit)
    return hit.buf
  }
  const entry = { buf: range(href, start, end, signal), size: end - start }
  ranges.set(key, entry)
  cachedBytes += entry.size
  const forget = () => {
    if (ranges.get(key) !== entry) return
    ranges.delete(key)
    cachedBytes -= entry.size
  }
  entry.buf.catch(forget) // failed or aborted reads are not kept
  for (const [k, e] of ranges) {
    if (cachedBytes <= MAX_CACHED_BYTES || e === entry) break
    ranges.delete(k)
    cachedBytes -= e.size
  }
  return entry.buf
}

// Keyed by the asset object, which `asset` keeps one of per item. Footers are shared by queries,
// so they are read without a query's abort signal, and not through the range cache.
const footer = memo(
  (a: ParquetAsset): Promise<FileMetaData> =>
    parquetMetadataAsync({ byteLength: a.size, slice: (s, e = a.size) => range(a.href, s, e) }),
  MAX_FOOTERS,
)

/** Runs tasks with at most `concurrency` in flight and yields their results in task order. */
async function* inOrder<T>(tasks: (() => Promise<T>)[], concurrency: number): AsyncGenerator<T> {
  const started: Promise<T>[] = []
  for (let i = 0; i < tasks.length; i++) {
    while (started.length < Math.min(tasks.length, i + concurrency)) {
      const p = tasks[started.length]!()
      p.catch(() => {}) // awaited below, or abandoned when the caller stops early
      started.push(p)
    }
    yield await started[i]!
  }
}

export interface ReadOptions {
  columns: string[]
  signal: AbortSignal
  /** hyparquet parsers, e.g. to keep geometry as WKB (the default decodes it to GeoJSON). */
  parsers?: Record<string, unknown>
  /** More row groups than this fail before any download. */
  maxRowGroups?: number
}

/**
 * The rows of the row groups that may hold features in `bbox`, one row group at a time, in file order.
 * Rows are not filtered by bbox: the caller does that with the `bbox` column.
 */
export async function* readOverture<T>(type: OvertureType, bbox: Bbox, { columns, signal, parsers, maxRowGroups = Infinity }: ReadOptions): AsyncGenerator<T[]> {
  const files = filesInBbox(await collection(collectionUrl(await release(), type)), bbox)
  const tasks: (() => Promise<T[]>)[] = []
  for (const f of files) {
    const a = await asset(f.item)
    const metadata = await footer(a)
    signal.throwIfAborted()
    for (const { rowStart, rowEnd } of rowGroupsInBbox(metadata.row_groups, bbox)) {
      tasks.push(() => readRowGroup<T>(a, metadata, rowStart, rowEnd, columns, signal, parsers))
    }
  }
  if (tasks.length > maxRowGroups) throw new Error(`Area too large: ${tasks.length} parts of the Overture data to read (at most ${maxRowGroups})`)
  for await (const rows of inOrder(tasks, CONCURRENCY)) {
    signal.throwIfAborted()
    yield rows
  }
}

async function readRowGroup<T>(
  a: ParquetAsset,
  metadata: FileMetaData,
  rowStart: number,
  rowEnd: number,
  columns: string[],
  signal: AbortSignal,
  parsers: Record<string, unknown> | undefined,
): Promise<T[]> {
  const file: AsyncBuffer = { byteLength: a.size, slice: (s, e = a.size) => cachedRange(a.href, s, e, signal) }
  return (await parquetReadObjects({ file, metadata, columns, rowStart, rowEnd, compressors, ...(parsers && { parsers }) })) as unknown as T[]
}
