import { describe, expect, it } from 'vitest'
import { withFramed } from '../src/canvas/camera'

const o = (id: string, type: string, x: number, y: number, w: number, h: number) => ({ id, type, x, y, w, h })

describe('withFramed', () => {
  const frame = o('f', 'frame', 0, 0, 500, 400)
  const inner = o('g', 'frame', 50, 50, 200, 200)
  const nested = o('n', 'sticky', 60, 60, 100, 100)
  const inside = o('a', 'map', 300, 50, 150, 150)
  const across = o('b', 'event', 450, 50, 100, 100)
  const outside = o('c', 'text', 600, 0, 100, 40)
  const all = [frame, inner, nested, inside, across, outside]

  it('moves what is wholly inside a moved frame, nested frames and their contents too', () => {
    expect(withFramed(all, new Set(['f'])).map((x) => x.id)).toEqual(['f', 'g', 'n', 'a'])
  })

  it('moves only the selection when no frame is moved', () => {
    expect(withFramed(all, new Set(['a', 'c'])).map((x) => x.id)).toEqual(['a', 'c'])
  })

  it('moves an inner frame without its outer frame', () => {
    expect(withFramed(all, new Set(['g'])).map((x) => x.id)).toEqual(['g', 'n'])
  })
})
