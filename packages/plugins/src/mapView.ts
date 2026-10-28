/**
 * Map views as areas and back, in web mercator, for the agent: it thinks in areas ("India"), and maps keep
 * center and zoom (MapLibre, 512 px tiles). Bearing is left out of areas.
 */

export interface Area {
  west: number
  south: number
  east: number
  north: number
}

export interface CenterZoom {
  center: [number, number]
  zoom: number
}

/** The map's header (`.ttx-map__header` in apps/web/src/styles.css: 32 px and a 1 px border) is not map. */
export const MAP_HEADER_PX = 33

const TILE = 512
const MAX_LAT = 85.0511
const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))
const x = (lon: number) => (lon + 180) / 360
const y = (lat: number) => {
  const r = (clampLat(lat) * Math.PI) / 180
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2
}
const lonOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI
const wrapLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180

/** Center and zoom that show `area` in a map of this size (px), with `padding` px around it. */
export function viewOfArea(area: Area, width: number, height: number, padding = 24): CenterZoom {
  // An area across the antimeridian has west > east.
  const dx = x(area.east) - x(area.west) + (area.east < area.west ? 1 : 0)
  const dy = y(area.south) - y(area.north)
  const w = Math.max(1, width - 2 * padding)
  const h = Math.max(1, height - 2 * padding)
  const zoom = Math.log2(Math.min(w / (Math.max(dx, 1e-9) * TILE), h / (Math.max(dy, 1e-9) * TILE)))
  return {
    center: [wrapLon(lonOf(x(area.west) + dx / 2)), latOf((y(area.north) + y(area.south)) / 2)],
    zoom: Math.max(0, Math.min(20, zoom)),
  }
}

/** The area a view shows in a map of this size (px). */
export function areaOfView(view: CenterZoom, width: number, height: number): Area {
  const scale = TILE * 2 ** view.zoom
  const cx = x(view.center[0])
  const cy = y(view.center[1])
  const halfW = width / 2 / scale
  const halfH = height / 2 / scale
  // Wider than the world: say so, instead of wrapping.
  const whole = halfW >= 0.5
  return {
    west: whole ? -180 : wrapLon(lonOf(cx - halfW)),
    east: whole ? 180 : wrapLon(lonOf(cx + halfW)),
    north: latOf(Math.max(0, cy - halfH)),
    south: latOf(Math.min(1, cy + halfH)),
  }
}
