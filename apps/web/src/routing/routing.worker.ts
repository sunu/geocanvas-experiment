/**
 * Finds routes in a worker, so reading the road network (tens of MB of GeoParquet) and building its graph never
 * block the canvas. Road networks are kept per area (area.ts): the first route in an area waits for its roads,
 * later ones, and every change of closures, take milliseconds.
 */
import type { Bbox } from '@ttx/plugins'
import { readOverture } from '../data/overtureRead'
import { bboxesIntersect } from '../data/wkb'
import { routeArea } from './area'
import { closedPieces } from './closures'
import { GraphBuilder, piecePoints, SEGMENT_COLUMNS, type RoadGraph, type SegmentRow } from './graph'
import { PieceIndex } from './pieceIndex'
import type { Profile } from './profiles'
import { findRoute, type RouteOutcome } from './route'

export interface RouteQuery {
  from: [number, number]
  to: [number, number]
  profile: Profile
  closures: GeoJSON.Geometry[]
}
/** A road near a place, to close it: the stretch between two junctions nearest the place, and its name. */
export interface NearRoad {
  line: [number, number][]
  name: string | null
}
/** What the worker is asked: a route, or the road near a place. */
export type RoutingAsk = { kind: 'route'; query: RouteQuery } | { kind: 'nearRoad'; at: [number, number]; maxMeters: number }
export type RoutingRequest = { id: number } & RoutingAsk
export type RoutingResponse = { id: number; ok: true; value: RouteOutcome | NearRoad | null } | { id: number; ok: false; error: string }

/** Measured on the 2026-10-21.0 release: 50 × 50 km around Kathmandu is 9 row groups (61 MB), around Beira 6. */
const MAX_ROW_GROUPS = 16
/** Road networks kept (a dense city's graph is about 40 MB). */
const MAX_NETWORKS = 2

interface Network {
  graph: RoadGraph
  index: PieceIndex
}

const networks = new Map<string, { area: Bbox; network: Promise<Network> }>()

/** The road network of an area, read once. Not aborted with a query: other routes in the area wait for it. */
function network(area: Bbox): Promise<Network> {
  const key = area.join(',')
  let entry = networks.get(key)
  if (!entry) {
    entry = { area, network: load(area) }
    networks.set(key, entry)
    entry.network.catch(() => networks.delete(key))
    while (networks.size > MAX_NETWORKS) networks.delete(networks.keys().next().value!)
  }
  return entry.network
}

async function load(area: Bbox): Promise<Network> {
  const builder = new GraphBuilder()
  const groups = readOverture<SegmentRow>('segments', area, { columns: SEGMENT_COLUMNS, signal: new AbortController().signal, maxRowGroups: MAX_ROW_GROUPS })
  // Each row group's rows are dropped once added: as objects, a city's rows take several hundred MB.
  for await (const rows of groups) {
    for (const r of rows) if (bboxesIntersect([r.bbox.xmin, r.bbox.ymin, r.bbox.xmax, r.bbox.ymax], area)) builder.add(r)
  }
  const graph = builder.build()
  return { graph, index: new PieceIndex(graph) }
}

async function route({ from, to, profile, closures }: RouteQuery): Promise<RouteOutcome> {
  const { graph, index } = await network(routeArea(from, to))
  return findRoute(graph, index, profile, closedPieces(graph, index, closures), from, to)
}

/**
 * The road nearest a place, within `maxMeters`, on a network already read that covers the place (a route's), or else
 * on the area around the place.
 */
async function nearRoad([lng, lat]: [number, number], maxMeters: number): Promise<NearRoad | null> {
  const covering = [...networks.values()].find(({ area: [w, s, e, n] }) => lng >= w && lng <= e && lat >= s && lat <= n)
  const { graph, index } = await (covering?.network ?? network(routeArea([lng, lat], [lng, lat])))
  const snap = index.nearest(lng, lat, () => true, maxMeters)
  if (!snap) return null
  return { line: piecePoints(graph, snap.piece), name: graph.segments[graph.segment[snap.piece]!]!.name }
}

self.onmessage = async ({ data }: MessageEvent<RoutingRequest>) => {
  let res: RoutingResponse
  try {
    res = { id: data.id, ok: true, value: data.kind === 'route' ? await route(data.query) : await nearRoad(data.at, data.maxMeters) }
  } catch (e) {
    res = { id: data.id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  self.postMessage(res)
}
