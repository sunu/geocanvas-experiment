import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Chat, Runtime, ToolRunner, Views, type Actor, type AgentReply, type AnyObject, type ChatEntry, type ToolDef, type UserMessage } from '@ttx/core'
import {
  Agent,
  boardGet,
  chatCompletions,
  eventsSearch,
  GAP,
  geocodeTools,
  HISTORY_ENTRIES,
  HISTORY_MS,
  MAX_STEPS,
  plugins,
  runTurn,
  SEARCH_RESULTS,
  TURNS_PER_HOUR,
  type Complete,
  type FunctionTool,
  type Geocoder,
  type Message,
} from '../src/index'
import { freeSpot } from '../src/agent/call'
import type { MontyClient } from '../src/monty/client'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const ben: Actor = { kind: 'user', id: 'ben', name: 'Ben' }
const canvas = { kind: 'canvas' } as const

/** A board with three boxes, added by a person. */
function board() {
  const doc = new Y.Doc()
  const person = new Runtime({ doc, plugins, actor: ada })
  const [a, b, c] = [0, 1, 2].map((x) => person.dispatch('box.add', canvas, { x: x * 300, y: 0 }).created![0]!) as [string, string, string]
  return { doc, person, chat: new Chat(doc), a, b, c }
}

/** A model that gives these answers in turn, and records what it was sent. */
function scripted(...answers: (Extract<Message, { role: 'assistant' }> | Error)[]) {
  const seen: Message[][] = []
  const complete: Complete = async (messages) => {
    seen.push(structuredClone(messages))
    const next = answers.shift() ?? { role: 'assistant', content: 'Done.' }
    if (next instanceof Error) throw next
    return next
  }
  return { complete, seen }
}
const call = (name: string, input: unknown, id = name) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(input) } })
const tools = (...calls: ReturnType<typeof call>[]) => ({ role: 'assistant' as const, content: null, tool_calls: calls })

/** runTurn with board.get and these read-only tools, as the room's Agent gives it. */
/** Another runtime on the doc, to read it as someone else does. */
const person = (doc: Y.Doc) => new Runtime({ doc, plugins, actor: ben })

const turn = (runtime: Runtime, message: UserMessage, complete: Complete, extra: ToolDef[] = [], history: ChatEntry[] = []) =>
  runTurn(runtime, message, complete, new ToolRunner([boardGet(runtime), ...extra]), history)

describe('runTurn', () => {
  it("gives the model the sender's selection snapshot, and deletes only those ids", async () => {
    const { doc, person, chat, a, b, c } = board()
    // Ada selected a and b; Ben has c selected at the same time, which the agent never sees.
    const message = chat.send({ actor: ada, text: 'delete these', selection: [a, b] })
    const model = scripted(tools(call('core__object__delete', { ids: [a, b], args: {} })), { role: 'assistant', content: 'Deleted 2 boxes.' })
    const agent = new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })

    const reply = await turn(agent, message, model.complete)

    const request = model.seen[0]![1]!.content as string
    expect(request).toContain('Ada (person id ada) asks: delete these')
    expect(request).toContain(`Selected (2):\n- box ${a}`)
    expect(request.split('Selected')[1]).not.toContain(c)
    expect(person.board.list().map((o) => o.id)).toEqual([c])
    expect(reply).toMatchObject({
      replyTo: message.id,
      text: 'Deleted 2 boxes.',
      calls: [{ tool: 'core.object.delete', ids: [a, b], status: 'applied' }],
      undo: { created: [], before: { [a]: { id: a, type: 'box' }, [b]: { id: b, type: 'box' } } },
    })
  })

  it('records created ids for a duplicate, and keeps no copy of objects the turn added', async () => {
    const { doc, chat, a } = board()
    const message = chat.send({ actor: ada, text: 'duplicate this and move the copy', selection: [a] })
    const agent = new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })
    let copy = ''
    const model: Complete = async (messages) => {
      const last = messages.at(-1)!
      if (last.role === 'user') return tools(call('core__object__duplicate', { ids: [a], args: {} }))
      if (!copy && last.role === 'tool') {
        copy = (JSON.parse(last.content) as { created: string[] }).created[0]!
        return tools(call('core__object__move', { ids: [copy], args: { dx: 10 } }))
      }
      return { role: 'assistant', content: 'Done.' }
    }
    const reply = await turn(agent, message, model)
    expect(reply.undo).toEqual({
      created: [copy],
      before: { [a]: expect.objectContaining({ id: a }) },
      // As the turn left them.
      after: { [copy]: person(doc).board.get(copy), [a]: person(doc).board.get(a) },
    })
  })

  it('reports failed tool calls back to the model', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'delete it', selection: [] })
    const model = scripted(tools(call('core__object__delete', { ids: ['nope'], args: {} })))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(reply.calls).toEqual([{ tool: 'core.object.delete', ids: ['nope'], status: 'failed', error: 'Object nope does not exist' }])
    expect(model.seen[1]!.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('does not exist') })
    expect(reply.undo).toBeUndefined()
  })

  it('searches Montandon, then adds the event it found near the view center', async () => {
    const { doc, person, chat } = board()
    const found = { id: 'gdacs-event-1', name: 'Flood in Nepal', type: 'flood', start: '2026-09-01', year: 2026, country: 'NPL', source: 'GDACS' }
    const searches: string[] = []
    const monty = { findEvents: async (text: string) => (searches.push(text), [found]) } as unknown as MontyClient
    const message = chat.send({ actor: ada, text: 'add the recent flood in Nepal', selection: [], center: { x: 1000, y: 500 } })
    const model = scripted(
      tools(call('events__search', { text: 'nepal flood' })),
      tools(call('event__add', { args: { eventId: found.id, x: 1000, y: 500 } })),
      { role: 'assistant', content: 'Added the Nepal flood.' },
    )
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete, [eventsSearch(monty)])

    expect(model.seen[0]![1]!.content).toContain('View center: (1000, 500)')
    expect(searches).toEqual(['nepal flood'])
    expect(model.seen[1]!.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('gdacs-event-1') })
    expect(person.board.list().find((o) => o.type === 'event')).toMatchObject({ eventId: found.id, x: 1000, y: 500 })
    expect(reply.calls.map((c) => [c.title ?? c.tool, c.status])).toEqual([
      ['Search events', 'applied'],
      ['event.add', 'applied'],
    ])
    expect(reply.undo!.created).toHaveLength(1)
  })

  it("finds a place, adds a map, and shows the place in the asker's view only", async () => {
    const { doc, chat } = board()
    const india = { west: 67.9, south: 6.6, east: 97.4, north: 35.7 }
    const geocoder: Geocoder = {
      forward: async () => [{ name: 'India', lngLat: [78, 21], bbox: [india.west, india.south, india.east, india.north], iso3: 'IND' }],
      reverse: async () => undefined,
    }
    const message = chat.send({ actor: ada, text: 'add a map and zoom to India', selection: [] })
    let map = ''
    const model: Complete = async (messages) => {
      const last = messages.at(-1)!
      if (last.role === 'user') return tools(call('data__geocode', { query: 'India' }))
      if (last.role === 'tool' && last.content.includes('India')) return tools(call('map__add', { args: { x: 0, y: 0 } }))
      if (!map && last.role === 'tool') {
        map = (JSON.parse(last.content) as { created: string[] }).created[0]!
        // No `for`: the agent acts for Ada, so it is her view.
        return tools(call('map__showArea', { ids: [map], args: india }))
      }
      return { role: 'assistant', content: 'Done.' }
    }
    new Views(doc).set('ben', 'nothing-yet', { center: [0, 0], zoom: 1, bearing: 0 })
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model, geocodeTools(geocoder))
    expect(reply.calls.map((c) => c.status)).toEqual(['applied', 'applied', 'applied'])
    const views = new Views(doc)
    expect(views.get(ada.id, map)?.zoom).toBeGreaterThan(2)
    expect(views.of(map).map((v) => v.person)).toEqual([ada.id])
  })

  it('puts adds without x and y in the middle of the view, and the next ones to the right', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'add a map and a box', selection: [], center: { x: 1000, y: 500 } })
    const model = scripted(tools(call('map__add', { args: {} }), call('box__add', { args: {} })), tools(call('text__add', { args: { x: 5, y: 600, text: 'here' } })))
    await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    const board_ = new Runtime({ doc, plugins, actor: ada }).board
    const map = board_.list().find((o) => o.type === 'map')!
    const box = board_.list().find((o) => o.type === 'box' && o.x > 900)!
    expect([map.x + map.w / 2, map.y + map.h / 2]).toEqual([1000, 500])
    expect([box.x, box.y + box.h / 2]).toEqual([map.x + map.w + 24, 500])
    // Given x and y in free space stay.
    expect(board_.list().find((o) => o.type === 'text')).toMatchObject({ x: 5, y: 600 })
  })

  it('refuses an add with a size far over its default, and lets the model try again', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'add a map', selection: [] })
    const model = scripted(tools(call('map__add', { args: { x: 0, y: 0, h: 4000.02 } })), tools(call('map__add', { args: { x: 0, y: 0 } })))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(reply.calls.map((c) => c.status)).toEqual(['failed', 'applied'])
    expect(model.seen[1]!.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Leave out w and h') })
    expect(new Runtime({ doc, plugins, actor: ada }).board.list().filter((o) => o.type === 'map').map((o) => o.h)).toEqual([360])
  })

  it('reports a failed search to the model', async () => {
    const { doc, chat } = board()
    const monty = { findEvents: async () => Promise.reject(new Error('Montandon search failed (401)')) } as unknown as MontyClient
    const message = chat.send({ actor: ada, text: 'add a flood', selection: [] })
    const model = scripted(tools(call('events__search', { text: 'flood' })))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete, [eventsSearch(monty)])
    expect(reply.calls).toEqual([{ tool: 'events__search', title: 'Search events', status: 'failed', error: 'Montandon search failed (401)' }])
    expect(model.seen[1]!.at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('401') })
  })

  it(`shows the last ${HISTORY_ENTRIES} chat entries of the last hour`, async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'now', selection: [] })
    const old: ChatEntry = { kind: 'user', id: 'old', actor: ada, text: 'too old', selection: [], at: message.at - HISTORY_MS }
    const recent = Array.from({ length: HISTORY_ENTRIES + 1 }, (_, i): ChatEntry => ({ kind: 'user', id: `m${i}`, actor: ben, text: `message ${i}`, selection: [], at: message.at - 1000 + i }))
    const model = scripted()
    await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete, [], [old, ...recent])
    const request = model.seen[0]![1]!.content as string
    expect(request).not.toContain('too old')
    expect(request).not.toContain('message 0\n')
    expect(request).toContain(`Recent chat, oldest first:\n- Ben: message 1\n`)
    expect(request).toContain(`- Ben: message ${HISTORY_ENTRIES}\n\nAda (person id ada) asks: now`)
  })

  it(`stops after ${MAX_STEPS} model calls`, async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'loop', selection: [] })
    const model = scripted(...Array.from({ length: 20 }, () => tools(call('board__get', {}))))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(model.seen).toHaveLength(MAX_STEPS)
    expect(reply.text).toMatch(/stopped after/)
  })

  it('keeps the undo data of writes made before the model failed', async () => {
    const { doc, chat, a } = board()
    const message = chat.send({ actor: ada, text: 'delete this', selection: [a] })
    const model = scripted(tools(call('core__object__delete', { ids: [a], args: {} })), new Error('OpenRouter 502'))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete)
    expect(reply.text).toMatch(/OpenRouter 502/)
    expect(Object.keys(reply.undo!.before)).toEqual([a])
  })
})

describe('placing what an agent adds', () => {
  const agent = (doc: Y.Doc) => new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })
  const overlap = (a: AnyObject, b: AnyObject) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  /** Pairs of objects (frames aside) that overlap, by type, to read in a failure. */
  const overlaps = (doc: Y.Doc) => {
    const objects = person(doc).board.list().filter((o) => o.type !== 'frame')
    return objects.flatMap((a, i) => objects.slice(i + 1).filter((b) => overlap(a, b)).map((b) => `${a.type} ${a.id} / ${b.type} ${b.id}`))
  }

  it("does not put a second turn's add on the first turn's", async () => {
    const { doc, chat } = board()
    const center = { x: 1000, y: 500 }
    await turn(agent(doc), chat.send({ actor: ada, text: 'add a map', selection: [], center }), scripted(tools(call('map__add', { args: {} }))).complete)
    await turn(agent(doc), chat.send({ actor: ada, text: 'add another', selection: [], center }), scripted(tools(call('map__add', { args: {} }))).complete)
    // Maps go below what is there, so the second is first in layer order.
    const [second, first] = person(doc).board.list().filter((o) => o.type === 'map')
    expect(overlaps(doc)).toEqual([])
    expect([first!.x + first!.w / 2, first!.y + first!.h / 2]).toEqual([1000, 500])
    // The nearest free spot: on the same row, to the right.
    expect(second).toMatchObject({ x: first!.x + first!.w + GAP, y: first!.y })
  })

  it('does not stack adds the model gave the view center as x and y', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'add three notes', selection: [], center: { x: 1000, y: 500 } })
    const note = (text: string) => call('sticky__add', { args: { x: 1000, y: 500, text } }, text)
    await turn(agent(doc), message, scripted(tools(note('a'), note('b'), note('c'))).complete)
    const notes = person(doc).board.list().filter((o) => o.type === 'sticky')
    expect(overlaps(doc)).toEqual([])
    // The first is where it was asked; the others to its right.
    expect(notes.map((o) => [o.x, o.y])).toEqual([
      [1000, 500],
      [1000 + 200 + GAP, 500],
      [1000 + 2 * (200 + GAP), 500],
    ])
  })

  it('moves an add down a row when its row is taken far to the right', async () => {
    const { doc, person: ada_, chat } = board()
    // A wall right of the three boxes, as wide as many notes.
    ada_.dispatch('box.add', canvas, { x: 800, y: 0, w: 4000, h: 120 })
    const message = chat.send({ actor: ada, text: 'add a note', selection: [] })
    await turn(agent(doc), message, scripted(tools(call('sticky__add', { args: { x: 0, y: 0, text: 'hi' } }))).complete)
    expect(overlaps(doc)).toEqual([])
    expect(person(doc).board.list().find((o) => o.type === 'sticky')).toMatchObject({ x: 0, y: 200 + GAP })
  })

  it('leaves an add in free space where it was asked', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'add a note', selection: [], center: { x: 1000, y: 500 } })
    await turn(agent(doc), message, scripted(tools(call('sticky__add', { args: { x: -500, y: 300, text: 'hi' } }))).complete)
    expect(person(doc).board.list().find((o) => o.type === 'sticky')).toMatchObject({ x: -500, y: 300 })
  })

  it('puts an add inside a frame where it was asked, and moves it only off the objects in the frame', async () => {
    const { doc, person: ada_, chat } = board()
    // A frame around the three boxes, with room below them.
    ada_.dispatch('frame.add', canvas, { x: -100, y: -100, w: 1000, h: 800 })
    const message = chat.send({ actor: ada, text: 'add notes in the frame', selection: [] })
    const note = (x: number, y: number) => call('sticky__add', { args: { x, y, text: `${x}` } }, `${x}`)
    await turn(agent(doc), message, scripted(tools(note(0, 300), note(600, 0))).complete)
    const [free, moved] = person(doc).board.list().filter((o) => o.type === 'sticky')
    expect(free).toMatchObject({ x: 0, y: 300 })
    // On the third box: the next free spot to its right is outside the frame's right edge.
    expect(moved).toMatchObject({ x: 800 + GAP, y: 0 })
    expect(overlaps(doc)).toEqual([])
  })

  it('goes below everything when no near row is free', () => {
    const wall = { x: -5000, y: -5000, w: 20000, h: 10000 }
    expect(freeSpot({ x: 0, y: 0, w: 200, h: 200 }, [wall])).toEqual({ x: 0, y: 5000 + GAP })
  })

  it('leaves a frame given x and y where it was asked, around what is there', async () => {
    const { doc, chat } = board()
    const message = chat.send({ actor: ada, text: 'frame these', selection: [] })
    await turn(agent(doc), message, scripted(tools(call('frame__add', { args: { x: -50, y: -50, w: 900, h: 300 } }))).complete)
    expect(person(doc).board.list().find((o) => o.type === 'frame')).toMatchObject({ x: -50, y: -50 })
  })

  it('moves a frame without x and y off what is in the middle of the view, frames too', async () => {
    const { doc, person: ada_, chat } = board()
    const empty = ada_.dispatch('frame.add', canvas, { x: 1000, y: -200, w: 800, h: 600 }).created![0]!
    const message = chat.send({ actor: ada, text: 'add a frame', selection: [], center: { x: 300, y: 60 } })
    await turn(agent(doc), message, scripted(tools(call('frame__add', { args: {} }))).complete)
    const frame = person(doc).board.list().find((o) => o.type === 'frame' && o.id !== empty)!
    expect(person(doc).board.list().filter((o) => o.id !== frame.id && overlap(o, frame))).toEqual([])
  })
})

describe('Agent', () => {
  const replies = (chat: Chat) => chat.list().filter((e): e is AgentReply => e.kind === 'agent')
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

  it('answers messages in order, one turn at a time, and reports when it is busy', async () => {
    const { doc, chat } = board()
    const busy: boolean[] = []
    let running = 0
    let most = 0
    const complete: Complete = async () => {
      most = Math.max(most, ++running)
      await settle()
      running--
      return { role: 'assistant', content: 'ok' }
    }
    new Agent({ doc, complete, onBusy: (b) => busy.push(b) })
    const first = chat.send({ actor: ada, text: 'one', selection: [] })
    const second = chat.send({ actor: ben, text: 'two', selection: [] })
    for (let i = 0; i < 10; i++) await settle()
    expect(replies(chat).map((r) => r.replyTo)).toEqual([first.id, second.id])
    expect(most).toBe(1)
    expect(busy).toEqual([true, false])
  })

  it('shows the earlier turns, so "the duplicate" can name an object that is not selected', async () => {
    const { doc, chat, a } = board()
    const model = scripted(tools(call('core__object__duplicate', { ids: [a], args: {} })), { role: 'assistant', content: 'Duplicated it.' })
    new Agent({ doc, complete: model.complete })
    chat.send({ actor: ada, text: 'duplicate this', selection: [a] })
    for (let i = 0; i < 10; i++) await settle()
    chat.send({ actor: ada, text: 'move the duplicate down', selection: [a] })
    for (let i = 0; i < 10; i++) await settle()
    const copy = replies(chat)[0]!.undo!.created[0]!
    const request = model.seen.at(-1)![1]!.content as string
    expect(request).toContain(`- Ada: duplicate this [selected: box ${a}]\n- Agent: Duplicated it. [core.object.duplicate on ${a}; added box ${copy}]`)
  })

  it('answers messages a lost turn left, without running them again', () => {
    const { doc, chat } = board()
    const lost = chat.send({ actor: ada, text: 'delete everything', selection: [] })
    new Agent({ doc, complete: async () => ({ role: 'assistant', content: 'should not run' }) })
    expect(replies(chat)).toMatchObject([{ replyTo: lost.id, text: 'Interrupted. Please ask again.' }])
  })

  it('says it is not configured without an API key', async () => {
    const { doc, chat } = board()
    new Agent({ doc, complete: undefined })
    chat.send({ actor: ada, text: 'hi', selection: [] })
    await settle()
    expect(replies(chat)[0]!.text).toMatch(/not configured/)
  })

  it(`answers at most ${TURNS_PER_HOUR} requests an hour`, async () => {
    const { doc, chat } = board()
    let calls = 0
    new Agent({ doc, complete: async () => (calls++, { role: 'assistant', content: 'ok' }), turnsPerHour: TURNS_PER_HOUR })
    for (let i = 0; i <= TURNS_PER_HOUR; i++) chat.send({ actor: ada, text: `${i}`, selection: [] })
    for (let i = 0; i < 50; i++) await settle()
    expect(calls).toBe(TURNS_PER_HOUR)
    expect(replies(chat).at(-1)!.text).toMatch(/this hour/)
  })

  it('has no turn limit without turnsPerHour (a person\'s own key)', async () => {
    const { doc, chat } = board()
    let calls = 0
    new Agent({ doc, complete: async () => (calls++, { role: 'assistant', content: 'ok' }) })
    for (let i = 0; i <= TURNS_PER_HOUR; i++) chat.send({ actor: ada, text: `${i}`, selection: [] })
    for (let i = 0; i < 60; i++) await settle()
    expect(calls).toBe(TURNS_PER_HOUR + 1)
  })

  it('answers only the messages it accepts: the room its own, each browser tab its own', async () => {
    const { doc, chat } = board()
    const answer = (who: string): Complete => async () => ({ role: 'assistant', content: who })
    new Agent({ doc, complete: answer('room') })
    new Agent({ doc, complete: answer('tab 1'), accepts: (m) => m.browserTab === 'tab-1' })
    const forRoom = chat.send({ actor: ada, text: 'a', selection: [] })
    const forTab1 = chat.send({ actor: ben, text: 'b', selection: [], browserTab: 'tab-1' })
    const forTab2 = chat.send({ actor: ben, text: 'c', selection: [], browserTab: 'tab-2' })
    for (let i = 0; i < 20; i++) await settle()
    const byMessage = Object.fromEntries(replies(chat).map((r) => [r.replyTo, r.text]))
    expect(byMessage).toEqual({ [forRoom.id]: 'room', [forTab1.id]: 'tab 1' })
    expect(chat.pending().map((m) => m.id)).toEqual([forTab2.id])
  })

  it('does not call a message of a browser tab interrupted when the room starts', () => {
    const { doc, chat } = board()
    const tab = chat.send({ actor: ada, text: 'hi', selection: [], browserTab: 'tab-1' })
    new Agent({ doc, complete: async () => ({ role: 'assistant', content: 'no' }) })
    expect(chat.pending().map((m) => m.id)).toEqual([tab.id])
  })
})

describe('chatCompletions', () => {
  function capture() {
    const sent: { url: string; headers: Headers }[] = []
    const original = globalThis.fetch
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: new Headers(init.headers) })
      return new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }] }))
    }) as typeof fetch
    return { sent, restore: () => (globalThis.fetch = original) }
  }

  it('sends the key and x-title to OpenRouter', async () => {
    const { sent, restore } = capture()
    try {
      await chatCompletions({ url: 'https://openrouter.ai/api/v1/', apiKey: 'sk-or-1', model: 'm' })([], [])
    } finally {
      restore()
    }
    expect(sent[0]!.url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(sent[0]!.headers.get('authorization')).toBe('Bearer sk-or-1')
    expect(sent[0]!.headers.get('x-title')).toBe('humanitarian-ttx')
  })

  it('sends no x-title to other servers, and no authorization without a key', async () => {
    const { sent, restore } = capture()
    try {
      await chatCompletions({ url: 'http://localhost:11434/v1', model: 'm' })([], [])
    } finally {
      restore()
    }
    expect(sent[0]!.url).toBe('http://localhost:11434/v1/chat/completions')
    expect([...sent[0]!.headers.keys()]).toEqual(['content-type'])
  })
})

describe('a browser agent on its own key', () => {
  it('keeps the key out of the board doc', async () => {
    const { doc, chat, a } = board()
    const key = 'sk-or-secret-123'
    const answers = [tools(call('core__object__delete', { ids: [a], args: {} })), { role: 'assistant', content: 'Deleted.' }]
    const original = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: answers.shift() }] }))) as typeof fetch
    try {
      new Agent({ doc, complete: chatCompletions({ url: 'https://openrouter.ai/api/v1', apiKey: key, model: 'm' }), accepts: (m) => m.browserTab === 'tab-1' })
      chat.send({ actor: ada, text: 'delete this', selection: [a], browserTab: 'tab-1' })
      for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0))
    } finally {
      globalThis.fetch = original
    }
    expect(chat.list().at(-1)).toMatchObject({ kind: 'agent', text: 'Deleted.' })
    expect(new TextDecoder().decode(Y.encodeStateAsUpdate(doc))).not.toContain(key)
  })
})

describe('undoing an agent turn', () => {
  /** A turn that moved a and added a box, stored as the agent's reply. */
  async function moved() {
    const b = board()
    const message = b.chat.send({ actor: ada, text: 'move this and add a box', selection: [b.a] })
    const model = scripted(tools(call('core__object__move', { ids: [b.a], args: { dx: 50 } }), call('box__add', { args: { x: 0, y: 500 } })))
    const reply = b.chat.reply(await turn(new Runtime({ doc: b.doc, plugins, actor: { kind: 'agent', id: 'agent' } }), message, model.complete))
    const added = reply.undo!.created[0]!
    return { ...b, reply, added }
  }

  it('puts back what the turn changed and removes what it added', async () => {
    const { person, reply, a, added } = await moved()
    const record = await person.invoke('agent.undoTurn', canvas, { replyId: reply.id })
    expect(record.status).toBe('applied')
    expect(person.board.get(a)!.x).toBe(0)
    expect(person.board.get(added)).toBeUndefined()
  })

  it('refuses, and changes nothing, when someone edited one of its objects since', async () => {
    const { person, reply, a, added } = await moved()
    // Another agent (or a person) moves the box the turn added.
    person.dispatch('core.object.move', { kind: 'objects', ids: [added] }, { dx: 5 })
    const record = await person.invoke('agent.undoTurn', canvas, { replyId: reply.id })
    expect(record).toMatchObject({ status: 'failed', error: expect.stringContaining(`box ${added}`) })
    expect(person.board.get(a)!.x).toBe(50)
    expect(person.board.get(added)).toBeDefined()
  })

  it('still undoes replies stored before `after` was kept', async () => {
    const { person, chat, a, added } = await moved()
    const { undo } = chat.list().at(-1) as AgentReply
    const old = chat.reply({ replyTo: 'x', text: 'old', calls: [], undo: { created: undo!.created, before: undo!.before } })
    person.dispatch('core.object.move', { kind: 'objects', ids: [added] }, { dx: 5 })
    expect((await person.invoke('agent.undoTurn', canvas, { replyId: old.id })).status).toBe('applied')
    expect(person.board.get(a)!.x).toBe(0)
  })
})

describe('skills and deferred tools', () => {
  const names = (t: FunctionTool[]) => t.map((x) => x.function.name)
  /** A model that gives these answers in turn, and records the tools and system prompt of each call. */
  function recording(...answers: Extract<Message, { role: 'assistant' }>[]) {
    const sent: string[][] = []
    const results: string[] = []
    let system = ''
    const complete: Complete = async (messages, tools) => {
      system = messages[0]!.content as string
      const last = messages.at(-1)!
      if (last.role === 'tool') results.push(last.content)
      sent.push(names(tools))
      return answers.shift() ?? { role: 'assistant', content: 'Done.' }
    }
    return { complete, sent, results, system: () => system }
  }
  const geocoder: Geocoder = { forward: async () => [], reverse: async () => undefined }

  it('sends the core tools first, and lists only the skills whose tools the agent has', async () => {
    const { doc, chat } = board()
    const m = recording()
    await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), chat.send({ actor: ada, text: 'hi', selection: [] }), m.complete, geocodeTools(geocoder))
    expect(m.sent[0]).toEqual(expect.arrayContaining(['tools__search', 'skills__read', 'box__add', 'map__add', 'core__object__delete', 'board__get']))
    expect(m.sent[0]).not.toContain('map__showArea')
    expect(m.sent[0]).not.toContain('data__geocode')
    // Geocoding is there, Montandon search is not.
    expect(m.system()).toContain('- show-place:')
    expect(m.system()).not.toContain('add-event')
  })

  it("gives a skill's steps and loads its tools for the next call", async () => {
    const { doc, chat } = board()
    const m = recording(tools(call('skills__read', { name: 'show-place' })))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), chat.send({ actor: ada, text: 'show Beira', selection: [] }), m.complete, geocodeTools(geocoder))
    expect(m.results[0]).toContain('data__geocode first')
    expect(m.sent[1]).toEqual(expect.arrayContaining(['data__geocode', 'map__showArea']))
    expect(reply.calls).toEqual([{ tool: 'skills__read', title: 'Read the show-place skill', status: 'applied' }])
  })

  it('loads the tools a search finds', async () => {
    const { doc, chat } = board()
    const m = recording(tools(call('tools__search', { query: 'road closure' })))
    await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), chat.send({ actor: ada, text: 'close the bridge', selection: [] }), m.complete)
    const found = (JSON.parse(m.results[0]!) as { loaded: { name: string }[] }).loaded.map((t) => t.name)
    expect(found[0]).toBe('map__addClosure')
    expect(found.length).toBeLessThanOrEqual(SEARCH_RESULTS)
    expect(m.sent[1]).toEqual(expect.arrayContaining(found))
    expect(m.sent[0]).not.toContain('map__addClosure')
  })

  it('runs a tool that is not loaded when the model names it', async () => {
    const { doc, person, chat } = board()
    const map = person.dispatch('map.add', canvas, { x: 0, y: 400 }).created![0]!
    const m = recording(tools(call('map__setBasemap', { ids: [map], args: { basemap: 'dark' } })))
    const reply = await turn(new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } }), chat.send({ actor: ada, text: 'make it dark', selection: [map] }), m.complete)
    expect(m.sent[0]).not.toContain('map__setBasemap')
    expect(reply.calls[0]).toMatchObject({ tool: 'map.setBasemap', status: 'applied' })
    expect(person.board.get(map)).toMatchObject({ basemap: 'dark' })
  })
})
