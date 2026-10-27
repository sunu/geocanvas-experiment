import { describe, expect, it } from 'vitest'
import { COLORS, DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_TEXT_COLOR, FONT_SIZES, PALETTE, stepFontSize } from '../src/canvas/style'

describe('text sizes', () => {
  it('steps through the sizes from the default', () => {
    expect(stepFontSize(DEFAULT_FONT_SIZE, 1)).toBe(24)
    expect(stepFontSize(DEFAULT_FONT_SIZE, -1)).toBe(16)
  })

  it('stops at either end', () => {
    expect(stepFontSize(FONT_SIZES[FONT_SIZES.length - 1]!, 1)).toBe(96)
    expect(stepFontSize(FONT_SIZES[0], -1)).toBe(12)
  })

  it('snaps a size that is not in the list to its neighbours', () => {
    expect(stepFontSize(21, 1)).toBe(24)
    expect(stepFontSize(21, -1)).toBe(20)
  })
})

describe('palette', () => {
  it('has every color, including the defaults', () => {
    for (const c of COLORS) expect(PALETTE[c]).toMatchObject({ ink: expect.any(String), fill: expect.any(String), stroke: expect.any(String) })
    expect(COLORS).toContain(DEFAULT_BOX_COLOR)
    expect(COLORS).toContain(DEFAULT_TEXT_COLOR)
  })
})
