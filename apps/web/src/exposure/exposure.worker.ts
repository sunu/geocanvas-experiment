/**
 * Counts Overture buildings in flood areas in a worker, so reading and decoding never block the canvas. Only the
 * `bbox` and `subtype` columns are read (areas.ts EXPOSURE_COLUMNS), of the files and row groups that meet the
 * polygons, not only their bbox; each row group's rows are counted and dropped. Measured in plans/plan-013.md.
 */
import { readOverture } from '../data/overtureRead'
import { countBuildings, EXPOSURE_COLUMNS, Flood, floodPolygons, noBuildings, rectMeetsFlood, type BuildingCounts, type BuildingRow } from './areas'

export type ExposureRequest = { kind: 'count'; id: number; areas: GeoJSON.Geometry[] } | { kind: 'abort'; id: number }
export type ExposureResponse = { id: number; ok: true; value: BuildingCounts } | { id: number; ok: false; error: string }

/**
 * Parts of Overture's buildings one count may read: about 0.45 MB of these columns each, so about 30 MB. Pakistan's
 * CEMS area (0.5 deg²) is 17; a country-wide envelope is over 800. Files cost a footer each (0.6 MB, 1–3 s).
 */
export const MAX_ROW_GROUPS = 64
export const MAX_FILES = 8

async function count(areas: GeoJSON.Geometry[], signal: AbortSignal): Promise<BuildingCounts> {
  const flood = new Flood(floodPolygons(areas))
  const counts = noBuildings()
  if (!flood.bounds) return counts
  const groups = readOverture<BuildingRow>('buildings', flood.bounds, {
    columns: EXPOSURE_COLUMNS,
    signal,
    maxRowGroups: MAX_ROW_GROUPS,
    maxFiles: MAX_FILES,
    keep: (rect) => rectMeetsFlood(rect, flood.polygons),
  })
  for await (const rows of groups) countBuildings(counts, rows, flood)
  return counts
}

const controllers = new Map<number, AbortController>()

self.onmessage = async ({ data }: MessageEvent<ExposureRequest>) => {
  if (data.kind === 'abort') {
    controllers.get(data.id)?.abort()
    return
  }
  const controller = new AbortController()
  controllers.set(data.id, controller)
  let res: ExposureResponse
  try {
    res = { id: data.id, ok: true, value: await count(data.areas, controller.signal) }
  } catch (e) {
    res = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    controllers.delete(data.id)
  }
  self.postMessage(res)
}
