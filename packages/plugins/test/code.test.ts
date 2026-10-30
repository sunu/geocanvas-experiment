import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { defineTool, Runtime, ToolRunner, type Actor } from '@ttx/core'
import { z } from 'zod'
import {
  capTable,
  CODE_EXECUTE_TOOL,
  followerState,
  hashSource,
  plugins,
  type CodeBoardObject,
  type ExecResult,
  type InputBoardObject,
  type MapBoardObject,
} from '../src/index'
import { canvas } from './fakes'

const F1 = '11111111-1111-4111-8111-111111111111'
const F2 = '22222222-2222-4222-8222-222222222222'
const features = (uploadId: string): ExecResult => ({
  ok: true,
  output: { kind: 'geo.features', uploadId, bbox: [85.2, 27.6, 85.4, 27.8], summary: '1 feature(s)' },
  stdout: '',
  ms: 12,
})
const table: ExecResult = { ok: true, output: { kind: 'table', value: { columns: ['a'], rows: [[1]] }, summary: 'table of 1 row(s): a' }, stdout: '', ms: 5 }
const failure: ExecResult = { ok: false, error: { ename: 'NameError', evalue: "name 'gpd' is not defined", traceback: ['\u001b[31mNameError\u001b[39m: ...', 'line 1'] }, stdout: 'hi\n', ms: 3 }

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const agent: Actor = { kind: 'agent', id: 'agent', onBehalfOf: 'ada' }

/** A board whose code.execute gives the results queued in `results`, one per run, by source. */
function setup(results: Record<string, ExecResult>, withHub = true) {
  const runs: string[] = []
  const exec = defineTool({
    id: CODE_EXECUTE_TOOL,
    title: 'Run code',
    description: 'test',
    input: z.object({ source: z.string() }),
    output: 'code.result',
    cache: false,
    run: ({ source }) => (runs.push(source), results[source] ?? { ok: true, stdout: '', ms: 1 }),
  })
  const doc = new Y.Doc()
  const tools = new ToolRunner(withHub ? [exec] : [])
  const rt = new Runtime({ doc, plugins, actor: ada, tools })
  return { rt, runs }
}

const cell = (rt: Runtime, id: string) => rt.board.get(id) as CodeBoardObject

describe('code cells', () => {
  it('run code when added, and show features as a layer on a map, made by the cell', async () => {
    const { rt } = setup({ buffer: features(F1) })
    const map = rt.dispatch('map.add', canvas, {}).created![0]!
    const r = await rt.invoke('code.add', canvas, { title: 'Kathmandu 10 km buffer', source: 'buffer', showOn: map })
    expect(r.status, r.error).toBe('applied')
    const id = r.created![0]!
    expect(cell(rt, id)).toMatchObject({ source: 'buffer', run: { status: 'ok', by: 'Ada' }, output: { kind: 'geo.features', uploadId: F1, sourceHash: hashSource('buffer') } })
    expect((rt.board.get(map) as MapBoardObject).layers).toEqual([expect.objectContaining({ tool: 'data.uploadFeatures', input: { fileId: F1 }, title: 'Kathmandu 10 km buffer', from: id })])
    expect(r.summary).toContain('1 feature(s)')
  })

  it('give a re-run to its map layers and linked objects in one undo step', async () => {
    const { rt } = setup({ buffer: features(F1), wider: features(F2) })
    const map = rt.dispatch('map.add', canvas, {}).created![0]!
    const input = rt.dispatch('input.add', canvas, {}).created![0]!
    const id = (await rt.invoke('code.add', canvas, { title: 'Buffer', source: 'buffer', showOn: map })).created![0]!
    expect((await rt.invoke('code.show', { kind: 'objects', ids: [id] }, { on: input })).status).toBe('applied')
    expect((rt.board.get(input) as InputBoardObject).value).toEqual({ west: 85.2, south: 27.6, east: 85.4, north: 27.8, name: 'Buffer' })

    rt.beginGesture()
    const r = await rt.invoke('code.run', { kind: 'objects', ids: [id] }, { source: 'wider' })
    expect(r.status, r.error).toBe('applied')
    expect((rt.board.get(map) as MapBoardObject).layers![0]!.input).toEqual({ fileId: F2 })
    expect(rt.board.get(input)!.link).toMatchObject({ from: id, recipe: 'code.input', args: { renderedAt: cell(rt, id).output!.at } })

    rt.undo()
    expect(cell(rt, id).source).toBe('buffer')
    expect((rt.board.get(map) as MapBoardObject).layers![0]!.input).toEqual({ fileId: F1 })
  })

  it("keep a person's failed run on the cell, and leave its output and followers as they were", async () => {
    const { rt } = setup({ buffer: features(F1), broken: failure })
    const map = rt.dispatch('map.add', canvas, {}).created![0]!
    const id = (await rt.invoke('code.add', canvas, { title: 'Buffer', source: 'buffer', showOn: map })).created![0]!
    rt.dispatch('code.setSource', { kind: 'objects', ids: [id] }, { source: 'broken' })
    expect((await rt.invoke('code.run', { kind: 'objects', ids: [id] }, {})).status).toBe('applied')
    const c = cell(rt, id)
    expect(c.run).toMatchObject({ status: 'error', stdout: 'hi\n', error: { ename: 'NameError' } })
    expect(c.output!.uploadId).toBe(F1)
    expect((rt.board.get(map) as MapBoardObject).layers![0]!.input).toEqual({ fileId: F1 })
    expect(followerState(c, 'map', { uploadId: F1 })).toEqual({ state: 'failed', at: c.run!.at })
  })

  it("refuse an agent's failing code, with the error and no ANSI colors, and write nothing", async () => {
    const { rt } = setup({ broken: failure })
    const before = rt.board.list().length
    const r = await rt.invoke('code.add', canvas, { title: 'Buffer', source: 'broken' }, { actor: agent })
    expect(r.status).toBe('failed')
    expect(r.error).toContain("NameError: name 'gpd' is not defined")
    expect(r.error).not.toContain('\u001b')
    expect(rt.board.list()).toHaveLength(before)
  })

  it('refuse to show on a follower an output of a kind it cannot show', async () => {
    const { rt } = setup({ rows: table })
    const map = rt.dispatch('map.add', canvas, {}).created![0]!
    const r = await rt.invoke('code.add', canvas, { title: 'Rows', source: 'rows', showOn: map }, { actor: agent })
    expect(r.status).toBe('failed')
    expect(r.error).toContain('A map shows features; the code gives a table')
  })

  it('leave a map as it was when the code now gives another kind, and say so', async () => {
    const { rt } = setup({ buffer: features(F1), rows: table })
    const map = rt.dispatch('map.add', canvas, {}).created![0]!
    const id = (await rt.invoke('code.add', canvas, { title: 'Buffer', source: 'buffer', showOn: map })).created![0]!
    const r = await rt.invoke('code.run', { kind: 'objects', ids: [id] }, { source: 'rows' }, { actor: agent })
    expect(r.status).toBe('applied')
    expect(r.summary).toContain('still show the earlier result')
    expect(cell(rt, id).output!.kind).toBe('table')
    expect((rt.board.get(map) as MapBoardObject).layers![0]!.input).toEqual({ fileId: F1 })
    expect(followerState(cell(rt, id), 'map', { uploadId: F1 })).toEqual({ state: 'otherKind', kind: 'table' })
  })

  it('say that code needs a hub login when this browser has none', async () => {
    const { rt } = setup({}, false)
    const r = await rt.invoke('code.add', canvas, { title: 'Buffer', source: 'buffer' })
    expect(r.status).toBe('failed')
    expect(r.error).toContain('JupyterHub')
    // A cell with no code can still be added, and edited by someone without a hub.
    expect((await rt.invoke('code.add', canvas, { title: 'Draft' })).status).toBe('applied')
  })

  it('show text output on a sticky note', async () => {
    const { rt } = setup({ count: { ok: true, output: { kind: 'number', value: 42, summary: '42' }, stdout: '', ms: 1 } })
    const sticky = rt.dispatch('sticky.add', canvas, {}).created![0]!
    await rt.invoke('code.add', canvas, { title: 'Count', source: 'count', showOn: sticky })
    expect(rt.board.get(sticky)).toMatchObject({ text: '42', link: { recipe: 'code.sticky' } })
  })
})

describe('follower state', () => {
  const at = 1000
  const output = { kind: 'geo.features' as const, uploadId: F1, summary: '', at, by: 'Ada', sourceHash: hashSource('a') }
  it('is current, old, edited, or gone', () => {
    expect(followerState({ source: 'a', output }, 'map', { uploadId: F1 })).toEqual({ state: 'current' })
    expect(followerState({ source: 'a', output }, 'map', { uploadId: F2 })).toEqual({ state: 'old' })
    expect(followerState({ source: 'b', output }, 'map', { uploadId: F1 })).toEqual({ state: 'edited' })
    expect(followerState(undefined, 'map', { uploadId: F1 })).toEqual({ state: 'deleted' })
    expect(followerState({ source: 'a', output }, 'input', { renderedAt: at })).toEqual({ state: 'current' })
  })
})

describe('caps', () => {
  it('cut a large table to fit', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [i, 'x'.repeat(100)])
    const { value, truncated } = capTable({ columns: ['i', 's'], rows })
    expect(truncated).toBe(true)
    expect(JSON.stringify(value).length).toBeLessThanOrEqual(64 * 1024)
  })
})
