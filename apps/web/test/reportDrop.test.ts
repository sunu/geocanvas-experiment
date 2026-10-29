import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, type Actor } from '@ttx/core'
import { plugins, type ReportBoardObject } from '@ttx/plugins'
import type { Board } from '../src/board/board'
import { dropQuestion, reportUnder } from '../src/reports/drop'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const
const setup = () => new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
const add = (rt: Runtime, type: string, fields: Record<string, unknown> = {}) => rt.dispatch(`${type}.add`, canvas, { x: 0, y: 0, ...fields }).created![0]!
const objects = (...ids: string[]) => ({ kind: 'objects' as const, ids })

describe('dropping on a report', () => {
  it('finds the topmost report under the pointer that is not being dragged', () => {
    const rt = setup()
    const board = rt.board as Board
    const note = add(rt, 'sticky')
    const a = add(rt, 'report')
    const b = add(rt, 'report')
    // Topmost first, as the DOM gives them: the dragged note, then report b, then report a.
    expect(reportUnder([note, b, a], board, new Set([note]))?.id).toBe(b)
    // A report being dragged is not a place to drop.
    expect(reportUnder([b, a], board, new Set([b]))?.id).toBe(a)
    expect(reportUnder([note], board, new Set([note]))).toBeUndefined()
  })

  it('asks about what was dragged, saying when a frame brings its contents', () => {
    const rt = setup()
    const board = rt.board as Board
    const note = add(rt, 'sticky')
    const map = add(rt, 'map')
    const frame = add(rt, 'frame')
    const r = add(rt, 'report')
    expect(dropQuestion(board, [note], 'Flood SitRep')).toBe('Add this object to Flood SitRep?')
    expect(dropQuestion(board, [note, map, r], 'Flood SitRep')).toBe('Add 2 objects to Flood SitRep?')
    expect(dropQuestion(board, [frame], 'Untitled report')).toBe('Add this frame and what is in it to Untitled report?')
  })

  it('puts the objects back and adds them in the drag\'s own undo step, as the canvas does on Add', () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 1000 })
    const note = add(rt, 'sticky', { x: 0, y: 0 })
    // The drag: one gesture of moves, onto the report.
    rt.beginGesture()
    rt.dispatch('core.object.setRect', objects(note), { rects: { [note]: { x: 500, y: 40 } } })
    rt.dispatch('core.object.setRect', objects(note), { rects: { [note]: { x: 1050, y: 40 } } })
    // Add: back where it was, then added, with no new gesture.
    rt.dispatch('core.object.setRect', objects(note), { rects: { [note]: { x: 0, y: 0 } } })
    const done = rt.dispatch('report.addItems', objects(note), { reportId: r })
    expect(done).toMatchObject({ status: 'applied', summary: 'Added 1 item to the report' })
    expect(rt.board.get(note)).toMatchObject({ x: 0, y: 0 })
    rt.undo()
    expect((rt.board.get(r) as ReportBoardObject).blocks).toEqual([])
    expect(rt.board.get(note)).toMatchObject({ x: 0, y: 0 })
    // Nothing else to undo: the drag and the add were one step.
    rt.undo()
    expect(rt.board.get(note)).toBeUndefined()
  })
})
