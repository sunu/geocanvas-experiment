import { useEffect, useMemo, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { ScatterplotLayer } from '@deck.gl/layers'
import { stableJson } from '@ttx/core'
import type { MapScenario, ScenarioClosure } from '@ttx/plugins'
import type { FacilityCategory, FacilityProps } from '../data/layercake'
import { tools } from '../tools/registry'
import { areasToCount } from './areas'
import type { Exposure } from './exposure'

/**
 * A map scenario's exposure as this browser has it (plans/plan-015.md): the buildings in its flood areas, the polygons
 * of the closures that are on and of the layers that block roads; and, when what-ifs add polygons, the same count for
 * the areas from data alone (the baseline), so people see what the what-ifs add. Both go through the tool runner, so
 * the map and its Options panel share them, and a what-if switched off and on again costs nothing.
 */
export interface ExposureState {
  /** No polygon among the flood areas small enough to count: nothing to count. */
  noAreas?: boolean
  /** Areas left out as larger than MAX_AREA_DEG2 (e.g. a country's outline), by name. */
  leftOut: string[]
  /** A layer that blocks roads is still loading: counting waits for it, or it would count twice. */
  waiting?: boolean
  /** With the what-ifs; undefined while counting. */
  result?: Exposure
  /** The areas from data alone, when what-ifs add polygons. Zero buildings when there are no areas from data. */
  baseline?: Exposure
  error?: string
}

const NONE: Exposure = { buildings: 0, bySubtype: {}, facilities: [], attribution: '' }

export function useExposure(
  scenario: MapScenario | undefined,
  closures: ScenarioClosure[],
  fromLayers: GeoJSON.Feature[],
  waiting: boolean,
): ExposureState | undefined {
  const on = !!scenario?.exposure?.buildings
  const { areas, dataAreas, leftOut } = useMemo(() => {
    const data = areasToCount(fromLayers.map((f) => ({ geometry: f.geometry, label: String(f.properties?.title ?? 'An affected area') })))
    const whatIfs = areasToCount(closures.flatMap((c) => (c.off ? [] : [{ geometry: c.geometry as GeoJSON.Geometry, label: c.note || 'A closed area' }])))
    return { areas: [...whatIfs.counted, ...data.counted], dataAreas: data.counted, leftOut: [...new Set([...data.leftOut, ...whatIfs.leftOut])] }
  }, [closures, fromLayers])
  // Flood layers can hold thousands of polygons: their keys are computed once per change, not on every render.
  const areasKey = useMemo(() => stableJson(areas), [areas])
  const dataKey = useMemo(() => stableJson(dataAreas), [dataAreas])
  const whatIfs = areas.length > dataAreas.length
  const key = on && !waiting && areas.length ? `${areasKey}|${whatIfs ? dataKey : ''}` : ''
  const [state, setState] = useState<{ key: string; result?: Exposure; baseline?: Exposure; error?: string }>({ key: '' })

  useEffect(() => {
    if (!key) return
    const abort = new AbortController()
    const run = (input: GeoJSON.Geometry[]) => tools.run<Exposure>('exposure.buildings', { areas: input }, { signal: abort.signal })
    Promise.all([run(areas), whatIfs ? (dataAreas.length ? run(dataAreas) : NONE) : undefined]).then(
      ([result, baseline]) => setState({ key, result, ...(baseline && { baseline }) }),
      (err) => {
        if (!abort.signal.aborted) setState({ key, error: String((err as Error)?.message ?? err) })
      },
    )
    return () => abort.abort()
    // `key` covers the areas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return useMemo(() => {
    if (!on) return undefined
    if (waiting) return { waiting, leftOut }
    if (!areas.length) return { noAreas: true, leftOut }
    return state.key === key ? { result: state.result, baseline: state.baseline, error: state.error, leftOut } : { leftOut }
  }, [on, waiting, areas.length, key, state, leftOut])
}

/** What the what-ifs add to the building count, or undefined without what-ifs or before both counts. */
export function addedByWhatIfs(s: ExposureState): number | undefined {
  return s.result && s.baseline ? s.result.buildings - s.baseline.buildings : undefined
}

/** The facilities of a count by category. */
export function facilitiesBy(e: Exposure, category: FacilityCategory) {
  return e.facilities.filter((f) => f.properties.category === category)
}

/** Colors of exposed facilities on the map and in the panel: not red (closures), not the routes' colors. */
export const FACILITY_COLORS: Record<FacilityCategory, string> = { health: '#e11d48', education: '#0d9488' }

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** The exposed health facilities and places of education as dots with a white ring, above the routes. */
export function exposureLayers(s: ExposureState | undefined): Layer[] {
  if (!s?.result?.facilities.length) return []
  return [
    new ScatterplotLayer<GeoJSON.Feature<GeoJSON.Point, FacilityProps>>({
      id: 'exposure-facilities',
      data: s.result.facilities,
      getPosition: (f) => f.geometry.coordinates as [number, number],
      getFillColor: (f) => rgb(FACILITY_COLORS[f.properties.category]),
      getLineColor: [255, 255, 255],
      radiusUnits: 'pixels',
      getRadius: 5,
      lineWidthUnits: 'pixels',
      getLineWidth: 1.5,
      stroked: true,
    }),
  ]
}
