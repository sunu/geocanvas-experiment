import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, type Actor } from '@ttx/core'
import { plugins, textDoc, type ReportBoardObject } from '@ttx/plugins'
import type { Board } from '../src/board/board'
import { addToReport, blockLabel, boardReports } from '../src/reports/reports'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const
const setup = () => new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
const add = (rt: Runtime, type: string, fields: Record<string, unknown> = {}) => rt.dispatch(`${type}.add`, canvas, { x: 0, y: 0, ...fields }).created![0]!

describe('the reports the menus offer', () => {
  it('list the board by title: a name, a frame it was made from, or Untitled report', async () => {
    const rt = setup()
    const board = rt.board as Board
    const frame = add(rt, 'frame', { w: 400, h: 400, title: 'Situation report: Flood in Nepal' })
    add(rt, 'sticky', { x: 10, y: 10 })
    const fromFrame = (await addToReport(rt, [frame])).created![0]!
    const named = add(rt, 'report', { x: 2000 })
    rt.dispatch('core.object.rename', { kind: 'objects', ids: [named] }, { name: 'Briefing' })
    const untitled = add(rt, 'report', { x: 3000 })
    expect(boardReports(board)).toEqual([
      { id: named, title: 'Briefing', added: false },
      { id: fromFrame, title: 'Situation report: Flood in Nepal', added: false },
      { id: untitled, title: 'Untitled report', added: false },
    ])
  })
})

describe('which reports have the selection', () => {
  it('check a report when every selected object is in it, the frame it was made from included', async () => {
    const rt = setup()
    const board = rt.board as Board
    const frame = add(rt, 'frame', { w: 400, h: 400 })
    const inside = add(rt, 'sticky', { x: 10, y: 10 })
    const outside = add(rt, 'sticky', { x: 1000, y: 0 })
    const r = (await addToReport(rt, [frame])).created![0]!
    const added = (ids: string[]) => boardReports(board, ids).find((c) => c.id === r)!.added
    expect(added([frame])).toBe(true)
    expect(added([inside])).toBe(true)
    expect(added([inside, outside])).toBe(false)
    expect(added([outside])).toBe(false)
    // A report in the selection is not asked about; a selection of reports only checks nothing.
    expect(added([inside, r])).toBe(true)
    expect(added([r])).toBe(false)
  })
})

describe('Add to report', () => {
  it('adds to a report in one undo step, says what it did, and why it did nothing', async () => {
    const rt = setup()
    const r = add(rt, 'report', { x: 2000 })
    const note = add(rt, 'sticky')
    const done = await addToReport(rt, [note], r)
    expect(done).toMatchObject({ status: 'applied', summary: 'Added 1 item to the report' })
    expect(await addToReport(rt, [note], r)).toMatchObject({ status: 'failed', error: expect.stringMatching(/already in this report/) })
    rt.undo()
    expect((rt.board.get(r) as ReportBoardObject).blocks).toEqual([])
  })

  it('makes a new report without one, and gives its id to select', async () => {
    const rt = setup()
    const note = add(rt, 'sticky')
    const done = await addToReport(rt, [note])
    expect(done.created).toHaveLength(1)
    expect(rt.board.get(done.created![0]!)).toMatchObject({ type: 'report' })
  })
})

describe('block labels', () => {
  it('name every kind of block, for the items list and the block being dragged', () => {
    const rt = setup()
    const note = add(rt, 'sticky', { text: 'Roads closed' })
    const board = rt.board as Board
    const label = (b: Record<string, unknown>) => blockLabel({ id: 'b', span: 1, ...b } as never, board, rt.registry, (id) => (id === 'u1' ? 'flood.png' : undefined))
    expect(label({ kind: 'heading', text: 'Overview', level: 1 })).toBe('Overview')
    expect(label({ kind: 'heading', text: ' ', level: 1 })).toBe('Heading')
    expect(label({ kind: 'text', doc: textDoc('First.\n\nSecond.') })).toBe('First. Second.')
    expect(label({ kind: 'text', doc: textDoc('') })).toBe('Empty text')
    expect(label({ kind: 'image', imageId: 'u1' })).toBe('flood.png')
    expect(label({ kind: 'image', imageId: 'u2' })).toBe('Image')
    expect(label({ kind: 'divider' })).toBe('Divider')
    expect(label({ kind: 'pageBreak' })).toBe('Page break')
    expect(label({ kind: 'item', sourceId: note, mode: 'live' })).toBe('Roads closed')
    expect(label({ kind: 'item', sourceId: 'gone', mode: 'live' })).toBe('Removed object')
  })
})
