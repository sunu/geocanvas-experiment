import { describe, expect, it } from 'vitest'
import { admin0Features, candidateRows, geometryIntersectsBbox, type WorldBankAdmin0Row } from '../src/data/worldBank'
import { wkbToGeometry } from '../src/data/wkb'
import { box, wkb } from './wkbWriter'

const BEIRA: [number, number, number, number] = [33.5, -20.5, 35.5, -19.0]

const row = (iso3: string, name: string, [xmin, ymin, xmax, ymax]: number[]): WorldBankAdmin0Row => ({
  ISO_A3: iso3,
  NAM_0: name,
  WB_REGION: 'AFR',
  WB_STATUS: 'Member State',
  bbox: { xmin: xmin!, ymin: ymin!, xmax: xmax!, ymax: ymax! },
})

describe('admin 0 query', () => {
  // Mozambique-like, Fiji-like (split at the antimeridian, bbox column spans the world), and far away.
  const moz = { polygon: [box(30.2, -26.9, 40.8, -10.5)] }
  const fiji = { multi: [[box(177, -21, 180, -12)], [box(-180, -21, -178, -15)]] }
  const rows = [
    row('MOZ', 'Mozambique', [30.2, -26.9, 40.8, -10.5]),
    row('FJI', 'Fiji', [-180, -21, 180, -12]),
    row('ISL', 'Iceland', [-24.5, 63.3, -13.5, 66.6]),
  ]
  const geometries = [wkb(moz), wkb(fiji), wkb({ polygon: [box(-24.5, 63.3, -13.5, 66.6)] })]

  it('candidateRows uses the bbox column (world-spanning bboxes match)', () => {
    expect(candidateRows(rows, BEIRA)).toEqual([0, 1])
    expect(candidateRows(rows, [-30, -30, -29, -29])).toEqual([])
  })

  it('geometryIntersectsBbox tests each polygon part', () => {
    expect(geometryIntersectsBbox(wkbToGeometry(geometries[1]!), BEIRA)).toBe(false)
    expect(geometryIntersectsBbox(wkbToGeometry(geometries[1]!), [179, -20, 179.5, -19])).toBe(true)
    expect(geometryIntersectsBbox(wkbToGeometry(geometries[0]!), BEIRA)).toBe(true)
  })

  it('returns only the countries whose polygons intersect the area, and decodes only candidates', () => {
    const read: number[] = []
    const fc = admin0Features(rows, (i) => (read.push(i), geometries[i]!), BEIRA)
    expect(read).toEqual([0, 1])
    expect(fc).toEqual({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: moz.polygon },
          properties: { iso3: 'MOZ', name: 'Mozambique', region: 'AFR', status: 'Member State', level: 0 },
        },
      ],
    })
    expect(admin0Features(rows, (i) => geometries[i]!, [179, -20, 179.5, -19]).features.map((f) => f.properties.iso3)).toEqual(['FJI'])
  })
})
