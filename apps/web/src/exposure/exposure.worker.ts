/**
 * Counts Overture buildings in flood areas in a worker, so reading and decoding never block the canvas. Only the
 * `bbox` and `subtype` columns are read (areas.ts EXPOSURE_COLUMNS), of the files and row groups that meet the
 * polygons, not only their bbox; each row group's rows are counted and dropped. Measured in plans/plan-015.md.
 */
import { readOverture } from '../data/overtureRead'
import { classCode, estimate, type Inundation } from '../inundation/estimate'
import { GlofasDepth, proxiedFiles } from '../inundation/glofas'
import { countBuildings, EXPOSURE_COLUMNS, Flood, floodPolygons, noBuildings, rectMeetsFlood, type BuildingCounts, type BuildingRow } from './areas'

/** A count, with the depth and damage of a flood of `returnPeriod` years when given; or the depths at some places. */
export type ExposureRequest =
  | { kind: 'count'; id: number; areas: GeoJSON.Geometry[]; returnPeriod?: number }
  | { kind: 'depths'; id: number; points: number[]; returnPeriod: number }
  | { kind: 'abort'; id: number }
export type ExposureResult = BuildingCounts & { inundation?: Inundation }
export type ExposureResponse = { id: number; ok: true; value: ExposureResult | Float32Array } | { id: number; ok: false; error: string }

/** The GloFAS depth maps, read through the Worker's proxy on the page's origin; tiles stay decoded between counts. */
const glofas = new GlofasDepth(proxiedFiles(self.location.origin))

/**
 * Parts of Overture's buildings one count may read: about 0.45 MB of these columns each, so about 30 MB. Pakistan's
 * CEMS area (0.5 deg²) is 17; a country-wide envelope is over 800. Files cost a footer each (0.6 MB, 1–3 s).
 */
export const MAX_ROW_GROUPS = 64
export const MAX_FILES = 8

async function count(areas: GeoJSON.Geometry[], returnPeriod: number | undefined, signal: AbortSignal): Promise<ExposureResult> {
  const flood = new Flood(floodPolygons(areas))
  const counts = noBuildings()
  if (!flood.bounds) return counts
  // For depth: each exposed building's bbox center and class, kept while the rows are dropped.
  const points: number[] = []
  const codes: number[] = []
  const keep = returnPeriod
    ? (r: BuildingRow) => {
        points.push((r.bbox.xmin + r.bbox.xmax) / 2, (r.bbox.ymin + r.bbox.ymax) / 2)
        codes.push(classCode(r.subtype))
      }
    : undefined
  const groups = readOverture<BuildingRow>('buildings', flood.bounds, {
    columns: EXPOSURE_COLUMNS,
    signal,
    maxRowGroups: MAX_ROW_GROUPS,
    maxFiles: MAX_FILES,
    keep: (rect) => rectMeetsFlood(rect, flood.polygons),
  })
  for await (const rows of groups) countBuildings(counts, rows, flood, keep)
  if (!returnPeriod) return counts
  signal.throwIfAborted()
  return { ...counts, inundation: estimate(points, codes, await glofas.depths(points, returnPeriod), returnPeriod) }
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
    const value = data.kind === 'count' ? await count(data.areas, data.returnPeriod, controller.signal) : await glofas.depths(data.points, data.returnPeriod)
    res = { id: data.id, ok: true, value }
  } catch (e) {
    res = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  } finally {
    controllers.delete(data.id)
  }
  self.postMessage(res)
}
