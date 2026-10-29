import { metersBetween, type RoadGraph } from './graph'

/**
 * A grid over the graph's pieces, to find those near a place: where a route starts and ends, and
 * which pieces a closure touches.
 */

/** Cell size in degrees, about 550 m; most pieces fall in one to four cells. */
const CELL = 0.005

const key = (ix: number, iy: number) => ix * 100_000 + iy
const cellOf = (lng: number, lat: number) => [Math.floor((lng + 180) / CELL), Math.floor((lat + 90) / CELL)] as const

export class PieceIndex {
  private cells = new Map<number, number[]>()
  private g: RoadGraph

  constructor(g: RoadGraph) {
    this.g = g
    for (let p = 0; p < g.pieces; p++) {
      let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity]
      for (let i = g.coordStart[p]!; i < g.coordStart[p + 1]!; i++) {
        const x = g.coords[2 * i]!
        const y = g.coords[2 * i + 1]!
        w = Math.min(w, x)
        e = Math.max(e, x)
        s = Math.min(s, y)
        n = Math.max(n, y)
      }
      const [x0, y0] = cellOf(w, s)
      const [x1, y1] = cellOf(e, n)
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          const k = key(ix, iy)
          const cell = this.cells.get(k)
          if (cell) cell.push(p)
          else this.cells.set(k, [p])
        }
      }
    }
  }

  /** The pieces whose cells meet a bbox [west, south, east, north] (a superset of those inside it). */
  near([w, s, e, n]: readonly number[]): Set<number> {
    const out = new Set<number>()
    const [x0, y0] = cellOf(w!, s!)
    const [x1, y1] = cellOf(e!, n!)
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) for (const p of this.cells.get(key(ix, iy)) ?? []) out.add(p)
    return out
  }

  /**
   * The nearest piece that `ok` accepts, within `maxMeters`: the piece, how far along it the nearest point is
   * (0-1), and the distance to it. Looks in a small box first, then wider ones.
   */
  nearest(lng: number, lat: number, ok: (p: number) => boolean, maxMeters = 5000): Snap | undefined {
    for (const radius of [...[250, 1000].filter((r) => r < maxMeters), maxMeters]) {
      let best: Snap | undefined
      for (const p of this.near(boxAround(lng, lat, radius))) {
        if (!ok(p)) continue
        const hit = project(this.g, p, lng, lat)
        if (hit.meters <= radius && (!best || hit.meters < best.meters)) best = hit
      }
      if (best) return best
      if (radius >= maxMeters) break
    }
    return undefined
  }
}

export interface Snap {
  piece: number
  /** Position of the nearest point along the piece, 0 at its `from` node to 1 at its `to` node. */
  t: number
  /** Distance from the place to the piece, in metres. */
  meters: number
}

/** A bbox of `meters` around a place. */
export function boxAround(lng: number, lat: number, meters: number): [number, number, number, number] {
  const dLat = meters / 111_195
  const dLng = dLat / Math.max(0.01, Math.cos((lat * Math.PI) / 180))
  return [lng - dLng, lat - dLat, lng + dLng, lat + dLat]
}

/** The point of a piece nearest a place, in a local flat projection around the place. */
export function project(g: RoadGraph, p: number, lng: number, lat: number): Snap {
  const kx = 111_195 * Math.cos((lat * Math.PI) / 180)
  const ky = 111_195
  const start = g.coordStart[p]!
  const end = g.coordStart[p + 1]!
  let best = { meters: Infinity, along: 0 }
  let along = 0
  for (let i = start; i + 1 < end; i++) {
    const ax = (g.coords[2 * i]! - lng) * kx
    const ay = (g.coords[2 * i + 1]! - lat) * ky
    const bx = (g.coords[2 * i + 2]! - lng) * kx
    const by = (g.coords[2 * i + 3]! - lat) * ky
    const dx = bx - ax
    const dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
    const d = Math.hypot(ax + dx * t, ay + dy * t)
    const len = Math.sqrt(len2)
    if (d < best.meters) best = { meters: d, along: along + len * t }
    along += len
  }
  return { piece: p, t: along > 0 ? best.along / along : 0, meters: best.meters }
}

/** Points every `step` metres along a piece, both ends included. */
export function samplePiece(g: RoadGraph, p: number, step: number): [number, number][] {
  const out: [number, number][] = []
  const start = g.coordStart[p]!
  const end = g.coordStart[p + 1]!
  out.push([g.coords[2 * start]!, g.coords[2 * start + 1]!])
  let carry = 0 // metres since the last sample
  for (let i = start; i + 1 < end; i++) {
    const x0 = g.coords[2 * i]!
    const y0 = g.coords[2 * i + 1]!
    const x1 = g.coords[2 * i + 2]!
    const y1 = g.coords[2 * i + 3]!
    const len = metersBetween(x0, y0, x1, y1)
    let d = step - carry
    while (d < len) {
      const t = d / len
      out.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t])
      d += step
    }
    carry = len - (d - step)
  }
  out.push([g.coords[2 * (end - 1)]!, g.coords[2 * (end - 1) + 1]!])
  return out
}
