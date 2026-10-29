import { describe, expect, it } from 'vitest'
import { roomFromLink } from '../src/board/room'
import { takePending, savePending } from '../src/home/pending'
import { forgetBoard, listBoards, recordBoard } from '../src/home/recents'

/** An in-memory Storage. */
function memory() {
  const m = new Map<string, string>()
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  }
}

describe('recent boards', () => {
  it('lists the last opened first', () => {
    const s = memory()
    recordBoard({ room: 'a', title: 'Nepal floods review' }, s, 1)
    recordBoard({ room: 'b', title: 'cyclone Freddy' }, s, 3)
    recordBoard({ room: 'c' }, s, 2)
    expect(listBoards(s).map((b) => b.room)).toEqual(['b', 'c', 'a'])
  })

  it('updates a board it knows, keeping what a later visit does not say', () => {
    const s = memory()
    recordBoard({ room: 'a', title: 'SitRep', template: 'sitrep' }, s, 1)
    recordBoard({ room: 'a', title: undefined }, s, 5)
    expect(listBoards(s)).toEqual([{ room: 'a', title: 'SitRep', template: 'sitrep', openedAt: 5 }])
  })

  it('forgets a board', () => {
    const s = memory()
    recordBoard({ room: 'a' }, s, 1)
    recordBoard({ room: 'b' }, s, 2)
    forgetBoard('a', s)
    expect(listBoards(s).map((b) => b.room)).toEqual(['b'])
  })

  it('starts over from broken or blocked storage', () => {
    const s = memory()
    s.setItem('ttx/boards', '{nope')
    expect(listBoards(s)).toEqual([])
    s.setItem('ttx/boards', JSON.stringify([{ room: 'a', openedAt: 1 }, { title: 'no room' }, null]))
    expect(listBoards(s).map((b) => b.room)).toEqual(['a'])
    const blocked = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    expect(() => recordBoard({ room: 'a' }, blocked)).not.toThrow()
    expect(listBoards(blocked)).toEqual([])
  })
})

describe('pending setup', () => {
  it('is read once', () => {
    const s = memory()
    savePending('a', { title: 'X', template: 'sitrep', seeds: { event: 'gdacs-event-1' } }, s)
    expect(takePending('b', s)).toBeUndefined()
    expect(takePending('a', s)).toEqual({ title: 'X', template: 'sitrep', seeds: { event: 'gdacs-event-1' } })
    expect(takePending('a', s)).toBeUndefined()
  })
})

describe('board links', () => {
  it('reads the room of a link or a bare id', () => {
    expect(roomFromLink(' https://humanitarian-ttx.development-seed.workers.dev/#room=3f2a9c1b7d4e8f60 ')).toBe('3f2a9c1b7d4e8f60')
    expect(roomFromLink('http://localhost:5173/#room=abc&mcp=8790:x')).toBe('abc')
    expect(roomFromLink('3f2a9c1b7d4e8f60')).toBe('3f2a9c1b7d4e8f60')
    expect(roomFromLink('https://example.org/')).toBeUndefined()
    expect(roomFromLink('not a link')).toBeUndefined()
  })
})
