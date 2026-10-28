import type { Bbox } from '@ttx/plugins'
import { bboxesIntersect, wkbToGeometry, type PolygonGeometry } from './wkb'

/**
 * Overture Maps GeoParquet on S3, found through the Overture STAC catalog (plans/plan-006.md on
 * feat/tools-registry, section 6.4). Pure helpers: the Parquet reader is overture.worker.ts; these pick files
 * and row groups and turn rows into features. No zod here, so a worker can import this module.
 */
export const OVERTURE_STAC_CATALOG = 'https://stac.overturemaps.org/catalog.json'

export type OvertureType = 'buildings'

/** STAC path of each type, below the release: `<release>/<theme>/<type>`. */
const COLLECTION_PATHS: Record<OvertureType, string> = { buildings: 'buildings/building' }

/** The buildings collection states `license: ODbL-1.0`; most buildings come from OpenStreetMap. */
export const OVERTURE_ATTRIBUTION: Record<OvertureType, string> = {
  buildings: '© OpenStreetMap contributors, Overture Maps Foundation (ODbL)',
}

/**
 * Limits measured on the 2026-10-21.0 release: a 6 × 6 km box in central Beira (0.0036 deg²) reads
 * 8 row groups (~15 MB) and returns 76k buildings. Larger areas fail before any download.
 */
export const OVERTURE_LIMITS: Record<OvertureType, { maxAreaDeg2: number; maxFeatures: number }> = {
  buildings: { maxAreaDeg2: 0.01, maxFeatures: 100_000 },
}

/** Area of a bbox in square degrees (what the reader cost scales with, not km²). */
export const bboxAreaDeg2 = ([w, s, e, n]: Bbox) => Math.max(0, e - w) * Math.max(0, n - s)

// ---------- STAC ----------

/** The release the catalog marks as latest, e.g. '2026-10-21.0'. */
export function latestRelease(catalog: unknown): string {
  const latest = (catalog as { latest?: unknown } | null)?.latest
  if (typeof latest !== 'string' || !latest) throw new Error('Overture STAC catalog has no latest release')
  return latest
}

export function collectionUrl(release: string, type: OvertureType): string {
  return new URL(`${release}/${COLLECTION_PATHS[type]}/collection.json`, OVERTURE_STAC_CATALOG).href
}

export interface StacFile {
  /** STAC item url (its JSON has the Parquet href). */
  item: string
  bbox: Bbox
}

interface StacCollection {
  extent?: { spatial?: { bbox?: number[][] } }
  links?: { rel?: string; href?: string }[]
}

/**
 * One entry per Parquet file. `extent.spatial.bbox[0]` covers the whole collection; the next
 * entries are the item bboxes, in the order of the `item` links. Relative hrefs are resolved
 * against the collection url.
 */
export function collectionFiles(collection: unknown, url: string): StacFile[] {
  const c = collection as StacCollection
  const items = (c.links ?? []).filter((l) => l.rel === 'item' && l.href).map((l) => new URL(l.href!, url).href)
  const bboxes = c.extent?.spatial?.bbox?.slice(1) ?? []
  if (items.length === 0 || bboxes.length !== items.length) {
    throw new Error(`Overture collection ${url}: ${items.length} items but ${bboxes.length} item bboxes`)
  }
  return items.map((item, i) => ({ item, bbox: bboxes[i]!.slice(0, 4) as Bbox }))
}

export function filesInBbox(files: StacFile[], bbox: Bbox): StacFile[] {
  return files.filter((f) => bboxesIntersect(f.bbox, bbox))
}

export interface ParquetAsset {
  href: string
  /** Bytes, from `file:size`: no HEAD request needed. */
  size: number
}

/** The HTTPS (AWS) Parquet asset of a STAC item. */
export function itemAsset(item: unknown): ParquetAsset {
  const aws = (item as { assets?: Record<string, { href?: unknown; 'file:size'?: unknown }> } | null)?.assets?.aws
  const href = aws?.href
  const size = aws?.['file:size']
  if (typeof href !== 'string' || !href.startsWith('https://') || typeof size !== 'number') {
    throw new Error('Overture STAC item has no HTTPS asset with a file size')
  }
  return { href, size }
}

// ---------- Buildings ----------

/** Top-level columns read for buildings (`names` is a struct; only `names.primary` is used). */
export const OVERTURE_BUILDING_COLUMNS = ['id', 'names', 'subtype', 'class', 'height', 'num_floors', 'geometry', 'bbox']

export interface OvertureBuildingRow {
  id: string
  names: { primary?: string | null } | null
  subtype: string | null
  class: string | null
  height: number | null
  num_floors: number | null
  /** WKB. */
  geometry: Uint8Array
  bbox: { xmin: number; xmax: number; ymin: number; ymax: number }
}

export interface BuildingProps {
  id: string
  name: string | null
  subtype: string | null
  class: string | null
  height: number | null
  num_floors: number | null
}

export type BuildingFeature = GeoJSON.Feature<PolygonGeometry, BuildingProps>

/**
 * Appends the buildings whose `bbox` column intersects the query bbox, up to `max` features in
 * total. Returns true when it stopped at `max` (more buildings may match).
 */
export function appendBuildings(out: BuildingFeature[], rows: OvertureBuildingRow[], bbox: Bbox, max: number): boolean {
  for (const r of rows) {
    if (!bboxesIntersect([r.bbox.xmin, r.bbox.ymin, r.bbox.xmax, r.bbox.ymax], bbox)) continue
    if (out.length >= max) return true
    out.push({
      type: 'Feature',
      geometry: wkbToGeometry(r.geometry),
      properties: {
        id: r.id,
        name: r.names?.primary ?? null,
        subtype: r.subtype,
        class: r.class,
        height: r.height,
        num_floors: r.num_floors,
      },
    })
  }
  return false
}
