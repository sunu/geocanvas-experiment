import { describe, expect, it } from 'vitest'
import { Runtime, Views, type AnyObject } from '@ttx/core'
import { callOp, linkedLayerId, plugins, TurnLog, type MapBoardObject, type ReliefWebBoardObject } from '../src/index'
import { agent, canvas, fakeTools, idai, nepal, setup } from './fakes'

const types = (rt: Runtime, ids: string[] = []) => ids.map((id) => rt.board.get(id)!.type).sort()
const objectsOf = (rt: Runtime, ids: string[] = []) => ids.map((id) => rt.board.get(id)!)
const one = (objects: AnyObject[], type: string) => objects.find((o) => o.type === type)!

describe('template.sitrep', () => {
  it('adds the event card, the objects that follow it, and notes in a frame, as one undo step, from search text', async () => {
    const { runner, calls } = fakeTools()
    const { doc, rt } = setup(runner)
    const r = await rt.invoke('template.sitrep', canvas, { event: { text: 'Nepal floods 2026' }, x: 0, y: 0 })
    expect(r.status, r.error).toBe('applied')
    expect(types(rt, r.created)).toEqual(['country', 'event', 'frame', 'map', 'reliefweb', 'sticky', 'sticky', 'sticky'])
    expect(r.summary).toBe('Situation report for Flood in Nepal (gdacs-event-1104124-1)')
    expect(calls[0]).toBe('events.search {"text":"Nepal floods 2026","limit":1}')

    const objects = objectsOf(rt, r.created)
    const event = one(objects, 'event')
    expect(event).toMatchObject({ eventId: nepal.id })
    expect(event).not.toHaveProperty('link')
    const map = one(objects, 'map') as MapBoardObject
    expect(map.layers).toEqual([{ id: linkedLayerId('eventFootprint'), tool: 'events.footprint', input: { eventId: nepal.id }, title: 'Flood in Nepal' }])
    expect(one(objects, 'reliefweb') as ReliefWebBoardObject).toMatchObject({ glides: ['FF-2026-000162-NPL'], title: 'Flood in Nepal' })
    expect(one(objects, 'country')).toMatchObject({ country: 'NPL' })
    for (const type of ['map', 'reliefweb', 'country', 'frame']) expect(one(objects, type).link?.from).toBe(event.id)
    expect(objects.filter((o) => o.type === 'sticky').every((o) => !o.link)).toBe(true)

    // The frame is titled after the event, under everything (maps too) and around everything; the set is centered on x, y.
    const frame = one(objects, 'frame')
    expect(frame).toMatchObject({ title: 'Situation report: Flood in Nepal' })
    for (const o of objects) {
      if (o === frame) continue
      expect(o.z).toBeGreaterThan(frame.z)
      expect(o.x).toBeGreaterThanOrEqual(frame.x)
      expect(o.x + o.w).toBeLessThanOrEqual(frame.x + frame.w)
      expect(o.y).toBeGreaterThanOrEqual(frame.y)
      expect(o.y + o.h).toBeLessThanOrEqual(frame.y + frame.h)
    }
    expect(Math.abs(frame.x + frame.w / 2)).toBeLessThanOrEqual(1)
    // The runner's view of the new map shows the event's area.
    expect(new Views(doc).get('ada', map.id)?.center).toEqual([expect.closeTo(84.5, 1), expect.closeTo(28, 1)])

    rt.undo()
    expect(rt.board.list()).toEqual([])
  })

  it('follows the event card afterwards: picking another event updates the set', async () => {
    const { runner } = fakeTools([nepal, idai])
    const { rt } = setup(runner)
    const r = await rt.invoke('template.sitrep', canvas, { event: nepal.id })
    const event = one(objectsOf(rt, r.created), 'event')
    await rt.invoke('event.setEvent', { kind: 'objects', ids: [event.id] }, { eventId: idai.id })
    const objects = objectsOf(rt, r.created)
    expect(one(objects, 'frame')).toMatchObject({ title: 'Situation report: Cyclone Idai' })
    expect(one(objects, 'country')).toMatchObject({ country: 'MOZ' })
    expect(one(objects, 'reliefweb')).toMatchObject({ glides: idai.glides })
  })

  it('keeps the feed, blank, when the event has no GLIDE number, so a later event can fill it', async () => {
    const { runner, calls } = fakeTools([{ ...nepal, glides: [] }])
    const { rt } = setup(runner)
    const r = await rt.invoke('template.sitrep', canvas, { event: nepal.id })
    expect(r.status, r.error).toBe('applied')
    expect(one(objectsOf(rt, r.created), 'reliefweb')).toMatchObject({ glides: [] })
    expect(calls.some((c) => c.startsWith('events.search'))).toBe(false)
  })

  it('without tools, fills what the event id alone gives', async () => {
    const { rt } = setup()
    const r = await rt.invoke('template.sitrep', canvas, { event: nepal.id })
    expect(r.status, r.error).toBe('applied')
    const objects = objectsOf(rt, r.created)
    expect(one(objects, 'map')).toMatchObject({ layers: [{ input: { eventId: nepal.id } }] })
    expect(one(objects, 'country')).not.toHaveProperty('country')
    expect(one(objects, 'frame')).not.toHaveProperty('title')
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
    const frame = one(objectsOf(rt, r.created), 'frame')
    expect(frame.x).toBeGreaterThan(300)
    expect(frame.y).toBe(50)
  })
})

describe('template.conflict', () => {
  it("puts the area in an input that the map and widgets follow, colored by the area's country", async () => {
    const { runner } = fakeTools()
    const { doc, rt } = setup(runner)
    const r = await rt.invoke('template.conflict', canvas, { area: { text: 'Beira' } })
    expect(r.status, r.error).toBe('applied')
    expect(types(rt, r.created)).toEqual(['conflict', 'country', 'frame', 'input', 'map', 'presence', 'sticky', 'sticky'])
    const objects = objectsOf(rt, r.created)
    const input = one(objects, 'input')
    expect(input).toMatchObject({ kind: 'area', value: { name: 'Beira, Mozambique' } })
    expect(objects.filter((o) => ['conflict', 'presence', 'country'].includes(o.type)).map((o) => (o as { country?: string }).country)).toEqual(['MOZ', 'MOZ', 'MOZ'])
    const map = one(objects, 'map') as MapBoardObject
    expect(map.layers?.[0]).toMatchObject({ tool: 'hapi.choropleth', input: { country: 'MOZ', indicator: 'conflictEvents', level: 1 } })
    expect(map.link?.from).toBe(input.id)
    expect(one(objects, 'frame')).toMatchObject({ title: 'Conflict: Beira, Mozambique' })
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
    expect(one(objectsOf(bot, r.created), 'frame')).toMatchObject({ title: 'Conflict: Mozambique' })
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
    const frame = one(objectsOf(bot, r.created), 'frame')
    expect(Math.abs(frame.x + frame.w / 2 - 1000)).toBeLessThanOrEqual(1)
    expect(Math.abs(frame.y + frame.h / 2 - 500)).toBeLessThanOrEqual(1)
  })
})
