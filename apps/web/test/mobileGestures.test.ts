import { describe, expect, it } from 'vitest'
import { toWorld } from '../src/canvas/camera'
import { pan, pinch } from '../src/mobile/gestures'

describe('canvas gestures', () => {
  const start = { x: 10, y: 20, z: 1 }

  it('pans by the finger’s travel', () => {
    expect(pan(start, { x: 100, y: 100 }, { x: 130, y: 90 })).toEqual({ x: 40, y: 10, z: 1 })
  })

  it('zooms by the fingers’ spread, keeping the point between them under them', () => {
    const cam = pinch(start, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 50, y: 100 }, { x: 250, y: 100 }])
    expect(cam.z).toBe(2)
    expect(toWorld(cam, 150, 100)).toEqual(toWorld(start, 150, 100))
  })

  it('pans while pinching when both fingers move', () => {
    const cam = pinch(start, [{ x: 100, y: 100 }, { x: 200, y: 100 }], [{ x: 120, y: 140 }, { x: 220, y: 140 }])
    expect(cam).toEqual({ x: 30, y: 60, z: 1 })
  })
})
