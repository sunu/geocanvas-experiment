/**
 * Color names and text sizes for boxes, texts and sticky notes. Objects store a color by name, so the web palette
 * (apps/web/src/canvas/style.ts) can be retuned without touching boards. They are here because the
 * object schemas and ops need them.
 */

export const COLORS = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type ColorName = (typeof COLORS)[number]

export const DEFAULT_BOX_COLOR: ColorName = 'blue'
export const DEFAULT_TEXT_COLOR: ColorName = 'ink'
export const DEFAULT_STICKY_COLOR: ColorName = 'yellow'

export const FONT_SIZES = [12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96] as const
export const DEFAULT_FONT_SIZE = 20

/** The next size up (1) or down (-1) in FONT_SIZES from any size; the same size at either end. */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir === 1) return FONT_SIZES.find((s) => s > size) ?? FONT_SIZES[FONT_SIZES.length - 1]!
  return [...FONT_SIZES].reverse().find((s) => s < size) ?? FONT_SIZES[0]
}
