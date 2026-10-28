import type { Map as MapLibreMap } from 'maplibre-gl'
import type { Place } from '@ttx/plugins'
import { viewArea } from './layers'

/**
 * The live MapLibre map of each map object in this tab, by object id. The map's Options panel is drawn
 * outside the map's view (canvas/OptionsPanel.tsx) but acts on what this person sees: go to a place,
 * add data for the area in view, share the view.
 */
const live = new Map<string, MapLibreMap>()

export const liveMap = (id: string) => live.get(id)

/** Record the live map of an object. Returns the function that forgets it. */
export function registerLiveMap(id: string, map: MapLibreMap) {
  live.set(id, map)
  return () => {
    if (live.get(id) === map) live.delete(id)
  }
}

/** Zoom for a place without a bbox. */
const POINT_ZOOM = 10

/** Move this person's view to a place (saved as their view like any pan). Other people's views stay where they are. */
export function goTo(map: MapLibreMap, place: Place) {
  if (place.bbox) map.fitBounds(place.bbox, { padding: 24, maxZoom: 16 })
  else map.flyTo({ center: place.lngLat, zoom: POINT_ZOOM })
}

/** The area in view, from the live map: the view in the doc is saved only after a pause. */
export function areaOf(map: MapLibreMap) {
  const [west, south, east, north] = viewArea(map.getBounds().toArray() as [[number, number], [number, number]])
  return { west, south, east, north }
}
