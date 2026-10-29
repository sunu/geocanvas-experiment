import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { footprintParts, plugins, type MapBoardObject } from '../src/index'
import type { EventFootprint } from '../src/monty/client'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent', onBehalfOf: 'ada' }
const canvas = { kind: 'canvas' } as const

function setup() {
  const doc = new Y.Doc()
  const rt = new Runtime({ doc, plugins, actor: ada })
  const event = rt.dispatch('event.add', canvas, { x: 0, y: 0, eventId: 'gdacs-event-1104124-1' }).created![0]!
  const map = rt.dispatch('map.add', canvas, { x: 600, y: 0 }).created![0]!
  return { doc, rt, event, map }
}

describe('map.addEventLayer', () => {
  it("adds where an event happened to a map as a recipe that names the event, for an agent too", () => {
    const { doc, rt, map } = setup()
    const target = { kind: 'objects' as const, ids: [map] }
    expect(rt.dispatch('map.addEventLayer', target, { eventId: 'gdacs-event-1104124-1', title: 'Flood in Nepal' }).status).toBe('applied')
    const bot = new Runtime({ doc, plugins, actor: agent })
    expect(bot.dispatch('map.addEventLayer', target, { eventId: 'emdat-event-2026-0326-NPL' }).status).toBe('applied')
    expect((rt.board.get(map) as MapBoardObject).layers).toEqual([
      { id: expect.any(String), tool: 'events.footprint', input: { eventId: 'gdacs-event-1104124-1' }, title: 'Flood in Nepal' },
      { id: expect.any(String), tool: 'events.footprint', input: { eventId: 'emdat-event-2026-0326-NPL' }, title: 'Event emdat-event-2026-0326-NPL' },
    ])
  })

  it('targets one map only', () => {
    const { rt, event } = setup()
    expect(rt.dispatch('map.addEventLayer', { kind: 'objects', ids: [event] }, { eventId: 'gdacs-event-1104124-1' }).status).toBe('failed')
  })

  it('is a tool for the agent, like the other map ops', () => {
    const { rt, map } = setup()
    expect(exportTools(rt.availableOps({ kind: 'objects', ids: [map] })).map((t) => t.name)).toContain('map__addEventLayer')
  })
})

/** Nepal's flood of August 2026 as Montandon gives it, trimmed: hazard areas, an event area (all of Nepal) and points. */
const area = (x: number) => ({ type: 'Polygon', coordinates: [[[x, 27], [x + 0.1, 27], [x + 0.1, 27.1], [x, 27]]] })
const point = { type: 'Point', coordinates: [85.3, 28.1] }
const NEPAL: EventFootprint = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: point, properties: { id: 'pdc-hazard-1', kind: 'hazard', source: 'pdc', title: 'Flood - Rasuwa, Nepal' } },
    { type: 'Feature', geometry: area(84.4), properties: { id: 'gdacs-hazard-1104124-1', kind: 'hazard', source: 'gdacs', title: 'Flood in Nepal' } },
    { type: 'Feature', geometry: area(85.1), properties: { id: 'cems-hazard-EMSR927-aoi03-flood', kind: 'hazard', source: 'cems', title: 'Bidur — flash flood hazard area' } },
    { type: 'Feature', geometry: area(80), properties: { id: 'ifrcevent-event-8073', kind: 'event', source: 'ifrcevent', title: 'Nepal: Rasuwa Flash Flood, 2026' } },
    { type: 'Feature', geometry: point, properties: { id: 'gdacs-event-1104124-1', kind: 'event', source: 'gdacs', title: 'Flood in Nepal' } },
  ],
}

describe('footprint parts', () => {
  it('names a layer per area by source, hazard areas before areas that only locate the event, and the points in one layer', () => {
    expect(footprintParts(NEPAL, 'Flood in Nepal')).toEqual([
      { itemId: 'gdacs-hazard-1104124-1', title: 'GDACS · Flood in Nepal', style: { color: '#2563eb' } },
      { itemId: 'cems-hazard-EMSR927-aoi03-flood', title: 'CEMS · Bidur — flash flood hazard area', style: { color: '#ea580c' } },
      { itemId: 'ifrcevent-event-8073', title: expect.stringMatching(/ · Nepal: Rasuwa Flash Flood, 2026 \(event area\)$/), style: { color: '#18181b', opacity: 0.15 } },
      { points: true, title: 'Flood in Nepal · points', style: { byProperty: 'source' } },
    ])
  })

  it('leaves a source it has no color for in the default color', () => {
    const idmc = { ...NEPAL.features[1]!, properties: { ...NEPAL.features[1]!.properties, id: 'idmc-1', source: 'idmc' } }
    expect(footprintParts({ type: 'FeatureCollection', features: [idmc] }, 'x')).toEqual([{ itemId: 'idmc-1', title: 'IDMC · Flood in Nepal' }])
  })

  it('adds them as layers in one step, each a recipe naming its part', () => {
    const { rt, map } = setup()
    const target = { kind: 'objects' as const, ids: [map] }
    rt.beginGesture()
    expect(rt.dispatch('map.addEventLayers', target, { eventId: 'gdacs-event-1104124-1', parts: footprintParts(NEPAL, 'Flood in Nepal') }).status).toBe('applied')
    const layers = (rt.board.get(map) as MapBoardObject).layers!
    expect(layers.map((l) => l.style?.color ?? l.style?.byProperty)).toEqual(['#2563eb', '#ea580c', '#18181b', 'source'])
    expect(layers.map((l) => [l.title, l.input])).toEqual([
      ['GDACS · Flood in Nepal', { eventId: 'gdacs-event-1104124-1', itemId: 'gdacs-hazard-1104124-1' }],
      ['CEMS · Bidur — flash flood hazard area', { eventId: 'gdacs-event-1104124-1', itemId: 'cems-hazard-EMSR927-aoi03-flood' }],
      [expect.any(String), { eventId: 'gdacs-event-1104124-1', itemId: 'ifrcevent-event-8073' }],
      ['Flood in Nepal · points', { eventId: 'gdacs-event-1104124-1', points: true }],
    ])
    rt.undo()
    expect((rt.board.get(map) as MapBoardObject).layers ?? []).toEqual([])
  })

  it("splits a whole footprint in its place, keeping its style if it has one, else each part's, and only a whole one", () => {
    const { rt, map } = setup()
    const target = { kind: 'objects' as const, ids: [map] }
    rt.dispatch('map.pinPlace', target, { place: 'Beira' })
    rt.dispatch('map.addEventLayer', target, { eventId: 'gdacs-event-1104124-1', title: 'Flood in Nepal' })
    rt.dispatch('map.pinPlace', target, { place: 'Kathmandu' })
    const whole = (rt.board.get(map) as MapBoardObject).layers![1]!
    rt.dispatch('map.setLayerStyle', target, { layerId: whole.id, style: { opacity: 0.5 } })
    const parts = footprintParts(NEPAL, 'Flood in Nepal').slice(0, 2)
    expect(rt.dispatch('map.splitEventLayer', target, { layerId: whole.id, parts }).status).toBe('applied')
    const layers = (rt.board.get(map) as MapBoardObject).layers!
    expect(layers.map((l) => l.title)).toEqual(['Beira', 'GDACS · Flood in Nepal', 'CEMS · Bidur — flash flood hazard area', 'Kathmandu'])
    expect(layers[1]).toMatchObject({ tool: 'events.footprint', input: { eventId: 'gdacs-event-1104124-1', itemId: 'gdacs-hazard-1104124-1' }, style: { opacity: 0.5 } })
    expect(layers[1]!.id).not.toBe(whole.id)
    expect(rt.dispatch('map.splitEventLayer', target, { layerId: layers[1]!.id, parts }).status).toBe('failed')

    rt.dispatch('map.addEventLayer', target, { eventId: 'gdacs-event-1104124-1' })
    const plain = (rt.board.get(map) as MapBoardObject).layers!.at(-1)!
    rt.dispatch('map.splitEventLayer', target, { layerId: plain.id, parts })
    expect((rt.board.get(map) as MapBoardObject).layers!.slice(-2).map((l) => l.style)).toEqual([{ color: '#2563eb' }, { color: '#ea580c' }])
  })

  it('takes a part with either an item or the points', () => {
    const { rt, map } = setup()
    const target = { kind: 'objects' as const, ids: [map] }
    expect(rt.dispatch('map.addEventLayers', target, { eventId: 'e', parts: [{ title: 'Both', itemId: 'x', points: true }] }).status).toBe('failed')
    expect(rt.dispatch('map.addEventLayers', target, { eventId: 'e', parts: [{ title: 'Neither' }] }).status).toBe('failed')
  })

  it('leaves the ops that need the footprint first out of the agent tools and the palette', () => {
    const { rt, map } = setup()
    const names = exportTools(rt.availableOps({ kind: 'objects', ids: [map] })).map((t) => t.name)
    expect(names).not.toContain('map__addEventLayers')
    expect(names).not.toContain('map__splitEventLayer')
  })
})
