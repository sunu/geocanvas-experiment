import { describe, expect, it } from 'vitest'
import { toScreen } from '../src/canvas/camera'
import { fillCamera, focusArea, focusedLayout, PANEL_W } from '../src/canvas/focus'

describe('focus geometry', () => {
  const area = focusArea(1600, 900)
  const map = { x: 400, y: -200, w: 520, h: 360 }

  it('leaves room for the Options panel on the right', () => {
    expect(area.x + area.w).toBeLessThan(1600 - PANEL_W)
    expect(area.h).toBeLessThan(900)
  })

  it('fills the screen to its edges for a full-screen type (a report), still left of the Options panel', () => {
    const full = focusArea(1600, 900, { full: true })
    expect(full).toMatchObject({ x: 0, y: 0, h: 900 })
    // Both stop one gap short of the Options panel.
    expect(full.x + full.w).toBe(area.x + area.w)
    expect(full.x + full.w).toBeLessThan(1600 - PANEL_W)
  })

  it('zooms an object until it fills the area, centered', () => {
    const r = toScreen(fillCamera(map, area), map)
    // One side fills the area, the other fits inside it; centered either way.
    expect(Math.max(r.w / area.w, r.h / area.h)).toBeCloseTo(1)
    expect(r.w).toBeLessThanOrEqual(area.w + 1e-9)
    expect(r.h).toBeLessThanOrEqual(area.h + 1e-9)
    expect(r.x + r.w / 2).toBeCloseTo(area.x + area.w / 2)
    expect(r.y + r.h / 2).toBeCloseTo(area.y + area.h / 2)
  })

  it('then puts the object, at the area size and 100%, exactly on the area', () => {
    const { rect, camera } = focusedLayout(map, area)
    expect(camera.z).toBe(1)
    expect(toScreen(camera, rect)).toEqual(area)
  })
})
