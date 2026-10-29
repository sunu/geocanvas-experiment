import { describe, expect, it } from 'vitest'
import { areaAround, parseBbox, parseLatLon } from '../src/map/location'

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

  it('reads a bbox as west, south, east, north', () => {
    expect(parseBbox('34.7,-19.9,34.9,-19.7')).toEqual({ west: 34.7, south: -19.9, east: 34.9, north: -19.7 })
    // Across the antimeridian: west is greater than east.
    expect(parseBbox('170 -20 -170 -10')).toEqual({ west: 170, south: -20, east: -170, north: -10 })
  })

  it('refuses a bbox with south above north, no width, or out of range', () => {
    expect(parseBbox('34.7,-19.7,34.9,-19.9')).toBeUndefined()
    expect(parseBbox('34.7,-19.9,34.7,-19.7')).toBeUndefined()
    expect(parseBbox('34.7,-95,34.9,-19.7')).toBeUndefined()
    expect(parseBbox('1,2,3')).toBeUndefined()
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
