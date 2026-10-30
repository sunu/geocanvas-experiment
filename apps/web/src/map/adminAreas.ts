import { addProtocol, type FilterSpecification, type LayerSpecification, type Map as MapLibreMap, type ExpressionSpecification } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { ADMIN_LEVELS, BOUNDARIES_TOOL, type AdminLevel } from '@ttx/plugins'
import type { LayerState } from './layers'

/**
 * Provinces and districts from OCHA's COD-AB, drawn by MapLibre from PMTiles on Source Cooperative (read by range
 * request, so only the tiles in view are fetched), under the basemap's labels. A layer of this kind is either the
 * boundaries alone, or a choropleth: values by P-code (from HDX HAPI, hapi/choropleth.ts) color the areas of one
 * country. Unlike other data layers, these are MapLibre layers, not deck.gl ones.
 */

/** The tool output for these layers: what to draw, not shapes. */
export const ADMIN_AREAS = 'geo.adminAreas'

export interface AdminAreas {
  level: AdminLevel
  /** Draw only this country's areas (ISO3). */
  country?: string
  /** Values by P-code, for a choropleth. Areas without one are not colored. */
  values?: Record<string, number>
  /** What the values are, e.g. "organizations". */
  unit?: string
  /** Values that name an area the tiles do not have, e.g. HAPI's unmatched "MZ01-XXX". */
  unmatched?: number
  attribution: string
}

export const CODAB_ATTRIBUTION = 'OCHA COD-AB (via HDX on Source Cooperative), CC BY 3.0 IGO'

/** The tiles of one level: layer "admin<N>", P-code in "adm<N>_pcode", name in "adm<N>_name". */
export const codab = (level: AdminLevel) => ({
  url: `pmtiles://https://data.source.coop/hdx/cod-ab/global/admin${level}/admin${level}.pmtiles`,
  sourceLayer: `admin${level}`,
  pcode: `adm${level}_pcode`,
  name: `adm${level}_name`,
})

/** The boundaries alone, for a map layer of provinces or districts. */
export const boundariesTool = defineTool({
  id: BOUNDARIES_TOOL,
  title: 'Admin boundaries (COD-AB)',
  description: "OCHA's common operational administrative boundaries with P-codes: provinces (level 1) or districts (level 2).",
  input: z.object({ level: z.union(ADMIN_LEVELS.map((l) => z.literal(l))).describe('1 for provinces, 2 for districts') }),
  output: ADMIN_AREAS,
  run: async ({ level }): Promise<AdminAreas> => ({ level: level as AdminLevel, attribution: CODAB_ATTRIBUTION }),
})

/** Light to dark (ColorBrewer Reds, 5 classes). */
export const RAMP = ['#fee5d9', '#fcae91', '#fb6a4a', '#de2d26', '#a50f15']
/** Areas with a value of 0. */
export const ZERO = '#f2f2f2'

export interface Legend {
  /** Each class: its color and the range of values in it, e.g. "6–20". */
  classes: { color: string; label: string }[]
}

/**
 * Up to five classes of about as many areas each (quantiles of the distinct values above 0), so a few large values
 * do not leave every other area in the lightest class. 0 is its own class.
 */
export function classify(values: Record<string, number>): { colorOf(v: number): string; legend: Legend } {
  const positive = [...new Set(Object.values(values).filter((v) => v > 0))].sort((a, b) => a - b)
  const n = Math.min(RAMP.length, positive.length)
  // Upper bound of each class.
  const uppers = Array.from({ length: n }, (_, i) => positive[Math.ceil(((i + 1) * positive.length) / n) - 1]!)
  const colors = n ? RAMP.slice(RAMP.length - n) : []
  const colorOf = (v: number) => (v <= 0 ? ZERO : colors[uppers.findIndex((u) => v <= u)] ?? colors.at(-1)!)
  const fmt = (v: number) => v.toLocaleString('en-US')
  const classes = uppers.map((u, i) => {
    const lower = i === 0 ? positive[0]! : positive[positive.findIndex((v) => v > uppers[i - 1]!)]!
    return { color: colors[i]!, label: lower === u ? fmt(u) : `${fmt(lower)}–${fmt(u)}` }
  })
  return { colorOf, legend: { classes: Object.values(values).some((v) => v === 0) ? [{ color: ZERO, label: '0' }, ...classes] : classes } }
}

/** The MapLibre id of a data layer's parts. */
const layerIds = (id: string) => ({ fill: `admin-${id}-fill`, line: `admin-${id}-line` })
const sourceId = (level: AdminLevel) => `codab-admin${level}`

/** MapLibre layers for one data layer: a fill when it has values, and outlines. */
export function adminLayerSpecs(id: string, a: AdminAreas): LayerSpecification[] {
  const t = codab(a.level)
  const ids = layerIds(id)
  const filter: FilterSpecification | undefined = a.country ? ['==', ['get', 'iso3'], a.country] : undefined
  const common = { source: sourceId(a.level), 'source-layer': t.sourceLayer, ...(filter && { filter }) }
  const layers: LayerSpecification[] = []
  if (a.values) {
    const { colorOf } = classify(a.values)
    const pairs = Object.entries(a.values).flatMap(([pcode, v]) => [pcode, colorOf(v)])
    // match needs at least one P-code; the spread is beyond what MapLibre's expression type can check.
    const color = pairs.length ? (['match', ['get', t.pcode], ...pairs, 'rgba(0, 0, 0, 0)'] as unknown as ExpressionSpecification) : 'rgba(0, 0, 0, 0)'
    layers.push({ id: ids.fill, type: 'fill', ...common, paint: { 'fill-color': color, 'fill-opacity': 0.75 } })
  }
  layers.push({
    id: ids.line,
    type: 'line',
    ...common,
    paint: { 'line-color': a.values ? '#ffffff' : '#555555', 'line-width': a.level === 1 ? 1.2 : 0.6, 'line-opacity': a.values ? 0.9 : 0.7 },
  })
  return layers
}

let protocolAdded = false

/** MapLibre reads pmtiles:// urls through the pmtiles package. Once per page. */
function addPmtilesProtocol() {
  if (protocolAdded) return
  addProtocol('pmtiles', new Protocol().tile)
  protocolAdded = true
}

/** The specs each map was last given, by MapLibre layer id, so an unchanged layer is left alone. */
const applied = new WeakMap<MapLibreMap, Map<string, string>>()

/**
 * Make the map's COD-AB layers match the data layers that have a result: add the new ones under the basemap's
 * labels, replace changed ones (cheap: the tiles stay loaded), remove the rest. The style must be loaded; a basemap
 * change drops every added layer, so call this again after it ('style.load').
 */
export function syncAdminLayers(map: MapLibreMap, states: LayerState[]) {
  addPmtilesProtocol()
  const wanted = states
    .filter((s) => s.output === ADMIN_AREAS && s.value !== undefined)
    .flatMap((s) => {
      const a = s.value as AdminAreas
      return adminLayerSpecs(s.id, a).map((spec) => ({ spec, level: a.level, json: JSON.stringify(spec) }))
    })
  const last = applied.get(map) ?? applied.set(map, new Map()).get(map)!
  const wantedIds = new Set(wanted.map((w) => w.spec.id))
  for (const id of [...last.keys()]) {
    if (wantedIds.has(id)) continue
    if (map.getLayer(id)) map.removeLayer(id)
    last.delete(id)
  }
  // Under the first label layer, so place names stay readable; on top when the basemap has none (satellite).
  const beforeId = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id
  for (const { spec, level, json } of wanted) {
    if (!map.getSource(sourceId(level))) map.addSource(sourceId(level), { type: 'vector', url: codab(level).url, attribution: CODAB_ATTRIBUTION })
    if (map.getLayer(spec.id)) {
      if (last.get(spec.id) === json) continue
      map.removeLayer(spec.id)
    }
    map.addLayer(spec, beforeId)
    last.set(spec.id, json)
  }
  for (const level of ADMIN_LEVELS) {
    if (map.getSource(sourceId(level)) && !wanted.some((w) => w.level === level)) map.removeSource(sourceId(level))
  }
}

/**
 * The fill layers of the choropleths among these data layers, to read a value under the pointer. None before the style
 * has loaded: the tap that opens a map on a phone sends it a mousemove at once.
 */
export const fillLayerIds = (map: MapLibreMap) => (map.getStyle()?.layers ?? []).filter((l) => l.id.startsWith('admin-') && l.type === 'fill').map((l) => l.id)

/** The data layer a MapLibre layer id belongs to. */
export const dataLayerOf = (layerId: string) => layerId.replace(/^admin-/, '').replace(/-(fill|line)$/, '')
