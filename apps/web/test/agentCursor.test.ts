import { describe, expect, it } from 'vitest'
import type { OplogEntry } from '@ttx/core'
import { agentStep, AgentCursors, DWELL_MS, IDLE_MS, TRAVEL_MS, type AgentStep } from '../src/canvas/agentCursor'

const agent = { kind: 'agent' as const, id: 'agent', name: 'Agent', color: '#8e51ff', onBehalfOf: 'p1' }
const rects: Record<string, { x: number; y: number; w: number; h: number }> = {
  a: { x: 0, y: 0, w: 100, h: 100 },
  b: { x: 200, y: 0, w: 100, h: 50 },
}
const rectOf = (id: string) => rects[id]

function entry(over: Partial<Extract<OplogEntry, { kind: 'invocation' }>> = {}): OplogEntry {
  return { kind: 'invocation', id: 'e', opId: 'core.sticky.add', actor: agent, target: { kind: 'canvas' }, args: {}, status: 'applied', at: 0, ...over }
}

const step = (x: number, y: number, created: string[] = []): AgentStep => ({ key: 'agent:p1', name: 'Agent', color: '#8e51ff', point: { x, y }, created })

describe('agentStep', () => {
  it('points at the middle of what an agent added', () => {
    expect(agentStep(entry({ created: ['a'] }), rectOf)).toMatchObject({ key: 'agent:p1', point: { x: 50, y: 50 }, created: ['a'] })
  })

  it('points at the objects it changed when it added none', () => {
    const s = agentStep(entry({ opId: 'core.object.move', target: { kind: 'objects', ids: ['a', 'b'] } }), rectOf)
    expect(s).toMatchObject({ point: { x: 150, y: 50 }, created: [] })
  })

  it('gives nothing for people, failed calls, or objects that are gone', () => {
    expect(agentStep(entry({ actor: { kind: 'user', id: 'p1' }, created: ['a'] }), rectOf)).toBeUndefined()
    expect(agentStep(entry({ status: 'failed', created: ['a'] }), rectOf)).toBeUndefined()
    expect(agentStep(entry({ target: { kind: 'objects', ids: ['gone'] } }), rectOf)).toBeUndefined()
    expect(agentStep(entry(), rectOf)).toBeUndefined()
    expect(agentStep({ kind: 'undo', invocationId: 'e', actor: agent, at: 0 }, rectOf)).toBeUndefined()
  })
})

describe('AgentCursors', () => {
  it('arrives at its place, then waits there', () => {
    const c = new AgentCursors()
    c.add(step(100, 100), 0)
    const [moving] = c.at(TRAVEL_MS / 2)
    expect(moving!.working).toBe(false)
    expect(moving!.x).toBeLessThan(100)
    expect(c.at(TRAVEL_MS)[0]).toMatchObject({ x: 100, y: 100, working: true })
  })

  it('plays a burst in order, one place after another', () => {
    const c = new AgentCursors()
    c.add(step(100, 0, ['a']), 0)
    c.add(step(500, 0, ['b']), 0)
    expect(c.arriving(0)).toEqual(new Set(['a', 'b']))
    // The second move waits for the first to arrive and dwell.
    expect(c.at(TRAVEL_MS + DWELL_MS / 2)[0]).toMatchObject({ x: 100 })
    expect(c.arriving(TRAVEL_MS)).toEqual(new Set(['b']))
    expect(c.nextArrival(TRAVEL_MS)).toBe(2 * TRAVEL_MS + DWELL_MS)
    expect(c.at(2 * TRAVEL_MS + DWELL_MS)[0]).toMatchObject({ x: 500 })
    expect(c.arriving(2 * TRAVEL_MS + DWELL_MS).size).toBe(0)
  })

  it('fades out and goes once the agent stops', () => {
    const c = new AgentCursors()
    c.add(step(0, 0), 0)
    const end = TRAVEL_MS + IDLE_MS
    expect(c.active(end - 1)).toBe(true)
    expect(c.at(end - 100)[0]!.opacity).toBeLessThan(1)
    expect(c.at(end)).toEqual([])
    expect(c.active(end)).toBe(false)
  })

  it('keeps one cursor per agent and person', () => {
    const c = new AgentCursors()
    c.add(step(0, 0), 0)
    c.add({ ...step(0, 0), key: 'agent:p2' }, 0)
    expect(c.at(10)).toHaveLength(2)
  })

  it('jumps and draws objects at once with reduced motion', () => {
    const c = new AgentCursors(true)
    c.add(step(100, 100, ['a']), 0)
    expect(c.at(0)[0]).toMatchObject({ x: 100, y: 100, opacity: 1 })
    expect(c.arriving(0).size).toBe(0)
  })
})
