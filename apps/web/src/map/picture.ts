import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { stableJson, Views, type Runtime } from '@ttx/core'
import { MAP_HEADER_PX, type MapAnnotation, type MapBoardObject, type MapLayer } from '@ttx/plugins'
import type { RouteState } from '../routing/useRoutes'
import { useScenario } from '../routing/ScenarioOnMap'
import { BASEMAP_CREDITS } from './basemaps'
import { attributionOf, captionOf, useLayerStates, type LayerState } from './layers'
import { useSnapshot, type SnapshotRequest } from './snapshots'

/** Where a map with no view yet looks: the whole world. */
export const WORLD = { center: [20, 10] as [number, number], zoom: 1, bearing: 0 }

/** What a map's data says about itself: the layers' attributions and captions, and the routes' (Overture roads). */
export function creditsOf(states: LayerState[], routes: RouteState[]): string {
  const results = [...states.map((st) => st.value), ...routes.map((r) => r.result)]
  return [...new Set(results.flatMap((v) => [attributionOf(v), captionOf(v)]).filter((a) => !!a))].join(' · ')
}

/** What the snapshot renderer needs to draw a map as it is: one picture of its view, data, drawings and scenario. */
export function pictureRequest(
  o: MapBoardObject,
  view: { center: [number, number]; zoom: number; bearing: number },
  layers: MapLayer[],
  shapes: MapAnnotation[],
  scenario: Pick<SnapshotRequest, 'routes' | 'closures'>,
): SnapshotRequest {
  return {
    view: { center: view.center, zoom: view.zoom, bearing: view.bearing },
    width: o.w,
    height: o.h - MAP_HEADER_PX,
    basemap: o.basemap,
    layers,
    shapes,
    routes: scenario.routes,
    closures: scenario.closures,
  }
}

/**
 * A picture of a map as this person sees it, with its credits (a picture has no attribution control): for a report,
 * which shows maps as pictures, never live maps (agent-docs/tasks/reports.md §3.3).
 */
export function useMapPicture(runtime: Runtime, o: MapBoardObject): { url?: string; credits: string } {
  const layers = o.layers ?? NO_LAYERS
  const states = useLayerStates(layers)
  const scenario = useScenario(o, layers, states)
  const annotations = o.annotations ?? NO_ANNOTATIONS
  const shapesKey = stableJson(annotations.filter((a) => a.kind === 'shape'))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shapes = useMemo(() => annotations.filter((a) => a.kind === 'shape'), [shapesKey])
  const views = useMemo(() => new Views(runtime.board.doc), [runtime])
  const subscribe = useCallback((listener: () => void) => views.subscribe(listener), [views])
  const view = useSyncExternalStore(subscribe, () => views.get(runtime.actor.id, o.id) ?? views.latest(o.id)?.view) ?? WORLD
  const url = useSnapshot(pictureRequest(o, view, layers, shapes, scenario))
  return { url, credits: [BASEMAP_CREDITS[o.basemap], creditsOf(states, scenario.routes)].filter(Boolean).join(' · ') }
}

const NO_LAYERS: MapLayer[] = []
const NO_ANNOTATIONS: MapAnnotation[] = []
