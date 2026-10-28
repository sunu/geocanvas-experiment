import { useEffect, useMemo, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer } from '@deck.gl/layers'
import { tools } from '../tools/registry'
import { stableJson } from '@ttx/core'
import { gridLayers } from './grid'
import { rasterLayers } from './raster'
import { bboxOf, GRID_OUTPUT, type Bbox, type MapLayer } from '@ttx/plugins'

export type { MapLayer } from '@ttx/plugins'

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

/** The bbox [west, south, east, north] of a feature collection's coordinates, or undefined when it has none. */
export function boundsOf(fc: GeoJSON.FeatureCollection): Bbox | undefined {
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

/** A map view's bounds ([[west, south], [east, north]]) as a layer's area. */
export function viewArea([[west, south], [east, north]]: [[number, number], [number, number]]): Bbox {
  return bboxOf({ west, south, east, north })
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

  // The same array until a layer or a result changes. Every board change and every canvas camera move re-renders
  // a map with a new `layers` array, and a new array of states would make deck.gl redraw all its data each time.
  const shown = stableJson(layers.map((l) => [l.id, l.title, recipeKey(l)]))
  return useMemo(
    () =>
      layers.map((l) => {
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
      }),
    // `shown` covers every field of `layers` read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, results],
  )
}

/** Accent color of data layers, [r, g, b]. */
const ACCENT = [37, 99, 235] as const

const isArea = (f: GeoJSON.Feature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'

/** deck.gl layers for the layers that have a result, by kind of result. Rasters and grids draw below features. */
export function deckLayers(states: LayerState[]): Layer[] {
  const isImage = (s: LayerState) => s.output === 'geo.raster' || s.output === GRID_OUTPUT
  const rasters = states.filter(isImage)
  const others = states.filter((s) => !isImage(s))
  return [...rasters, ...others].flatMap((s): Layer[] => {
    if (s.value === undefined) return []
    if (s.output === 'geo.raster') return rasterLayers(s.value, { id: `layer-${s.id}` })
    if (s.output === GRID_OUTPUT) return gridLayers(s.value, { id: `layer-${s.id}` })
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

/** What a result says about itself beyond its source: for a forecast, the model, run and valid time, and that it is no warning. */
export function captionOf(value: unknown): string | undefined {
  const c = (value as { caption?: unknown } | undefined)?.caption
  return typeof c === 'string' ? c : undefined
}

/** "Showing the first N features only" when a tool stopped at its cap (Overture buildings). */
export function truncationOf(value: unknown): string | undefined {
  const fc = value as { truncated?: unknown; features?: unknown[] } | undefined
  return fc?.truncated === true ? `Showing the first ${(fc.features?.length ?? 0).toLocaleString('en')} features only` : undefined
}
