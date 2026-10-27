import { describe, expect, it } from 'vitest'
import { fitBounds, project, unproject, type MapView } from '../src/geo/project.js'

const size = { w: 600, h: 400 }

describe('projection', () => {
  it('puts the center in the middle', () => {
    const view: MapView = { center: [34.8, -19.8], zoom: 6 }
    expect(project(view, size, [34.8, -19.8])).toEqual({ x: 300, y: 200 })
  })

  it('round-trips project and unproject, also with bearing', () => {
    for (const bearing of [0, 30, -90]) {
      const view: MapView = { center: [125, 11], zoom: 7.3, bearing }
      const p = project(view, size, [125.6, 10.4])
      const [lon, lat] = unproject(view, size, p)
      expect(lon).toBeCloseTo(125.6, 6)
      expect(lat).toBeCloseTo(10.4, 6)
    }
  })

  it('east is right and north is up', () => {
    const view: MapView = { center: [0, 0], zoom: 3 }
    expect(project(view, size, [10, 0]).x).toBeGreaterThan(300)
    expect(project(view, size, [0, 10]).y).toBeLessThan(200)
  })

  it('fitBounds makes the bbox fit inside the padding', () => {
    const bbox: [number, number, number, number] = [33, -21, 36, -18]
    const v = fitBounds(bbox, size, 30)
    const a = project(v, size, [bbox[0], bbox[3]])
    const b = project(v, size, [bbox[2], bbox[1]])
    expect(a.x).toBeGreaterThanOrEqual(29.9)
    expect(a.y).toBeGreaterThanOrEqual(29.9)
    expect(b.x).toBeLessThanOrEqual(570.1)
    expect(b.y).toBeLessThanOrEqual(370.1)
    // One side touches the padding.
    expect(Math.min(a.x, a.y, 600 - b.x, 400 - b.y)).toBeCloseTo(30, 0)
  })
})
