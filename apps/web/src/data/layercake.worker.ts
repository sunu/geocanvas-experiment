/**
 * Reads OpenStreetMap health facilities from Layercake's `pois` GeoParquet in a worker, so ZSTD and
 * Parquet decoding never block the canvas. HEAD (size) -> footer (~5 MB, once per page) -> row groups
 * whose `bbox` statistics intersect the query (at most MAX_ROW_GROUPS) -> only the small columns of
 * those row groups (layercake.ts HEALTH_COLUMNS: no geometry), a few at a time.
 */
import { parquetMetadataAsync, parquetReadObjects, type AsyncBuffer, type FileMetaData } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { appendHealthFacilities, HEALTH_COLUMNS, LAYERCAKE_POIS_URL, MAX_ROW_GROUPS, type HealthFeature, type PoiRow } from './layercake'
import type { Bbox } from './geocode'
import { rowGroupsInBbox } from './wkb'

export type LayercakeRequest = { kind: 'query'; id: number; bbox: Bbox } | { kind: 'abort'; id: number }
export type LayercakeResponse =
  | { id: number; ok: true; value: GeoJSON.FeatureCollection<GeoJSON.Point> }
  | { id: number; ok: false; error: string }

/** Row groups downloaded at the same time (about 2.3 MB each). */
const CONCURRENCY = 4

/**
 * A Range GET. A 200 instead of a 206 would be the whole 4.7 GB file, so it fails instead
 * (hyparquet's asyncBufferFromUrl would accept it).
 */
async function range(start: number, end: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  const res = await fetch(LAYERCAKE_POIS_URL, { headers: { Range: `bytes=${start}-${end - 1}` }, signal })
  if (res.status !== 206) {
    await res.body?.cancel()
    throw new Error(`Layercake: expected a partial response (206), got ${res.status}`)
  }
  return res.arrayBuffer()
}

interface Table {
  byteLength: number
  metadata: FileMetaData
}

/** Size and footer, once per worker (page). Forgotten when it fails, so the next query retries. */
let table: Promise<Table> | undefined

async function openTable(): Promise<Table> {
  const head = await fetch(LAYERCAKE_POIS_URL, { method: 'HEAD' })
  if (!head.ok) throw new Error(`Layercake: HTTP ${head.status}`)
  const byteLength = Number(head.headers.get('content-length'))
  const metadata = await parquetMetadataAsync({ byteLength, slice: (s, e = byteLength) => range(s, e) })
  return { byteLength, metadata }
}

async function query(bbox: Bbox, signal: AbortSignal): Promise<GeoJSON.FeatureCollection<GeoJSON.Point>> {
  table ??= openTable().catch((e) => {
    table = undefined
    throw e
  })
  const { byteLength, metadata } = await table
  const groups = rowGroupsInBbox(metadata.row_groups, bbox)
  // Fail before any row group is read: a zoomed-out area would download hundreds of MB.
  if (groups.length > MAX_ROW_GROUPS) {
    throw new Error(`Area too large for health facilities (${groups.length} parts of the file, at most ${MAX_ROW_GROUPS}): zoom in, then use your view for this layer`)
  }
  const file: AsyncBuffer = { byteLength, slice: (s, e = byteLength) => range(s, e, signal) }
  const features: HealthFeature[] = []
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    const batch = await Promise.all(
      groups.slice(i, i + CONCURRENCY).map(
        ({ rowStart, rowEnd }) =>
          parquetReadObjects({ file, metadata, columns: HEALTH_COLUMNS, rowStart, rowEnd, compressors }) as unknown as Promise<PoiRow[]>,
      ),
    )
    signal.throwIfAborted()
    for (const rows of batch) appendHealthFacilities(features, rows, bbox)
  }
  return { type: 'FeatureCollection', features }
}

const controllers = new Map<number, AbortController>()

self.onmessage = async ({ data }: MessageEvent<LayercakeRequest>) => {
  if (data.kind === 'abort') {
    controllers.get(data.id)?.abort()
    return
  }
  const controller = new AbortController()
  controllers.set(data.id, controller)
  let res: LayercakeResponse
  try {
    res = { id: data.id, ok: true, value: await query(data.bbox, controller.signal) }
  } catch (e) {
    res = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    controllers.delete(data.id)
  }
  self.postMessage(res)
}
