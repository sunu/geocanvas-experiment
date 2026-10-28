import type { Bbox } from './geocode'
import { bboxesIntersect, wkbToGeometry, type PolygonGeometry } from './wkb'

/**
 * World Bank Official Boundaries, admin 0, as GeoParquet on Source Cooperative (plans/plan-006.md on feat/tools-registry, section 6.3).
 * Pure helpers: the Parquet reader is worldBankAdmin0.worker.ts; these turn its rows into features.
 */
export const WORLD_BANK_ADMIN0_URL =
  'https://data.source.coop/tge-labs/admin-boundaries/world-bank/World_Bank_Official_Boundaries_-_Admin_0.parquet'

export const WORLD_BANK_ATTRIBUTION = 'World Bank Official Boundaries (via Source Cooperative / TGE Labs), CC-BY-4.0'

/** The small columns read to pick rows. `geometry` (WKB) is read separately. */
export const WORLD_BANK_ADMIN0_COLUMNS = ['ISO_A3', 'NAM_0', 'WB_REGION', 'WB_STATUS', 'bbox'] as const

export interface WorldBankAdmin0Row {
  ISO_A3: string | null
  NAM_0: string | null
  WB_REGION: string | null
  WB_STATUS: string | null
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number }
}

export interface AdminBoundaryProps {
  iso3: string | null
  name: string | null
  region: string | null
  status: string | null
  level: 0
}

/** Indexes of the rows whose bbox column intersects the query bbox. */
export function candidateRows(rows: WorldBankAdmin0Row[], bbox: Bbox): number[] {
  const out: number[] = []
  rows.forEach((r, i) => {
    if (bboxesIntersect([r.bbox.xmin, r.bbox.ymin, r.bbox.xmax, r.bbox.ymax], bbox)) out.push(i)
  })
  return out
}

function ringBbox(ring: GeoJSON.Position[]): Bbox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
  for (const [x, y] of ring) {
    if (x! < w) w = x!
    if (x! > e) e = x!
    if (y! < s) s = y!
    if (y! > n) n = y!
  }
  return [w, s, e, n]
}

/**
 * True when the bbox of at least one polygon of the geometry intersects the query bbox.
 * Countries across the antimeridian (Russia, Fiji) are stored as parts split at ±180, so their
 * bbox column spans the whole world; testing each part keeps them out of unrelated queries.
 */
export function geometryIntersectsBbox(geom: PolygonGeometry, bbox: Bbox): boolean {
  const polygons = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates
  return polygons.some((p) => p[0] !== undefined && bboxesIntersect(ringBbox(p[0]), bbox))
}

/**
 * Countries that intersect the bbox: bbox column prefilter, then the bbox of each polygon part.
 * `geometry(i)` returns the WKB of row i; it is called only for candidate rows.
 */
export function admin0Features(
  rows: WorldBankAdmin0Row[],
  geometry: (i: number) => Uint8Array,
  bbox: Bbox,
): GeoJSON.FeatureCollection<PolygonGeometry, AdminBoundaryProps> {
  const features: GeoJSON.Feature<PolygonGeometry, AdminBoundaryProps>[] = []
  for (const i of candidateRows(rows, bbox)) {
    const geom = wkbToGeometry(geometry(i))
    if (!geometryIntersectsBbox(geom, bbox)) continue
    const r = rows[i]!
    features.push({
      type: 'Feature',
      geometry: geom,
      properties: { iso3: r.ISO_A3, name: r.NAM_0, region: r.WB_REGION, status: r.WB_STATUS, level: 0 },
    })
  }
  return { type: 'FeatureCollection', features }
}
