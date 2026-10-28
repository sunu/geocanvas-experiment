/**
 * Reads World Bank admin 0 boundaries (GeoParquet on Source Cooperative) in a worker, so the
 * ZSTD and WKB decoding never blocks the canvas (plans/plan-006.md on feat/tools-registry, section 6.3).
 *
 * The file has one row group and no page index, and its geometry column is a single ~51 MB
 * dictionary page: no reader can fetch some countries only. So:
 * - the small columns (bbox, names) are read with range requests and pick the candidate rows;
 * - the geometry column chunk is downloaded once, kept in the Cache API (keyed by ETag and byte
 *   range) so later page loads skip the download, and decoded once per worker;
 * - only candidate rows are turned into GeoJSON (worldBank.ts `admin0Features`).
 */
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import {
  admin0Features,
  candidateRows,
  WORLD_BANK_ADMIN0_COLUMNS,
  WORLD_BANK_ADMIN0_URL,
  type WorldBankAdmin0Row,
} from './worldBank'
import type { Bbox } from '@ttx/plugins'

export type Admin0Request = { id: number; bbox: Bbox }
export type Admin0Response =
  | { id: number; ok: true; value: GeoJSON.FeatureCollection; stats: Admin0Stats }
  | { id: number; ok: false; error: string }
/** Network and timing figures since the worker started (for measuring the cost). */
export interface Admin0Stats {
  requests: number
  bytes: number
  geometryFromCache: boolean | null
  ms: number
}

const CACHE_NAME = 'world-bank-admin0'
const stats: Admin0Stats = { requests: 0, bytes: 0, geometryFromCache: null, ms: 0 }

async function get(init?: RequestInit): Promise<Response> {
  stats.requests++
  const res = await fetch(WORLD_BANK_ADMIN0_URL, init)
  if (!res.ok) throw new Error(`World Bank boundaries: HTTP ${res.status}`)
  return res
}

async function range(start: number, end: number): Promise<ArrayBuffer> {
  const buf = await (await get({ headers: { Range: `bytes=${start}-${end - 1}` } })).arrayBuffer()
  stats.bytes += buf.byteLength
  return buf
}

interface Table {
  rows: WorldBankAdmin0Row[]
  /** Raw WKB per row, loaded on the first query that has candidates. */
  geometry: () => Promise<Uint8Array[]>
}

let table: Promise<Table> | undefined

async function openTable(): Promise<Table> {
  const head = await get({ method: 'HEAD' })
  const byteLength = Number(head.headers.get('content-length'))
  const etag = head.headers.get('etag') ?? ''
  const file: AsyncBuffer = { byteLength, slice: range }
  const metadata = await parquetMetadataAsync(file, { geoparquet: false })
  const rows = (await parquetReadObjects({
    file,
    metadata,
    columns: [...WORLD_BANK_ADMIN0_COLUMNS],
    compressors,
  })) as WorldBankAdmin0Row[]
  let geometry: Promise<Uint8Array[]> | undefined
  const loadGeometry = () =>
    readGeometry(metadata, byteLength, etag).catch((e) => {
      geometry = undefined // retry on the next query
      throw e
    })
  return { rows, geometry: () => (geometry ??= loadGeometry()) }
}

/** Byte range of the geometry column chunk (dictionary page + data pages). */
function geometryChunk(metadata: FileMetaData): [number, number] {
  if (metadata.row_groups.length !== 1) throw new Error('Expected one row group')
  const col = metadata.row_groups[0]!.columns.find((c) => c.meta_data?.path_in_schema.join('.') === 'geometry')?.meta_data
  if (!col) throw new Error('No geometry column')
  const start = Number(col.dictionary_page_offset ?? col.data_page_offset)
  return [start, start + Number(col.total_compressed_size)]
}

async function cachedRange(start: number, end: number, etag: string): Promise<ArrayBuffer> {
  // Only a cache key, never fetched. A new ETag or range (new file version) is a new key.
  const key = `${WORLD_BANK_ADMIN0_URL}?cache=${encodeURIComponent(etag)}&bytes=${start}-${end}`
  const cache = typeof caches === 'undefined' ? undefined : await caches.open(CACHE_NAME)
  const hit = await cache?.match(key)
  if (hit) {
    stats.geometryFromCache = true
    return hit.arrayBuffer()
  }
  stats.geometryFromCache = false
  const buf = await range(start, end)
  if (cache) {
    for (const old of await cache.keys()) await cache.delete(old)
    // Cache storage can be full or disabled; the data still works without it.
    await cache.put(key, new Response(buf)).catch(() => {})
  }
  return buf
}

async function readGeometry(metadata: FileMetaData, byteLength: number, etag: string): Promise<Uint8Array[]> {
  const [start, end] = geometryChunk(metadata)
  const chunk = await cachedRange(start, end, etag)
  const file: AsyncBuffer = {
    byteLength,
    slice: (s, e = byteLength) =>
      s >= start && e <= end ? chunk.slice(s - start, e - start) : range(s, e),
  }
  const rows = await parquetReadObjects({ file, metadata, columns: ['geometry'], compressors, utf8: false })
  return rows.map((r) => r.geometry as Uint8Array)
}

async function query(bbox: Bbox): Promise<GeoJSON.FeatureCollection> {
  table ??= openTable().catch((e) => {
    table = undefined
    throw e
  })
  const t = await table
  // No candidates (e.g. open ocean): skip the geometry download.
  if (candidateRows(t.rows, bbox).length === 0) return { type: 'FeatureCollection', features: [] }
  const wkb = await t.geometry()
  return admin0Features(t.rows, (i) => wkb[i]!, bbox)
}

self.onmessage = async ({ data }: MessageEvent<Admin0Request>) => {
  const t0 = performance.now()
  let res: Admin0Response
  try {
    const value = await query(data.bbox)
    res = { id: data.id, ok: true, value, stats: { ...stats, ms: Math.round(performance.now() - t0) } }
  } catch (e) {
    res = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  self.postMessage(res)
}
