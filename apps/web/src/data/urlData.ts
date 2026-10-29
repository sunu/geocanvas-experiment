/**
 * Pure helpers for features read from a URL (urlData.worker.ts): GeoJSON, GeoParquet rows and shapefiles become
 * one feature collection in longitude/latitude, cut at a cap. Tested in Node; the worker only fetches and calls them.
 */

/** At most this many features per layer: more would make the canvas slow, as for Overture buildings. */
export const MAX_URL_FEATURES = 100_000
/** Files larger than this are refused before they are read, when the server says their size. */
export const MAX_URL_BYTES = 50 * 1024 * 1024

export type Features = GeoJSON.FeatureCollection & { truncated?: boolean }

/** A size the server announced, checked against the cap. */
export function checkSize(bytes: number | undefined) {
  if (bytes !== undefined && bytes > MAX_URL_BYTES) throw new Error(`The file is ${Math.round(bytes / 2 ** 20)} MB; layers from a URL take at most ${MAX_URL_BYTES / 2 ** 20} MB`)
}

const isGeometry = (v: unknown): v is GeoJSON.Geometry =>
  !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string' && ('coordinates' in v || 'geometries' in v)

/** Property values deck.gl and the attribute list can show: no bigints, dates as text, no binary. */
export function plainValue(v: unknown): unknown {
  if (typeof v === 'bigint') return Number(v)
  if (v instanceof Date) return v.toISOString()
  if (v instanceof Uint8Array) return undefined
  return v
}

/** Any GeoJSON (a collection, a feature, a geometry, or shpjs's list of collections) as one capped collection. */
export function toFeatures(value: unknown, limit = MAX_URL_FEATURES): Features {
  const list = Array.isArray(value) ? value : [value]
  const features: GeoJSON.Feature[] = []
  for (const v of list) {
    const type = (v as { type?: unknown } | null)?.type
    if (type === 'FeatureCollection') features.push(...((v as GeoJSON.FeatureCollection).features ?? []))
    else if (type === 'Feature') features.push(v as GeoJSON.Feature)
    else if (isGeometry(v)) features.push({ type: 'Feature', geometry: v, properties: {} })
    else throw new Error('Not GeoJSON: expected a FeatureCollection, a Feature or a geometry')
  }
  return cap(features, limit)
}

function cap(features: GeoJSON.Feature[], limit: number): Features {
  return features.length > limit ? { type: 'FeatureCollection', features: features.slice(0, limit), truncated: true } : { type: 'FeatureCollection', features }
}

/** CRSs GeoParquet readers can draw as they are: longitude/latitude. Absent means OGC:CRS84 (the spec's default). */
const LON_LAT = new Set(['OGC:CRS84', 'EPSG:4326'])

/**
 * The geometry column of a GeoParquet file, from its `geo` metadata. Throws when the file is not GeoParquet or its
 * coordinates are not longitude/latitude: a reprojection is not built.
 */
export function geometryColumn(geo: string | undefined): string {
  if (!geo) throw new Error('Not GeoParquet: the file has no "geo" metadata')
  const meta = JSON.parse(geo) as { primary_column?: string; columns?: Record<string, { encoding?: string; crs?: unknown }> }
  const name = meta.primary_column
  const column = name ? meta.columns?.[name] : undefined
  if (!name || !column) throw new Error('Not GeoParquet: no primary geometry column')
  if (column.encoding !== 'WKB') throw new Error(`GeoParquet encoding ${column.encoding} is not supported (only WKB)`)
  const crs = column.crs as { id?: { authority: string; code: string | number } } | null | undefined
  if (crs === null) throw new Error('The GeoParquet file has no coordinate reference system')
  if (crs?.id && !LON_LAT.has(`${crs.id.authority}:${crs.id.code}`)) throw new Error(`The GeoParquet file is in ${crs.id.authority}:${crs.id.code}; only longitude/latitude (EPSG:4326) is supported`)
  return name
}

/** GeoParquet rows (geometry already decoded to GeoJSON by hyparquet) as features, the other columns as properties. */
export function rowsToFeatures(rows: Record<string, unknown>[], geometry: string, limit = MAX_URL_FEATURES): Features {
  const features: GeoJSON.Feature[] = []
  for (const row of rows) {
    const g = row[geometry]
    if (!isGeometry(g)) continue
    const properties: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (k === geometry) continue
      const p = plainValue(v)
      if (p !== undefined) properties[k] = p
    }
    features.push({ type: 'Feature', geometry: g, properties })
    if (features.length > limit) break
  }
  return cap(features, limit)
}
