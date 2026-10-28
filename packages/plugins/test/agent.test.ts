import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Chat, Runtime, Views, type Actor, type AnyObject } from '@ttx/core'
import { areaOfView, plugins, viewOfArea } from '../src/index'

const user: Actor = { kind: 'user', id: 'u1', name: 'Ada' }
const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent' }
const canvas = { kind: 'canvas' } as const

function setup() {
  const doc = new Y.Doc()
  const people = new Runtime({ doc, plugins, actor: user })
  const bot = new Runtime({ doc, plugins, actor: agent })
  const chat = new Chat(doc)
  const add = (type: string, args: Record<string, unknown>) => people.dispatch(`${type}.add`, canvas, args).created![0]!
  return { doc, people, bot, chat, add }
}

describe('chat', () => {
  it('lists messages and replies in order, and knows which messages have no reply', () => {
    const { chat } = setup()
    let changes = 0
    chat.subscribe(() => changes++)
    const a = chat.send({ actor: user, text: 'delete these', selection: ['x'] })
    const b = chat.send({ actor: user, text: 'and this', selection: [] })
    expect(chat.pending().map((m) => m.id)).toEqual([a.id, b.id])
    chat.reply({ replyTo: a.id, text: 'Done.', calls: [] })
    expect(chat.list().map((e) => e.kind)).toEqual(['user', 'user', 'agent'])
    expect(chat.pending().map((m) => m.id)).toEqual([b.id])
    expect(changes).toBe(3)
  })

  it('lists a reply written from inside its own observer', () => {
    const { chat } = setup()
    const seen: number[] = []
    chat.subscribe(() => {
      const m = chat.pending()[0]
      if (m) chat.reply({ replyTo: m.id, text: 'ok', calls: [] })
      seen.push(chat.pending().length)
    })
    chat.send({ actor: user, text: 'hi', selection: [] })
    expect(seen[0]).toBe(0)
  })

  it('syncs between two docs, as between a browser and the room', () => {
    const a = setup()
    const b = new Y.Doc()
    a.doc.on('update', (u: Uint8Array) => Y.applyUpdate(b, u))
    a.chat.send({ actor: user, text: 'hi', selection: [] })
    expect(new Chat(b).list()[0]).toMatchObject({ kind: 'user', text: 'hi' })
  })
})

describe('agent.undoTurn', () => {
  it('removes what the turn added and puts back what it changed or deleted, with the same ids', async () => {
    const { people, bot, chat, add } = setup()
    const box = add('box', { x: 0, y: 0 })
    const text = add('text', { x: 10, y: 10, text: 'keep me' })
    const before: Record<string, AnyObject> = { [box]: people.board.get(box)!, [text]: people.board.get(text)! }

    // The agent's turn: color the box (a field it had not set), delete the text, duplicate the box.
    expect((await bot.callTool('core__object__setColor', { ids: [box], args: { color: 'red' } })).status).toBe('applied')
    expect((await bot.callTool('core__object__delete', { ids: [text], args: {} })).status).toBe('applied')
    const dup = await bot.callTool('core__object__duplicate', { ids: [box], args: {} })
    const reply = chat.reply({ replyTo: 'm1', text: 'Done.', calls: [], undo: { created: dup.created!, before } })

    expect((await people.invoke('agent.undoTurn', canvas, { replyId: reply.id })).status).toBe('applied')
    expect(people.board.list()).toEqual([before[box], before[text]])
    // A person's own ⌘Z undoes the undo.
    people.undo()
    expect(people.board.get(text)).toBeUndefined()
  })

  it('fails without undo data, and is not a tool', async () => {
    const { people, bot, chat } = setup()
    const reply = chat.reply({ replyTo: 'm1', text: 'Hello.', calls: [] })
    expect((await people.invoke('agent.undoTurn', canvas, { replyId: reply.id })).error).toMatch(/Nothing to undo/)
    expect((await bot.callTool('agent__undoTurn', { args: { replyId: reply.id } })).error).toMatch(/not a tool/)
  })
})

describe('views', () => {
  const view = { center: [85.3, 27.7] as [number, number], zoom: 6, bearing: 0 }

  it("keeps each person's view, finds the latest, and forgets the views of deleted objects", () => {
    const { doc, people, add } = setup()
    const map = add('map', { x: 0, y: 0 })
    const views = new Views(doc)
    views.set('ada', map, { ...view, at: 1 })
    views.set('ben', map, { ...view, zoom: 3, at: 2 })
    expect(views.get('ada', map)?.zoom).toBe(6)
    expect(views.latest(map)).toMatchObject({ person: 'ben', view: { zoom: 3 } })
    people.dispatch('core.object.delete', { kind: 'objects', ids: [map] }, {})
    expect(views.of(map)).toEqual([])
  })

  it('keeps views when an agent turn is undone', async () => {
    const { doc, people, bot, chat, add } = setup()
    const map = add('map', { x: 0, y: 0 })
    new Views(doc).set('ada', map, view)
    const before = { [map]: people.board.get(map)! }
    await bot.callTool('map__setBasemap', { ids: [map], args: { basemap: 'dark' } })
    const reply = chat.reply({ replyTo: 'm', text: '', calls: [], undo: { created: [], before } })
    await people.invoke('agent.undoTurn', canvas, { replyId: reply.id })
    expect(people.board.get(map)).toMatchObject({ basemap: 'light' })
    expect(new Views(doc).get('ada', map)?.zoom).toBe(6)
  })
})

describe('map views as areas', () => {
  const india = { west: 67.9, south: 6.6, east: 97.4, north: 35.7 }

  it('fits an area in a map, and reads it back as an area that contains it', () => {
    const view = viewOfArea(india, 520, 327)
    const back = areaOfView(view, 520, 327)
    expect(back.west).toBeLessThanOrEqual(india.west)
    expect(back.east).toBeGreaterThanOrEqual(india.east)
    expect(back.south).toBeLessThanOrEqual(india.south)
    expect(back.north).toBeGreaterThanOrEqual(india.north)
    // Not much more than India: the area fills the map, less the padding.
    expect(back.north - back.south).toBeLessThan((india.north - india.south) * 1.5)
  })

  it('handles an area across the antimeridian (Fiji)', () => {
    const view = viewOfArea({ west: 176, south: -21, east: -178, north: -12 }, 520, 327)
    expect(Math.abs(view.center[0])).toBeGreaterThan(178)
  })
})

describe('map.showArea', () => {
  const india = { west: 67.9, south: 6.6, east: 97.4, north: 35.7 }
  const zoomOf = (doc: Y.Doc, person: string, map: string) => new Views(doc).get(person, map)?.zoom

  it("changes the runner's view by default, given people's, or everyone's", async () => {
    const { doc, people, bot, add } = setup()
    const map = add('map', { x: 0, y: 0 })
    const views = new Views(doc)
    views.set('ben', map, { center: [0, 0], zoom: 1, bearing: 0 })
    const target = { kind: 'objects' as const, ids: [map] }

    expect((await people.invoke('map.showArea', target, india)).status).toBe('applied')
    expect(zoomOf(doc, user.id, map)).toBeGreaterThan(2)
    expect(zoomOf(doc, 'ben', map)).toBe(1)

    expect((await bot.callTool('map__showArea', { ids: [map], args: { ...india, for: ['ben'] } })).status).toBe('applied')
    expect(zoomOf(doc, 'ben', map)).toBeGreaterThan(2)

    const kathmandu = { west: 85.27, south: 27.66, east: 85.37, north: 27.75 }
    await bot.callTool('map__showArea', { ids: [map], args: { ...kathmandu, for: 'everyone' } })
    expect(zoomOf(doc, user.id, map)).toBeGreaterThan(9)
    expect(zoomOf(doc, 'ben', map)).toBeGreaterThan(9)
    // So people who open the map later start at Kathmandu too.
    expect(views.latest(map)?.view.zoom).toBeGreaterThan(9)
  })

  it('changes the view of the person an agent acts for; without one it asks whose', async () => {
    const { doc, bot, add } = setup()
    const map = add('map', { x: 0, y: 0 })
    expect((await bot.callTool('map__showArea', { ids: [map], args: india })).error).toMatch(/Give `for`/)
    expect((await bot.callTool('map__showArea', { ids: [map], args: india }, { ...agent, onBehalfOf: 'ben' })).status).toBe('applied')
    expect(new Views(doc).of(map).map((v) => v.person)).toEqual(['ben'])
  })

  it('refuses an area outside the globe', async () => {
    const { people, add } = setup()
    const map = add('map', { x: 0, y: 0 })
    expect((await people.invoke('map.showArea', { kind: 'objects', ids: [map] }, { ...india, north: 120 })).status).toBe('failed')
  })
})
