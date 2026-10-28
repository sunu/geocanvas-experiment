import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, Views, type Actor } from '@ttx/core'
import { bboxOf, DATA_LAYERS, plugins, type MapBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const agentFor = (person: string): Actor => ({ kind: 'agent', id: 'agent', name: 'Agent', onBehalfOf: person })
const canvas = { kind: 'canvas' } as const
const beira = { west: 34.8, south: -19.9, east: 34.9, north: -19.8 }

function setup() {
  const doc = new Y.Doc()
  const rt = new Runtime({ doc, plugins, actor: ada })
  const map = rt.dispatch('map.add', canvas, { x: 0, y: 0 }).created![0]!
  const layersOf = () => (rt.board.get(map) as MapBoardObject).layers ?? []
  return { doc, rt, map, target: { kind: 'objects' as const, ids: [map] }, layersOf }
}

describe('map layers', () => {
  it('adds a data layer for the given area, as a recipe', () => {
    const { rt, target, layersOf } = setup()
    rt.beginGesture()
    expect(rt.dispatch('map.addLayer', target, { layer: 'population-constrained', area: beira }).status).toBe('applied')
    expect(layersOf()).toEqual([
      { id: expect.any(String), tool: 'data.population', input: { variant: 'constrained', area: [34.8, -19.9, 34.9, -19.8] }, title: DATA_LAYERS['population-constrained'].title },
    ])
  })

  it("uses the area the asker sees when none is given, also for an agent acting for them", () => {
    const { doc, rt, map, target, layersOf } = setup()
    new Views(doc).set('ada', map, { center: [34.85, -19.85], zoom: 10, bearing: 0 })
    const bot = new Runtime({ doc, plugins, actor: agentFor('ada') })
    expect(bot.dispatch('map.addLayer', target, { layer: 'countries' }).status).toBe('applied')
    const area = layersOf()[0]!.input.area as number[]
    expect(area[0]).toBeLessThan(34.85)
    expect(area[2]).toBeGreaterThan(34.85)
    expect(area[1]).toBeLessThan(-19.85)
    expect(area[3]).toBeGreaterThan(-19.85)
    expect(rt.dispatch('map.addLayer', target, { layer: 'countries' }).status).toBe('applied')
    expect(layersOf()[1]!.input.area).toEqual(area)
  })

  it('adds health facilities for an area', () => {
    const { rt, target, layersOf } = setup()
    rt.dispatch('map.addLayer', target, { layer: 'health-facilities', area: beira })
    expect(layersOf()[0]).toMatchObject({ tool: 'data.healthFacilities', input: { area: [34.8, -19.9, 34.9, -19.8] }, title: 'Health facilities (OpenStreetMap)' })
  })

  it('fails without an area when nobody has looked at the map', () => {
    const { rt, target, layersOf } = setup()
    expect(rt.dispatch('map.addLayer', target, { layer: 'countries' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/area/) })
    expect(layersOf()).toEqual([])
  })

  it('pins a place, moves a layer to another area, and removes a layer', () => {
    const { rt, target, layersOf } = setup()
    rt.dispatch('map.pinPlace', target, { place: 'Beira, Mozambique' })
    rt.dispatch('map.addLayer', target, { layer: 'buildings', area: beira })
    const [pin, buildings] = layersOf()
    expect(pin).toMatchObject({ tool: 'data.geocode', input: { query: 'Beira, Mozambique', limit: 1 }, title: 'Beira, Mozambique' })

    const moved = { west: 35, south: -20, east: 35.05, north: -19.95 }
    expect(rt.dispatch('map.setLayerArea', target, { layerId: buildings!.id, area: moved }).status).toBe('applied')
    expect(layersOf()[1]!.input.area).toEqual(bboxOf(moved))
    expect(rt.dispatch('map.setLayerArea', target, { layerId: pin!.id, area: moved }).status).toBe('failed')

    rt.dispatch('map.removeLayer', target, { layerId: pin!.id })
    expect(layersOf().map((l) => l.id)).toEqual([buildings!.id])
    expect(rt.dispatch('map.removeLayer', target, { layerId: 'nope' }).status).toBe('failed')
  })

  it('undoes a layer add as one step', () => {
    const { rt, target, layersOf } = setup()
    rt.beginGesture()
    rt.dispatch('map.addLayer', target, { layer: 'countries', area: beira })
    expect(layersOf()).toHaveLength(1)
    rt.undo()
    expect(layersOf()).toEqual([])
  })

  it('reads maps made before layers existed', () => {
    const { rt, map } = setup()
    expect(rt.board.get(map)).not.toHaveProperty('layers')
    expect(rt.registry.objectSchema('map').parse({ x: 0, y: 0, w: 1, h: 1, z: 0, basemap: 'light' })).not.toHaveProperty('layers')
  })

  it('keeps layer areas on the globe and rounded', () => {
    expect(bboxOf({ west: -250, south: -95, east: 250, north: 95 })).toEqual([-180, -90, 180, 90])
    expect(bboxOf({ west: 34.812345678, south: -19.86, east: 34.87, north: -19.8000049 })).toEqual([34.8123, -19.86, 34.87, -19.8])
  })
})
