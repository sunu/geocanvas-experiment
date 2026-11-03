import { describe, expect, it } from 'vitest'
import { fitView, toScreen } from '../src/canvas/camera'

describe('fitView', () => {
  it("shows all of another person's view, centered, past 100%", () => {
    const view = { x: 100, y: 100, w: 400, h: 200 }
    const cam = fitView(view, 1200, 900)
    expect(cam.z).toBe(3)
    expect(toScreen(cam, view)).toEqual({ x: 0, y: 150, w: 1200, h: 600 })
  })
})
