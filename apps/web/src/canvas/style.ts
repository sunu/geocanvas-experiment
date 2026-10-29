/**
 * Colors for boxes and text. Objects store a color by name (the names, sizes and defaults are in
 * @ttx/core, which the object schemas use), so this palette can be retuned without touching boards.
 */
import type { ColorName } from '@ttx/core'

export { COLORS, DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_STICKY_COLOR, DEFAULT_TEXT_COLOR, FONT_SIZES, stepFontSize, type ColorName } from '@ttx/core'

/** The shadcn color primitives, which are Tailwind's palette (the --color-* variables in shadcn.css). */
const c = (name: string, shade: number) => `var(--color-${name}-${shade})`

/** ink: text and swatch color; fill and stroke: a box's background and border. */
export const PALETTE: Record<ColorName, { ink: string; fill: string; stroke: string }> = {
  ink: { ink: c('neutral', 900), fill: c('neutral', 200), stroke: c('neutral', 700) },
  gray: { ink: c('neutral', 500), fill: c('neutral', 100), stroke: c('neutral', 400) },
  red: { ink: c('red', 500), fill: c('red', 100), stroke: c('red', 400) },
  orange: { ink: c('orange', 500), fill: c('orange', 100), stroke: c('orange', 400) },
  yellow: { ink: c('yellow', 500), fill: c('yellow', 100), stroke: c('yellow', 400) },
  green: { ink: c('green', 500), fill: c('green', 100), stroke: c('green', 400) },
  blue: { ink: c('blue', 500), fill: c('blue', 100), stroke: c('blue', 400) },
  purple: { ink: c('purple', 500), fill: c('purple', 100), stroke: c('purple', 400) },
}
