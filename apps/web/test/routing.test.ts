import { describe, expect, it } from 'vitest'
import { routeArea } from '../src/routing/area'
import { closedPieces } from '../src/routing/closures'
import { buildGraph, metersBetween, type SegmentRow } from '../src/routing/graph'
import { PieceIndex } from '../src/routing/pieceIndex'
import { speedOn } from '../src/routing/profiles'
import { findRoute } from '../src/routing/route'
import { detour, formatDuration } from '../src/routing/useRoutes'

/**
 * A small network near the equator (0.01° is about 1.1 km):
 *
 *   D ------------------- E        detour (residential)
 *   |          |          |
 *   A -------- B ---X---- C        Main (primary); X: a bridge passes over, not joined
 *              |
 *              F                   spur (tertiary)
 */
const A = [0, 0]
const B = [0.01, 0]
const C = [0.02, 0]
const D = [0, 0.01]
const E = [0.02, 0.01]
const F = [0.01, -0.01]

function seg(id: string, cls: string, coords: number[][], connectors: string[] | { connector_id: string; at: number }[], extra: Partial<SegmentRow> = {}): SegmentRow {
  const conns = connectors.map((c, i) => (typeof c === 'string' ? { connector_id: c, at: i / (connectors.length - 1) } : c))
  const xs = coords.map((c) => c[0]!)
  const ys = coords.map((c) => c[1]!)
  return {
    id,
    subtype: 'road',
    class: cls,
    names: { primary: id },
    connectors: conns,
    access_restrictions: null,
    speed_limits: null,
    road_flags: null,
    geometry: { type: 'LineString', coordinates: coords },
    bbox: { xmin: Math.min(...xs), xmax: Math.max(...xs), ymin: Math.min(...ys), ymax: Math.max(...ys) },
    ...extra,
  }
}

const network = (overrides: Record<string, Partial<SegmentRow>> = {}) => [
  // One segment from A to C with an interior connector at B (no vertex there: it is split at `at`).
  seg('Main', 'primary', [A, C], [{ connector_id: 'a', at: 0 }, { connector_id: 'b', at: 0.5 }, { connector_id: 'c', at: 1 }], overrides.Main),
  seg('Detour west', 'residential', [A, D], ['a', 'd']),
  seg('Detour', 'residential', [D, [0.01, 0.01], E], [{ connector_id: 'd', at: 0 }, { connector_id: 'de', at: 0.5 }, { connector_id: 'e', at: 1 }]),
  seg('Detour link', 'residential', [B, [0.01, 0.01]], ['b', 'de']),
  seg('Detour east', 'residential', [E, C], ['e', 'c']),
  seg('Spur', 'tertiary', [B, F], ['b', 'f']),
  // Crosses Main at X with no shared connector: a bridge.
  seg('Bridge', 'secondary', [[0.015, -0.005], [0.015, 0.005]], ['x1', 'x2']),
  seg('Footpath', 'footway', [A, F], ['a', 'f']),
]

function setup(rows = network()) {
  const g = buildGraph(rows)
  return { g, index: new PieceIndex(g), open: new Uint8Array(g.pieces) }
}

const names = (r: ReturnType<typeof findRoute>) => (r.ok ? r.roads.map((x) => x.name).sort() : [])

describe('buildGraph', () => {
  it('cuts segments at their connectors and leaves out paths', () => {
    const { g } = setup()
    // Main 2, Detour west 1, Detour 2, link 1, east 1, spur 1, bridge 1; no footway.
    expect(g.pieces).toBe(9)
    expect(g.segments.map((s) => s.id)).not.toContain('Footpath')
    // Main's interior connector is at its middle, where B is.
    const main = [...g.segment].flatMap((s, p) => (g.segments[s]!.id === 'Main' ? [p] : []))
    expect(main.map((p) => Math.round(g.meters[p]!))).toEqual([1112, 1112])
    const b = g.to[main[0]!]!
    expect([g.nodeCoords[2 * b], g.nodeCoords[2 * b + 1]]).toEqual(B)
  })
})

describe('findRoute', () => {
  it('takes the fastest road', () => {
    const { g, index, open } = setup()
    const r = findRoute(g, index, 'car', open, [0, 0], [0.02, 0])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(names(r)).toEqual(['Main'])
    expect(r.meters).toBeCloseTo(metersBetween(0, 0, 0.02, 0), 0)
    expect(r.seconds).toBeCloseTo(r.meters / (65 / 3.6), 0)
    expect(r.line[0]).toEqual([0, 0])
    expect(r.line[r.line.length - 1]).toEqual([0.02, 0])
  })

  it('starts and ends part-way along a road', () => {
    const { g, index, open } = setup()
    const r = findRoute(g, index, 'car', open, [0.005, 0.0005], [0.018, -0.0005])
    expect(r.ok && Math.round(r.meters)).toBe(Math.round(metersBetween(0.005, 0, 0.018, 0)))
    expect(r.ok && r.offRoad.map(Math.round)).toEqual([56, 56])
  })

  it('follows one-way rules', () => {
    // Main is one way from A to C: going back takes the detour.
    const oneWay = { access_restrictions: [{ access_type: 'denied', when: { heading: 'backward' } }] }
    const { g, index, open } = setup(network({ Main: oneWay }))
    expect(names(findRoute(g, index, 'car', open, C as [number, number], A as [number, number]))).toEqual(['Detour', 'Detour east', 'Detour west'])
    expect(names(findRoute(g, index, 'car', open, A as [number, number], C as [number, number]))).toEqual(['Main'])
  })

  it('does not turn where roads only cross', () => {
    const { g, index, open } = setup()
    const r = findRoute(g, index, 'car', open, [0.015, -0.005], [0.02, 0])
    expect(r).toEqual({ ok: false, reason: 'No route: the destination is cut off from the start' })
  })

  it('goes around closed roads, and says when there is no way through', () => {
    const { g, index } = setup()
    const nearB = { type: 'Point', coordinates: B } as GeoJSON.Point
    const r = findRoute(g, index, 'car', closedPieces(g, index, [nearB]), [0, 0], [0.02, 0])
    expect(names(r)).toEqual(['Detour', 'Detour east', 'Detour west'])
    const all = closedPieces(g, index, [nearB, { type: 'Point', coordinates: [0.01, 0.01] }])
    expect(findRoute(g, index, 'car', all, [0, 0], [0.02, 0]).ok).toBe(false)
  })

  it('starts from the nearest open road', () => {
    const { g, index } = setup()
    const closed = closedPieces(g, index, [{ type: 'LineString', coordinates: [A, C] }])
    const r = findRoute(g, index, 'car', closed, [0.005, 0.001], [0.02, 0])
    // Main is closed: the route starts on the link, about 560 m away, and does not use Main.
    expect(r.ok && Math.round(r.offRoad[0])).toBe(556)
    expect(names(r)).not.toContain('Main')
  })
})

describe('closedPieces', () => {
  const pieceOf = (g: ReturnType<typeof setup>['g'], name: string) =>
    [...g.segment].flatMap((s, p) => (g.segments[s]!.name === name ? [p] : []))

  it('closes the roads along a line, not those that cross it', () => {
    const { g, index } = setup()
    const closed = closedPieces(g, index, [{ type: 'LineString', coordinates: [B, C] }])
    const main = pieceOf(g, 'Main')
    expect([...main].map((p) => closed[p])).toEqual([0, 1])
    expect(pieceOf(g, 'Bridge').map((p) => closed[p])).toEqual([0])
    expect(pieceOf(g, 'Spur').map((p) => closed[p])).toEqual([0])
    expect(pieceOf(g, 'Detour link').map((p) => closed[p])).toEqual([0])
  })

  it('closes every road at a point, and every road in an area', () => {
    const { g, index } = setup()
    const atB = closedPieces(g, index, [{ type: 'Point', coordinates: B }])
    expect(atB.reduce((a, b) => a + b, 0)).toBe(4) // both halves of Main, the link and the spur
    const box = [[0.012, -0.002], [0.018, -0.002], [0.018, 0.002], [0.012, 0.002], [0.012, -0.002]]
    const inBox = closedPieces(g, index, [{ type: 'Polygon', coordinates: [box] }])
    expect(pieceOf(g, 'Main').map((p) => inBox[p])).toEqual([0, 1])
    expect(pieceOf(g, 'Bridge').map((p) => inBox[p])).toEqual([1])
  })

  it('leaves out the holes of a polygon', () => {
    const { g, index } = setup()
    const outer = [[-0.01, -0.02], [0.03, -0.02], [0.03, 0.02], [-0.01, 0.02], [-0.01, -0.02]]
    const hole = [[-0.005, -0.002], [0.025, -0.002], [0.025, 0.002], [-0.005, 0.002], [-0.005, -0.002]]
    const closed = closedPieces(g, index, [{ type: 'Polygon', coordinates: [outer, hole] }])
    expect(pieceOf(g, 'Main').map((p) => closed[p])).toEqual([0, 0])
    expect(pieceOf(g, 'Detour').map((p) => closed[p])).toEqual([1, 1])
  })
})

describe('speedOn', () => {
  const road = (rules: object[], limits: object[] = []) => ({ class: 'primary', access_restrictions: rules as never, speed_limits: limits as never })

  it('applies the last matching access rule for the vehicle', () => {
    expect(speedOn('car', road([]), 0.5, 'forward')).toBe(65)
    // A private road: denied, then allowed only to those it recognizes, which we cannot know.
    expect(speedOn('car', road([{ access_type: 'denied' }, { access_type: 'allowed', when: { recognized: ['as_private'] } }]), 0.5, 'forward')).toBe(0)
    // A pedestrian zone open to motor vehicles.
    expect(speedOn('car', road([{ access_type: 'denied' }, { access_type: 'allowed', when: { mode: ['motor_vehicle'] } }]), 0.5, 'forward')).toBe(65)
    expect(speedOn('car', road([{ access_type: 'denied', when: { mode: ['bicycle'] } }]), 0.5, 'forward')).toBe(65)
    expect(speedOn('truck', road([{ access_type: 'denied', when: { mode: ['hgv'] } }]), 0.5, 'forward')).toBe(0)
    expect(speedOn('car', road([{ access_type: 'denied', when: { mode: ['hgv'] } }]), 0.5, 'forward')).toBe(65)
    // Only where the rule's `between` covers.
    expect(speedOn('car', road([{ access_type: 'denied', between: [0, 0.3] }]), 0.5, 'forward')).toBe(65)
  })

  it('keeps under the speed limit', () => {
    expect(speedOn('car', road([], [{ max_speed: { value: 40, unit: 'km/h' } }]), 0.5, 'forward')).toBe(40)
    expect(speedOn('car', road([], [{ max_speed: { value: 30, unit: 'mph' } }]), 0.5, 'forward')).toBeCloseTo(48.27)
    expect(speedOn('car', road([], [{ max_speed: { value: 120, unit: 'km/h' } }]), 0.5, 'forward')).toBe(65)
  })

  it('does not drive on paths', () => {
    expect(speedOn('car', { class: 'footway' }, 0.5, 'forward')).toBe(0)
  })
})

describe('routeArea', () => {
  it('pads the ends and snaps outward to the grid, so nearby routes share roads', () => {
    const beira = routeArea([34.838, -19.826], [34.858, -19.83])
    // At least 5 km of room on every side (0.045° of latitude), on a 0.05° grid.
    expect(beira).toEqual([34.75, -19.9, 34.95, -19.75])
    expect(routeArea([34.84, -19.82], [34.86, -19.835])).toEqual(beira)
    // A longer route gets room in proportion: 30% of its size.
    const [w, s, e, n] = routeArea([34.6, -19.8], [35.0, -19.8])
    expect([w, e]).toEqual([34.45, 35.15])
    expect(n - s).toBeCloseTo(0.1)
  })
})

describe('detour', () => {
  const ok = (seconds: number, meters: number) => ({ ok: true as const, line: [], seconds, meters, roads: [], offRoad: [0, 0] as [number, number] })
  const route = { id: 'r', title: 'Route 1', from: [0, 0] as [number, number], to: [1, 1] as [number, number], profile: 'car' as const, color: 'orange' as const }

  it('says what the closures add, and nothing when they add nothing', () => {
    expect(detour({ route, result: ok(3900, 25_000), baseline: ok(1200, 21_600) })).toBe('+45 min, +3.4 km')
    expect(detour({ route, result: ok(1210, 21_600), baseline: ok(1200, 21_600) })).toBeUndefined()
    expect(detour({ route, result: ok(1200, 21_600) })).toBeUndefined()
    expect(formatDuration(3900)).toBe('1 h 05 min')
  })
})
