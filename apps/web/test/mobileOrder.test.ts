import { describe, expect, it } from 'vitest'
import { phoneRows } from '../src/mobile/order'

const o = (id: string, type: string, x: number, y: number, w: number, h: number) => ({ id, type, x, y, w, h, z: 0 })
const shape = (rows: ReturnType<typeof phoneRows>) => rows.map((r) => `${'  '.repeat(r.depth)}${r.kind === 'section' ? '#' : ''}${r.object.id}`)

describe('phoneRows', () => {
  it('lists the board in reading order, each frame as a section of what it holds, nested frames inside it', () => {
    const rows = phoneRows([
      o('later', 'text', 0, 900, 100, 40),
      o('f', 'frame', 0, 100, 800, 600),
      o('right', 'map', 400, 150, 300, 200),
      o('left', 'event', 20, 150, 300, 200),
      o('g', 'frame', 20, 400, 400, 250),
      o('deep', 'sticky', 40, 450, 100, 100),
      o('first', 'text', 0, 0, 100, 40),
    ])
    expect(shape(rows)).toEqual(['first', '#f', '  left', '  right', '  #g', '    deep', 'later'])
  })

  it('leaves out shapes', () => {
    expect(shape(phoneRows([o('b', 'box', 0, 0, 10, 10), o('t', 'text', 0, 20, 10, 10)]))).toEqual(['t'])
  })
})
