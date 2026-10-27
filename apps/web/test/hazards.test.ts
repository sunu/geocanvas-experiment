import { describe, expect, it } from 'vitest'
import { disasterTypeOf, hazardCodes, hazardTypesIn } from '../src/events/hazards'

describe('hazard codes', () => {
  it('lists the UNDRR-ISC, GLIDE and EM-DAT codes of each type', () => {
    expect(hazardCodes('cyclone')).toEqual(expect.arrayContaining(['MH0309', 'TC', 'nat-met-sto-tro']))
    expect(hazardCodes('earthquake')).toEqual(expect.arrayContaining(['GH0101', 'EQ', 'nat-geo-ear-gro']))
    expect(hazardCodes('drought')).toEqual(expect.arrayContaining(['MH0401', 'DR', 'nat-cli-dro-dro']))
  })

  it('covers the whole flood family, including flash floods', () => {
    expect(hazardCodes('flood')).toEqual(
      expect.arrayContaining(['MH0600', 'MH0603', 'MH0604', 'MH0610', 'FL', 'FF', 'nat-hyd-flo-riv', 'nat-hyd-flo-fla']),
    )
  })

  it('does not share a code between two types', () => {
    const all = (['cyclone', 'flood', 'earthquake', 'drought'] as const).flatMap(hazardCodes)
    expect(new Set(all).size).toBe(all.length)
  })
})

describe('type of an item from its hazard codes', () => {
  it('reads a code from any of the three systems', () => {
    expect(disasterTypeOf(['MH0604'])).toBe('flood')
    expect(disasterTypeOf(['FL'])).toBe('flood')
    expect(disasterTypeOf(['nat-met-sto-tro'])).toBe('cyclone')
    expect(disasterTypeOf(['GH0101', 'EQ', 'nat-geo-ear-gro'])).toBe('earthquake')
  })

  it('uses the first code that belongs to a supported type', () => {
    expect(disasterTypeOf(['MH0705', 'MH0309', 'MH0604'])).toBe('cyclone')
  })

  it('returns nothing for hazards it does not show', () => {
    expect(disasterTypeOf(['MH0705'])).toBeUndefined()
    expect(disasterTypeOf([])).toBeUndefined()
  })
})

describe('hazard types named in text', () => {
  it.each([
    ['hurricane in Haiti', ['cyclone']],
    ['Typhoons 2023', ['cyclone']],
    ['tropical cyclone Idai', ['cyclone']],
    ['Nepal floods', ['flood']],
    ['flooding', ['flood']],
    ['quake', ['earthquake']],
    ['earthquakes in Türkiye', ['earthquake']],
    ['drought', ['drought']],
    ['floods and earthquakes', ['flood', 'earthquake']],
    ['nepal', []],
    ['', []],
  ])('%s', (text, expected) => {
    expect(hazardTypesIn(text)).toEqual(expected)
  })
})
