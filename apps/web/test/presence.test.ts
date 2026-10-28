import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURSOR_INTERVAL, cursorSender, loadUser, peersFrom } from '../src/board/presence'

describe('loadUser', () => {
  const store = new Map<string, string>()
  beforeEach(() => {
    store.clear()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('picks a name and color once, then keeps them', () => {
    const first = loadUser(() => 0)
    expect(first.name).toMatch(/^[A-Z][a-z]+$/)
    expect(first.color).toMatch(/^#[0-9a-f]{6}$/)
    expect(loadUser(() => 0.99)).toEqual(first)
  })

  it('still works when storage is unavailable', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(loadUser(() => 0)).toMatchObject({ name: expect.any(String), color: expect.any(String) })
  })
})

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
