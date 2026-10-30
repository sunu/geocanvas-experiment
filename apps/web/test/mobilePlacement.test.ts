import { describe, expect, it } from 'vitest'
import { phoneCenter, placed } from '../src/mobile/placement'

const o = (id: string, x: number, y: number, w: number, h: number) => ({ id, type: 'text', x, y, w, h, z: 0 })

describe('phone placement', () => {
  const card = o('card', 0, 0, 300, 200)

  it('puts adds next to the chosen card, on its row', () => {
    const at = phoneCenter([card], card)
    const spot = placed([card], { x: at.x - 50, y: at.y - 50 }, { w: 100, h: 100 })
    expect(spot.x).toBeGreaterThanOrEqual(card.x + card.w)
    expect(spot.y).toBe(50)
  })

  it('puts adds under the board when no card is chosen', () => {
    expect(phoneCenter([card, o('b', 400, 300, 100, 100)], undefined)).toEqual({ x: 250, y: 600 })
    expect(phoneCenter([], undefined)).toEqual({ x: 0, y: 0 })
  })
})
