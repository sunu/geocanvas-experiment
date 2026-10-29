import { cumulativeMeters, metersBetween, piecePoints, pointsBetween, type RoadGraph } from './graph'
import type { PieceIndex, Snap } from './pieceIndex'
import { maxSpeed, type Profile } from './profiles'

/**
 * The fastest route between two places on a road graph: A* over travel time, with the closed pieces left
 * out. A place joins the graph at the nearest point of a piece the profile can drive and that is open, so
 * a route can start or end mid-way along a road.
 */

export interface Route {
  /** The path, [lng, lat] points from start to end. */
  line: [number, number][]
  meters: number
  seconds: number
  /** The named roads it uses most, with the metres on each. */
  roads: { name: string; meters: number }[]
  /** Distance from each place to where the route meets the road, in metres (not part of `meters` or `seconds`). */
  offRoad: [number, number]
}

export type RouteOutcome = ({ ok: true } & Route) | { ok: false; reason: string }

/** Farthest a place may be from an open road it can start from. */
export const MAX_SNAP_METERS = 5000

const kmh = (v: number) => v / 3.6

export function findRoute(
  g: RoadGraph,
  index: PieceIndex,
  profile: Profile,
  closed: Uint8Array,
  from: [number, number],
  to: [number, number],
): RouteOutcome {
  const fwd = g.speed[profile].forward
  const bwd = g.speed[profile].backward
  const usable = (p: number) => !closed[p] && (fwd[p]! > 0 || bwd[p]! > 0)
  const start = index.nearest(from[0], from[1], usable, MAX_SNAP_METERS)
  if (!start) return { ok: false, reason: `No open road within ${MAX_SNAP_METERS / 1000} km of the start` }
  const end = index.nearest(to[0], to[1], usable, MAX_SNAP_METERS)
  if (!end) return { ok: false, reason: `No open road within ${MAX_SNAP_METERS / 1000} km of the destination` }

  // Nodes 0..nodes-1 are the graph's; START and GOAL are the two places, joined to the ends of their pieces.
  const START = g.nodes
  const GOAL = g.nodes + 1
  const cost = new Float64Array(g.nodes + 2).fill(Infinity)
  const viaNode = new Int32Array(g.nodes + 2).fill(-1)
  const viaPiece = new Int32Array(g.nodes + 2).fill(-1)
  const done = new Uint8Array(g.nodes + 2)
  const fastest = kmh(maxSpeed(profile))
  const [gx, gy] = to
  const h = (n: number) => (n >= START ? 0 : metersBetween(g.nodeCoords[2 * n]!, g.nodeCoords[2 * n + 1]!, gx, gy) / fastest)
  const heap = new MinHeap()
  const relax = (n: number, c: number, prev: number, piece: number) => {
    if (c >= cost[n]!) return
    cost[n] = c
    viaNode[n] = prev
    viaPiece[n] = piece
    heap.push(c + h(n), n)
  }
  /** Seconds along part of a piece, in the direction from `t0` to `t1`; Infinity where it may not be driven. */
  const seconds = (p: number, t0: number, t1: number) => {
    const v = t1 >= t0 ? fwd[p]! : bwd[p]!
    return v > 0 ? (Math.abs(t1 - t0) * g.meters[p]!) / kmh(v) : Infinity
  }

  cost[START] = 0
  relax(g.to[start.piece]!, seconds(start.piece, start.t, 1), START, start.piece)
  relax(g.from[start.piece]!, seconds(start.piece, start.t, 0), START, start.piece)
  if (start.piece === end.piece) relax(GOAL, seconds(start.piece, start.t, end.t), START, start.piece)

  while (heap.size > 0) {
    const u = heap.pop()
    if (done[u]) continue
    done[u] = 1
    if (u === GOAL) break
    const cu = cost[u]!
    if (u === g.from[end.piece]) relax(GOAL, cu + seconds(end.piece, 0, end.t), u, end.piece)
    if (u === g.to[end.piece]) relax(GOAL, cu + seconds(end.piece, 1, end.t), u, end.piece)
    for (let k = g.incidentStart[u]!; k < g.incidentStart[u + 1]!; k++) {
      const p = g.incident[k]!
      if (closed[p]) continue
      if (g.from[p] === u && fwd[p]! > 0) relax(g.to[p]!, cu + g.meters[p]! / kmh(fwd[p]!), u, p)
      else if (g.to[p] === u && bwd[p]! > 0) relax(g.from[p]!, cu + g.meters[p]! / kmh(bwd[p]!), u, p)
    }
  }
  if (!Number.isFinite(cost[GOAL]!)) return { ok: false, reason: 'No route: the destination is cut off from the start' }
  return { ok: true, ...trace(g, start, end, viaNode, viaPiece, START, GOAL), seconds: cost[GOAL]! }
}

/** Walks back from the goal and joins the pieces' points, cutting the first and last pieces at the places. */
function trace(g: RoadGraph, start: Snap, end: Snap, viaNode: Int32Array, viaPiece: Int32Array, START: number, GOAL: number) {
  const steps: { piece: number; t0: number; t1: number }[] = []
  for (let n = GOAL; n !== START; n = viaNode[n]!) {
    const p = viaPiece[n]!
    const prev = viaNode[n]!
    const t0 = prev === START ? start.t : prev === g.from[p] ? 0 : 1
    const t1 = n === GOAL ? end.t : n === g.to[p] ? 1 : 0
    steps.push({ piece: p, t0, t1 })
  }
  steps.reverse()
  const line: [number, number][] = []
  const byName = new Map<string, number>()
  let meters = 0
  for (const { piece, t0, t1 } of steps) {
    // A place right at a node joins the graph with a step of no length (on a road it does not use).
    if (t0 === t1) continue
    for (const pt of cut(g, piece, t0, t1)) {
      const last = line[line.length - 1]
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) line.push(pt)
    }
    const m = Math.abs(t1 - t0) * g.meters[piece]!
    meters += m
    const name = g.segments[g.segment[piece]!]!.name
    if (name) byName.set(name, (byName.get(name) ?? 0) + m)
  }
  const roads = [...byName].map(([name, m]) => ({ name, meters: Math.round(m) })).sort((a, b) => b.meters - a.meters).slice(0, 5)
  return { line, meters, roads, offRoad: [start.meters, end.meters] as [number, number] }
}

/** The points of a piece between positions `t0` and `t1` (0-1 by length), in that direction. */
function cut(g: RoadGraph, p: number, t0: number, t1: number): [number, number][] {
  const pts = piecePoints(g, p)
  const cum = cumulativeMeters(pts)
  const total = cum[cum.length - 1]!
  const out = pointsBetween(pts, cum, Math.min(t0, t1) * total, Math.max(t0, t1) * total)
  return t0 <= t1 ? out : out.reverse()
}

/** A binary min-heap of node ids by priority; stale entries are skipped by the caller. */
class MinHeap {
  private keys: number[] = []
  private values: number[] = []
  get size() {
    return this.keys.length
  }
  push(key: number, value: number) {
    const k = this.keys
    const v = this.values
    let i = k.length
    k.push(key)
    v.push(value)
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (k[parent]! <= key) break
      k[i] = k[parent]!
      v[i] = v[parent]!
      i = parent
    }
    k[i] = key
    v[i] = value
  }
  pop(): number {
    const k = this.keys
    const v = this.values
    const top = v[0]!
    const lastKey = k.pop()!
    const lastValue = v.pop()!
    if (k.length > 0) {
      let i = 0
      for (;;) {
        let child = 2 * i + 1
        if (child >= k.length) break
        if (child + 1 < k.length && k[child + 1]! < k[child]!) child++
        if (k[child]! >= lastKey) break
        k[i] = k[child]!
        v[i] = v[child]!
        i = child
      }
      k[i] = lastKey
      v[i] = lastValue
    }
    return top
  }
}
