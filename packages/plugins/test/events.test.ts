import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { plugins, type MapBoardObject } from '../src/index'

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
