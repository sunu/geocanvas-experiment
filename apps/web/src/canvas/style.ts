/**
 * Colors for boxes and text. Objects store a color by name (the names, sizes and defaults are in
 * @ttx/core, which the object schemas use), so this palette can be retuned without touching boards.
 */
import type { ColorName } from '@ttx/core'

export { COLORS, DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_TEXT_COLOR, FONT_SIZES, stepFontSize, type ColorName } from '@ttx/core'

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
