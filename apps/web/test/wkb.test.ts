import { describe, expect, it } from 'vitest'
import { bboxesIntersect, wkbToGeometry } from '../src/data/wkb'
import { box, wkb } from './wkbWriter'

describe('wkbToGeometry', () => {
  const outer = box(30, -27, 41, -10)
  const hole = box(34, -20, 35, -19)

  it('decodes a Polygon with a hole in both byte orders', () => {
    const expected = { type: 'Polygon', coordinates: [outer, hole] }
    expect(wkbToGeometry(wkb({ polygon: [outer, hole] }, true))).toEqual(expected)
    expect(wkbToGeometry(wkb({ polygon: [outer, hole] }, false))).toEqual(expected)
  })

  it('decodes a MultiPolygon, and reads from a subarray offset', () => {
    const g = wkb({ multi: [[outer], [box(178, -18, 180, -16)]] }, false)
    const shifted = new Uint8Array(g.length + 3)
    shifted.set(g, 3)
    expect(wkbToGeometry(shifted.subarray(3))).toEqual({ type: 'MultiPolygon', coordinates: [[outer], [box(178, -18, 180, -16)]] })
  })

  it('rejects other geometry types and Z/M/SRID flags', () => {
    expect(() => wkbToGeometry(wkb({ polygon: [outer] }, true, 2))).toThrow('Unsupported WKB geometry type 2')
    expect(() => wkbToGeometry(wkb({ polygon: [outer] }, true, 1003))).toThrow('Z or M')
    expect(() => wkbToGeometry(wkb({ polygon: [outer] }, true, 0x80000003))).toThrow('Z, M or SRID')
  })
})

describe('bboxesIntersect', () => {
  it('counts touching edges as intersecting', () => {
    expect(bboxesIntersect([0, 0, 1, 1], [1, 1, 2, 2])).toBe(true)
    expect(bboxesIntersect([0, 0, 1, 1], [1.1, 0, 2, 1])).toBe(false)
  })
})
