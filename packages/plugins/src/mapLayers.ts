import { z } from 'zod'

/**
 * A data layer of a map: the recipe (tool id and input), not the data. The board stores the recipe;
 * each person's browser runs the tool (apps/web/src/map/layers.ts). An area-based tool gets its area
 * when the layer is added, so everyone sees the same data although map views are per person.
 */
export const FILTER_OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains'] as const
export type FilterOp = (typeof FILTER_OPS)[number]

/** Which features of a layer are drawn: those whose property compares so to the value. Runs in each browser on the loaded features. */
export const layerFilter = z.object({
  property: z.string().min(1).describe("A property of the layer's features"),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number()]).describe('Numbers compare as numbers; contains ignores case'),
})
export type LayerFilter = z.infer<typeof layerFilter>

/** How a layer is drawn. Each part is optional: absent, the default (the accent color, fully opaque). */
export const layerStyle = z.object({
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional()
    .describe('Color of the features, #rrggbb'),
  byProperty: z.string().min(1).optional().describe('Color the features by this property instead: classes for numbers, categories for text'),
  opacity: z.number().min(0.1).max(1).optional().describe('Opacity of the whole layer'),
})
export type LayerStyle = z.infer<typeof layerStyle>

export const mapLayer = z.object({
  id: z.string(),
  /** A tool id, e.g. 'data.population' (apps/web/src/tools/registry.ts). */
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  title: z.string(),
  /** Added after layers: absent on older ones. Filter and color apply to features only; opacity to every deck.gl layer. */
  filter: layerFilter.optional(),
  style: layerStyle.optional(),
})
export type MapLayer = z.infer<typeof mapLayer>

/** An area as the data tools take it: [west, south, east, north] in degrees. */
export type Bbox = [west: number, south: number, east: number, north: number]

/** The data layers people and the agent can add to a map, each for an area. */
export const DATA_LAYERS = {
  'population-constrained': {
    label: 'Population 2020 (constrained)',
    title: 'Population 2020 (constrained)',
    tool: 'data.population',
    input: { variant: 'constrained' },
  },
  'population-unconstrained': {
    label: 'Population 2020 (unconstrained)',
    title: 'Population 2020 (unconstrained)',
    tool: 'data.population',
    input: { variant: 'unconstrained' },
  },
  countries: { label: 'Countries (World Bank)', title: 'Countries (World Bank)', tool: 'data.adminBoundaries', input: { level: 0 } },
  buildings: { label: 'Buildings (Overture), zoomed in', title: 'Overture buildings', tool: 'data.overture', input: { type: 'buildings' } },
  'health-facilities': {
    label: 'Health facilities (OpenStreetMap)',
    title: 'Health facilities (OpenStreetMap)',
    tool: 'data.healthFacilities',
    input: {},
  },
} as const satisfies Record<string, { label: string; title: string; tool: string; input: Record<string, unknown> }>

export type DataLayerKey = keyof typeof DATA_LAYERS

/**
 * Administrative boundaries from OCHA's COD-AB, with P-codes: provinces (level 1) and districts (level 2). The tool
 * returns no shapes: each browser draws the vector tiles itself (apps/web/src/map/adminAreas.ts), so a layer needs
 * no area. HAPI figures are joined to the same tiles by P-code (hapi.choropleth).
 */
export const BOUNDARIES_TOOL = 'boundaries.codab'
export const ADMIN_LEVELS = [1, 2] as const
export type AdminLevel = (typeof ADMIN_LEVELS)[number]
export const ADMIN_LEVEL_NAME: Record<AdminLevel, { one: string; many: string }> = { 1: { one: 'province', many: 'Provinces' }, 2: { one: 'district', many: 'Districts' } }

/** Id of a new layer. Unique within one map is enough. */
export const newLayerId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** The recipe of a COD-AB boundaries layer. */
export const boundariesLayer = (level: AdminLevel): MapLayer => ({ id: newLayerId(), tool: BOUNDARIES_TOOL, input: { level }, title: `${ADMIN_LEVEL_NAME[level].many} (COD-AB)` })

/** True when a layer works on an area, which can be reset to someone's view. */
export const hasArea = (l: MapLayer) => Array.isArray(l.input.area)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/**
 * An area as a layer stores it: kept on the globe (a zoomed-out view can span more than 360 degrees)
 * and rounded, so small pans do not change it more than needed.
 */
export function bboxOf(a: { west: number; south: number; east: number; north: number }): Bbox {
  return [round4(clamp(a.west, -180, 180)), round4(clamp(a.south, -90, 90)), round4(clamp(a.east, -180, 180)), round4(clamp(a.north, -90, 90))]
}

/**
 * Data from a URL: each browser reads the file itself (apps/web/src/data/fromUrl.ts), so the server must allow
 * CORS. Features (GeoJSON, GeoParquet, a zipped shapefile) are read whole, up to a cap; a COG is read by range
 * request; XYZ tiles as the view needs them. Each format's tool gives one kind of result, which picks the renderer.
 */
export const URL_FORMATS = {
  geojson: { label: 'GeoJSON', tool: 'data.urlFeatures' },
  geoparquet: { label: 'GeoParquet', tool: 'data.urlFeatures' },
  shapefile: { label: 'Shapefile (.zip)', tool: 'data.urlFeatures' },
  cog: { label: 'Cloud-Optimized GeoTIFF', tool: 'data.urlRaster' },
  xyz: { label: 'XYZ raster tiles', tool: 'data.urlTiles' },
} as const satisfies Record<string, { label: string; tool: string }>

export type UrlFormat = keyof typeof URL_FORMATS

/** The format a URL's name suggests, or undefined when it says nothing (then the person picks one). */
export function guessFormat(url: string): UrlFormat | undefined {
  if (/\{z\}/i.test(url) && /\{x\}/i.test(url) && /\{y\}/i.test(url)) return 'xyz'
  let path: string
  try {
    path = new URL(url).pathname.toLowerCase()
  } catch {
    return undefined
  }
  if (/\.(geo)?json$/.test(path)) return 'geojson'
  if (/\.(geo)?parquet$/.test(path)) return 'geoparquet'
  if (/\.(zip|shp)$/.test(path)) return 'shapefile'
  if (/\.tiff?$/.test(path)) return 'cog'
  return undefined
}

/** A layer's title from its URL: the file name, or the host for tiles. */
export function urlTitle(url: string, format: UrlFormat): string {
  try {
    const u = new URL(url.replace(/\{[a-z]\}/gi, '0'))
    if (format === 'xyz') return u.host
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() ?? u.host)
  } catch {
    return url
  }
}
