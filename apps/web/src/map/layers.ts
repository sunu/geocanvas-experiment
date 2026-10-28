import { useEffect, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer } from '@deck.gl/layers'
import { tools } from '../tools/registry'
import { stableJson } from '../tools/runner'
import { rasterLayers } from './raster'
import { bboxOf, type Bbox, type MapLayer } from '@ttx/plugins'

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
          pointRadiusUnits: 'pixels',
          getPointRadius: 6,
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
