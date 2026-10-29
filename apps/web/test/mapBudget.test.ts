import { describe, expect, it } from 'vitest'
import type { BoardObject } from '../src/board/board'
import type { Viewport } from '../src/canvas/viewport'
import { liveMaps } from '../src/map/budget'

const map = (id: string, x: number, w = 520, h = 360) => ({ id, type: 'map', x, y: 0, w, h, z: 0, basemap: 'light' }) as unknown as BoardObject
const view = (objects: BoardObject[], v: Partial<Viewport> = {}): Viewport => ({
  camera: { x: 0, y: 0, z: 1 },
  width: 1600,
  height: 900,
  objects,
  selected: new Set(),
  editing: null,
  focused: null,
  ...v,
})

describe('live-map budget', () => {
  it('keeps at most the budget live, the largest on screen first', () => {
    const maps = [map('a', 0, 300, 200), map('b', 320), map('c', 860), map('d', 1400), map('e', 0, 1000, 700)]
    expect([...liveMaps(view(maps), 3)].sort()).toEqual(['b', 'c', 'e'])
  })

  it('leaves out maps off screen or too small on screen', () => {
    const maps = [map('far', 5000), map('tiny', 0, 150, 100), map('near', 0)]
    expect([...liveMaps(view(maps))]).toEqual(['near'])
    // Zoomed out to 25%, a 520 × 360 map is 130 × 90 px.
    expect([...liveMaps(view(maps, { camera: { x: 0, y: 0, z: 0.25 } }))]).toEqual([])
  })

  it('puts selected maps first, and always keeps the edited and the focused one', () => {
    const maps = [map('a', 0, 1000, 700), map('b', 1100, 300, 200), map('far', 9000)]
    expect([...liveMaps(view(maps, { selected: new Set(['b']) }), 1)]).toEqual(['b'])
    expect([...liveMaps(view(maps, { editing: 'far' }), 1)].sort()).toEqual(['a', 'far'])
    expect([...liveMaps(view(maps, { focused: 'far' }), 1)]).toEqual(['far'])
  })

  it('never makes 12 maps more than the budget plus the edited one', () => {
    const maps = Array.from({ length: 12 }, (_, i) => map(`m${i}`, (i % 4) * 400, 380, 280))
    expect(liveMaps(view(maps.map((m, i) => ({ ...m, y: Math.floor(i / 4) * 300 })), { editing: 'm11' })).size).toBe(5)
  })
})
