import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Board, BoardTx, corePlugin, Nav, Registry } from '../src/index'

describe('show requests', () => {
  it('keeps the latest request per person and tells only that person', () => {
    const doc = new Y.Doc()
    const board = new Board(doc)
    const tx = new BoardTx(board, new Registry([corePlugin]))
    const a = tx.add('box', { x: 0, y: 0, w: 10, h: 10 })
    const b = tx.add('box', { x: 50, y: 0, w: 10, h: 10 })
    const nav = new Nav(doc)
    const seen: string[] = []
    nav.subscribe('p1', (r) => seen.push(r.id))
    tx.showTo('p1', a)
    tx.showTo('p2', a)
    tx.showTo('p1', b)
    expect(seen).toEqual([a, b])
    expect(nav.get('p1')?.id).toBe(b)
    expect(nav.get('p2')?.id).toBe(a)
    expect(() => tx.showTo('p1', 'gone')).toThrow('does not exist')
  })
})
