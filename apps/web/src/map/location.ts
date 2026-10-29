import type { MapArea } from '@ttx/plugins'

/**
 * Typed locations for a map's Location tools (LocationPicker.tsx): a point as "lat, lon" or a bbox as
 * "west, south, east north". Each becomes an area for map.showArea. Numbers may be split by commas or spaces.
 */

const numbers = (text: string) => {
  const parts = text.trim().split(/[\s,;]+/).filter(Boolean)
  const values = parts.map(Number)
  return values.every((v) => Number.isFinite(v)) ? values : []
}

/** "lat, lon" (latitude first, as most sources write it), or undefined when it is not one. */
export function parseLatLon(text: string): { lat: number; lon: number } | undefined {
  const v = numbers(text)
  if (v.length !== 2) return undefined
  const [lat, lon] = v as [number, number]
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined
}

/** "west, south, east, north" in degrees, or undefined. West may be greater than east, across the antimeridian. */
export function parseBbox(text: string): MapArea | undefined {
  const v = numbers(text)
  if (v.length !== 4) return undefined
  const [west, south, east, north] = v as [number, number, number, number]
  if ([west, east].some((x) => Math.abs(x) > 180) || [south, north].some((y) => Math.abs(y) > 90)) return undefined
  if (south >= north || west === east) return undefined
  return { west, south, east, north }
}

/** About this many km on each side of a typed point: a town and its surroundings. */
const POINT_KM = 10
const KM_PER_DEGREE = 111.32

/** The area around a point, for map.showArea, which takes areas. */
export function areaAround({ lat, lon }: { lat: number; lon: number }, km = POINT_KM): MapArea {
  const dLat = km / KM_PER_DEGREE
  const dLon = km / (KM_PER_DEGREE * Math.max(0.01, Math.cos((lat * Math.PI) / 180)))
  return {
    west: Math.max(-180, lon - dLon),
    south: Math.max(-90, lat - dLat),
    east: Math.min(180, lon + dLon),
    north: Math.min(90, lat + dLat),
  }
}
