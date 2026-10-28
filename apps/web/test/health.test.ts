import { describe, expect, it } from 'vitest'
import { healthFacilitiesTool, type HealthSource } from '../src/data/health'
import { appendHealthFacilities, isHealthFacility, type HealthFeature, type PoiRow } from '../src/data/layercake'
import { ToolRunner } from '../src/tools/runner'

const BEIRA: [number, number, number, number] = [34.8, -19.9, 34.95, -19.7]

const row = (fields: Partial<PoiRow> & Pick<PoiRow, 'bbox'>): PoiRow => ({
  type: 'node',
  id: 1n,
  amenity: null,
  healthcare: null,
  name: null,
  operator: null,
  emergency: null,
  ...fields,
})
const at = (x: number, y: number) => ({ xmin: x, ymin: y, xmax: x, ymax: y })

describe('health facilities from Layercake rows', () => {
  it('counts healthcare=* and the health amenities, nothing else', () => {
    expect(isHealthFacility(row({ healthcare: 'clinic', bbox: at(0, 0) }))).toBe(true)
    expect(isHealthFacility(row({ healthcare: 'yes', bbox: at(0, 0) }))).toBe(true)
    for (const amenity of ['hospital', 'clinic', 'doctors', 'dentist', 'pharmacy']) expect(isHealthFacility(row({ amenity, bbox: at(0, 0) }))).toBe(true)
    expect(isHealthFacility(row({ amenity: 'school', bbox: at(0, 0) }))).toBe(false)
    expect(isHealthFacility(row({ bbox: at(0, 0) }))).toBe(false)
  })

  it('keeps facilities inside the area, as points at the center of their bbox, with OSM ids', () => {
    const rows = [
      row({ type: 'way', id: 508658322n, amenity: 'hospital', name: ['Hospital Central da Beira', 'HCB'], operator: 'MISAU', emergency: 'yes', bbox: { xmin: 34.84, ymin: -19.84, xmax: 34.86, ymax: -19.82 } }),
      row({ id: 2n, healthcare: 'pharmacy', amenity: 'pharmacy', bbox: at(34.85, -19.83) }),
      row({ id: 3n, amenity: 'school', bbox: at(34.85, -19.83) }), // not health
      row({ id: 4n, amenity: 'clinic', bbox: at(35.5, -19.83) }), // outside the area
    ]
    const out: HealthFeature[] = []
    appendHealthFacilities(out, rows, BEIRA)
    expect(out.map((f) => f.properties.osm)).toEqual(['way/508658322', 'node/2'])
    expect(out[0]!.geometry.coordinates[0]).toBeCloseTo(34.85)
    expect(out[0]!.geometry.coordinates[1]).toBeCloseTo(-19.83)
    expect(out[0]!.properties).toEqual({
      osm: 'way/508658322',
      name: 'Hospital Central da Beira',
      kind: 'hospital',
      amenity: 'hospital',
      healthcare: null,
      operator: 'MISAU',
      emergency: 'yes',
    })
    // The healthcare tag names the kind when both are set.
    expect(out[1]!.properties.kind).toBe('pharmacy')
  })
})

describe('data.healthFacilities', () => {
  it('passes the area to the source and adds the OpenStreetMap attribution', async () => {
    const calls: unknown[] = []
    const source: HealthSource = {
      async query(area) {
        calls.push(area)
        return { type: 'FeatureCollection', features: [] }
      },
    }
    const runner = new ToolRunner([healthFacilitiesTool(source)])
    const fc = await runner.run<GeoJSON.FeatureCollection & { attribution?: string }>('data.healthFacilities', { area: BEIRA })
    expect(calls).toEqual([BEIRA])
    expect(fc.attribution).toBe('© OpenStreetMap contributors (ODbL), via Layercake (OpenStreetMap US)')
    await expect(runner.run('data.healthFacilities', {})).rejects.toThrow(/Invalid input/)
  })

  it("passes the source's errors through, e.g. an area that is too large", async () => {
    const source: HealthSource = {
      query: async () => {
        throw new Error('Area too large for health facilities (40 parts of the file, at most 12): zoom in, then use your view for this layer')
      },
    }
    await expect(new ToolRunner([healthFacilitiesTool(source)]).run('data.healthFacilities', { area: [-20, -35, 55, 38] })).rejects.toThrow(
      /Area too large for health facilities/,
    )
  })
})
