import { describe, expect, it } from 'vitest'
import type { OplogEntry } from '@ttx/core'
import { agentStep, AgentCursors, askStep, busyText, DWELL_MS, hoverOffset, IDLE_MS, MAX_WAIT_MS, MIN_BUSY_MS, TRAVEL_MS, type AgentStep } from '../src/canvas/agentCursor'

const agent = { kind: 'agent' as const, id: 'agent', name: 'Agent', color: '#8e51ff', onBehalfOf: 'p1' }
const rects: Record<string, { x: number; y: number; w: number; h: number }> = {
  a: { x: 0, y: 0, w: 100, h: 100 },
  b: { x: 200, y: 0, w: 100, h: 50 },
}
const rectOf = (id: string) => rects[id]

function entry(over: Partial<Extract<OplogEntry, { kind: 'invocation' }>> = {}): OplogEntry {
  return { kind: 'invocation', id: 'e', opId: 'core.sticky.add', actor: agent, target: { kind: 'canvas' }, args: {}, status: 'applied', at: 0, ...over }
}

const step = (x: number, y: number, created: string[] = [], ids = created, label?: string): AgentStep => ({ key: 'agent:p1', name: 'Agent', color: '#8e51ff', point: { x, y }, created, ids, ...(label && { label }) })

describe('agentStep', () => {
  it('points near the bottom-right corner of what an agent added', () => {
    expect(agentStep(entry({ created: ['a'] }), rectOf, () => 'Generating sticky note…')).toMatchObject({ key: 'agent:p1', point: { x: 75, y: 75 }, created: ['a'], ids: ['a'], label: 'Generating sticky note…' })
  })

  it('points at the objects it changed when it added none', () => {
    const s = agentStep(entry({ opId: 'core.object.move', target: { kind: 'objects', ids: ['a', 'b'] } }), rectOf)
    expect(s).toMatchObject({ point: { x: 252, y: 75 }, created: [], ids: ['a', 'b'] })
  })

  it('gives nothing for people, failed calls, or objects that are gone', () => {
    expect(agentStep(entry({ actor: { kind: 'user', id: 'p1' }, created: ['a'] }), rectOf)).toBeUndefined()
    expect(agentStep(entry({ status: 'failed', created: ['a'] }), rectOf)).toBeUndefined()
    expect(agentStep(entry({ target: { kind: 'objects', ids: ['gone'] } }), rectOf)).toBeUndefined()
    expect(agentStep(entry(), rectOf)).toBeUndefined()
    expect(agentStep({ kind: 'undo', invocationId: 'e', actor: agent, at: 0 }, rectOf)).toBeUndefined()
  })
})

describe('busyText', () => {
  it('says what the agent generates for an add, else the op', () => {
    expect(busyText('Add map', 'Map')).toBe('Generating map…')
    expect(busyText('Add sticky note', 'Sticky note')).toBe('Generating sticky note…')
    expect(busyText('Add ReliefWeb updates', 'ReliefWeb updates')).toBe('Generating ReliefWeb updates…')
    expect(busyText('Add data layer')).toBe('Add data layer…')
  })
})

describe('askStep', () => {
  it("starts the agent's cursor for the asker, in the middle of their view", () => {
    const message = { kind: 'user' as const, id: 'm', actor: { kind: 'user' as const, id: 'p1' }, text: 'hi', selection: [], center: { x: 10, y: 20 }, at: 0 }
    expect(askStep(message)).toMatchObject({ key: 'agent:p1', point: { x: 10, y: 20 }, ids: [] })
    expect(askStep({ ...message, center: undefined })).toBeUndefined()
  })
})

const busyIds = (c: AgentCursors, t: number) => new Set(c.busy(t).keys())

describe('AgentCursors', () => {
  /** Cursors that see these ids as loading. */
  const withLoading = (...ids: string[]) => {
    const loading = new Set(ids)
    return { loading, c: new AgentCursors({ loading: (id) => loading.has(id) }) }
  }

  it('arrives at its place, floating all along, moving or not', () => {
    const c = new AgentCursors()
    c.add(step(100, 100), 0)
    const [moving] = c.at(TRAVEL_MS / 2)
    expect(moving!.x).toBeLessThan(100)
    expect(moving!.floating).toBe(TRAVEL_MS / 2)
    expect(c.at(TRAVEL_MS)[0]).toMatchObject({ x: 100, y: 100 })
    expect(c.at(TRAVEL_MS + 500)[0]!.floating).toBe(TRAVEL_MS + 500)
  })

  it('plays a burst in order, staying at each object while it is busy', () => {
    const c = new AgentCursors()
    c.add(step(100, 0, ['a']), 0)
    c.add(step(500, 0, ['b']), 0)
    expect(c.arriving(0)).toEqual(new Set(['a', 'b']))
    // The second move waits for the first to arrive and place its object: 'a' is busy for MIN_BUSY_MS.
    expect(c.at(TRAVEL_MS + MIN_BUSY_MS - 1)[0]).toMatchObject({ x: 100 })
    expect(busyIds(c, TRAVEL_MS + MIN_BUSY_MS - 1)).toEqual(new Set(['a']))
    expect(c.arriving(TRAVEL_MS)).toEqual(new Set(['b']))
    const bArrives = 2 * TRAVEL_MS + MIN_BUSY_MS
    expect(c.at(bArrives)[0]).toMatchObject({ x: 500 })
    expect(c.arriving(bArrives).size).toBe(0)
  })

  it('goes on after a short pause from a step with no objects (where someone asked)', () => {
    const c = new AgentCursors()
    c.add(step(0, 0), 0)
    c.add(step(500, 0, ['b']), 0)
    expect(c.at(TRAVEL_MS + DWELL_MS + TRAVEL_MS)[0]).toMatchObject({ x: 500 })
  })

  it('waits at an object while its data loads, then moves on', () => {
    const { c, loading } = withLoading('a')
    c.add(step(100, 0, ['a'], ['a'], 'Add data layer'), 0)
    c.add(step(500, 0, ['b']), 0)
    expect(c.at(2000)[0]).toMatchObject({ x: 100, placing: true })
    expect(c.arriving(2000)).toEqual(new Set(['b']))
    loading.delete('a')
    // It leaves when it sees the data in.
    expect(c.at(2000)[0]).toMatchObject({ x: 100 })
    expect(c.at(2000 + TRAVEL_MS)[0]).toMatchObject({ x: 500 })
    expect(c.arriving(2000 + TRAVEL_MS).size).toBe(0)
  })

  it('does not wait for loading when the next step is on the same object', () => {
    const { c } = withLoading('m')
    c.add(step(100, 0, ['m'], ['m'], 'Generating map…'), 0)
    c.add(step(100, 0, [], ['m'], 'Add data layer…'), 0)
    expect(c.busy(TRAVEL_MS).get('m')).toBe('Generating map…')
    expect(c.busy(TRAVEL_MS + DWELL_MS + TRAVEL_MS).get('m')).toBe('Add data layer…')
  })

  it('glides to a step that comes in after a pause, from where it waited, and places it', () => {
    const c = new AgentCursors()
    c.add(step(100, 0, ['a']), 0)
    const working = new Set(['agent:p1'])
    // The model thinks for 5 s; the cursor waits at 'a'.
    expect(c.at(5000, working)[0]).toMatchObject({ x: 100 })
    c.add(step(500, 0, ['b']), 5000)
    expect(c.arriving(5000)).toEqual(new Set(['b']))
    expect(c.at(5000 + TRAVEL_MS / 2, working)[0]!.x).toBeGreaterThan(100)
    expect(c.at(5000 + TRAVEL_MS / 2, working)[0]!.x).toBeLessThan(500)
    expect(busyIds(c, 5000 + TRAVEL_MS)).toEqual(new Set(['b']))
  })

  it(`moves on after ${MAX_WAIT_MS} ms if the data is still loading`, () => {
    const { c } = withLoading('a')
    c.add(step(100, 0, ['a']), 0)
    c.add(step(500, 0, ['b']), 0)
    const leaves = TRAVEL_MS + MAX_WAIT_MS
    expect(c.nextChange(TRAVEL_MS + MIN_BUSY_MS + 1)).toBe(leaves)
    expect(c.at(leaves - 1)[0]).toMatchObject({ x: 100 })
    expect(c.at(leaves + TRAVEL_MS)[0]).toMatchObject({ x: 500 })
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

  it('jumps, draws objects at once and does not hover with reduced motion', () => {
    const c = new AgentCursors({ reduced: true })
    c.add(step(100, 100, ['a']), 0)
    expect(c.at(0)[0]).toMatchObject({ x: 100, y: 100, opacity: 1 })
    expect(c.at(5000)[0]!.floating).toBeUndefined()
    expect(c.arriving(0).size).toBe(0)
  })

  it('stays while its agent is at work, and fades once it stops', () => {
    const c = new AgentCursors()
    c.add(step(0, 0), 0)
    const working = new Set(['agent:p1'])
    const later = TRAVEL_MS + IDLE_MS * 3
    expect(c.at(later, working)).toHaveLength(1)
    expect(c.active(later)).toBe(true)
    expect(c.at(later + IDLE_MS - 1)).toHaveLength(1)
    expect(c.at(later + IDLE_MS)).toEqual([])
  })

  it('is placing while at its busy objects, which say what it does; then its tag can say it', () => {
    const c = new AgentCursors()
    c.add(step(100, 0, ['a'], ['a'], 'Generating map…'), 0)
    expect(c.at(TRAVEL_MS / 2)[0]!.placing).toBe(false)
    expect(c.at(TRAVEL_MS)[0]!.placing).toBe(true)
    expect(c.busy(TRAVEL_MS)).toEqual(new Map([['a', 'Generating map…']]))
    expect(c.at(TRAVEL_MS + MIN_BUSY_MS - 1)[0]!.placing).toBe(true)
    expect(c.at(TRAVEL_MS + MIN_BUSY_MS)[0]!.placing).toBe(false)
  })

  it('keeps an object busy a moment once the cursor is there, and while it loads', () => {
    const { c, loading } = withLoading('b')
    c.add(step(100, 0, ['a']), 0)
    c.add(step(500, 0, [], ['b']), 0)
    // Nothing is busy before its cursor arrives.
    expect(busyIds(c, TRAVEL_MS - 1)).toEqual(new Set())
    expect(busyIds(c, TRAVEL_MS)).toEqual(new Set(['a']))
    // The cursor leaves 'a' as its busy minimum ends.
    const bArrives = 2 * TRAVEL_MS + MIN_BUSY_MS
    expect(busyIds(c, bArrives)).toEqual(new Set(['b']))
    // 'b' stays busy while it loads.
    expect(busyIds(c, bArrives + MIN_BUSY_MS)).toEqual(new Set(['b']))
    loading.delete('b')
    expect(busyIds(c, bArrives + MIN_BUSY_MS)).toEqual(new Set())
    // Forgotten once done: loading later, not caused by the agent, does not show it busy again.
    loading.add('b')
    expect(busyIds(c, bArrives + MIN_BUSY_MS + 1)).toEqual(new Set())
  })
})

describe('hoverOffset', () => {
  it('starts where the cursor appears, eases in, and stays within a few pixels', () => {
    expect(hoverOffset(0)).toEqual({ x: 0, y: 0 })
    const drifts = Array.from({ length: 100 }, (_, i) => hoverOffset(i * 97))
    expect(Math.max(...drifts.map((d) => Math.abs(d.x)))).toBeGreaterThan(3)
    expect(drifts.every((d) => Math.abs(d.x) <= 6 && Math.abs(d.y) <= 3)).toBe(true)
  })
})
