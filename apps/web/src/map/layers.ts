import { useEffect, useMemo, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import type { Tiles } from '../data/fromUrl'
import { tools } from '../tools/registry'
import { stableJson } from '@ttx/core'
import { rasterLayers } from './raster'
import { bboxOf, type Bbox, type LayerFilter, type LayerStyle, type MapLayer } from '@ttx/plugins'
import { featurePaint, filterFeatures } from './featureStyle'

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
  filter?: LayerFilter
  style?: LayerStyle
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

/** A layer and its tool's result, if there is one yet. */
function layerState(l: MapLayer, r: { value?: unknown; error?: string } | undefined): LayerState {
  const output = tools.tool(l.tool)?.output
  return {
    id: l.id,
    title: l.title,
    ...(output && { output }),
    loading: !r,
    ...(r?.value !== undefined && { value: r.value }),
    ...(r?.error !== undefined && { error: r.error }),
    ...(l.filter && { filter: l.filter }),
    ...(l.style && { style: l.style }),
  }
}

/** The states of a map's layers once their tools have run (from the cache when a map already ran them), outside React. */
export const loadLayerStates = (layers: MapLayer[], signal?: AbortSignal): Promise<LayerState[]> =>
  Promise.all(
    layers.map((l) =>
      tools.run(l.tool, l.input, signal ? { signal } : {}).then(
        (value) => layerState(l, { value }),
        (err) => layerState(l, { error: String((err as Error)?.message ?? err) }),
      ),
    ),
  )

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
  const shown = stableJson(layers.map((l) => [l.id, l.title, recipeKey(l), l.filter ?? null, l.style ?? null]))
  return useMemo(
    () =>
      layers.map((l) => {
        const r = results[l.id]
        return layerState(l, r?.key === recipeKey(l) ? r : undefined)
      }),
    // `shown` covers every field of `layers` read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [shown, results],
  )
}

/** The kinds of geometry in a feature collection, for its legend. */
export function geometryKinds(fc: GeoJSON.FeatureCollection): Set<'point' | 'line' | 'area'> {
  const kinds = new Set<'point' | 'line' | 'area'>()
  const add = (g: GeoJSON.Geometry | null): void => {
    if (!g) return
    if (g.type === 'GeometryCollection') return g.geometries.forEach(add)
    kinds.add(g.type.endsWith('Point') ? 'point' : g.type.endsWith('LineString') ? 'line' : 'area')
  }
  for (const f of fc.features) {
    add(f.geometry)
    if (kinds.size === 3) break
  }
  return kinds
}

const isArea = (f: GeoJSON.Feature) => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon'

/** Drawing order by kind of result: tiles at the bottom, then rasters, then features. */
const DRAW_ORDER: Record<string, number> = { 'geo.tiles': 0, 'geo.raster': 1 }
const drawOrder = (s: LayerState) => DRAW_ORDER[s.output ?? ''] ?? 2

/** deck.gl layers for the layers that have a result, by kind of result. Tiles and rasters draw below features. */
export function deckLayers(states: LayerState[]): Layer[] {
  // A stable sort: within a kind, the list's order.
  return [...states].sort((a, b) => drawOrder(a) - drawOrder(b)).flatMap((s): Layer[] => {
    if (s.value === undefined) return []
    const opacity = s.style?.opacity ?? 1
    if (s.output === 'geo.tiles') return [tileLayer(s.value as Tiles, `layer-${s.id}`, opacity)]
    if (s.output === 'geo.raster') return rasterLayers(s.value, { id: `layer-${s.id}`, opacity })
    if (s.output === 'geo.features') {
      const all = s.value as GeoJSON.FeatureCollection
      const { colorOf } = featurePaint(all, s.style)
      // Areas colored by a property are a choropleth, so they are filled more than a plain outline's light fill.
      const areaAlpha = s.style?.byProperty ? 170 : 30
      // Points: solid dots. Polygons (countries, buildings): a light fill and an outline, so the basemap stays readable.
      return [
        new GeoJsonLayer({
          id: `layer-${s.id}`,
          data: filterFeatures(all, s.filter),
          opacity,
          pointType: 'circle',
          // Sized in meters, kept between 2.5 and 6 px: thousands of points (health facilities in a
          // country) stay apart when zoomed out, and a single pin stays visible.
          pointRadiusUnits: 'meters',
          getPointRadius: 150,
          pointRadiusMinPixels: 2.5,
          pointRadiusMaxPixels: 6,
          getFillColor: (f: GeoJSON.Feature) => [...colorOf(f), isArea(f) ? areaAlpha : 140],
          getLineColor: (f: GeoJSON.Feature) => [...colorOf(f), 230],
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

/** XYZ raster tiles, each drawn as an image over its own bounds. */
function tileLayer(t: Tiles, id: string, opacity: number): Layer {
  return new TileLayer({
    id,
    opacity,
    data: t.url,
    tileSize: 256,
    minZoom: 0,
    maxZoom: 19,
    renderSubLayers: (props) => {
      const { west, south, east, north } = props.tile.bbox as { west: number; south: number; east: number; north: number }
      return new BitmapLayer({ ...props, data: undefined, image: props.data, bounds: [west, south, east, north] })
    },
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
