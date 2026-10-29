import { z } from 'zod'

/**
 * A data layer of a map: the recipe (tool id and input), not the data. The board stores the recipe;
 * each person's browser runs the tool (apps/web/src/map/layers.ts). An area-based tool gets its area
 * when the layer is added, so everyone sees the same data although map views are per person.
 */
export const mapLayer = z.object({
  id: z.string(),
  /** A tool id, e.g. 'data.population' (apps/web/src/tools/registry.ts). */
  tool: z.string(),
  input: z.record(z.string(), z.unknown()),
  title: z.string(),
})
export type MapLayer = z.infer<typeof mapLayer>

/** A MapLibre-rendered raster tile layer (unlike tool results rendered by deck.gl). */
export interface TileRaster {
  tiles?: string[]
  attribution?: string
  opacity?: number
  bounds?: Bbox
  status?: 'running' | 'ready'
}

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
