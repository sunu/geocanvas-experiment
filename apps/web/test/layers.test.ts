import { describe, expect, it } from 'vitest'
import { hasArea } from '@ttx/plugins'
import { attributionOf, deckLayers, viewArea, type LayerState } from '../src/map/layers'
import type { Raster } from '../src/map/raster'

const points: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [34.8, -19.8] }, properties: {} }],
}
const raster: Raster = { url: 'https://example.org/moz.tif', title: 'Population', rescale: [0, 50] }

describe('map data layers', () => {
  it('draws a geo.features result, one deck.gl layer per map layer', () => {
    const states: LayerState[] = [{ id: 'a', title: 'Beira', output: 'geo.features', loading: false, value: points }]
    const [layer] = deckLayers(states)
    expect(layer?.id).toBe('layer-a')
    expect(layer?.props.data).toBe(points)
  })

  it('draws rasters below features, whatever the layer order', () => {
    const states: LayerState[] = [
      { id: 'pin', title: 'Beira', output: 'geo.features', loading: false, value: points },
      { id: 'pop', title: 'Population', output: 'geo.raster', loading: false, value: raster },
    ]
    expect(deckLayers(states).map((l) => l.id)).toEqual(['layer-pop-raster', 'layer-pin'])
  })

  // openEO's tool answers { status: 'running' } until the Worker has made its tile service; the layer list says it is waiting.
  it('draws an XYZ tile result once it has a url, below the features, and nothing while it has none', () => {
    const tiles = { id: 'sar', title: 'Change', output: 'geo.tiles', loading: false, value: { status: 'ready', url: 'https://eopf.example/{z}/{x}/{y}' } }
    const pin = { id: 'pin', title: 'Beira', output: 'geo.features', loading: false, value: points }
    expect(deckLayers([pin, tiles]).map((l) => l.id)).toEqual(['layer-sar', 'layer-pin'])
    expect(deckLayers([{ ...tiles, value: { status: 'running' } }])).toEqual([])
  })

  it('draws nothing for layers still loading, failed, or of a kind it cannot show', () => {
    expect(
      deckLayers([
        { id: 'loading', title: 'x', output: 'geo.features', loading: true },
        { id: 'failed', title: 'x', output: 'geo.raster', loading: false, error: 'No country found' },
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

describe('layer areas', () => {
  it("turns a view's bounds into an area on the globe, rounded", () => {
    expect(
      viewArea([
        [34.812345678, -19.86],
        [34.87, -19.8000049],
      ]),
    ).toEqual([34.8123, -19.86, 34.87, -19.8])
    // A zoomed-out view can span more than the world.
    expect(
      viewArea([
        [-250, -95],
        [250, 95],
      ]),
    ).toEqual([-180, -90, 180, 90])
  })

  it('knows which layers have an area', () => {
    expect(hasArea({ id: 'a', tool: 'data.population', input: { area: [0, 0, 1, 1] }, title: 'x' })).toBe(true)
    expect(hasArea({ id: 'b', tool: 'data.geocode', input: { query: 'Beira' }, title: 'x' })).toBe(false)
  })

  it('lets only layers made by code be picked, and draws the one in focus stronger', () => {
    const code: LayerState = { id: 'buffer', title: 'Buffer', output: 'geo.features', loading: false, value: points, from: 'cell' }
    const other: LayerState = { id: 'pin', title: 'Beira', output: 'geo.features', loading: false, value: points }
    const [a, b] = deckLayers([code, other])
    expect([a?.props.pickable, b?.props.pickable]).toEqual([true, false])
    const [strong, faint] = deckLayers([code, other], { highlight: 'buffer' })
    expect(strong?.props.opacity).toBe(1)
    expect((strong?.props as { lineWidthMinPixels?: number }).lineWidthMinPixels).toBe(3)
    expect(faint?.props.opacity).toBeCloseTo(0.35)
  })
})
