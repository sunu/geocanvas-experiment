import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { hdxUrl, parseHdxUrl, plugins, type HdxBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

describe('HDX links', () => {
  it('reads a dataset, with a file or a section after it, and surrounding space', () => {
    expect(parseHdxUrl('https://data.humdata.org/dataset/cod-ab-npl')).toEqual({ name: 'cod-ab-npl' })
    expect(parseHdxUrl('  https://data.humdata.org/dataset/hot_flood_npl/resource/0511c76e-e7c1-4689-a57e-0e2ba5f0e11e?x=1  ')).toEqual({ name: 'hot_flood_npl' })
    expect(parseHdxUrl('http://www.data.humdata.org/dataset/philippines-flood-20250706#description')).toEqual({ name: 'philippines-flood-20250706' })
  })

  it('is not fooled by other pages or hosts', () => {
    for (const bad of [
      'https://data.humdata.org/dataset',
      'https://data.humdata.org/dataset/',
      'https://data.humdata.org/dataset?q=nepal',
      'https://data.humdata.org/organization/ocha-fiss',
      'https://data.humdata.org/group/npl',
      'https://data.humdata.org/dataset/COD-AB-NPL',
      'https://data.humdata.org/api/3/action/package_show?id=cod-ab-npl',
      'https://hapi.humdata.org/dataset/cod-ab-npl',
      'https://evil.example/data.humdata.org/dataset/cod-ab-npl',
      'nepal flood data',
    ]) {
      expect(parseHdxUrl(bad), bad).toBeUndefined()
    }
  })

  it('spells the same dataset one way', () => {
    expect(hdxUrl(parseHdxUrl('http://data.humdata.org/dataset/cod-ab-npl/resource/abc?x=1#y')!)).toBe('https://data.humdata.org/dataset/cod-ab-npl')
  })
})

describe('hdx objects', () => {
  function setup() {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    return { rt, get: (id: string) => rt.board.get(id) as HdxBoardObject }
  }

  it('adds a card for a link, at its default size', () => {
    const { rt, get } = setup()
    const rec = rt.dispatch('hdx.add', canvas, { x: 0, y: 0, url: 'https://data.humdata.org/dataset/cod-ab-npl' })
    expect(rec.status).toBe('applied')
    expect(get(rec.created![0]!)).toMatchObject({ type: 'hdx', url: 'https://data.humdata.org/dataset/cod-ab-npl', w: 380, h: 440 })
  })

  it('stores only the link of a dataset, not of another page', () => {
    const { rt } = setup()
    expect(rt.dispatch('hdx.add', canvas, { url: 'https://data.humdata.org/organization/ocha-fiss' }).status).toBe('failed')
    expect(rt.dispatch('hdx.add', canvas, { url: 'https://data.humdata.org/dataset/cod-ab-npl/resource/abc' }).status).toBe('failed')
  })

  it('sets the link of a card made without one, from any spelling, and tells an agent what it shows', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('hdx.add', canvas, {}).created![0]!
    const def = rt.registry.objectType('hdx')!
    expect(def.summarize!(get(id))).toBe('no HDX link yet')
    expect(rt.dispatch('hdx.setUrl', { kind: 'objects', ids: [id] }, { url: 'https://data.humdata.org/dataset/cod-ab-npl/resource/abc#x' }).status).toBe('applied')
    expect(get(id).url).toBe('https://data.humdata.org/dataset/cod-ab-npl')
    expect(def.summarize!(get(id))).toBe('HDX dataset https://data.humdata.org/dataset/cod-ab-npl')
  })

  it('refuses a link that is not a dataset, and keeps the old one', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('hdx.add', canvas, { url: 'https://data.humdata.org/dataset/cod-ab-npl' }).created![0]!
    expect(rt.dispatch('hdx.setUrl', { kind: 'objects', ids: [id] }, { url: 'https://data.humdata.org/group/npl' }).status).toBe('failed')
    expect(get(id).url).toBe('https://data.humdata.org/dataset/cod-ab-npl')
  })

  it('is a tool for the agent', () => {
    const { rt } = setup()
    expect(exportTools(rt.availableOps(canvas)).map((t) => t.name)).toContain('hdx__add')
  })
})
