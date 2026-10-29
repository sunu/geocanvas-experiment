import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime } from '@ttx/core'
import { plugins, type PdfBoardObject } from '../src/index'

const A = '3f2b8c1e-6d4a-4b7e-9a10-2c5d8e7f9b01'
const B = '9d1c7a2e-4b3f-4e6a-8c10-5f2e1d7c9a03'

function setup() {
  const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: { kind: 'user', id: 'ada' } })
  const id = rt.dispatch('pdf.add', { kind: 'canvas' }, { fileId: A, name: 'sitrep.pdf' }).created![0]!
  return { rt, target: { kind: 'objects' as const, ids: [id] }, get: () => rt.board.get(id) as PdfBoardObject }
}

describe('PDF objects', () => {
  it('shows a chosen page on the card, as one undo step, and starts a new file at its first page', () => {
    const { rt, target, get } = setup()
    rt.beginGesture()
    expect(rt.dispatch('pdf.setPage', target, { page: 4 }).status).toBe('applied')
    expect(get().page).toBe(4)
    rt.undo()
    expect(get().page).toBeUndefined()

    rt.dispatch('pdf.setPage', target, { page: 4 })
    rt.dispatch('pdf.setFile', target, { fileId: B, name: 'map.pdf' })
    expect(get()).toMatchObject({ fileId: B, name: 'map.pdf', page: 1 })
  })

  it('refuses malformed file ids and pages below 1', () => {
    const { rt, target } = setup()
    expect(rt.dispatch('pdf.setFile', target, { fileId: '../monty/search' }).status).toBe('failed')
    expect(rt.dispatch('pdf.setPage', target, { page: 0 }).status).toBe('failed')
  })
})
