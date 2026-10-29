import type { Bbox } from '@ttx/plugins'

/**
 * Flood areas and what is in them, for exposure counts (plans/plan-013.md). Pure, so the worker and tests use it:
 * the polygons of a scenario's flood areas, whether a point is in them, whether a row group's bbox can hold any,
 * and the counts of buildings by the center of their bbox.
 */

/** One polygon: its rings (the outer one, then holes), as [lng, lat] positions, and its bbox. */
export interface FloodPolygon {
  rings: number[][][]
  bbox: Bbox
}

/** The polygons among some geometries. Points and lines have no inside, so they are left out. */
export function floodPolygons(geometries: GeoJSON.Geometry[]): FloodPolygon[] {
  const out: FloodPolygon[] = []
  const add = (rings: number[][][]) => {
    const outer = rings[0]
    if (!outer || outer.length < 4) return
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
    for (const [x, y] of outer) {
      w = Math.min(w, x!)
      e = Math.max(e, x!)
      s = Math.min(s, y!)
      n = Math.max(n, y!)
    }
    out.push({ rings, bbox: [w, s, e, n] })
  }
  const visit = (g: GeoJSON.Geometry) => {
    if (g.type === 'Polygon') add(g.coordinates)
    else if (g.type === 'MultiPolygon') g.coordinates.forEach(add)
    else if (g.type === 'GeometryCollection') g.geometries.forEach(visit)
  }
  geometries.forEach(visit)
  return out
}

/** The bbox of all the polygons, or undefined when there are none. */
export function boundsOf(polygons: FloodPolygon[]): Bbox | undefined {
  if (!polygons.length) return undefined
  return polygons.reduce<Bbox>(
    ([w, s, e, n], { bbox: b }) => [Math.min(w, b[0]), Math.min(s, b[1]), Math.max(e, b[2]), Math.max(n, b[3])],
    [Infinity, Infinity, -Infinity, -Infinity],
  )
}

function inRing(x: number, y: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]!
    const [xj, yj] = ring[j]!
    if (yi! > y !== yj! > y && x < ((xj! - xi!) * (y - yi!)) / (yj! - yi!) + xi!) inside = !inside
  }
  return inside
}

const inBbox = (x: number, y: number, [w, s, e, n]: Bbox) => x >= w && x <= e && y >= s && y <= n

const inPolygon = (x: number, y: number, p: FloodPolygon) =>
  inBbox(x, y, p.bbox) && inRing(x, y, p.rings[0]!) && !p.rings.slice(1).some((hole) => inRing(x, y, hole))

/** Grid cells per side: a point is tested only against the polygons whose bbox meets its cell. */
const GRID = 64

/**
 * The flood areas, ready to test hundreds of thousands of points: a detailed flood extent can have thousands of
 * polygons, so they are put in a grid over their bounds.
 */
export class Flood {
  readonly polygons: FloodPolygon[]
  readonly bounds: Bbox | undefined
  private cells: FloodPolygon[][] = []

  constructor(polygons: FloodPolygon[]) {
    this.polygons = polygons
    this.bounds = boundsOf(polygons)
    if (!this.bounds) return
    this.cells = Array.from({ length: GRID * GRID }, () => [])
    for (const p of polygons) {
      const [c0, r0] = this.cell(p.bbox[0], p.bbox[1])
      const [c1, r1] = this.cell(p.bbox[2], p.bbox[3])
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) this.cells[r * GRID + c]!.push(p)
    }
  }

  private cell(x: number, y: number): [number, number] {
    const [w, s, e, n] = this.bounds!
    const clamp = (v: number) => Math.min(GRID - 1, Math.max(0, Math.floor(v * GRID)))
    return [clamp((x - w) / (e - w || 1)), clamp((y - s) / (n - s || 1))]
  }

  /** Whether a point is in a flood area (inside a polygon's outer ring, not in one of its holes). */
  contains(x: number, y: number): boolean {
    if (!this.bounds || !inBbox(x, y, this.bounds)) return false
    const [c, r] = this.cell(x, y)
    return this.cells[r * GRID + c]!.some((p) => inPolygon(x, y, p))
  }
}

const side = (a: number[], b: number[], c: number[]) => Math.sign((b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!))
const cross = (a: number[], b: number[], c: number[], d: number[]) => side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b)

/**
 * Whether a rectangle meets any of the polygons: a corner of it is in one, a vertex of one is in it, or their edges
 * cross. Used to skip the parts of a file (row groups, files) whose bbox is near the flood areas but outside them.
 */
export function rectMeetsFlood(rect: Bbox, polygons: FloodPolygon[]): boolean {
  const [w, s, e, n] = rect
  const corners = [
    [w, s],
    [e, s],
    [e, n],
    [w, n],
  ]
  for (const p of polygons) {
    const b = p.bbox
    if (b[0] > e || b[2] < w || b[1] > n || b[3] < s) continue
    if (corners.some(([x, y]) => inPolygon(x!, y!, p))) return true
    const outer = p.rings[0]!
    if (outer.some(([x, y]) => inBbox(x!, y!, rect))) return true
    for (let i = 0; i < outer.length - 1; i++) {
      for (let k = 0; k < 4; k++) if (cross(outer[i]!, outer[i + 1]!, corners[k]!, corners[(k + 1) % 4]!)) return true
    }
  }
  return false
}

/** The Overture building columns an exposure count reads: no geometry, about a tenth of the bytes. */
export const EXPOSURE_COLUMNS = ['bbox', 'subtype']

export interface BuildingRow {
  bbox: { xmin: number; ymin: number; xmax: number; ymax: number }
  /** Overture's kind of building, e.g. residential, education; mostly null outside cities. */
  subtype: string | null
}

export interface BuildingCounts {
  /** Buildings whose bbox center is in a flood area. */
  buildings: number
  /** Of those, how many Overture gives each subtype; the rest have none. */
  bySubtype: Record<string, number>
}

export const noBuildings = (): BuildingCounts => ({ buildings: 0, bySubtype: {} })

/** Adds the buildings among `rows` whose bbox center is in the flood areas. */
export function countBuildings(counts: BuildingCounts, rows: BuildingRow[], flood: Flood): void {
  for (const r of rows) {
    const b = r.bbox
    if (!flood.contains((b.xmin + b.xmax) / 2, (b.ymin + b.ymax) / 2)) continue
    counts.buildings++
    if (r.subtype) counts.bySubtype[r.subtype] = (counts.bySubtype[r.subtype] ?? 0) + 1
  }
}

/**
 * Areas larger than this (bbox, square degrees; about 200 × 200 km at the equator) are left out of a count. Some
 * sources give a whole country as an event's area (EM-DAT, IFRC): one such outline would make the count too large to
 * read in the browser, and would not say what is flooded anyway.
 */
export const MAX_AREA_DEG2 = 4

/** A flood area and what to call it when it is left out, e.g. a footprint feature's title. */
export interface NamedArea {
  geometry: GeoJSON.Geometry
  label: string
}

/** The polygon areas small enough to count, and the labels of those left out as too large. Points and lines are dropped. */
export function areasToCount(areas: NamedArea[]): { counted: GeoJSON.Geometry[]; leftOut: string[] } {
  const counted: GeoJSON.Geometry[] = []
  const leftOut: string[] = []
  for (const a of areas) {
    const b = boundsOf(floodPolygons([a.geometry]))
    if (!b) continue
    if ((b[2] - b[0]) * (b[3] - b[1]) > MAX_AREA_DEG2) leftOut.push(a.label)
    else counted.push(a.geometry)
  }
  return { counted, leftOut }
}
