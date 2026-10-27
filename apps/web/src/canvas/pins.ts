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

/** Smallest on-screen width of a pinned card, and the largest scale. */
export const PIN_MIN_PX = 64
export const PIN_MAX_SCALE = 2

/**
 * Scale of a pinned card: it follows the map zoom from the zoom it was pinned at
 * (one zoom level = 2×), but stays at least PIN_MIN_PX wide and at most PIN_MAX_SCALE.
 */
export function pinScale(view: MapView, child: NodeRecord): number {
  const ref = child.anchor?.zoom
  if (ref === undefined) return 1
  const s = 2 ** (view.zoom - ref)
  return Math.min(PIN_MAX_SCALE, Math.max(PIN_MIN_PX / Math.max(1, child.layout.w), s))
}

/** Box of a pinned card relative to its map shape: the tip of its tail sits on the place. */
export function pinPosition(runtime: CanvasRuntime, map: NodeRecord, child: NodeRecord): { x: number; y: number; w: number; h: number; scale: number } {
  const view = currentView(runtime, map)
  const scale = pinScale(view, child)
  const w = child.layout.w * scale
  const h = child.layout.h * scale
  const p = project(view, mapViewport(map.layout), child.anchor!.lngLat)
  return { x: p.x - w / 2, y: MAP_HEADER_H + p.y - h - PIN_TAIL * scale, w, h, scale }
}

/**
 * Where the tail tip of a card at (x, y, w, h) relative to the map lands, as lon/lat,
 * or undefined if outside the map view. `scale` is the card's current scale (tail length).
 */
export function placeUnder(
  runtime: CanvasRuntime,
  map: NodeRecord,
  rel: { x: number; y: number; w: number; h: number },
  scale = 1,
): [number, number] | undefined {
  const size = mapViewport(map.layout)
  const tip = { x: rel.x + rel.w / 2, y: rel.y + rel.h + PIN_TAIL * scale - MAP_HEADER_H }
  if (tip.x < 0 || tip.y < 0 || tip.x > size.w || tip.y > size.h) return undefined
  const [lon, lat] = unproject(currentView(runtime, map), size, tip)
  return [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5]
}
