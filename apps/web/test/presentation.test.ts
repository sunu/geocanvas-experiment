import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CURSOR_INTERVAL } from '../src/board/presence'
import { bindPresence, follow, followedMap, presentation, presentMap, presentView, setFollowed, startPresenting, stopPresenting } from '../src/canvas/presentation'

describe('presentation', () => {
  const view = { x: 0, y: 0, w: 800, h: 600 }
  const map = { id: 'm1', center: [85.3, 27.7] as [number, number], zoom: 9, bearing: 0 }
  let sent: unknown[]
  let unbind: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    sent = []
    unbind = bindPresence({ setLocalStateField: (_k: string, v: unknown) => sent.push(v) })
  })
  afterEach(() => {
    stopPresenting()
    unbind()
    vi.useRealTimers()
  })

  it('sends nothing until this person presents', () => {
    presentView(view)
    expect(sent).toEqual([])
  })

  it("sends the canvas's view, the focus and the map in one field, then null when they stop", () => {
    startPresenting()
    const since = presentation().presenting
    presentView(view, 'm1')
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    presentMap(map)
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    stopPresenting()
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    expect(sent).toEqual([{ view, since, focus: 'm1' }, { view, since, focus: 'm1', map }, null])
  })

  it('stops presenting to follow someone', () => {
    startPresenting()
    presentView(view)
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    follow(7)
    vi.advanceTimersByTime(CURSOR_INTERVAL)
    expect(sent.at(-1)).toBeNull()
    expect(presentation()).toMatchObject({ presenting: null, following: 7 })
  })

  it("gives a map the followed presenter's view of it only", () => {
    setFollowed({ view, since: 1, map })
    expect(followedMap('m1')).toEqual(map)
    expect(followedMap('m2')).toBeUndefined()
    setFollowed(undefined)
    expect(followedMap('m1')).toBeUndefined()
  })
})
