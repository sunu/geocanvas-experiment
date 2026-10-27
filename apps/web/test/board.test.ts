import { describe, expect, it, vi } from 'vitest'
import * as Y from 'yjs'
import { Board } from '../src/board/board'
import { newRoomId, roomFromHash, roomHash } from '../src/board/room'

/** Texts stack in the order they are added (new boxes and maps go to the bottom instead). */
const item = (x = 0) => ({ type: 'text' as const, x, y: 0, w: 10, h: 10, text: '' })
const order = (b: Board) => b.list().map((o) => o.x)

/** A board with texts at x = 0, 1, 2, ... added in that order (so bottom to top). */
function boardWith(n: number) {
  const board = new Board(new Y.Doc())
  const ids = Array.from({ length: n }, (_, i) => board.add(item(i)))
  return { board, ids }
}

describe('Board layer order', () => {
  it('adds new text on top, and new boxes and maps at the bottom', () => {
    const { board } = boardWith(2)
    board.add({ type: 'box', x: 10, y: 0, w: 10, h: 10 })
    board.add({ type: 'map', x: 11, y: 0, w: 10, h: 10, basemap: 'light' })
    board.add(item(12))
    expect(order(board)).toEqual([11, 10, 0, 1, 12])
  })

  it('brings a selection to the front and sends it to the back, keeping its own order', () => {
    const { board, ids } = boardWith(4)
    board.bringToFront(new Set([ids[0]!, ids[1]!]))
    expect(order(board)).toEqual([2, 3, 0, 1])
    board.sendToBack(new Set([ids[3]!, ids[1]!]))
    expect(order(board)).toEqual([3, 1, 2, 0])
  })

  it('steps one place forward and backward, past unselected neighbours only', () => {
    const { board, ids } = boardWith(4)
    board.step(new Set([ids[0]!]), 1)
    expect(order(board)).toEqual([1, 0, 2, 3])
    board.step(new Set([ids[0]!, ids[1]!]), 1)
    expect(order(board)).toEqual([2, 1, 0, 3])
    board.step(new Set([ids[3]!]), 1) // already on top
    expect(order(board)).toEqual([2, 1, 0, 3])
    board.step(new Set([ids[3]!]), -1)
    expect(order(board)).toEqual([2, 1, 3, 0])
  })

  it('keeps stepping when floats between two neighbours run out', () => {
    const { board, ids } = boardWith(3)
    const renumber = vi.spyOn(board as unknown as { normalizeZ(): void }, 'normalizeZ')
    for (let i = 0; i < 200; i++) board.step(new Set([ids[i % 2 === 0 ? 2 : 1]!]), -1)
    expect(renumber).toHaveBeenCalled()
    expect(new Set(order(board)).size).toBe(3)
    expect(board.list().every((o) => Number.isFinite(o.z))).toBe(true)
  })
})

describe('Board sync and undo', () => {
  it('merges two people moving different objects', () => {
    const a = new Board(new Y.Doc())
    const b = new Board(new Y.Doc())
    const id = a.add(item())
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    a.update({ [id]: { x: 50 } })
    b.update({ [id]: { w: 99 } })
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc))
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc))
    expect(a.get(id)).toMatchObject({ x: 50, w: 99 })
    expect(b.get(id)).toEqual(a.get(id))
  })

  it('undoes only your own edits, one gesture at a time', () => {
    const a = new Board(new Y.Doc())
    const b = new Board(new Y.Doc())
    a.doc.on('update', (u: Uint8Array) => Y.applyUpdate(b.doc, u, 'remote'))
    b.doc.on('update', (u: Uint8Array, origin: unknown) => origin !== 'remote' && Y.applyUpdate(a.doc, u, 'remote'))

    const id = a.add(item())
    a.undo.stopCapturing()
    a.update({ [id]: { x: 10 } })
    a.update({ [id]: { x: 20 } }) // same gesture (a drag)
    b.update({ [id]: { y: 5 } }) // someone else

    a.undo.undo()
    expect(a.get(id)).toMatchObject({ x: 0, y: 5 })
    a.undo.undo()
    expect(a.get(id)).toBeUndefined()
    a.undo.redo()
    expect(b.get(id)).toMatchObject({ x: 0 })
  })
})

describe('Board snapshot', () => {
  it('reflects changes that arrived before anyone subscribed, and stays the same array until the next change', () => {
    const a = new Board(new Y.Doc())
    a.add(item(1))
    const b = new Board(new Y.Doc())
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc), 'remote') // e.g. the first sync from the server
    const first = b.snapshot()
    expect(first.map((o) => o.x)).toEqual([1])
    expect(b.snapshot()).toBe(first)

    let calls = 0
    b.subscribe(() => calls++)
    b.add(item(2))
    expect(calls).toBe(1)
    expect(b.snapshot()).not.toBe(first)
    expect(b.snapshot().map((o) => o.x)).toEqual([1, 2])
  })
})

describe('rooms', () => {
  it('reads the room from the URL hash', () => {
    expect(roomFromHash('#room=abc-123')).toBe('abc-123')
    expect(roomFromHash('#x=1&room=r_2')).toBe('r_2')
    expect(roomFromHash('')).toBeUndefined()
    expect(roomFromHash('#room=')).toBeUndefined()
    expect(roomFromHash('#room=has spaces')).toBeUndefined()
    expect(roomFromHash('#bedroom=abc')).toBeUndefined()
  })

  it('makes new room ids that the Worker accepts and that do not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, newRoomId))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(roomFromHash(roomHash(id))).toBe(id)
  })
})
