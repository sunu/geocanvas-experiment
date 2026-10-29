import { describe, expect, it } from 'vitest'
import { Views, type Link, type Runtime } from '@ttx/core'
import { linkedLayerId, type CountryBoardObject, type MapBoardObject, type ReliefWebBoardObject } from '../src/index'
import { canvas, fakeTools, idai, nepal, setup } from './fakes'

/** Make `id` follow `from`, as a template does. Links have no op of their own yet. */
const follow = (rt: Runtime, id: string, link: Link) => rt.board.doc.transact(() => rt.board.objects.get(id)!.set('link', link))

const add = (rt: Runtime, type: string, fields: Record<string, unknown> = {}) => rt.dispatch(`${type}.add`, canvas, { x: 0, y: 0, ...fields }).created![0]!

/** An event card with a map, a feed, a country card and a frame that follow it, showing Nepal. */
function sitrep(events = [nepal, idai]) {
  const { runner, calls } = fakeTools(events)
  const { doc, rt } = setup(runner)
  const event = add(rt, 'event', { eventId: nepal.id })
  const mine = { id: 'mine', tool: 'data.geocode', input: { query: 'Kathmandu' }, title: 'Kathmandu' }
  const map = add(rt, 'map', { layers: [mine] })
  const feed = add(rt, 'reliefweb', { glides: nepal.glides, title: nepal.name })
  const country = add(rt, 'country', { country: 'NPL' })
  const frame = add(rt, 'frame', { title: 'Situation report: Flood in Nepal' })
  follow(rt, map, { from: event, recipe: 'eventFootprint' })
  follow(rt, feed, { from: event, recipe: 'reliefweb' })
  follow(rt, country, { from: event, recipe: 'country' })
  follow(rt, frame, { from: event, recipe: 'frameTitle', args: { prefix: 'Situation report: ' } })
  return { doc, rt, calls, event, map, feed, country, frame, mine }
}

describe('links', () => {
  it('re-render what follows an event when another event is picked, in one undo step', async () => {
    const { doc, rt, event, map, feed, country, frame, mine } = sitrep()
    rt.beginGesture()
    const r = await rt.invoke('event.setEvent', { kind: 'objects', ids: [event] }, { eventId: idai.id })
    expect(r.status, r.error).toBe('applied')
    // Only the linked layer: the layer someone added stays.
    expect((rt.board.get(map) as MapBoardObject).layers).toEqual([
      { id: linkedLayerId('eventFootprint'), tool: 'events.footprint', input: { eventId: idai.id }, title: 'Cyclone Idai' },
      mine,
    ])
    expect(rt.board.get(feed)).toMatchObject({ glides: idai.glides, title: 'Cyclone Idai' })
    expect(rt.board.get(country)).toMatchObject({ country: 'MOZ' })
    expect(rt.board.get(frame)).toMatchObject({ title: 'Situation report: Cyclone Idai' })
    // The person who picked sees the new area on the map.
    expect(new Views(doc).get('ada', map)?.center).toEqual([expect.closeTo(34, 0), expect.closeTo(-19, 0)])

    rt.undo()
    expect(rt.board.get(event)).toMatchObject({ eventId: nepal.id })
    expect(rt.board.get(feed)).toMatchObject({ glides: nepal.glides, title: nepal.name })
    expect(rt.board.get(country)).toMatchObject({ country: 'NPL' })
  })

  it('blank what the new event does not have, and never keep the old data', async () => {
    // No GLIDE number, no country, and no area to find the country from.
    const { bbox: _, ...rest } = idai
    const none = { ...rest, glides: [], country: '' }
    const { rt, event, feed, country } = sitrep([nepal, none])
    await rt.invoke('event.setEvent', { kind: 'objects', ids: [event] }, { eventId: none.id })
    const f = rt.board.get(feed) as ReliefWebBoardObject
    expect(f.glides).toEqual([])
    expect(f).not.toHaveProperty('title')
    expect(rt.board.get(country) as CountryBoardObject).not.toHaveProperty('country')
  })

  it('keep a name someone gave a follower, and the link, when the root changes', async () => {
    const { rt, event, frame } = sitrep()
    rt.dispatch('core.object.rename', { kind: 'objects', ids: [frame] }, { name: 'Our sitrep' })
    await rt.invoke('event.setEvent', { kind: 'objects', ids: [event] }, { eventId: idai.id })
    expect(rt.board.get(frame)).toMatchObject({ name: 'Our sitrep', title: 'Situation report: Cyclone Idai', link: { from: event } })
    // An empty name goes back to the linked title.
    rt.dispatch('core.object.rename', { kind: 'objects', ids: [frame] }, { name: '' })
    expect(rt.board.get(frame)).toMatchObject({ name: '', title: 'Situation report: Cyclone Idai' })
  })

  it('leave an unlinked object as it is', async () => {
    const { rt, event, country } = sitrep()
    expect(rt.dispatch('link.remove', { kind: 'objects', ids: [country] }, {}).status).toBe('applied')
    expect(rt.board.get(country)).not.toHaveProperty('link')
    await rt.invoke('event.setEvent', { kind: 'objects', ids: [event] }, { eventId: idai.id })
    expect(rt.board.get(country)).toMatchObject({ country: 'NPL' })
  })

  it('refresh on request, and look nothing up for a root that nobody follows', async () => {
    const { rt, calls, event, feed } = sitrep([{ ...nepal, glides: ['FF-2026-000170-NPL'] }, idai])
    const r = await rt.invoke('link.refresh', { kind: 'objects', ids: [event] }, {})
    expect(r).toMatchObject({ status: 'applied', summary: '4 linked object(s) updated' })
    expect(rt.board.get(feed)).toMatchObject({ glides: ['FF-2026-000170-NPL'] })

    const lone = add(rt, 'event')
    calls.length = 0
    expect((await rt.invoke('event.setEvent', { kind: 'objects', ids: [lone] }, { eventId: idai.id })).status).toBe('applied')
    expect(calls).toEqual([])
    expect(rt.availableOps({ kind: 'objects', ids: [lone] }).map((o) => o.id)).not.toContain('link.refresh')
  })

  it('follow an area of interest: set it by text, and its country reaches the widgets', async () => {
    const { runner } = fakeTools()
    const { rt } = setup(runner)
    const input = add(rt, 'input')
    const map = add(rt, 'map')
    const conflict = add(rt, 'conflict')
    follow(rt, map, { from: input, recipe: 'conflictChoropleth' })
    follow(rt, conflict, { from: input, recipe: 'country' })
    const r = await rt.invoke('input.setArea', { kind: 'objects', ids: [input] }, { area: { text: 'Beira' } })
    expect(r.status, r.error).toBe('applied')
    expect(r.summary).toBe('Area of interest: Beira, Mozambique; 2 linked object(s) updated')
    expect(rt.board.get(input)).toMatchObject({ value: { name: 'Beira, Mozambique' } })
    expect(rt.board.get(conflict)).toMatchObject({ country: 'MOZ' })
    expect((rt.board.get(map) as MapBoardObject).layers?.[0]).toMatchObject({ id: linkedLayerId('conflictChoropleth'), tool: 'hapi.choropleth', input: { country: 'MOZ' } })
    expect((await rt.invoke('input.setArea', { kind: 'objects', ids: [input] }, { area: { text: 'nowhere' } })).status).toBe('failed')
  })

  it('cannot follow an object that is not a root', async () => {
    const { runner } = fakeTools()
    const { rt } = setup(runner)
    const text = add(rt, 'text', { text: 'x' })
    const map = add(rt, 'map')
    follow(rt, map, { from: text, recipe: 'eventFootprint' })
    expect((await rt.invoke('link.refresh', { kind: 'objects', ids: [text] }, {})).status).toBe('failed')
  })
})
