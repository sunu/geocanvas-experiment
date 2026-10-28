import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { notebookResultLayer, plugins, type MapBoardObject, type NotebookBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent', onBehalfOf: 'ada' }
const canvas = { kind: 'canvas' } as const

function setup() {
  const doc = new Y.Doc()
  const rt = new Runtime({ doc, plugins, actor: ada })
  const notebook = rt.dispatch('notebook.add', canvas, { x: 0, y: 0 }).created![0]!
  const map = rt.dispatch('map.add', canvas, { x: 600, y: 0 }).created![0]!
  return { doc, rt, notebook, map, get: (id: string) => rt.board.get(id) }
}

describe('notebook objects', () => {
  it('adds a notebook with no run yet, at its default size, on top', () => {
    const { get, notebook } = setup()
    expect(get(notebook)).toMatchObject({ type: 'notebook', w: 520, h: 420 })
    expect((get(notebook) as NotebookBoardObject).runId).toBeUndefined()
  })

  it('picks a run and switches the shared view, each an op with undo', () => {
    const { rt, notebook, get } = setup()
    const target = { kind: 'objects' as const, ids: [notebook] }
    rt.beginGesture()
    expect(rt.dispatch('notebook.setRun', target, { runId: '694fd49d' }).status).toBe('applied')
    rt.beginGesture()
    expect(rt.dispatch('notebook.setView', target, { view: 'notebook' }).status).toBe('applied')
    expect(get(notebook)).toMatchObject({ runId: '694fd49d', view: 'notebook' })
    rt.undo()
    expect((get(notebook) as NotebookBoardObject).view).toBeUndefined()
    expect(rt.dispatch('notebook.setView', target, { view: 'table' }).status).toBe('failed')
  })

  it('tells an agent what a notebook shows', () => {
    const { rt, notebook } = setup()
    const nb = rt.registry.objectType('notebook')!
    expect(nb.summarize!(rt.board.get(notebook)!)).toBe('no run picked yet')
    rt.dispatch('notebook.setRun', { kind: 'objects', ids: [notebook] }, { runId: 'r1' })
    expect(nb.summarize!(rt.board.get(notebook)!)).toBe('Notebook Factory run r1')
  })
})

describe('map.addNotebookResult', () => {
  it("adds a run's GeoJSON file to a map as a recipe that names the run and the file, for an agent too", () => {
    const { doc, rt, map } = setup()
    const target = { kind: 'objects' as const, ids: [map] }
    expect(rt.dispatch('map.addNotebookResult', target, { runId: 'r1', name: 'exposure.geojson', title: 'exposure · West' }).status).toBe('applied')
    const bot = new Runtime({ doc, plugins, actor: agent })
    expect(bot.dispatch('map.addNotebookResult', target, { runId: 'r2', name: 'flood.geojson' }).status).toBe('applied')
    expect((rt.board.get(map) as MapBoardObject).layers).toEqual([
      { id: expect.any(String), tool: 'notebooks.artifact', input: { runId: 'r1', name: 'exposure.geojson' }, title: 'exposure · West' },
      { id: expect.any(String), tool: 'notebooks.artifact', input: { runId: 'r2', name: 'flood.geojson' }, title: 'flood' },
    ])
  })

  it('takes GeoJSON files only, and maps only', () => {
    const { rt, map, notebook } = setup()
    expect(rt.dispatch('map.addNotebookResult', { kind: 'objects', ids: [map] }, { runId: 'r1', name: 'table.csv' }).status).toBe('failed')
    expect(rt.dispatch('map.addNotebookResult', { kind: 'objects', ids: [notebook] }, { runId: 'r1', name: 'a.geojson' }).status).toBe('failed')
  })

  it('makes a new map with a result layer in one op, as "Show on a new map" does', () => {
    const { rt, get } = setup()
    const layer = notebookResultLayer('r1', 'exposure.geojson', 'exposure · West')
    const id = rt.dispatch('map.add', canvas, { x: 0, y: 500, layers: [layer] }).created![0]!
    expect((get(id) as MapBoardObject).layers).toEqual([layer])
  })

  it('is a tool for the agent, like the other map ops', () => {
    const { rt, map } = setup()
    const names = exportTools(rt.availableOps({ kind: 'objects', ids: [map] })).map((t) => t.name)
    expect(names).toContain('map__addNotebookResult')
  })
})
