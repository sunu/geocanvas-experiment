/**
 * Colors and text sizes for boxes and text. Objects store a color by name, so the palette can be
 * retuned without touching boards. Objects made before these fields existed get the defaults.
 */

export const COLORS = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const
export type ColorName = (typeof COLORS)[number]

/** ink: text and swatch color; fill and stroke: a box's background and border. */
export const PALETTE: Record<ColorName, { ink: string; fill: string; stroke: string }> = {
  ink: { ink: '#18181b', fill: '#e4e4e7', stroke: '#3f3f46' },
  gray: { ink: '#71717a', fill: '#f4f4f5', stroke: '#a1a1aa' },
  red: { ink: '#dc2626', fill: '#fee2e2', stroke: '#ef4444' },
  orange: { ink: '#ea580c', fill: '#ffedd5', stroke: '#f97316' },
  yellow: { ink: '#ca8a04', fill: '#fef9c3', stroke: '#eab308' },
  green: { ink: '#16a34a', fill: '#dcfce7', stroke: '#22c55e' },
  blue: { ink: '#2563eb', fill: '#dbeafe', stroke: '#3b82f6' },
  purple: { ink: '#9333ea', fill: '#f3e8ff', stroke: '#a855f7' },
}

export const DEFAULT_BOX_COLOR: ColorName = 'blue'
export const DEFAULT_TEXT_COLOR: ColorName = 'ink'

export const FONT_SIZES = [12, 14, 16, 20, 24, 32, 40, 48, 64, 80, 96] as const
export const DEFAULT_FONT_SIZE = 20

/** The next size up (1) or down (-1) in FONT_SIZES from any size; the same size at either end. */
export function stepFontSize(size: number, dir: 1 | -1): number {
  if (dir === 1) return FONT_SIZES.find((s) => s > size) ?? FONT_SIZES[FONT_SIZES.length - 1]!
  return [...FONT_SIZES].reverse().find((s) => s < size) ?? FONT_SIZES[0]
}
