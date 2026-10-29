import { covers, drivable, PROFILES, speedOn, type AccessRule, type Profile, type SpeedLimit } from './profiles'

/**
 * The road graph routing runs on, built from Overture transportation segments. Overture connects
 * segments only through shared connectors (`connectors`: a connector id and its position `at`, 0-1
 * along the segment), never through shared coordinates, so a bridge over a road does not meet it. Each
 * segment is cut at its connectors into pieces; a piece joins two nodes (connectors) and is the unit
 * that routes travel along and closures close. Arrays are typed so a city's graph stays compact.
 */

/** Columns the routing worker reads from the segment files. */
export const SEGMENT_COLUMNS = ['id', 'subtype', 'class', 'names', 'connectors', 'access_restrictions', 'speed_limits', 'road_flags', 'geometry', 'bbox']

/** One Overture segment, as hyparquet reads it (geometry decoded to GeoJSON). */
export interface SegmentRow {
  id: string
  subtype: string | null
  class: string | null
  names: { primary?: string | null } | null
  connectors: { connector_id: string; at: number }[] | null
  access_restrictions: AccessRule[] | null
  speed_limits: SpeedLimit[] | null
  road_flags: { values: string[] | null; between?: number[] | null }[] | null
  geometry: GeoJSON.LineString
  bbox: { xmin: number; xmax: number; ymin: number; ymax: number }
}

export interface RoadGraph {
  nodes: number
  /** Each node's place: lng, lat pairs. */
  nodeCoords: Float64Array
  pieces: number
  /** Each piece's nodes: it runs from `from` to `to` in the segment's direction (Overture's forward). */
  from: Int32Array
  to: Int32Array
  meters: Float64Array
  /** km/h by profile and heading; 0 where the profile may not drive that way. */
  speed: Record<Profile, { forward: Float32Array; backward: Float32Array }>
  /** The segment each piece is part of, an index into `segments`. */
  segment: Int32Array
  segments: { id: string; name: string | null; class: string }[]
  /** Each piece's line, from `from` to `to`: points coordStart[p] to coordStart[p + 1] - 1 of coords (lng, lat pairs). */
  coords: Float64Array
  coordStart: Int32Array
  /** The pieces at each node: incident[incidentStart[n]] to incident[incidentStart[n + 1] - 1]. */
  incidentStart: Int32Array
  incident: Int32Array
}

const EARTH_RADIUS = 6_371_008.8
const RAD = Math.PI / 180

/** Distance in metres; equirectangular, which is well under 0.1% off at city scale. */
export function metersBetween(lng1: number, lat1: number, lng2: number, lat2: number): number {
  const x = (lng2 - lng1) * RAD * Math.cos(((lat1 + lat2) / 2) * RAD)
  const y = (lat2 - lat1) * RAD
  return EARTH_RADIUS * Math.hypot(x, y)
}

/** Flags that close a part of a segment to every vehicle. */
const CLOSED_FLAGS = ['is_under_construction', 'is_abandoned']

/** Builds the graph of the drivable road segments among `rows`. */
export function buildGraph(rows: Iterable<SegmentRow>): RoadGraph {
  const builder = new GraphBuilder()
  for (const r of rows) builder.add(r)
  return builder.build()
}

/**
 * Builds a graph one segment at a time, so the routing worker can drop each row group's decoded rows
 * as it goes (a city's rows take several hundred MB as objects; its graph, tens).
 */
export class GraphBuilder {
  private nodeIds = new Map<string, number>()
  private from: number[] = []
  private to: number[] = []
  private meters: number[] = []
  private segment: number[] = []
  private segments: RoadGraph['segments'] = []
  private coords: number[] = []
  private coordStart: number[] = [0]
  private speeds = PROFILES.map(() => ({ forward: [] as number[], backward: [] as number[] }))

  private node(id: string) {
    let n = this.nodeIds.get(id)
    if (n === undefined) this.nodeIds.set(id, (n = this.nodeIds.size))
    return n
  }

  /** Adds a segment's drivable pieces; other segments (paths, rail, water) are left out. */
  add(r: SegmentRow) {
    const roadClass = r.class ?? 'unknown'
    if (r.subtype !== 'road' || !drivable(roadClass) || r.geometry?.type !== 'LineString') return
    const line = r.geometry.coordinates
    const cum = cumulativeMeters(line)
    const total = cum[cum.length - 1]!
    if (!(total > 0)) return
    // Every released segment has a connector at each end; a missing one gets a node of its own (a dead end).
    const stops = [...(r.connectors ?? [])].sort((a, b) => a.at - b.at)
    if (stops[0]?.at !== 0) stops.unshift({ connector_id: `${r.id}@0`, at: 0 })
    if (stops[stops.length - 1]!.at !== 1) stops.push({ connector_id: `${r.id}@1`, at: 1 })

    const segIndex = this.segments.length
    let added = false
    for (let i = 0; i + 1 < stops.length; i++) {
      const a = stops[i]!
      const b = stops[i + 1]!
      if (a.connector_id === b.connector_id || b.at <= a.at) continue
      const mid = (a.at + b.at) / 2
      const closed = r.road_flags?.some((f) => f.values?.some((v) => CLOSED_FLAGS.includes(v)) && covers(f.between, mid))
      const forward = PROFILES.map((p) => (closed ? 0 : speedOn(p, r, mid, 'forward')))
      const backward = PROFILES.map((p) => (closed ? 0 : speedOn(p, r, mid, 'backward')))
      if (forward.every((v) => v === 0) && backward.every((v) => v === 0)) continue
      this.from.push(this.node(a.connector_id))
      this.to.push(this.node(b.connector_id))
      this.meters.push((b.at - a.at) * total)
      this.segment.push(segIndex)
      PROFILES.forEach((_, k) => {
        this.speeds[k]!.forward.push(forward[k]!)
        this.speeds[k]!.backward.push(backward[k]!)
      })
      for (const [lng, lat] of pointsBetween(line, cum, a.at * total, b.at * total)) this.coords.push(lng, lat)
      this.coordStart.push(this.coords.length / 2)
      added = true
    }
    if (added) this.segments.push({ id: r.id, name: r.names?.primary ?? null, class: roadClass })
  }

  build(): RoadGraph {
    const { from, to, coords, coordStart } = this
    const nodes = this.nodeIds.size
    const nodeCoords = new Float64Array(2 * nodes)
    for (let p = 0; p < from.length; p++) {
      const first = coordStart[p]!
      const last = coordStart[p + 1]! - 1
      nodeCoords.set([coords[2 * first]!, coords[2 * first + 1]!], 2 * from[p]!)
      nodeCoords.set([coords[2 * last]!, coords[2 * last + 1]!], 2 * to[p]!)
    }
    const incidentStart = new Int32Array(nodes + 1)
    for (let p = 0; p < from.length; p++) {
      incidentStart[from[p]! + 1]!++
      if (to[p] !== from[p]) incidentStart[to[p]! + 1]!++
    }
    for (let n = 0; n < nodes; n++) incidentStart[n + 1]! += incidentStart[n]!
    const incident = new Int32Array(incidentStart[nodes]!)
    const fill = incidentStart.slice(0, nodes)
    for (let p = 0; p < from.length; p++) {
      incident[fill[from[p]!]!++] = p
      if (to[p] !== from[p]) incident[fill[to[p]!]!++] = p
    }

    return {
      nodes,
      nodeCoords,
      pieces: from.length,
      from: Int32Array.from(from),
      to: Int32Array.from(to),
      meters: Float64Array.from(this.meters),
      speed: Object.fromEntries(
        PROFILES.map((p, k) => [p, { forward: Float32Array.from(this.speeds[k]!.forward), backward: Float32Array.from(this.speeds[k]!.backward) }]),
      ) as RoadGraph['speed'],
      segment: Int32Array.from(this.segment),
      segments: this.segments,
      coords: Float64Array.from(coords),
      coordStart: Int32Array.from(coordStart),
      incidentStart,
      incident,
    }
  }
}

/** Metres from a line's first point to each of its points. */
export function cumulativeMeters(line: GeoJSON.Position[]): number[] {
  const cum = [0]
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1]! + metersBetween(line[i - 1]![0]!, line[i - 1]![1]!, line[i]![0]!, line[i]![1]!))
  return cum
}

/** The part of a line from `d0` to `d1` metres along it (`cum`: metres to each point), ends interpolated. */
export function pointsBetween(line: GeoJSON.Position[], cum: number[], d0: number, d1: number): [number, number][] {
  const at = (d: number): [number, number] => {
    let i = 1
    while (i < line.length - 1 && cum[i]! < d) i++
    const span = cum[i]! - cum[i - 1]!
    const t = span > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]!) / span)) : 0
    const [x0, y0] = line[i - 1]!
    const [x1, y1] = line[i]!
    return [x0! + (x1! - x0!) * t, y0! + (y1! - y0!) * t]
  }
  const out: [number, number][] = [at(d0)]
  for (let i = 0; i < line.length; i++) if (cum[i]! > d0 && cum[i]! < d1) out.push([line[i]![0]!, line[i]![1]!])
  out.push(at(d1))
  return out
}

/** A piece's points, from its `from` node to its `to` node. */
export function piecePoints(g: RoadGraph, p: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = g.coordStart[p]!; i < g.coordStart[p + 1]!; i++) out.push([g.coords[2 * i]!, g.coords[2 * i + 1]!])
  return out
}
