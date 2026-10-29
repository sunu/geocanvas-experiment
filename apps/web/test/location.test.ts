import { describe, expect, it } from 'vitest'
import { areaAround, parseLatLon } from '../src/map/location'

describe('typed map locations', () => {
  it('reads "lat, lon", latitude first', () => {
    expect(parseLatLon('-19.84, 34.84')).toEqual({ lat: -19.84, lon: 34.84 })
    expect(parseLatLon(' 27.7 85.3 ')).toEqual({ lat: 27.7, lon: 85.3 })
  })

  it('refuses what is not a point on the globe', () => {
    expect(parseLatLon('34.84')).toBeUndefined()
    expect(parseLatLon('95, 10')).toBeUndefined()
    expect(parseLatLon('10, 200')).toBeUndefined()
    expect(parseLatLon('Beira')).toBeUndefined()
  })

  it('makes an area of about 20 km around a point', () => {
    const a = areaAround({ lat: 0, lon: 30 })
    expect(a.north - a.south).toBeCloseTo(20 / 111.32, 5)
    expect(a.east - a.west).toBeCloseTo(20 / 111.32, 5)
    // Longitudes get wider away from the equator, so the area stays about square on the ground.
    const north = areaAround({ lat: 60, lon: 30 })
    expect(north.east - north.west).toBeCloseTo(2 * (north.north - north.south), 1)
  })
})
