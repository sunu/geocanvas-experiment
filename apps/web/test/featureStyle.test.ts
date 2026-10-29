import { describe, expect, it } from 'vitest'
import { attributes, featurePaint, filterFeatures, hexToRgb, matches } from '../src/map/featureStyle'
import { deckLayers } from '../src/map/layers'

const at = (properties: Record<string, unknown>): GeoJSON.Feature => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties })
const fc = (...features: GeoJSON.Feature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features })
const shelters = fc(at({ name: 'School', type: 'school', capacity: 120 }), at({ name: 'Church', type: 'church', capacity: '40' }), at({ name: 'Tent', type: 'school' }))

describe('layer filters', () => {
  it('compares numbers as numbers, also when a file stores them as text', () => {
    expect(matches(120, { property: 'c', op: '>', value: 100 })).toBe(true)
    expect(matches('40', { property: 'c', op: '>', value: 100 })).toBe(false)
    expect(matches('9', { property: 'c', op: '<', value: '10' })).toBe(true)
    expect(matches('b', { property: 'c', op: '>', value: 'a' })).toBe(true)
  })

  it('matches text exactly, or contained in any case', () => {
    expect(matches('school', { property: 't', op: '=', value: 'school' })).toBe(true)
    expect(matches('Primary School', { property: 't', op: 'contains', value: 'school' })).toBe(true)
    expect(matches('school', { property: 't', op: '!=', value: 'school' })).toBe(false)
  })

  it('treats a missing value as different from anything', () => {
    expect(matches(undefined, { property: 'c', op: '=', value: 1 })).toBe(false)
    expect(matches(null, { property: 'c', op: '!=', value: 1 })).toBe(true)
  })

  it('keeps the features that match, and the same collection without a filter', () => {
    expect(filterFeatures(shelters, { property: 'capacity', op: '>=', value: 100 }).features.map((f) => f.properties!.name)).toEqual(['School'])
    expect(filterFeatures(shelters, undefined)).toBe(shelters)
  })

  it('draws only the filtered features, at the layer opacity', () => {
    const [layer] = deckLayers([
      { id: 'a', title: 'Shelters', output: 'geo.features', loading: false, value: shelters, filter: { property: 'type', op: '=', value: 'school' }, style: { opacity: 0.5 } },
    ])
    expect((layer!.props.data as GeoJSON.FeatureCollection).features).toHaveLength(2)
    expect(layer!.props.opacity).toBe(0.5)
  })
})

describe('layer colors', () => {
  it('uses one color, the accent by default', () => {
    expect(featurePaint(shelters, undefined).colorOf(shelters.features[0]!)).toEqual([37, 99, 235])
    const red = featurePaint(shelters, { color: '#dc2626' })
    expect(red.colorOf(shelters.features[1]!)).toEqual(hexToRgb('#dc2626'))
    expect(red.legend).toBeUndefined()
  })

  it('colors text by category, most frequent first', () => {
    const paint = featurePaint(shelters, { byProperty: 'type' })
    expect(paint.legend!.map((l) => l.label)).toEqual(['school', 'church'])
    expect(paint.colorOf(shelters.features[0]!)).toEqual(paint.colorOf(shelters.features[2]!))
    expect(paint.colorOf(shelters.features[0]!)).not.toEqual(paint.colorOf(shelters.features[1]!))
  })

  it('colors numbers in classes, and says which have no value', () => {
    const paint = featurePaint(shelters, { byProperty: 'capacity' })
    expect(paint.legend!.map((l) => l.label)).toEqual(['40', '120', 'no value'])
  })
})

describe('layer attributes', () => {
  it('lists each property with its type and a few values', () => {
    expect(attributes(shelters)).toEqual([
      { name: 'name', type: 'text', examples: ['School', 'Church', 'Tent'], distinct: 3 },
      { name: 'type', type: 'text', examples: ['school', 'church'], distinct: 2 },
      { name: 'capacity', type: 'mixed', examples: ['120', '40'], distinct: 2 },
    ])
  })
})
