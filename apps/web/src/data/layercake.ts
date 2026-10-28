import type { Bbox } from './geocode'
import { bboxesIntersect } from './wkb'

/**
 * OpenStreetMap health facilities from Layercake (OpenStreetMap US): OSM tags as columns, one
 * GeoParquet file per layer for the whole planet. Health facilities are in the `pois` layer.
 * Pure helpers: the Parquet reader is layercake.worker.ts. No zod here, so the worker can import this.
 *
 * Measured on the 2026-10-25 file (4.7 GB, 62.5M rows, 509 row groups of ~123k rows, spatially
 * sorted, `bbox` statistics on every row group, no page index): Beira reads 1 row group (2.3 MB,
 * 1.4 s), Mozambique 7 (16 MB, 7 s, 3,404 facilities), plus a ~5 MB footer once per page.
 */
export const LAYERCAKE_POIS_URL = 'https://data.openstreetmap.us/layercake/pois.parquet'

export const LAYERCAKE_ATTRIBUTION = '© OpenStreetMap contributors (ODbL), via Layercake (OpenStreetMap US)'

/**
 * Row groups one query may read, about 2.3 MB each: a country, not a continent. Checked from the
 * footer, before any row group is downloaded.
 */
export const MAX_ROW_GROUPS = 12

/**
 * The columns read. `geometry` is left out on purpose: it is ~11 MB per row group (building-sized
 * polygons), and a facility is shown as a point at the center of its `bbox`.
 */
export const HEALTH_COLUMNS = ['type', 'id', 'amenity', 'healthcare', 'name', 'operator', 'emergency', 'bbox']

/** The older tagging scheme: amenity values that are health facilities. `healthcare=*` is the newer one. */
const HEALTH_AMENITIES = new Set(['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy'])

export interface PoiRow {
  /** OSM element type: node, way or relation. */
  type: string
  id: bigint | number
  amenity: string | null
  healthcare: string | null
  name: string[] | null
  operator: string | null
  emergency: string | null
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number }
}

export interface HealthProps {
  /** OSM element, e.g. "node/4979236200" (openstreetmap.org/<osm>). */
  osm: string
  name: string | null
  /** `healthcare` if tagged, else `amenity`, e.g. hospital, clinic, pharmacy. */
  kind: string | null
  amenity: string | null
  healthcare: string | null
  operator: string | null
  emergency: string | null
}

export type HealthFeature = GeoJSON.Feature<GeoJSON.Point, HealthProps>

export const isHealthFacility = (r: PoiRow) => !!r.healthcare || (r.amenity !== null && HEALTH_AMENITIES.has(r.amenity))

/** Appends the health facilities among `rows` whose bbox intersects the query bbox, as points at their bbox center. */
export function appendHealthFacilities(out: HealthFeature[], rows: PoiRow[], bbox: Bbox): void {
  for (const r of rows) {
    if (!isHealthFacility(r)) continue
    const b = r.bbox
    if (!bboxesIntersect([b.xmin, b.ymin, b.xmax, b.ymax], bbox)) continue
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [(b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2] },
      properties: {
        osm: `${r.type}/${r.id}`,
        name: r.name?.[0] ?? null,
        kind: r.healthcare || r.amenity,
        amenity: r.amenity,
        healthcare: r.healthcare,
        operator: r.operator,
        emergency: r.emergency,
      },
    })
  }
}
