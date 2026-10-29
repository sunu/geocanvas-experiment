import { describe, expect, it } from 'vitest'
import { pngStats } from '../src/png.js'
import { png } from './pngFixture.js'

const BLACK = [0, 0, 0]
const GREEN = [30, 120, 40]

describe('pngStats', () => {
  it('says an all-black image is blank', async () => {
    const stats = await pngStats(png(4, 4, 2, Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => BLACK))))
    expect(stats).toEqual({ width: 4, height: 4, nonBlank: 0, transparent: 0 })
  })

  it('counts the pixels that have any colour', async () => {
    const rows = [[BLACK, GREEN, GREEN, BLACK], [GREEN, GREEN, BLACK, BLACK]]
    expect((await pngStats(png(4, 2, 2, rows))).nonBlank).toBe(0.5)
  })

  // Real PNGs filter their rows; each filter has to be undone before the pixels mean anything.
  it.each([1, 2, 3, 4])('reads rows written with filter %i', async (filter) => {
    const rows = [[BLACK, GREEN, [200, 10, 10], BLACK], [GREEN, [90, 90, 90], BLACK, BLACK], [GREEN, GREEN, GREEN, [255, 255, 255]]]
    expect((await pngStats(png(4, 3, 2, rows, filter))).nonBlank).toBe(8 / 12)
  })

  it('treats a fully transparent pixel as no data, whatever its colour', async () => {
    const rows = [[[10, 20, 30, 0], [10, 20, 30, 255]], [[0, 0, 0, 255], [0, 0, 0, 0]]]
    expect(await pngStats(png(2, 2, 6, rows))).toEqual({ width: 2, height: 2, nonBlank: 0.25, transparent: 0.5 })
  })

  it('reads one grey band, with or without alpha', async () => {
    expect((await pngStats(png(2, 1, 0, [[[0], [180]]]))).nonBlank).toBe(0.5)
    expect((await pngStats(png(2, 1, 4, [[[0, 255], [180, 255]]]))).nonBlank).toBe(0.5)
  })

  it('says so for what it cannot read, instead of guessing', async () => {
    await expect(pngStats(png(1, 1, 3, [[[0]]]))).rejects.toThrow(/unsupported/i)
    await expect(pngStats(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a png/i)
  })
})
