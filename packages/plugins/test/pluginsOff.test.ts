import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Chat, Runtime, ToolRunner } from '@ttx/core'
import { Agent, AGENT_OFF, agentTools, availableSkills, boardGet, eventsSearch, openeoCollections, openeoCoverage, openeoPreview, plugins } from '../src/index'
import type { MontyClient } from '../src/monty/client'

const canvas = { kind: 'canvas' } as const

/** A person's runtime and an agent's on one board. */
function board() {
  const doc = new Y.Doc()
  const person = new Runtime({ doc, plugins, actor: { kind: 'user', id: 'p1' } })
  const agent = new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })
  const turnOff = (...disabled: string[]) => person.dispatch('board.setPlugins', canvas, { disabled })
  return { person, agent, turnOff }
}

const offered = (runtime: Runtime) => new Set(runtime.availableOps(canvas).map((op) => op.id))

describe('plugins turned off on a board', () => {
  it('are off with every optional plugin that needs them, never the ones that are not optional', () => {
    const { person, turnOff } = board()
    turnOff('map', 'notebooks', 'nope')
    expect([...person.disabledPlugins()]).toEqual(['notebooks'])
    turnOff('events')
    expect(person.disabledPlugins().has('events')).toBe(true)
    // Templates need only core, map and links: each template needs its own nodes' plugins.
    expect(person.disabledPlugins().has('templates')).toBe(false)
  })

  it('are not offered in the palette, and their tool calls are refused', async () => {
    const { person, agent, turnOff } = board()
    expect(offered(person).has('event.add')).toBe(true)
    turnOff('events')
    expect(offered(person).has('event.add')).toBe(false)
    expect(offered(person).has('map.add')).toBe(true)
    const r = await agent.callTool('event__add', { args: {} })
    expect(r.status).toBe('failed')
    expect(r.error).toMatch(/turned off/)
  })

  it('leave their objects working through dispatch', () => {
    const { person, turnOff } = board()
    const added = person.dispatch('image.add', canvas, {})
    turnOff('images')
    const id = added.created![0]!
    expect(person.dispatch('core.object.rename', { kind: 'objects', ids: [id] }, { name: 'Photo' }).status).toBe('applied')
    expect(person.dispatch('image.add', canvas, {}).status).toBe('applied')
  })

  it('cannot be changed by an agent', async () => {
    const { agent } = board()
    expect((await agent.callTool('board__setPlugins', { args: { disabled: ['events'] } })).status).toBe('failed')
    expect(agent.board.disabledPlugins).toEqual([])
  })

  it('take templates that add their objects out, and keep the others', () => {
    const { person, turnOff } = board()
    turnOff('reliefweb')
    expect(offered(person).has('template.sitrep')).toBe(false)
    expect(offered(person).has('template.conflict')).toBe(true)
  })

  it('give an agent none of their ops, tools or skills', () => {
    const { agent, turnOff } = board()
    const tools = new ToolRunner([
      boardGet(agent),
      eventsSearch({} as MontyClient),
      openeoCollections('https://openeo.test'),
      openeoCoverage('https://openeo.test'),
      openeoPreview(async () => new Response()),
    ])
    const names = () => new Set(agentTools(agent, tools).map((t) => t.function.name))
    expect(names().has('openeo__collections')).toBe(true)
    expect(availableSkills(names()).map((s) => s.name)).toContain('satellite-imagery')
    turnOff('openeo', 'events')
    const after = names()
    expect(after.has('openeo__collections')).toBe(false)
    expect(after.has('openeo__proposeGraph')).toBe(false)
    expect(after.has('events__search')).toBe(false)
    expect(after.has('event__add')).toBe(false)
    expect(after.has('map__add')).toBe(true)
    expect(availableSkills(after).map((s) => s.name)).not.toContain('satellite-imagery')
  })

  it('stop the agent answering, without a model call', async () => {
    const doc = new Y.Doc()
    const person = new Runtime({ doc, plugins, actor: { kind: 'user', id: 'ada' } })
    person.dispatch('board.setPlugins', canvas, { disabled: ['agent'] })
    let calls = 0
    new Agent({ doc, complete: async () => (calls++, { role: 'assistant', content: 'Hi' }) })
    const chat = new Chat(doc)
    chat.send({ actor: { kind: 'user', id: 'ada' }, text: 'add a map', selection: [] })
    for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0))
    expect(calls).toBe(0)
    expect(chat.list().at(-1)).toMatchObject({ kind: 'agent', text: AGENT_OFF })
  })
})
