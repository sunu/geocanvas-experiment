import type { Bbox } from '@ttx/plugins'

/**
 * The area whose roads a route is found on: the box around its ends, with room to go around closures, snapped
 * outward to a grid. Computed from the route alone, so every browser reads the same roads and finds the same
 * path, and routes near each other share one road network.
 */

/** Room around the ends: this share of the box's size, and at least PAD_KM. */
const PAD_SHARE = 0.3
const PAD_KM = 5
/** Grid in degrees (about 5.5 km). */
const GRID = 0.05

export function routeArea(from: [number, number], to: [number, number]): Bbox {
  const lat = (from[1] + to[1]) / 2
  const kmLat = 111.195
  const kmLng = kmLat * Math.max(0.01, Math.cos((lat * Math.PI) / 180))
  const [w, e] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])]
  const [s, n] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])]
  const padLng = Math.max((e - w) * PAD_SHARE, PAD_KM / kmLng)
  const padLat = Math.max((n - s) * PAD_SHARE, PAD_KM / kmLat)
  const down = (v: number) => Math.round(Math.floor(v / GRID) * GRID * 1e6) / 1e6
  const up = (v: number) => Math.round(Math.ceil(v / GRID) * GRID * 1e6) / 1e6
  return [down(w - padLng), down(s - padLat), up(e + padLng), up(n + padLat)]
}
