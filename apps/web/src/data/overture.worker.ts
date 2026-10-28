/**
 * Reads Overture Maps buildings (GeoParquet on S3) in a worker, so ZSTD, Parquet and WKB decoding
 * never block the canvas (plans/plan-006.md on feat/tools-registry, section 6.4).
 *
 * STAC catalog -> latest release -> collection (one bbox per file) -> files that intersect the
 * query -> item JSON (HTTPS href and size, so no HEAD) -> footer -> row groups whose `bbox`
 * statistics intersect -> only the needed columns of those row groups, a few at a time and in
 * order, so the feature cap and an abort stop further downloads. Rows are filtered by their `bbox`
 * column. STAC documents, footers and recent row-group bytes are kept in memory.
 */
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import {
  appendBuildings,
  collectionFiles,
  collectionUrl,
  filesInBbox,
  itemAsset,
  latestRelease,
  OVERTURE_BUILDING_COLUMNS,
  OVERTURE_STAC_CATALOG,
  type BuildingFeature,
  type OvertureBuildingRow,
  type OvertureType,
  type ParquetAsset,
  type StacFile,
} from './overture'
import { rowGroupsInBbox } from './wkb'
import type { Bbox } from '@ttx/plugins'

export type OvertureRequest =
  | { kind: 'query'; id: number; type: OvertureType; bbox: Bbox; limit: number }
  | { kind: 'abort'; id: number }
export type OvertureResponse =
  | { id: number; ok: true; value: GeoJSON.FeatureCollection & { truncated?: boolean }; stats: OvertureStats }
  | { id: number; ok: false; error: string }
/** Network and timing figures (requests and bytes since the worker started; ms of this query). */
export interface OvertureStats {
  requests: number
  bytes: number
  ms: number
}

const stats: OvertureStats = { requests: 0, bytes: 0, ms: 0 }

/** Footers kept in memory (each ~1.2 MB on the wire). */
const MAX_FOOTERS = 8
/** Compressed row-group bytes kept in memory, so a small pan does not download them again. */
const MAX_CACHED_BYTES = 96 * 2 ** 20
/** Row groups downloaded at the same time (about 2 MB each for buildings). */
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

async function readRowGroup(a: ParquetAsset, metadata: FileMetaData, rowStart: number, rowEnd: number, signal: AbortSignal) {
  const file: AsyncBuffer = { byteLength: a.size, slice: (s, e = a.size) => cachedRange(a.href, s, e, signal) }
  return (await parquetReadObjects({
    file,
    metadata,
    columns: OVERTURE_BUILDING_COLUMNS,
    rowStart,
    rowEnd,
    compressors,
    // Keep WKB: only rows inside the bbox are decoded (wkb.ts wkbToGeometry).
    parsers: { geometryFromBytes: (b: Uint8Array) => b },
  })) as unknown as OvertureBuildingRow[]
}

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

const controllers = new Map<number, AbortController>()

async function query(type: OvertureType, bbox: Bbox, limit: number, signal: AbortSignal) {
  const files = filesInBbox(await collection(collectionUrl(await release(), type)), bbox)
  const tasks: (() => Promise<OvertureBuildingRow[]>)[] = []
  for (const f of files) {
    const a = await asset(f.item)
    const metadata = await footer(a)
    signal.throwIfAborted()
    for (const { rowStart, rowEnd } of rowGroupsInBbox(metadata.row_groups, bbox)) {
      tasks.push(() => readRowGroup(a, metadata, rowStart, rowEnd, signal))
    }
  }
  const features: BuildingFeature[] = []
  for await (const rows of inOrder(tasks, CONCURRENCY)) {
    signal.throwIfAborted()
    // At the cap: the caller aborts the row groups still in flight.
    if (appendBuildings(features, rows, bbox, limit)) return { type: 'FeatureCollection' as const, features, truncated: true }
  }
  return { type: 'FeatureCollection' as const, features }
}

self.onmessage = async ({ data }: MessageEvent<OvertureRequest>) => {
  if (data.kind === 'abort') {
    controllers.get(data.id)?.abort()
    return
  }
  const t0 = performance.now()
  const controller = new AbortController()
  controllers.set(data.id, controller)
  let res: OvertureResponse
  try {
    const value = await query(data.type, data.bbox, data.limit, controller.signal)
    res = { id: data.id, ok: true, value, stats: { ...stats, ms: Math.round(performance.now() - t0) } }
  } catch (e) {
    res = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    controller.abort() // stops reads still in flight (after truncation or an error)
    controllers.delete(data.id)
  }
  self.postMessage(res)
}
