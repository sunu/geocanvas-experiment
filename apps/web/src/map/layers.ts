import { useEffect, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer } from '@deck.gl/layers'
import { tools } from '../tools/registry'
import { stableJson } from '../tools/runner'

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

/** deck.gl layers for the layers that have a result, by kind of result. */
export function deckLayers(states: LayerState[]): Layer[] {
  return states.flatMap((s): Layer[] => {
    if (s.value === undefined) return []
    if (s.output === 'geo.features') {
      return [
        new GeoJsonLayer({
          id: `layer-${s.id}`,
          data: s.value as GeoJSON.FeatureCollection,
          pointType: 'circle',
          pointRadiusUnits: 'pixels',
          getPointRadius: 6,
          getFillColor: [...ACCENT, 140],
          getLineColor: [...ACCENT, 255],
          lineWidthUnits: 'pixels',
          getLineWidth: 1.5,
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
