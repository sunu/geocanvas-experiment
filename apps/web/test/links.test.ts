import { describe, expect, it } from 'vitest'
import { connector } from '../src/canvas/Links'

describe('connector', () => {
  const event = { x: 0, y: 0, w: 380, h: 320 }

  it('joins objects side by side from the facing sides, at their middles', () => {
    const map = { x: 404, y: 0, w: 640, h: 520 }
    const { start, end } = connector(event, map)
    expect(start).toEqual({ x: 380, y: 160 })
    expect(end).toEqual({ x: 404, y: 260 })
    expect(connector(map, event).start).toEqual({ x: 404, y: 260 })
  })

  it('joins objects one above the other from bottom to top', () => {
    const country = { x: 0, y: 344, w: 380, h: 460 }
    const { start, end, path } = connector(event, country)
    expect(start).toEqual({ x: 190, y: 320 })
    expect(end).toEqual({ x: 190, y: 344 })
    // It leaves and enters square to the sides: the control points are straight below and above.
    expect(path).toBe('M 190 320 C 190 352, 190 312, 190 344')
  })
})
