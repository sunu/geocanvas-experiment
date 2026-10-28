import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Board, type BoardObject } from '../src/board/board'
import { PALETTE } from '../src/canvas/style'
import { objectType, objectTypes } from '../src/objects/registry'

const rect = { x: 1, y: 2, w: 30, h: 40 }

describe('object type registry', () => {
  it('lists every type once, in toolbar order', () => {
    expect(objectTypes.map((d) => d.type)).toEqual(['box', 'text', 'sticky', 'map', 'event'])
  })

  it('gives each type its own one-letter tool key, apart from the select tool (v)', () => {
    const keys = objectTypes.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const k of keys) expect(k).toMatch(/^[a-uw-z]$/)
  })

  it('creates objects of its type in the given rectangle, which the board keeps as they are', () => {
    const board = new Board(new Y.Doc())
    for (const def of objectTypes) {
      const id = board.add(def.create(rect), def.layer)
      expect(board.get(id)).toMatchObject({ type: def.type, ...rect })
    }
  })

  it('puts new texts, sticky notes and events on top, and new boxes and maps at the bottom', () => {
    const board = new Board(new Y.Doc())
    const add = (type: BoardObject['type'], x: number) => {
      const def = objectType(type)!
      board.add(def.create({ ...rect, x }), def.layer)
    }
    add('text', 0)
    add('box', 1)
    add('map', 2)
    add('event', 3)
    add('sticky', 4)
    expect(board.list().map((o) => o.x)).toEqual([2, 1, 0, 3, 4])
  })

  it('knows which types the side panel can color and size, with a default color from the palette', () => {
    expect(objectTypes.filter((d) => d.defaultColor).map((d) => d.type)).toEqual(['box', 'text', 'sticky'])
    expect(objectTypes.filter((d) => d.textSize).map((d) => d.type)).toEqual(['text', 'sticky'])
    for (const d of objectTypes) if (d.defaultColor) expect(PALETTE[d.defaultColor]).toBeDefined()
  })

  it('makes a sticky note: an empty yellow square that opens for typing, resizable in both directions, kept when empty', () => {
    const sticky = objectType('sticky')!
    expect(sticky.create(rect)).toEqual({ type: 'sticky', ...rect, text: '' })
    expect(sticky).toMatchObject({ key: 's', size: { w: 200, h: 200 }, editable: true, editOnCreate: true, defaultColor: 'yellow' })
    expect(sticky.widthOnly).toBeFalsy()
    expect(sticky.isEmpty).toBeUndefined()
  })

  it('removes a text left empty, and only that', () => {
    const text = objectType('text')!
    const make = (s: string) => ({ ...text.create(rect), id: 't', z: 0, text: s }) as BoardObject
    expect(text.isEmpty!(make(''))).toBe(true)
    expect(text.isEmpty!(make(' \n '))).toBe(true)
    expect(text.isEmpty!(make('Flood'))).toBe(false)
    expect(objectTypes.filter((d) => d.isEmpty).map((d) => d.type)).toEqual(['text'])
  })

  it('does not know types from a newer version of the app', () => {
    expect(objectType('chart')).toBeUndefined()
  })
})
