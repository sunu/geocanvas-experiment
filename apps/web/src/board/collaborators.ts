import type { Actor } from '@ttx/core'

/**
 * Who is who on the canvas (plans/plan-011.md). Three roles, each with its own color:
 * - you: --canvas-accent (cyan), never given to anyone else;
 * - another person: one color of their own, which no one else on the board has at the same time (claimColor);
 * - the agent: --agent (violet), also dashed outlines and a sparkle, so color is never the only signal.
 *
 * People's colors come in tiers, used in this order, so no one shares a color until about 65 people are on a board:
 * 1. FIGMA_COLORS: the seven multiplayer colors of Figma's editor, each as the nearest shadcn (Tailwind) color;
 * 2. RAINBOW_COLORS: 16 more shadcn colors spanning the rainbow, chosen by a farthest-first search over every shade
 *    (300 to 700) of every hue, one or two of each in the shade that sets it apart most;
 * 3. MORE_SHADCN_COLORS: the next of that search;
 * 4. SOFT_COLORS and DEEP_COLORS: generated, evenly spaced soft and deep hues, for the boards that need still more.
 * The values are Tailwind's OKLCH colors as sRGB hex. Presence carries the hex, so every browser draws a person the
 * same way.
 */
/**
 * Figma's own: the editor defines seven (ui_color_multiplayer_b, g, p, r, s, t and y in its loaded app bundle), for
 * the cursors and avatars of the people in a file. Each is matched here to the nearest shadcn color by distance in
 * OKLab. Figma's teal is a cyan, which is yours, so it is given the nearest shadcn color that is not cyan.
 */
export const FIGMA_COLORS = [
  '#57a2fe', // blue-400     for Figma's #18a0fb
  '#0bb981', // emerald-500  for #1bc47d
  '#7d88ff', // indigo-400   for #907cff
  '#eb5601', // orange-600   for #ef5533
  '#e12afb', // fuchsia-500  for #ee46d3
  '#0eb8a6', // teal-500     for #00b5ce
  '#ffd239', // amber-300    for #ffc700
] as const

const RAINBOW_ALL = [
  '#fc7101', // orange-500
  '#1447e6', // blue-700
  '#05df72', // green-400
  '#e12afb', // fuchsia-500
  '#a4b4ff', // indigo-300
  '#07766e', // teal-700
  '#e20276', // pink-600
  '#ffe032', // yellow-300
  '#ffa3af', // rose-300
  '#0684c7', // sky-600
  '#be0311', // red-700
  '#bf7ffe', // purple-400
  '#46ecd5', // teal-300
  '#64a304', // lime-600
  '#ffba71', // orange-300
  '#a601b4', // fuchsia-700
] as const

const MORE_ALL = [
  '#ca8a06', // yellow-600
  '#ff6880', // rose-400
  '#bbf451', // lime-300
  '#7d88ff', // indigo-400
  '#03813a', // green-700
  '#0bb981', // emerald-500
  '#7ad4fe', // sky-300
  '#fb2c36', // red-500
  '#f2a9ff', // fuchsia-300
  '#fb64b6', // pink-400
  '#83cc02', // lime-500
  '#57a2fe', // blue-400
  '#3380fe', // blue-500
  '#eab305', // yellow-500
  '#7bf1a8', // green-300
  '#4f39f6', // indigo-600
  '#0c9488', // teal-600
  '#0169a1', // sky-700
  '#fda5d5', // pink-300
  '#d97708', // amber-600
] as const

const without = (list: readonly string[], ...taken: (readonly string[])[]) => list.filter((c) => !taken.some((t) => t.includes(c)))

/** The rainbow of shadcn colors, without the ones Figma's tier already has. */
export const RAINBOW_COLORS: readonly string[] = without(RAINBOW_ALL, FIGMA_COLORS)

export const MORE_SHADCN_COLORS: readonly string[] = without(MORE_ALL, FIGMA_COLORS, RAINBOW_COLORS)

/** The shadcn colors, in the order they are used. */
export const USER_COLORS: readonly string[] = [...FIGMA_COLORS, ...RAINBOW_COLORS, ...MORE_SHADCN_COLORS]

/** Hue bands (OKLCH degrees) kept free: cyan with teal and sky (yours), violet with indigo and purple (the agent's). */
const RESERVED_HUES: [number, number][] = [
  [170, 250],
  [264, 330],
]

/** OKLCH to a hex inside sRGB: the chroma is lowered until the color fits, so a hue never clips to another. */
function oklchHex(L: number, C: number, H: number): string {
  const h = (H * Math.PI) / 180
  for (let c = C; c >= 0; c -= 0.005) {
    const a = c * Math.cos(h)
    const b = c * Math.sin(h)
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    const lin = [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ]
    if (lin.every((v) => v >= -0.0001 && v <= 1.0001)) {
      const encode = (v: number) => {
        const x = Math.min(1, Math.max(0, v))
        return Math.round((x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055) * 255)
      }
      return '#' + lin.map((v) => encode(v).toString(16).padStart(2, '0')).join('')
    }
  }
  return '#808080'
}

/** Evenly spaced hues outside the reserved bands, at one brightness and chroma: a set that looks like one. */
function tier(L: number, C: number, skip: (hue: number) => boolean = () => false): string[] {
  const colors: string[] = []
  for (let hue = 6; hue < 360; hue += 12) {
    if (RESERVED_HUES.some(([from, to]) => hue >= from && hue <= to) || skip(hue)) continue
    const color = oklchHex(L, C, hue)
    if (!USER_COLORS.includes(color)) colors.push(color)
  }
  return colors
}

/** Generated soft colors, as bright as pastels but clear on white: the third choice. */
export const SOFT_COLORS: readonly string[] = tier(0.7, 0.17)

/** The last choice: the same hues, darker. Deep oranges, yellows and limes are browns and olives, so not those. */
export const DEEP_COLORS: readonly string[] = tier(0.55, 0.16, (hue) => hue > 35 && hue < 120)

const ALL_COLORS: ReadonlySet<string> = new Set([...USER_COLORS, ...SOFT_COLORS, ...DEEP_COLORS])

export const isUserColor = (color: string) => ALL_COLORS.has(color)

/** A color for a person who has none: the same one for the same id, spread over the Figma-like tier. */
export function colorFor(id: string): string {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619)
  return FIGMA_COLORS[(hash >>> 0) % FIGMA_COLORS.length]!
}

const linear = (channel: number) => {
  const c = channel / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [linear((n >> 16) & 255), linear((n >> 8) & 255), linear(n & 255)]
}

/** A color in OKLab, where distance is how different two colors look (Björn Ottosson's matrices). */
function oklab(hex: string): [number, number, number] {
  const [r, g, b] = rgb(hex)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const distance = (a: string, b: string) => {
  const [p, q] = [oklab(a), oklab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/**
 * `preferred` if no one has it, so a person keeps their color from one visit to the next. Otherwise the free color
 * that looks least like any taken one (the farthest from the nearest), not simply the next in the list, so a second
 * person is not given a neighbour of the first. Figma's seven go first, then the rainbow, then the rest of shadcn's,
 * then the generated soft and deep ones, each only when the tier before is used up. `preferred` again if every color is taken.
 */
export function pickColor(taken: ReadonlySet<string>, preferred: string): string {
  if (!taken.has(preferred)) return preferred
  const nearest = (c: string) => Math.min(...[...taken].map((t) => distance(c, t)))
  for (const colors of [FIGMA_COLORS as readonly string[], RAINBOW_COLORS, MORE_SHADCN_COLORS, SOFT_COLORS, DEEP_COLORS]) {
    const free = colors.filter((c) => !taken.has(c))
    if (free.length) return free.reduce((best, c) => (nearest(c) > nearest(best) ? c : best))
  }
  return preferred
}

/** What claimColor needs of the room's awareness (y-protocols' Awareness has all of it). */
export interface ColorAwareness {
  clientID: number
  getStates(): Map<number, Record<string, unknown>>
  setLocalStateField(field: string, value: unknown): void
  on(event: 'change', listener: () => void): void
}

/**
 * Give this person a color no one else on the board has, as Figma and Miro show each person in their own: a person
 * keeps the color they had when it is free, else takes the first free one, and moves off it if someone else is found
 * with it. Two people who joined at the same moment have the same color until each sees the other; then the one with
 * the higher client id moves, so exactly one of them does. Tabs of the same person share their color. The actor is
 * changed in place, as rename does: it is the runtime's actor, which chat messages and presence read. `onChange`
 * is told the new color, to keep it.
 */
export function claimColor(actor: Actor, awareness: ColorAwareness, onChange?: (color: string) => void): void {
  const resolve = () => {
    const others = [...awareness.getStates()].filter(([id, state]) => {
      const user = state.user as Actor | undefined
      return id !== awareness.clientID && user?.color && user.kind !== 'agent' && user.id !== actor.id
    })
    const colorOf = ([, state]: (typeof others)[number]) => (state.user as Actor).color as string
    if (!others.some((o) => colorOf(o) === actor.color && o[0] < awareness.clientID)) return
    const next = pickColor(new Set(others.map(colorOf)), actor.color ?? FIGMA_COLORS[0])
    if (next === actor.color) return
    actor.color = next
    onChange?.(next)
    awareness.setLocalStateField('user', { ...actor })
  }
  awareness.on('change', resolve)
  resolve()
}

export const isAgent = (user: Pick<Actor, 'kind'>) => user.kind === 'agent'

/** The text color for a label on `color`: black or white, whichever has the higher contrast (WCAG), 4.5:1 or more on all of the palette. */
export function onColor(color: string): string {
  const [r, g, b] = rgb(color)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.05 ? '#ffffff' : '#000000'
}
