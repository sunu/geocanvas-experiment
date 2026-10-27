/**
 * Web Mercator math for map views. Pure functions, no map library.
 * Same conventions as MapLibre: 512 px tiles, zoom 0 = whole world in 512 px.
 */

export interface MapView {
  center: [number, number]
  zoom: number
  bearing?: number
}

export interface Size {
  w: number
  h: number
}

const TILE = 512
const MAX_LAT = 85.051129

/** lon/lat -> world pixels at zoom 0 (0..512). */
export function toWorld([lon, lat]: [number, number]): [number, number] {
  const l = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
  const x = ((lon + 180) / 360) * TILE
  const s = Math.sin((l * Math.PI) / 180)
  const y = (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE
  return [x, y]
}

export function fromWorld([x, y]: [number, number]): [number, number] {
  const lon = (x / TILE) * 360 - 180
  const n = Math.PI - (2 * Math.PI * y) / TILE
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return [lon, lat]
}

/** lon/lat -> pixel position inside a map of `size`, top-left origin. */
export function project(view: MapView, size: Size, lngLat: [number, number]): { x: number; y: number } {
  const scale = 2 ** view.zoom
  const [cx, cy] = toWorld(view.center)
  const [px, py] = toWorld(lngLat)
  let dx = (px - cx) * scale
  const dy = (py - cy) * scale
  // Shortest way around the antimeridian.
  const world = TILE * scale
  if (dx > world / 2) dx -= world
  if (dx < -world / 2) dx += world
  const b = ((view.bearing ?? 0) * Math.PI) / 180
  const rx = dx * Math.cos(b) + dy * Math.sin(b)
  const ry = -dx * Math.sin(b) + dy * Math.cos(b)
  return { x: size.w / 2 + rx, y: size.h / 2 + ry }
}

/** Pixel position inside a map -> lon/lat. */
export function unproject(view: MapView, size: Size, p: { x: number; y: number }): [number, number] {
  const scale = 2 ** view.zoom
  const b = ((view.bearing ?? 0) * Math.PI) / 180
  const rx = p.x - size.w / 2
  const ry = p.y - size.h / 2
  const dx = rx * Math.cos(b) - ry * Math.sin(b)
  const dy = rx * Math.sin(b) + ry * Math.cos(b)
  const [cx, cy] = toWorld(view.center)
  const [lon, lat] = fromWorld([cx + dx / scale, cy + dy / scale])
  return [((((lon + 180) % 360) + 360) % 360) - 180, lat]
}

/** Bounding box [minLon, minLat, maxLon, maxLat] of any GeoJSON geometry or feature. */
export function bboxOf(g: GeoJSON.GeoJSON): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity]
  const visit = (c: unknown): void => {
    if (Array.isArray(c) && typeof c[0] === 'number') {
      minX = Math.min(minX, c[0]); minY = Math.min(minY, c[1] as number)
      maxX = Math.max(maxX, c[0]); maxY = Math.max(maxY, c[1] as number)
    } else if (Array.isArray(c)) c.forEach(visit)
  }
  const walk = (o: any): void => {
    if (!o) return
    if (o.type === 'FeatureCollection') o.features.forEach(walk)
    else if (o.type === 'Feature') walk(o.geometry)
    else if (o.type === 'GeometryCollection') o.geometries.forEach(walk)
    else visit(o.coordinates)
  }
  walk(g)
  return [minX, minY, maxX, maxY]
}

/** View that fits a bbox in a map of `size`, with padding in px. */
export function fitBounds(
  [minX, minY, maxX, maxY]: [number, number, number, number],
  size: Size,
  padding = 30,
  maxZoom = 16,
): MapView {
  const [x0, y1] = toWorld([minX, minY])
  const [x1, y0] = toWorld([maxX, maxY])
  const w = Math.max(1e-9, x1 - x0)
  const h = Math.max(1e-9, y1 - y0)
  const zoom = Math.min(
    maxZoom,
    Math.log2(Math.max(1, size.w - 2 * padding) / w),
    Math.log2(Math.max(1, size.h - 2 * padding) / h),
  )
  return { center: fromWorld([(x0 + x1) / 2, (y0 + y1) / 2]), zoom: round(zoom, 3) }
}

export function round(n: number, d = 5) {
  const k = 10 ** d
  return Math.round(n * k) / k
}
