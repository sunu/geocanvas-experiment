import type { Actor } from '@ttx/core'

/**
 * Who is who on the canvas (plans/plan-011.md). Three roles, each with its own color:
 * - you: --canvas-accent (cyan), never given to anyone else;
 * - another person: one of USER_COLORS, kept by that person and the same on every screen;
 * - the agent: --agent (violet), also dashed outlines and a sparkle, so color is never the only signal.
 * The values are Tailwind's 500 shades (the Figma file's user-1 to user-6). Presence carries the hex, so every
 * browser draws a person the same way; `on` is the text color that reads on it.
 */
export const USER_COLORS = [
  { color: '#ff6900', on: '#000000' }, // orange
  { color: '#f6339a', on: '#000000' }, // pink
  { color: '#f0b100', on: '#000000' }, // yellow
  { color: '#3080ff', on: '#ffffff' }, // blue
  { color: '#00bc7d', on: '#000000' }, // emerald
  { color: '#fb2c36', on: '#ffffff' }, // red
] as const

export const isUserColor = (color: string) => USER_COLORS.some((u) => u.color === color)

export const isAgent = (user: Pick<Actor, 'kind'>) => user.kind === 'agent'

/** The text color for a label on `color`: from the table, else black or white by brightness. */
export function onColor(color: string): string {
  const known = USER_COLORS.find((u) => u.color === color)
  if (known) return known.on
  const n = parseInt(color.replace('#', ''), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff'
}
