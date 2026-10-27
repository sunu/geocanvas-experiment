import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLiveSearch, type LiveState } from '../src/events/liveSearch'

/** A search the test settles by hand, so that responses can arrive out of order. */
function manualSearch() {
  const calls: { text: string; resolve: (v: string[]) => void; reject: (e: unknown) => void }[] = []
  const search = (text: string) => new Promise<string[]>((resolve, reject) => calls.push({ text, resolve, reject }))
  return { calls, search }
}

function setup(delayMs = 200) {
  const api = manualSearch()
  const states: LiveState<string[]>[] = []
  const live = createLiveSearch(api.search, (s) => states.push(s), delayMs)
  return { ...api, states, live, last: () => states[states.length - 1]! }
}

const settle = () => vi.advanceTimersByTimeAsync(0)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('live search', () => {
  it('searches once, for the last text, after typing stops', async () => {
    const t = setup()
    t.live.update('n')
    await vi.advanceTimersByTimeAsync(100)
    t.live.update('ne')
    await vi.advanceTimersByTimeAsync(100)
    t.live.update('nepal')
    expect(t.calls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(200)
    expect(t.calls.map((c) => c.text)).toEqual(['nepal'])
  })

  it('shows loading while it waits, then the results', async () => {
    const t = setup()
    t.live.update('nepal')
    expect(t.last()).toEqual({ loading: true })
    await vi.advanceTimersByTimeAsync(200)
    t.calls[0]!.resolve(['a', 'b'])
    await settle()
    expect(t.last()).toEqual({ loading: false, results: ['a', 'b'] })
  })

  it('keeps the previous results on screen while the next search loads', async () => {
    const t = setup()
    t.live.update('nepal')
    await vi.advanceTimersByTimeAsync(200)
    t.calls[0]!.resolve(['nepal events'])
    await settle()
    t.live.update('nepal floods')
    expect(t.last()).toEqual({ loading: true, results: ['nepal events'] })
  })

  it('ignores a response that arrives after a newer search was asked for', async () => {
    const t = setup()
    t.live.update('nep')
    await vi.advanceTimersByTimeAsync(200)
    t.live.update('nepal')
    await vi.advanceTimersByTimeAsync(200)
    expect(t.calls.map((c) => c.text)).toEqual(['nep', 'nepal'])
    t.calls[1]!.resolve(['nepal events'])
    await settle()
    t.calls[0]!.resolve(['nep events'])
    await settle()
    expect(t.last()).toEqual({ loading: false, results: ['nepal events'] })
  })

  it('drops the results when the text is cleared, even if a search is still running', async () => {
    const t = setup()
    t.live.update('nepal')
    await vi.advanceTimersByTimeAsync(200)
    t.live.update('  ')
    expect(t.last()).toEqual({ loading: false })
    t.calls[0]!.resolve(['late'])
    await settle()
    expect(t.last()).toEqual({ loading: false })
  })

  it('reports a failed search and keeps the previous results', async () => {
    const t = setup()
    t.live.update('a')
    await vi.advanceTimersByTimeAsync(200)
    t.calls[0]!.resolve(['a events'])
    await settle()
    t.live.update('ab')
    await vi.advanceTimersByTimeAsync(200)
    const error = new Error('offline')
    t.calls[1]!.reject(error)
    await settle()
    expect(t.last()).toEqual({ loading: false, results: ['a events'], error })
  })

  it('says nothing after it is disposed', async () => {
    const t = setup()
    t.live.update('nepal')
    await vi.advanceTimersByTimeAsync(200)
    const before = t.states.length
    t.live.dispose()
    t.calls[0]!.resolve(['late'])
    await settle()
    expect(t.states).toHaveLength(before)
  })
})
