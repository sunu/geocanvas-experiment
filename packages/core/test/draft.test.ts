import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { corePlugin, Draft, Runtime, Views, type Actor, type OplogEntry } from '../src/index'

const user = (id: string): Actor => ({ kind: 'user', id })
const canvas = { kind: 'canvas' } as const
const objects = (...ids: string[]) => ({ kind: 'objects' as const, ids })
const invocations = (rt: Runtime) => (rt.oplog.toArray() as OplogEntry[]).filter((e) => e.kind === 'invocation')

/** Me and another person on one board, a text on it, and my draft of the board. */
function setup() {
  const doc = new Y.Doc()
  const me = new Runtime({ doc, plugins: [corePlugin], actor: user('me') })
  const other = new Runtime({ doc, plugins: [corePlugin], actor: user('other') })
  const id = me.dispatch('text.add', canvas, { x: 0, y: 0, w: 10, h: 10 }).created![0]!
  me.flush()
  return { me, other, id, draft: new Draft(me) }
}

const moveTo = (rt: Runtime, id: string, x: number) => {
  rt.beginGesture()
  expect(rt.dispatch('core.object.setRect', objects(id), { rects: { [id]: { x } } }).status).toBe('applied')
}
const xOf = (rt: Runtime, id: string) => rt.board.get(id)?.x

describe('Draft', () => {
  it('starts as a copy of the board', () => {
    const { draft, id } = setup()
    expect(xOf(draft.runtime, id)).toBe(0)
    expect(draft.hasUnshared()).toBe(false)
  })

  it('keeps its edits from the board until they are shared', () => {
    const { me, draft, id } = setup()
    moveTo(draft.runtime, id, 5)
    expect(xOf(draft.runtime, id)).toBe(5)
    expect(xOf(me, id)).toBe(0)
    expect(draft.hasUnshared()).toBe(true)
  })

  it("follows other people's edits, which are not unshared changes", () => {
    const { other, draft, id } = setup()
    moveTo(other, id, 7)
    expect(xOf(draft.runtime, id)).toBe(7)
    expect(draft.hasUnshared()).toBe(false)
  })

  it('undoes in the draft without touching the board', () => {
    const { me, draft, id } = setup()
    moveTo(draft.runtime, id, 5)
    expect(draft.runtime.undo()).toBe(true)
    expect(xOf(draft.runtime, id)).toBe(0)
    expect(me.undoManager.undoStack.length).toBe(1) // only the add
  })

  it('shares its edits as one undo step on the board', () => {
    const { me, draft, id } = setup()
    moveTo(draft.runtime, id, 5)
    moveTo(draft.runtime, id, 6)
    expect(draft.share()).toBe(true)
    expect(xOf(me, id)).toBe(6)
    expect(draft.hasUnshared()).toBe(false)

    expect(me.undo()).toBe(true)
    expect(xOf(me, id)).toBe(0)
    // The undo reaches the draft too, like any change to the board.
    expect(xOf(draft.runtime, id)).toBe(0)
    expect(me.redo()).toBe(true)
    expect(xOf(me, id)).toBe(6)
  })

  it('sends only what changed since the last share', () => {
    const { me, draft, id } = setup()
    moveTo(draft.runtime, id, 5)
    draft.share()
    moveTo(draft.runtime, id, 9)
    draft.share()
    expect(me.undo()).toBe(true)
    expect(xOf(me, id)).toBe(5)
  })

  it('tells listeners when it gets unshared changes and when they are shared', () => {
    const { draft, id } = setup()
    const seen: boolean[] = []
    draft.subscribe(() => seen.push(draft.hasUnshared()))
    moveTo(draft.runtime, id, 5)
    moveTo(draft.runtime, id, 6)
    draft.share()
    expect(seen).toEqual([true, false])
  })

  it('has nothing to share when nothing changed', () => {
    const { me, draft } = setup()
    const steps = me.undoManager.undoStack.length
    expect(draft.share()).toBe(false)
    expect(me.undoManager.undoStack.length).toBe(steps)
  })

  it("brings the draft's op log entries with a share", () => {
    const { me, draft, id } = setup()
    moveTo(draft.runtime, id, 5)
    expect(invocations(me).map((e) => e.opId)).toEqual(['text.add'])
    draft.share()
    expect(invocations(me).map((e) => e.opId)).toEqual(['text.add', 'core.object.setRect'])
  })

  it('shares map views written in the draft', () => {
    const { me, draft, id } = setup()
    new Views(draft.runtime.board.doc).set('me', id, { center: [34.8, -19.8], zoom: 10, bearing: 0 })
    expect(new Views(me.board.doc).get('me', id)).toBeUndefined()
    expect(draft.hasUnshared()).toBe(true)
    draft.share()
    expect(new Views(me.board.doc).get('me', id)?.zoom).toBe(10)
  })

  it('counts a deletion as an unshared change', () => {
    const { me, draft, id } = setup()
    draft.runtime.beginGesture()
    draft.runtime.dispatch('core.object.delete', objects(id), {})
    expect(draft.hasUnshared()).toBe(true)
    draft.share()
    expect(me.board.get(id)).toBeUndefined()
  })

  it('does not bring back an object someone else deleted', () => {
    const { me, other, draft, id } = setup()
    moveTo(draft.runtime, id, 5)
    other.beginGesture()
    other.dispatch('core.object.delete', objects(id), {})
    expect(draft.runtime.board.get(id)).toBeUndefined()
    draft.share()
    expect(me.board.get(id)).toBeUndefined()
  })

  it('stops following the board when closed', () => {
    const { other, draft, id } = setup()
    const doc = draft.runtime.board.doc
    draft.close()
    moveTo(other, id, 7)
    expect(doc.getMap<Y.Map<unknown>>('objects').get(id)?.get('x')).toBe(0)
  })
})
