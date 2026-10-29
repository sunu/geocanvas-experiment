import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { z } from 'zod'
import { defineTool, Runtime, ToolRunner, Views, type Actor, type ToolDef } from '@ttx/core'
import { callOp, plugins, TurnLog, type EventFacts, type MapBoardObject, type PlaceFeatures, type ReliefWebBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent', onBehalfOf: 'ada' }
const canvas = { kind: 'canvas' } as const

const nepal: EventFacts = {
  id: 'gdacs-event-1104124-1',
  name: 'Flood in Nepal',
  start: '2026-08-02',
  end: '2026-08-09',
  country: 'NPL',
  glides: ['FF-2026-000162-NPL'],
  bbox: [83, 27, 86, 29],
}

const beira = { name: 'Beira, Mozambique', lngLat: [34.84, -19.84] as [number, number], bbox: [34.74, -19.91, 34.95, -19.69] as [number, number, number, number], iso3: 'MOZ' }

const points = (places: object[]): PlaceFeatures =>
  ({ type: 'FeatureCollection', features: places.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: p })) }) as PlaceFeatures

/** Montandon and the geocoder, faked. `calls` lists each tool call. */
function fakeTools(event: EventFacts = nepal) {
  const calls: string[] = []
  const tool = (id: string, run: (input: any) => unknown): ToolDef =>
    defineTool({ id, title: id, description: id, input: z.any(), output: 'json', cache: false, run: (input) => (calls.push(`${id} ${JSON.stringify(input)}`), run(input)) })
  const runner = new ToolRunner([
    tool('events.search', ({ text }) => (text === 'nothing' ? 'No events found.' : [{ id: event.id, name: event.name }])),
    tool('events.get', () => event),
    tool('data.geocode', ({ query }) => points(query === 'Nepal' ? [{ name: 'Nepal', lngLat: [84, 28], bbox: [80, 26, 88, 30.5], iso3: 'NPL' }] : [beira])),
    tool('data.reverseGeocode', () => points([{ name: 'Somewhere', lngLat: [0, 0], iso3: 'MOZ' }])),
  ])
  return { runner, calls }
}

function setup(tools?: ToolRunner) {
  const doc = new Y.Doc()
  const rt = new Runtime({ doc, plugins, actor: ada, ...(tools && { tools }) })
  return { doc, rt }
}

const types = (rt: Runtime, ids: string[] = []) => ids.map((id) => rt.board.get(id)!.type).sort()

describe('template.sitrep', () => {
  it('adds the event, its map, feed, country and notes in a frame, as one undo step, from search text', async () => {
    const { runner, calls } = fakeTools()
    const { doc, rt } = setup(runner)
    const r = await rt.invoke('template.sitrep', canvas, { event: { text: 'Nepal floods 2026' }, x: 0, y: 0 })
    expect(r.status, r.error).toBe('applied')
    expect(types(rt, r.created)).toEqual(['box', 'country', 'event', 'map', 'reliefweb', 'sticky', 'sticky', 'sticky', 'text'])
    expect(r.summary).toBe('Situation report for Flood in Nepal (gdacs-event-1104124-1)')
    expect(calls[0]).toBe('events.search {"text":"Nepal floods 2026","limit":1}')

    const objects = r.created!.map((id) => rt.board.get(id)!)
    const map = objects.find((o) => o.type === 'map') as MapBoardObject
    expect(map.layers).toEqual([{ id: expect.any(String), tool: 'events.footprint', input: { eventId: nepal.id }, title: 'Flood in Nepal' }])
    expect((objects.find((o) => o.type === 'reliefweb') as ReliefWebBoardObject).glides).toEqual(['FF-2026-000162-NPL'])
    expect(objects.find((o) => o.type === 'text')).toMatchObject({ text: 'Situation report: Flood in Nepal (2026-08-02 to 2026-08-09)' })
    // The frame is under everything, maps too, and around everything; the set is centered on x, y.
    const frame = objects.find((o) => o.type === 'box')!
    for (const o of objects) {
      if (o === frame) continue
      expect(o.z).toBeGreaterThan(frame.z)
      expect(o.x).toBeGreaterThanOrEqual(frame.x)
      expect(o.x + o.w).toBeLessThanOrEqual(frame.x + frame.w)
      expect(o.y + o.h).toBeLessThanOrEqual(frame.y + frame.h)
    }
    expect(Math.abs(frame.x + frame.w / 2)).toBeLessThanOrEqual(1)
    // The runner's view of the new map shows the event's area.
    expect(new Views(doc).get('ada', map.id)?.center).toEqual([expect.closeTo(84.5, 1), expect.closeTo(28, 1)])

    rt.undo()
    expect(rt.board.list()).toEqual([])
  })

  it('takes an event id as it is, and leaves out the feed when the event has no GLIDE number', async () => {
    const { runner, calls } = fakeTools({ ...nepal, glides: [] })
    const { rt } = setup(runner)
    const r = await rt.invoke('template.sitrep', canvas, { event: nepal.id })
    expect(r.status, r.error).toBe('applied')
    expect(types(rt, r.created)).not.toContain('reliefweb')
    expect(calls.some((c) => c.startsWith('events.search'))).toBe(false)
  })

  it('without tools, makes what the event id alone gives', async () => {
    const { rt } = setup()
    const r = await rt.invoke('template.sitrep', canvas, { event: nepal.id })
    expect(r.status, r.error).toBe('applied')
    expect(types(rt, r.created)).toEqual(['box', 'event', 'map', 'sticky', 'sticky', 'sticky', 'text'])
  })

  it('fails before any write when nothing matches, or when it cannot search', async () => {
    const { runner } = fakeTools()
    const withTools = setup(runner).rt
    expect(await withTools.invoke('template.sitrep', canvas, { event: { text: 'nothing' } })).toMatchObject({ status: 'failed', error: 'No event matches "nothing"' })
    expect(withTools.board.list()).toEqual([])
    const without = setup().rt
    expect((await without.invoke('template.sitrep', canvas, { event: { text: 'Nepal floods' } })).status).toBe('failed')
  })

  it('goes right of everything on the board without x and y', async () => {
    const { runner } = fakeTools()
    const { rt } = setup(runner)
    rt.dispatch('box.add', canvas, { x: 100, y: 50, w: 200, h: 100 })
    const r = await rt.invoke('template.sitrep', canvas, { event: nepal.id })
    const frame = r.created!.map((id) => rt.board.get(id)!).find((o) => o.type === 'box')!
    expect(frame.x).toBeGreaterThan(300)
    expect(frame.y).toBe(50)
  })
})

describe('template.conflict', () => {
  it("colors the area's country by political violence, with its conflict, presence and context widgets", async () => {
    const { runner } = fakeTools()
    const { doc, rt } = setup(runner)
    const r = await rt.invoke('template.conflict', canvas, { area: { text: 'Beira' } })
    expect(r.status, r.error).toBe('applied')
    expect(types(rt, r.created)).toEqual(['box', 'conflict', 'country', 'map', 'presence', 'sticky', 'sticky', 'text'])
    const objects = r.created!.map((id) => rt.board.get(id)!)
    expect(objects.filter((o) => ['conflict', 'presence', 'country'].includes(o.type)).map((o) => (o as { country?: string }).country)).toEqual(['MOZ', 'MOZ', 'MOZ'])
    const map = objects.find((o) => o.type === 'map') as MapBoardObject
    expect(map.layers?.[0]).toMatchObject({ tool: 'hapi.choropleth', input: { country: 'MOZ', indicator: 'conflictEvents', level: 1 } })
    expect(objects.find((o) => o.type === 'text')).toMatchObject({ text: 'Conflict: Beira, Mozambique' })
    expect(new Views(doc).get('ada', map.id)).toBeDefined()
  })

  it("uses the asker's last map view for an agent, and finds the country at its center", async () => {
    const { runner, calls } = fakeTools()
    const { doc, rt } = setup(runner)
    const mapId = rt.dispatch('map.add', canvas, { x: 0, y: 0 }).created![0]!
    new Views(doc).set('ada', mapId, { center: [35, -19], zoom: 7, bearing: 0 })
    const bot = new Runtime({ doc, plugins, actor: agent, tools: runner })
    const r = await bot.invoke('template.conflict', canvas, { area: 'my view' })
    expect(r.status, r.error).toBe('applied')
    expect(calls.some((c) => c.startsWith('data.reverseGeocode'))).toBe(true)
    expect(r.created!.map((id) => bot.board.get(id)!).find((o) => o.type === 'text')).toMatchObject({ text: 'Conflict: Mozambique' })
  })

  it('fails on "my view" without any map view', async () => {
    const { runner } = fakeTools()
    const { rt } = setup(runner)
    expect((await rt.invoke('template.conflict', canvas, { area: 'my view' })).status).toBe('failed')
  })
})

describe('templates for agents', () => {
  it("go in the middle of the asker's view, and say what they found", async () => {
    const { runner } = fakeTools()
    const { doc } = setup()
    const bot = new Runtime({ doc, plugins, actor: agent, tools: runner })
    const r = await callOp(bot, 'template__sitrep', { args: { event: { text: 'Nepal floods' } } }, { actor: agent, turn: new TurnLog(), center: { x: 1000, y: 500 } })
    expect(r.status, r.error).toBe('applied')
    expect(r.summary).toContain('Flood in Nepal')
    const frame = r.created!.map((id) => bot.board.get(id)!).find((o) => o.type === 'box')!
    expect(Math.abs(frame.x + frame.w / 2 - 1000)).toBeLessThanOrEqual(1)
    expect(Math.abs(frame.y + frame.h / 2 - 500)).toBeLessThanOrEqual(1)
  })
})
