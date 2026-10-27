import { describe, expect, it } from 'vitest'
import { attributionOf, deckLayers, type LayerState } from '../src/map/layers'

const points: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [34.8, -19.8] }, properties: {} }],
}

describe('map data layers', () => {
  it('draws a geo.features result, one deck.gl layer per map layer', () => {
    const states: LayerState[] = [{ id: 'a', title: 'Beira', output: 'geo.features', loading: false, value: points }]
    const [layer] = deckLayers(states)
    expect(layer?.id).toBe('layer-a')
    expect(layer?.props.data).toBe(points)
  })

  it('draws nothing for layers still loading, failed, or of a kind it cannot show', () => {
    expect(
      deckLayers([
        { id: 'loading', title: 'x', output: 'geo.features', loading: true },
        { id: 'failed', title: 'x', output: 'geo.features', loading: false, error: 'No place found' },
        { id: 'unknown', title: 'x', loading: false, value: points },
      ]),
    ).toEqual([])
  })

  it('reads the attribution a result carries', () => {
    expect(attributionOf({ ...points, attribution: 'WorldPop, CC-BY-4.0' })).toBe('WorldPop, CC-BY-4.0')
    expect(attributionOf(points)).toBeUndefined()
    expect(attributionOf(undefined)).toBeUndefined()
  })
})
