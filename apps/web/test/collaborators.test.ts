import { describe, expect, it } from 'vitest'
import type { Actor } from '@ttx/core'
import { claimColor, colorFor, DEEP_COLORS, FIGMA_COLORS, isUserColor, MORE_SHADCN_COLORS, onColor, pickColor, RAINBOW_COLORS, SOFT_COLORS, type ColorAwareness } from '../src/board/collaborators'

const [A, B] = FIGMA_COLORS as unknown as [string, string]
const EVERY_COLOR = [...FIGMA_COLORS, ...RAINBOW_COLORS, ...MORE_SHADCN_COLORS, ...SOFT_COLORS, ...DEEP_COLORS]
const taken = (...colors: string[]) => new Set<string>(colors)

describe('the palette', () => {
  it('has Figma\'s seven first, then the rainbow and the rest of shadcn\'s, then generated ones, none repeated', () => {
    expect(FIGMA_COLORS).toHaveLength(7)
    expect(RAINBOW_COLORS.length).toBeGreaterThanOrEqual(12)
    expect(MORE_SHADCN_COLORS.length).toBeGreaterThanOrEqual(15)
    expect(SOFT_COLORS.length + DEEP_COLORS.length).toBeGreaterThanOrEqual(20)
    expect(new Set(EVERY_COLOR).size).toBe(EVERY_COLOR.length)
    expect(EVERY_COLOR.every((c) => /^#[0-9a-f]{6}$/.test(c) && isUserColor(c))).toBe(true)
  })

  it('gives the same Figma-tier color to the same id', () => {
    expect(colorFor('p-ana')).toBe(colorFor('p-ana'))
    expect(FIGMA_COLORS).toContain(colorFor('p-ana') as never)
  })

  it('puts a label color on each that reads at 4.5:1 or more', () => {
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16)
      const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
    }
    for (const color of EVERY_COLOR) {
      const [a, b] = [luminance(color), luminance(onColor(color))].sort((x, y) => y - x) as [number, number]
      expect((a + 0.05) / (b + 0.05)).toBeGreaterThanOrEqual(4.5)
    }
  })
})

describe('pickColor', () => {
  it('keeps the preferred color when it is free', () => {
    expect(pickColor(taken(B), A)).toBe(A)
  })

  it('takes a free color that looks different from the taken one, not its neighbour', () => {
    const picked = pickColor(taken(A), A)
    expect(picked).not.toBe(A)
    expect(FIGMA_COLORS).toContain(picked as never)
    expect(picked).not.toBe(FIGMA_COLORS[0])
  })

  it('gives each of 50 people a different color: Figma\'s seven first, then the rainbow', () => {
    const used = new Set<string>()
    const order: string[] = []
    for (let i = 0; i < 50; i++) {
      const c = pickColor(used, A)
      used.add(c)
      order.push(c)
    }
    expect(used.size).toBe(50)
    expect(order.slice(0, 7).every((c) => FIGMA_COLORS.includes(c as never))).toBe(true)
    expect(order.slice(7, 7 + RAINBOW_COLORS.length).every((c) => RAINBOW_COLORS.includes(c))).toBe(true)
  })

  it('keeps the preferred color when every color is taken', () => {
    const everything = taken(...EVERY_COLOR)
    expect(pickColor(everything, B)).toBe(B)
  })
})

/** A room's awareness with the given states; `me` is this client. */
function room(me: number, states: [number, Record<string, unknown>][]) {
  const map = new Map(states)
  const listeners: (() => void)[] = []
  const awareness: ColorAwareness = {
    clientID: me,
    getStates: () => map,
    setLocalStateField: (field, value) => map.set(me, { ...map.get(me), [field]: value }),
    on: (_event, listener) => void listeners.push(listener),
  }
  return { awareness, set: (id: number, state: Record<string, unknown>) => (map.set(id, state), listeners.forEach((l) => l())) }
}

const person = (id: string, color: string): Actor => ({ kind: 'user', id, name: id, color })

describe('claimColor', () => {
  it('leaves a color no one else has', () => {
    const me = person('me', A)
    const { awareness } = room(5, [[5, { user: me }], [2, { user: person('sam', B) }]])
    claimColor(me, awareness)
    expect(me.color).toBe(A)
  })

  it('moves off a color another person already has, to one no one has', () => {
    const me = person('me', A)
    const { awareness } = room(9, [[9, { user: me }], [2, { user: person('sam', A) }], [3, { user: person('tara', B) }]])
    const kept: string[] = []
    claimColor(me, awareness, (c) => kept.push(c))
    expect([A, B]).not.toContain(me.color)
    expect(isUserColor(me.color!)).toBe(true)
    expect(kept).toEqual([me.color])
  })

  it('does not move when it is the other person, with the higher client id, who must', () => {
    const me = person('me', A)
    const { awareness } = room(2, [[2, { user: me }], [9, { user: person('sam', A) }]])
    claimColor(me, awareness)
    expect(me.color).toBe(A)
  })

  it('resolves a clash when the other person arrives later', () => {
    const me = person('me', A)
    const { awareness, set } = room(9, [[9, { user: me }]])
    claimColor(me, awareness)
    expect(me.color).toBe(A)
    set(2, { user: person('sam', A) })
    expect(me.color).not.toBe(A)
  })

  it('ignores the agent and other tabs of the same person', () => {
    const me = person('me', A)
    const { awareness } = room(9, [[9, { user: me }], [2, { user: { kind: 'agent', id: 'agent', name: 'Agent', color: A } }], [3, { user: person('me', A) }]])
    claimColor(me, awareness)
    expect(me.color).toBe(A)
  })

  it('gives ten people who all started with the same color ten different ones', () => {
    // Everyone is on the board; each sees the others, and the ones with the higher client ids move, in turn.
    const people = Array.from({ length: 10 }, (_, i) => person(`p${i}`, A))
    const states = new Map<number, Record<string, unknown>>(people.map((p, i) => [i + 1, { user: p }]))
    const awarenesses = people.map((p, i) => {
      const a: ColorAwareness = {
        clientID: i + 1,
        getStates: () => states,
        setLocalStateField: (field, value) => states.set(i + 1, { ...states.get(i + 1), [field]: value }),
        on: () => {},
      }
      return a
    })
    // Lowest client id first: each keeps what is free of the ones before it.
    people.forEach((p, i) => claimColor(p, awarenesses[i]!))
    expect(new Set(people.map((p) => p.color)).size).toBe(10)
  })
})
