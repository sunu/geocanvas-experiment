import type { CanvasRuntime, NodeRecord } from '@geo-canvas/core'
import { MAP_HEADER_H, mapViewport, project, unproject, type MapView } from '@geo-canvas/plugin-core'
import { liveViews, viewOf } from '../nodes/mapCamera'

/** Height of the pointer under a pinned card. The place is at the tip. */
export const PIN_TAIL = 12

export function isMapNode(n: NodeRecord | undefined) {
  return n?.type === 'core.map'
}

/** View a map shows now: the live camera while the local user pans, else the doc view (or a fit). */
export function currentView(runtime: CanvasRuntime, map: NodeRecord): MapView {
  const live = liveViews.get(map.id)
  if (live) return live
  const aoi = runtime.engine.get(map.id)?.result?.outputs?.aoi as GeoJSON.Feature | undefined
  return viewOf(map, aoi)
}

/** Position of a pinned card relative to its map shape: the tip of its tail sits on the place. */
export function pinPosition(runtime: CanvasRuntime, map: NodeRecord, child: NodeRecord): { x: number; y: number } {
  const p = project(currentView(runtime, map), mapViewport(map.layout), child.anchor!.lngLat)
  return { x: p.x - child.layout.w / 2, y: MAP_HEADER_H + p.y - child.layout.h - PIN_TAIL }
}

/** Where the tail tip of a card at (x, y, w, h) relative to the map lands, as lon/lat, or undefined if outside the map view. */
export function placeUnder(
  runtime: CanvasRuntime,
  map: NodeRecord,
  rel: { x: number; y: number; w: number; h: number },
): [number, number] | undefined {
  const size = mapViewport(map.layout)
  const tip = { x: rel.x + rel.w / 2, y: rel.y + rel.h + PIN_TAIL - MAP_HEADER_H }
  if (tip.x < 0 || tip.y < 0 || tip.x > size.w || tip.y > size.h) return undefined
  const [lon, lat] = unproject(currentView(runtime, map), size, tip)
  return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
}
