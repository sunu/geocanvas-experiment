import { useEffect, useMemo, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { TileLayer } from '@deck.gl/geo-layers'
import { BitmapLayer, GeoJsonLayer } from '@deck.gl/layers'
import type { Tiles } from '../data/fromUrl'
import { tools } from '../tools/registry'
import { stableJson } from '@ttx/core'
import { gridLayers } from './grid'
import { rasterLayers } from './raster'
import { bboxOf, GRID_OUTPUT, SHAPE_COLORS, shapeFeatures, type Bbox, type LayerFilter, type LayerStyle, type MapAnnotation, type MapLayer, type ShapePart } from '@ttx/plugins'
import { featurePaint, filterFeatures, hexToRgb } from './featureStyle'

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
  /** The code cell that made the layer (plan-018): its features can be hovered and clicked (code/focus.ts). */
  from?: string
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
    ...(l.from && { from: l.from }),
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
const DRAW_ORDER: Record<string, number> = { 'geo.tiles': 0, 'geo.raster': 1, [GRID_OUTPUT]: 1 }
const drawOrder = (s: LayerState) => DRAW_ORDER[s.output ?? ''] ?? 2

/** The canvas accent (Tailwind cyan-500, --canvas-accent): a hovered feature of a code layer. */
const ACCENT: [number, number, number, number] = [6, 182, 212, 90]

/**
 * deck.gl layers for the layers that have a result, by kind of result. Tiles, rasters and grids draw below features.
 * Layers made by code can be picked (hovered and clicked). With `highlight` (a layer id, plan-019), that layer is drawn
 * stronger and the other feature layers fainter.
 */
export function deckLayers(states: LayerState[], { highlight }: { highlight?: string } = {}): Layer[] {
  // A stable sort: within a kind, the list's order.
  return [...states].sort((a, b) => drawOrder(a) - drawOrder(b)).flatMap((s): Layer[] => {
    if (s.value === undefined) return []
    const opacity = s.style?.opacity ?? 1
    // A tile result without a url is an openEO service that is still being created (openEOTilesTool).
    if (s.output === 'geo.tiles') return (s.value as Tiles).url ? [tileLayer(s.value as Tiles, `layer-${s.id}`, opacity)] : []
    if (s.output === 'geo.raster') return rasterLayers(s.value, { id: `layer-${s.id}`, opacity })
    if (s.output === GRID_OUTPUT) return gridLayers(s.value, { id: `layer-${s.id}` })
    if (s.output === 'geo.features') {
      const all = s.value as GeoJSON.FeatureCollection
      const { colorOf } = featurePaint(all, s.style)
      const strong = highlight === s.id
      // Areas colored by a property are a choropleth, so they are filled more than a plain outline's light fill.
      const areaAlpha = s.style?.byProperty ? 170 : strong ? 80 : 30
      // Points: solid dots. Polygons (countries, buildings): a light fill and an outline, so the basemap stays readable.
      return [
        new GeoJsonLayer({
          id: `layer-${s.id}`,
          data: filterFeatures(all, s.filter),
          opacity: highlight && !strong ? opacity * 0.35 : opacity,
          pickable: !!s.from,
          autoHighlight: !!s.from,
          highlightColor: ACCENT,
          ...(strong && { lineWidthMinPixels: 3 }),
          updateTriggers: { getFillColor: [strong] },
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

const FILL_ALPHA = { none: 0, light: 40, solid: 230 } as const

/**
 * The shapes people drew on a map (map.addShape), above its data layers: lines 3 px wide, areas with a light fill,
 * arrowheads solid. Undefined when there are none. Sticky notes are not here: they are DOM markers (MapStickies.tsx).
 */
export function shapeLayer(annotations: MapAnnotation[]): Layer | undefined {
  const parts = annotations.flatMap((a) => (a.kind === 'shape' ? shapeFeatures(a.shape, a.points, SHAPE_COLORS[a.color]) : []))
  if (!parts.length) return undefined
  return new GeoJsonLayer({
    id: 'annotations',
    data: { type: 'FeatureCollection', features: parts } as unknown as GeoJSON.FeatureCollection,
    stroked: true,
    filled: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 3,
    lineCapRounded: true,
    lineJointRounded: true,
    getLineColor: (f) => [...hexToRgb((f as unknown as ShapePart).properties.color), 255],
    getFillColor: (f) => {
      const { color, fill } = (f as unknown as ShapePart).properties
      return [...hexToRgb(color), FILL_ALPHA[fill]]
    },
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
