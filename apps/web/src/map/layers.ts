import { useEffect, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer } from '@deck.gl/layers'
import { tools } from '../tools/registry'
import { stableJson } from '../tools/runner'
import { rasterLayers } from './raster'

/**
 * A data layer of a map: the recipe (tool id and input), not the data. The board stores the recipe;
 * each person's browser runs the tool. An area-based tool gets its area at add time, from the view of
 * the person who added it, so everyone sees the same data although map views are per person.
 */
export interface MapLayer {
  id: string
  tool: string
  input: Record<string, unknown>
  title: string
}

/** A layer as this browser has it: loading, its result, or why it failed. */
export interface LayerState {
  id: string
  title: string
  /** Kind of result (the tool's output), which picks the renderer. */
  output?: string
  loading: boolean
  value?: unknown
  error?: string
}

/** Id of a new layer. Unique within one map is enough. */
export const newLayerId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

/** Layers a person can add from a map's menu. Each gets `area` from the adder's view. */
export const AREA_LAYERS: { label: string; tool: string; input: Record<string, unknown>; title: string }[] = [
  { label: 'Population 2020 (constrained)', tool: 'data.population', input: { variant: 'constrained' }, title: 'Population 2020 (constrained)' },
  { label: 'Population 2020 (unconstrained)', tool: 'data.population', input: { variant: 'unconstrained' }, title: 'Population 2020 (unconstrained)' },
  { label: 'Countries (World Bank)', tool: 'data.adminBoundaries', input: { level: 0 }, title: 'Countries (World Bank)' },
  { label: 'Buildings (Overture), zoomed in', tool: 'data.overture', input: { type: 'buildings' }, title: 'Overture buildings' },
  { label: 'Health facilities (OpenStreetMap)', tool: 'data.healthFacilities', input: {}, title: 'Health facilities (OpenStreetMap)' },
]

/** A layer for a GeoJSON file of a Notebook Factory run (notebooks/artifact.ts), from a map's menu or a notebook's card. */
export function notebookLayer(runId: string, fileName: string, runTitle: string): MapLayer {
  return { id: newLayerId(), tool: 'notebooks.artifact', input: { runId, name: fileName }, title: `${fileName.replace(/\.geojson$/i, '')} · ${runTitle}` }
}

/** The bbox [west, south, east, north] of a feature collection's coordinates, or undefined when it has none. */
export function boundsOf(fc: GeoJSON.FeatureCollection): [number, number, number, number] | undefined {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const walk = (c: unknown): void => {
    if (!Array.isArray(c)) return
    if (typeof c[0] === 'number') {
      const [x, y] = c as number[]
      if (x! < w) w = x!
      if (x! > e) e = x!
      if (y! < s) s = y!
      if (y! > n) n = y!
    } else for (const part of c) walk(part)
  }
  for (const f of fc.features) if (f.geometry && 'coordinates' in f.geometry) walk(f.geometry.coordinates)
  return w <= e ? [w, s, e, n] : undefined
}

/** True when a layer works on an area, which can be reset to someone's view. */
export const hasArea = (l: MapLayer) => Array.isArray(l.input.area)

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round4 = (v: number) => Math.round(v * 1e4) / 1e4

/**
 * A map view's bounds as an area: [west, south, east, north], kept on the globe (a zoomed-out view can
 * span more than 360 degrees) and rounded, so small pans do not change it more than needed.
 */
export function viewArea([[w, s], [e, n]]: [[number, number], [number, number]]): [number, number, number, number] {
  return [round4(clamp(w, -180, 180)), round4(clamp(s, -90, 90)), round4(clamp(e, -180, 180)), round4(clamp(n, -90, 90))]
}

const recipeKey = (l: MapLayer) => stableJson([l.tool, l.input])

/** Runs the tools of a map's layers. One failing layer does not stop the others. */
export function useLayerStates(layers: MapLayer[]): LayerState[] {
  const [results, setResults] = useState<Record<string, { key: string; value?: unknown; error?: string }>>({})
  const key = stableJson(layers.map((l) => [l.id, recipeKey(l)]))

  useEffect(() => {
    const abort = new AbortController()
    for (const l of layers) {
      const k = recipeKey(l)
      tools.run(l.tool, l.input, { signal: abort.signal }).then(
        (value) => setResults((r) => ({ ...r, [l.id]: { key: k, value } })),
        (err) => {
          if (!abort.signal.aborted) setResults((r) => ({ ...r, [l.id]: { key: k, error: String((err as Error)?.message ?? err) } }))
        },
      )
    }
    return () => abort.abort()
    // `key` covers every field of `layers` that the runs depend on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return layers.map((l) => {
    const r = results[l.id]
    const fresh = r?.key === recipeKey(l)
    const output = tools.tool(l.tool)?.output
    return {
      id: l.id,
      title: l.title,
      ...(output && { output }),
      loading: !fresh,
      ...(fresh && r.value !== undefined && { value: r.value }),
      ...(fresh && r.error !== undefined && { error: r.error }),
    }
  })
}

/** Accent color of data layers, [r, g, b]. */
const ACCENT = [37, 99, 235] as const

const isArea = (f: GeoJSON.Feature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'

/** deck.gl layers for the layers that have a result, by kind of result. Rasters draw below features. */
export function deckLayers(states: LayerState[]): Layer[] {
  const rasters = states.filter((s) => s.output === 'geo.raster')
  const others = states.filter((s) => s.output !== 'geo.raster')
  return [...rasters, ...others].flatMap((s): Layer[] => {
    if (s.value === undefined) return []
    if (s.output === 'geo.raster') return rasterLayers(s.value, { id: `layer-${s.id}` })
    if (s.output === 'geo.features') {
      // Points: solid dots. Polygons (countries, buildings): a light fill and an outline, so the basemap stays readable.
      return [
        new GeoJsonLayer({
          id: `layer-${s.id}`,
          data: s.value as GeoJSON.FeatureCollection,
          pointType: 'circle',
          // Sized in meters, kept between 2.5 and 6 px: thousands of points (health facilities in a
          // country) stay apart when zoomed out, and a single pin stays visible.
          pointRadiusUnits: 'meters',
          getPointRadius: 150,
          pointRadiusMinPixels: 2.5,
          pointRadiusMaxPixels: 6,
          getFillColor: (f: GeoJSON.Feature) => [...ACCENT, isArea(f) ? 30 : 140],
          getLineColor: [...ACCENT, 230],
          lineWidthUnits: 'pixels',
          getLineWidth: (f: GeoJSON.Feature) => (isArea(f) ? 1 : 1.5),
          stroked: true,
          filled: true,
        }),
      ]
    }
    return []
  })
}

/** The attribution a result carries, if any (e.g. "WorldPop, CC-BY-4.0"). */
export function attributionOf(value: unknown): string | undefined {
  const a = (value as { attribution?: unknown } | undefined)?.attribution
  return typeof a === 'string' ? a : undefined
}

/** "Showing the first N features only" when a tool stopped at its cap (Overture buildings). */
export function truncationOf(value: unknown): string | undefined {
  const fc = value as { truncated?: unknown; features?: unknown[] } | undefined
  return fc?.truncated === true ? `Showing the first ${(fc.features?.length ?? 0).toLocaleString('en')} features only` : undefined
}
