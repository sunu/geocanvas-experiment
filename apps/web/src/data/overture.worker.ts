/**
 * Reads Overture Maps buildings (GeoParquet on S3) in a worker, so ZSTD, Parquet and WKB decoding
 * never block the canvas (plans/plan-006.md on feat/tools-registry, section 6.4).
 * The files and row groups are read by overtureRead.ts; rows are filtered by their `bbox` column, and
 * reading stops at the feature cap.
 */
import { appendBuildings, OVERTURE_BUILDING_COLUMNS, type BuildingFeature, type OvertureBuildingRow, type OvertureType } from './overture'
import { readOverture, stats, type OvertureStats } from './overtureRead'
import type { Bbox } from '@ttx/plugins'

export type OvertureRequest =
  | { kind: 'query'; id: number; type: OvertureType; bbox: Bbox; limit: number }
  | { kind: 'abort'; id: number }
export type OvertureResponse =
  | { id: number; ok: true; value: GeoJSON.FeatureCollection & { truncated?: boolean }; stats: OvertureStats }
  | { id: number; ok: false; error: string }

const controllers = new Map<number, AbortController>()

async function query(type: OvertureType, bbox: Bbox, limit: number, signal: AbortSignal) {
  const features: BuildingFeature[] = []
  const rows = readOverture<OvertureBuildingRow>(type, bbox, {
    columns: OVERTURE_BUILDING_COLUMNS,
    signal,
    // Keep WKB: only rows inside the bbox are decoded (wkb.ts wkbToGeometry).
    parsers: { geometryFromBytes: (b: Uint8Array) => b },
  })
  for await (const group of rows) {
    // At the cap: the caller aborts the row groups still in flight.
    if (appendBuildings(features, group, bbox, limit)) return { type: 'FeatureCollection' as const, features, truncated: true }
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
