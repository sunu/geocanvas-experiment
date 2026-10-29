import type { RoadGraph } from './graph'
import { boxAround, project, samplePiece, type PieceIndex } from './pieceIndex'

/**
 * Closures turned into the pieces they close. A closure is any GeoJSON geometry: one someone drew, or a
 * feature of a hazard layer marked as blocking roads.
 * - Point: closes every piece within POINT_METERS (a collapsed bridge, a landslide on a road).
 * - Line: closes the pieces that run along it: those with at least half their length, or LINE_RUN_METERS,
 *   within LINE_METERS of it. A road that only crosses the line keeps going.
 * - Polygon: closes every piece with a point inside it (sampled every SAMPLE_METERS).
 */

export const POINT_METERS = 25
export const LINE_METERS = 10
export const LINE_RUN_METERS = 40
const SAMPLE_METERS = 5

/** Marks the pieces the closures close: closed[p] is 1 for each. */
export function closedPieces(g: RoadGraph, index: PieceIndex, closures: GeoJSON.Geometry[]): Uint8Array {
  const closed = new Uint8Array(g.pieces)
  const close = (geometry: GeoJSON.Geometry) => {
    switch (geometry.type) {
      case 'Point':
        closeNearPoint(g, index, geometry.coordinates, closed)
        break
      case 'MultiPoint':
        for (const c of geometry.coordinates) closeNearPoint(g, index, c, closed)
        break
      case 'LineString':
        closeAlongLine(g, index, geometry.coordinates, closed)
        break
      case 'MultiLineString':
        for (const c of geometry.coordinates) closeAlongLine(g, index, c, closed)
        break
      case 'Polygon':
        closeInside(g, index, geometry.coordinates, closed)
        break
      case 'MultiPolygon':
        for (const c of geometry.coordinates) closeInside(g, index, c, closed)
        break
      case 'GeometryCollection':
        geometry.geometries.forEach(close)
        break
    }
  }
  closures.forEach(close)
  return closed
}

function closeNearPoint(g: RoadGraph, index: PieceIndex, [lng, lat]: GeoJSON.Position, closed: Uint8Array) {
  for (const p of index.near(boxAround(lng!, lat!, POINT_METERS))) {
    if (!closed[p] && project(g, p, lng!, lat!).meters <= POINT_METERS) closed[p] = 1
  }
}

function closeAlongLine(g: RoadGraph, index: PieceIndex, line: GeoJSON.Position[], closed: Uint8Array) {
  if (line.length === 0) return
  for (const p of index.near(grow(bboxOf([line]), LINE_METERS))) {
    if (closed[p]) continue
    const samples = samplePiece(g, p, SAMPLE_METERS)
    const near = samples.filter(([x, y]) => distanceToLine(line, x, y) <= LINE_METERS).length
    const run = (near / samples.length) * g.meters[p]!
    if (run >= Math.min(g.meters[p]! / 2, LINE_RUN_METERS)) closed[p] = 1
  }
}

function closeInside(g: RoadGraph, index: PieceIndex, rings: GeoJSON.Position[][], closed: Uint8Array) {
  if (!rings[0]?.length) return
  const inside = polygonTest(rings)
  for (const p of index.near(bboxOf(rings))) {
    if (!closed[p] && samplePiece(g, p, SAMPLE_METERS).some(([x, y]) => inside(x, y))) closed[p] = 1
  }
}

function bboxOf(lines: GeoJSON.Position[][]): [number, number, number, number] {
  const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const line of lines) {
    for (const [x, y] of line) {
      b[0] = Math.min(b[0], x!)
      b[1] = Math.min(b[1], y!)
      b[2] = Math.max(b[2], x!)
      b[3] = Math.max(b[3], y!)
    }
  }
  return b
}

/** A bbox grown by `meters` on every side. */
function grow([w, s, e, n]: [number, number, number, number], meters: number): [number, number, number, number] {
  const [pw, ps] = boxAround(w, s, meters)
  return [pw, ps, e + (w - pw), n + (s - ps)]
}

/** Distance in metres from a place to a line, in a local flat projection around the place. */
function distanceToLine(line: GeoJSON.Position[], lng: number, lat: number): number {
  const kx = 111_195 * Math.cos((lat * Math.PI) / 180)
  const ky = 111_195
  if (line.length === 1) return Math.hypot((line[0]![0]! - lng) * kx, (line[0]![1]! - lat) * ky)
  let best = Infinity
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = (line[i]![0]! - lng) * kx
    const ay = (line[i]![1]! - lat) * ky
    const dx = (line[i + 1]![0]! - lng) * kx - ax
    const dy = (line[i + 1]![1]! - lat) * ky - ay
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t))
  }
  return best
}

/** Bands the ring edges are sorted into: a test casts its ray only across the edges of its own band. */
const BANDS = 64

/**
 * A point-in-polygon test (even-odd, so holes are left out) for a polygon's rings. Flood extents have
 * thousands of vertices and are tested at every sample of every road near them, so the edges are
 * sorted into latitude bands first.
 */
export function polygonTest(rings: GeoJSON.Position[][]): (lng: number, lat: number) => boolean {
  const [, s, , n] = bboxOf(rings)
  const height = (n - s) / BANDS || 1
  const bands: number[][] = Array.from({ length: BANDS }, () => [])
  const band = (y: number) => Math.min(BANDS - 1, Math.max(0, Math.floor((y - s) / height)))
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j]!
      const [x1, y1] = ring[i]!
      for (let b = band(Math.min(y0!, y1!)); b <= band(Math.max(y0!, y1!)); b++) bands[b]!.push(x0!, y0!, x1!, y1!)
    }
  }
  const [w, , e] = bboxOf(rings)
  return (lng, lat) => {
    if (lat < s || lat > n || lng < w || lng > e) return false
    const edges = bands[band(lat)]!
    let inside = false
    for (let k = 0; k < edges.length; k += 4) {
      const x0 = edges[k]!
      const y0 = edges[k + 1]!
      const x1 = edges[k + 2]!
      const y1 = edges[k + 3]!
      if (y0 > lat !== y1 > lat && lng < ((x1 - x0) * (lat - y0)) / (y1 - y0) + x0) inside = !inside
    }
    return inside
  }
}
