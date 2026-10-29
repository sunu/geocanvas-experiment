import { describe, expect, it } from 'vitest'
import { ToolRunner } from '@ttx/core'
import { affectedByDefault, areasToCount, countBuildings, Flood, floodPolygons, noBuildings, rectMeetsFlood, type BuildingRow } from '../src/exposure/areas'
import { exposureTool, type BuildingSource, type FacilitySource } from '../src/exposure/exposure'
import { appendFacilities, type FacilityFeature, type PoiRow } from '../src/data/layercake'
import { rowGroupsInBbox, type RowGroupMeta } from '../src/data/wkb'

/** A square ring from (x, y), `size` degrees wide. */
const square = (x: number, y: number, size: number) => [
  [x, y],
  [x + size, y],
  [x + size, y + size],
  [x, y + size],
  [x, y],
]
/** A 1° square with a 0.5° hole in its middle, and a separate 0.1° square to the east. */
const AREAS: GeoJSON.Geometry[] = [
  { type: 'Polygon', coordinates: [square(0, 0, 1), square(0.25, 0.25, 0.5)] },
  { type: 'MultiPolygon', coordinates: [[square(5, 0, 0.1)]] },
  { type: 'Point', coordinates: [0.5, 0.5] },
  { type: 'LineString', coordinates: [[0, 0], [9, 9]] },
]
const building = (x: number, y: number, subtype: string | null = null): BuildingRow => ({ bbox: { xmin: x - 0.0001, ymin: y - 0.0001, xmax: x + 0.0001, ymax: y + 0.0001 }, subtype })

describe('flood areas', () => {
  const flood = new Flood(floodPolygons(AREAS))

  it('keeps the polygons, not points or lines, and knows their bounds', () => {
    expect(flood.polygons).toHaveLength(2)
    expect(flood.bounds).toEqual([0, 0, 5.1, 1])
  })

  it('finds points inside a polygon, not in its hole or outside', () => {
    expect(flood.contains(0.1, 0.1)).toBe(true)
    expect(flood.contains(0.5, 0.5)).toBe(false) // the hole
    expect(flood.contains(5.05, 0.05)).toBe(true)
    expect(flood.contains(3, 0.5)).toBe(false) // between the two, inside their bounds
    expect(new Flood([]).contains(0, 0)).toBe(false)
  })

  it('tells which parts of a file can hold buildings in the polygons, not only in their bbox', () => {
    expect(rectMeetsFlood([0.9, 0.9, 1.2, 1.2], flood.polygons)).toBe(true) // overlaps a corner
    expect(rectMeetsFlood([0.4, 0.4, 0.6, 0.6], flood.polygons)).toBe(false) // inside the hole
    expect(rectMeetsFlood([2, 0, 4, 1], flood.polygons)).toBe(false) // between them
    expect(rectMeetsFlood([-1, -1, 10, 10], flood.polygons)).toBe(true) // around everything
    expect(rectMeetsFlood([0.95, -0.5, 1.05, 1.5], flood.polygons)).toBe(true) // edges cross, no vertex inside either
  })

  it('drops row groups whose statistics miss the polygons', () => {
    const group = (xmin: number, xmax: number): RowGroupMeta => ({
      num_rows: 10,
      columns: [
        ['bbox.xmin', xmin, xmin],
        ['bbox.xmax', xmax, xmax],
        ['bbox.ymin', 0, 0],
        ['bbox.ymax', 1, 1],
      ].map(([path, min, max]) => ({ meta_data: { path_in_schema: String(path).split('.'), statistics: { min_value: min, max_value: max } } })),
    })
    const groups = [group(0, 0.2), group(2, 4), group(5, 5.1)]
    expect(rowGroupsInBbox(groups, flood.bounds!)).toHaveLength(3)
    expect(rowGroupsInBbox(groups, flood.bounds!, (r) => rectMeetsFlood(r, flood.polygons))).toEqual([
      { rowStart: 0, rowEnd: 10 },
      { rowStart: 20, rowEnd: 30 },
    ])
  })

  it('counts the buildings whose bbox center is in a flood area, with their Overture subtypes', () => {
    const counts = noBuildings()
    countBuildings(counts, [building(0.1, 0.1, 'residential'), building(0.5, 0.5, 'education'), building(5.05, 0.05), building(3, 0.5)], flood)
    countBuildings(counts, [building(0.9, 0.9, 'residential')], flood)
    expect(counts).toEqual({ buildings: 3, bySubtype: { residential: 2 } })
  })
})

const poi = (amenity: string | null, healthcare: string | null, x: number, name = 'A'): PoiRow => ({
  type: 'node',
  id: 1,
  amenity,
  healthcare,
  name: [name],
  operator: null,
  emergency: null,
  bbox: { xmin: x, ymin: 0.1, xmax: x, ymax: 0.1 },
})

describe('areas to count', () => {
  it("leaves out areas larger than a region, such as a country's outline, by name, and points and lines", () => {
    const nepal: GeoJSON.Geometry = { type: 'Polygon', coordinates: [square(80, 26.4, 8)] }
    expect(
      areasToCount([
        { geometry: AREAS[0]!, label: 'CEMS Bharatpur' },
        { geometry: nepal, label: 'EM-DAT Flash flood in Nepal' },
        { geometry: AREAS[2]!, label: 'A point' },
      ]),
    ).toEqual({ counted: [AREAS[0]], leftOut: ['EM-DAT Flash flood in Nepal'] })
  })
})

describe("a footprint's affected areas by default", () => {
  it('are the hazard areas up to a region, not areas that locate the event, points or a country', () => {
    const hazard = (geometry: GeoJSON.Geometry) => ({ geometry, properties: { kind: 'hazard' } })
    expect(affectedByDefault(hazard(AREAS[0]!))).toBe(true)
    expect(affectedByDefault({ geometry: AREAS[0]!, properties: { kind: 'event' } })).toBe(false)
    expect(affectedByDefault(hazard(AREAS[2]!))).toBe(false)
    expect(affectedByDefault(hazard({ type: 'Polygon', coordinates: [square(80, 26.4, 8)] }))).toBe(false)
  })
})

describe('OpenStreetMap facilities', () => {
  it('picks health facilities and places of education, health first', () => {
    const out: FacilityFeature[] = []
    appendFacilities(out, [poi('school', null, 0.1, 'Escola'), poi('hospital', null, 0.2), poi('school', 'hospital', 0.3), poi('cafe', null, 0.4), poi('university', null, 9)], [0, 0, 1, 1])
    expect(out.map((f) => [f.properties.name, f.properties.category, f.properties.kind])).toEqual([
      ['Escola', 'education', 'school'],
      ['A', 'health', 'hospital'],
      ['A', 'health', 'hospital'],
    ])
  })
})

describe('the exposure tool', () => {
  const buildings: BuildingSource = { count: async () => ({ buildings: 120, bySubtype: { residential: 4 } }) }
  const facility = (x: number, category: 'health' | 'education'): GeoJSON.Feature<GeoJSON.Point, FacilityFeature['properties']> => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [x, 0.05] },
    properties: { osm: 'node/1', name: null, category, kind: null },
  })

  it('gives the building count and the facilities inside the flood areas, not those in their bbox only', async () => {
    const facilities: FacilitySource = { facilities: async () => ({ type: 'FeatureCollection', features: [facility(0.1, 'health'), facility(3, 'education'), facility(5.05, 'education')] }) }
    const result = await new ToolRunner([exposureTool(buildings, facilities)]).run('exposure.buildings', { areas: AREAS })
    expect(result).toMatchObject({ buildings: 120, bySubtype: { residential: 4 }, attribution: expect.stringMatching(/Overture.*OpenStreetMap/) })
    expect((result as { facilities: GeoJSON.Feature<GeoJSON.Point>[] }).facilities.map((f) => f.geometry.coordinates[0])).toEqual([0.1, 5.05])
  })

  it('still counts buildings when the facilities cannot be read', async () => {
    const facilities: FacilitySource = { facilities: async () => Promise.reject(new Error('Area too large for OpenStreetMap facilities')) }
    const result = await new ToolRunner([exposureTool(buildings, facilities)]).run('exposure.buildings', { areas: AREAS })
    expect(result).toMatchObject({ buildings: 120, facilities: [], facilitiesError: 'Area too large for OpenStreetMap facilities' })
  })

  it('fails without a polygon', async () => {
    const facilities: FacilitySource = { facilities: async () => ({ type: 'FeatureCollection', features: [] }) }
    await expect(new ToolRunner([exposureTool(buildings, facilities)]).run('exposure.buildings', { areas: [AREAS[2]] })).rejects.toThrow(/only polygons/)
  })
})
