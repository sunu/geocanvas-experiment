import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { agentActivities, CURSOR_INTERVAL, cursorSender, peersFrom, presenterOf } from '../src/board/presence'

describe('peersFrom', () => {
  const user = { name: 'Heron', color: '#2f9e44' }

  it('lists everyone else with a user, with their cursor and selection', () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { name: 'Me', color: '#000000' }, cursor: { x: 1, y: 2 } }],
      [2, { user, cursor: { x: 10, y: 20 }, selection: ['a', 'b'] }],
      [3, { user: { name: 'Wren', color: '#e03131' }, cursor: null }],
      [4, {}], // connected, no presence yet
    ])
    expect(peersFrom(states, 1)).toEqual([
      { clientId: 2, user, cursor: { x: 10, y: 20 }, selection: ['a', 'b'] },
      { clientId: 3, user: { name: 'Wren', color: '#e03131' }, selection: [] },
    ])
  })

  it("keeps the agent's status", () => {
    const agent = { kind: 'agent', id: 'agent', name: 'Agent', color: '#7c3aed' }
    const states = new Map<number, Record<string, unknown>>([[5, { user: agent, status: 'thinking' }]])
    expect(peersFrom(states, 1)).toEqual([{ clientId: 5, user: agent, selection: [], status: 'thinking' }])
  })

  it('keeps what a person presents, and drops it when malformed or from an agent', () => {
    const presenting = { view: { x: 0, y: 0, w: 800, h: 600 }, since: 5 }
    const states = new Map<number, Record<string, unknown>>([
      [2, { user, presenting }],
      [3, { user, presenting: { view: { x: 0, y: 0, w: 0, h: 600 }, since: 5 } }],
      [4, { user, presenting: null }],
      [5, { user: { kind: 'agent', id: 'agent', name: 'Agent', color: '#7c3aed' }, presenting }],
    ])
    expect(peersFrom(states, 1).map((p) => p.presenting)).toEqual([presenting, undefined, undefined, undefined])
  })
})

describe('presenterOf', () => {
  const user = { kind: 'user' as const, id: 'heron', name: 'Heron', color: '#2f9e44' }
  const view = { x: 0, y: 0, w: 1, h: 1 }

  it('picks whoever started presenting last', () => {
    const peers = [
      { clientId: 2, user, selection: [], presenting: { view, since: 1 } },
      { clientId: 3, user, selection: [], presenting: { view, since: 9 } },
      { clientId: 4, user, selection: [] },
    ]
    expect(presenterOf(peers)?.clientId).toBe(3)
    expect(presenterOf([peers[2]!])).toBeUndefined()
  })
})

describe('cursorSender', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends at most once per interval, and always the last position', () => {
    const sent: unknown[] = []
    const send = cursorSender({ setLocalStateField: (_k: string, v: unknown) => sent.push(v) })
    send({ x: 1, y: 1 }) // first one goes at once
    send({ x: 2, y: 2 })
    send({ x: 3, y: 3 })
    expect(sent).toEqual([{ x: 1, y: 1 }])
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    expect(sent).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }])
    send(null) // pointer left the canvas
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    expect(sent).toEqual([{ x: 1, y: 1 }, { x: 3, y: 3 }, null])
  })
})

describe('agentActivities', () => {
  it("keys each agent's activity by its cursor: the room's agent by whom it works for, a browser agent by its person", () => {
    const states = new Map<number, Record<string, unknown>>([
      [1, { user: { kind: 'agent', id: 'agent', name: 'Agent' }, status: 'thinking', activity: 'Search events', for: 'ada' }],
      [2, { user: { kind: 'user', id: 'ben', name: 'Ben' }, status: 'thinking', activity: 'Thinking' }],
      [3, { user: { kind: 'user', id: 'cy', name: 'Cy' }, cursor: { x: 1, y: 2 } }],
      [4, { user: { kind: 'agent', id: 'agent', name: 'Agent' }, status: 'thinking' }], // between turns, no activity yet
    ])
    expect(agentActivities(states)).toEqual(new Map([
      ['agent:ada', 'Search events'],
      ['agent:ben', 'Thinking'],
    ]))
  })
})
