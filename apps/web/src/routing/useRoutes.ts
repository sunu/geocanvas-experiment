import { useEffect, useMemo, useState } from 'react'
import type { Layer } from '@deck.gl/core'
import { GeoJsonLayer, PathLayer } from '@deck.gl/layers'
import { stableJson } from '@ttx/core'
import { ROUTE_COLORS, type MapLayer, type MapScenario, type ScenarioClosure, type ScenarioRoute } from '@ttx/plugins'
import type { LayerState } from '../map/layers'
import { tools } from '../tools/registry'
import type { RouteOutcome } from './routing'

/**
 * A map's routes as this browser has them. Each route is found twice: around the closures, and with none (the
 * baseline), so people see what the closures cost. Both runs go through the tool runner, so the map and its Options
 * panel share them, and a closure that is added and removed again costs nothing the second time.
 */

export interface RouteState {
  route: ScenarioRoute
  /** Around the closures; undefined while loading. */
  result?: RouteOutcome
  /** With no closures; only found when there are closures. */
  baseline?: RouteOutcome
  error?: string
}

/**
 * What closes roads in a map's scenario: `all`, the geometries routing goes around (the closures that are on, and the
 * features of the map's layers that block roads, once loaded), and `closures`, every closure, which the map draws
 * (those switched off faded). Each stays the same array until it changes: `states` is kept while no layer or result
 * changes. `fromLayers` is the part of `all` that comes from data, not from what-ifs, as features (with their titles).
 */
export function useClosures(
  scenario: MapScenario | undefined,
  layers: MapLayer[],
  states: LayerState[],
): { all: GeoJSON.Geometry[]; fromLayers: GeoJSON.Feature[]; closures: ScenarioClosure[] } {
  const closuresKey = stableJson(scenario?.closures ?? [])
  const closures = useMemo(() => JSON.parse(closuresKey) as ScenarioClosure[], [closuresKey])
  const blockingKey = layers.flatMap((l) => (l.blocks ? [l.id] : [])).join(',')
  const fromLayers = useMemo(() => {
    const blocking = new Set(blockingKey.split(','))
    return states.flatMap((s) =>
      blocking.has(s.id) && s.output === 'geo.features' && s.value
        ? (s.value as GeoJSON.FeatureCollection).features.filter((f) => !!f.geometry)
        : [],
    )
  }, [blockingKey, states])
  const all = useMemo(() => [...closures.flatMap((c) => (c.off ? [] : [c.geometry as GeoJSON.Geometry])), ...fromLayers.map((f) => f.geometry)], [closures, fromLayers])
  return { all, fromLayers, closures }
}

const routeInput = (r: ScenarioRoute, closures: GeoJSON.Geometry[]) => ({ from: r.from, to: r.to, profile: r.profile, closures })

export function useRoutes(routes: ScenarioRoute[], closures: GeoJSON.Geometry[]): RouteState[] {
  const [results, setResults] = useState<Record<string, { key: string; result?: RouteOutcome; baseline?: RouteOutcome; error?: string }>>({})
  // Hazard layers can hold thousands of polygons: their key is computed once per change, not on every render.
  const closuresKey = useMemo(() => stableJson(closures), [closures])
  const keyOf = (r: ScenarioRoute) => stableJson([r.from, r.to, r.profile, closuresKey])
  const key = stableJson(routes.map((r) => [r.id, keyOf(r)]))

  useEffect(() => {
    const abort = new AbortController()
    const run = (input: ReturnType<typeof routeInput>) => tools.run<RouteOutcome>('routing.route', input, { signal: abort.signal })
    for (const r of routes) {
      const k = keyOf(r)
      Promise.all([run(routeInput(r, closures)), closures.length ? run(routeInput(r, [])) : undefined]).then(
        ([result, baseline]) => setResults((s) => ({ ...s, [r.id]: { key: k, result, ...(baseline && { baseline }) } })),
        (err) => {
          if (!abort.signal.aborted) setResults((s) => ({ ...s, [r.id]: { key: k, error: String((err as Error)?.message ?? err) } }))
        },
      )
    }
    return () => abort.abort()
    // `key` covers the routes and the closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  // The same array until a route or a result changes, so deck.gl does not redraw on every render.
  return useMemo(
    () =>
      routes.map((route) => {
        const r = results[route.id]
        return r?.key === keyOf(route) ? { route, ...r } : { route }
      }),
    // `key` covers `routes`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key, results],
  )
}

/** "1 h 05 min", "12 min". */
export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60)
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`
}

export const formatKm = (meters: number) => `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`

/** "+3.4 km", "−0.4 km": a difference in length. */
export const signedKm = (meters: number) => `${meters < 0 ? '−' : '+'}${formatKm(Math.abs(meters))}`

/**
 * What the closures change in a route: the metres and seconds they add (either can be negative: a detour can be
 * shorter but slower), or undefined when the route is the same (within 50 m and half a minute). Lengths are what
 * people should read: times are road-class guesses, and traffic after a disaster is anyone's guess.
 */
export function detour({ result: r, baseline: b }: RouteState): { meters: number; seconds: number } | undefined {
  if (!r?.ok || !b?.ok) return undefined
  const meters = r.meters - b.meters
  const seconds = r.seconds - b.seconds
  return Math.abs(meters) >= 50 || seconds >= 30 ? { meters, seconds } : undefined
}

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const BASELINE_COLOR: [number, number, number] = [113, 113, 122]
const CLOSURE_COLOR: [number, number, number] = [220, 38, 38]

/**
 * deck.gl layers for a scenario: each route in its color over a white casing, with its route without closures, where
 * that differs, as a thin grey line under it; and above them the closures in red (faded when switched off).
 */
export function routingLayers(states: RouteState[], closures: ScenarioClosure[]): Layer[] {
  const paths = (pick: (s: RouteState) => RouteOutcome | undefined) =>
    states.flatMap((s) => {
      const r = pick(s)
      return r?.ok ? [{ path: r.line, color: rgb(ROUTE_COLORS[s.route.color]) }] : []
    })
  const routes = paths((s) => s.result)
  const baselines = paths((s) => (detour(s) ? s.baseline : undefined))
  const path = { getPath: (d: { path: [number, number][] }) => d.path, widthUnits: 'pixels' as const, capRounded: true, jointRounded: true }
  return [
    new PathLayer({ id: 'routing-baselines', data: baselines, ...path, getColor: [...BASELINE_COLOR, 200], getWidth: 3 }),
    new PathLayer({ id: 'routing-casing', data: routes, ...path, getColor: [255, 255, 255, 230], getWidth: 8 }),
    new PathLayer({ id: 'routing-routes', data: routes, ...path, getColor: (d) => [...d.color, 255], getWidth: 5 }),
    // Above the routes: a closure on a route's way must show.
    new GeoJsonLayer<{ off: boolean }>({
      id: 'routing-closures',
      data: {
        type: 'FeatureCollection',
        features: closures.map((c) => ({ type: 'Feature' as const, geometry: c.geometry as GeoJSON.Geometry, properties: { off: !!c.off } })),
      },
      pointType: 'circle',
      pointRadiusUnits: 'meters',
      getPointRadius: 25,
      pointRadiusMinPixels: 6,
      getFillColor: (f) => [...CLOSURE_COLOR, f.properties.off ? 15 : 60],
      getLineColor: (f) => [...CLOSURE_COLOR, f.properties.off ? 90 : 230],
      lineWidthUnits: 'pixels',
      // A closed road wider than the routes over it; an area's outline thin.
      getLineWidth: (f) => (f.geometry.type === 'LineString' ? 7 : 2),
      lineCapRounded: true,
      stroked: true,
      filled: true,
      updateTriggers: { getFillColor: [closures], getLineColor: [closures] },
    }),
  ]
}
