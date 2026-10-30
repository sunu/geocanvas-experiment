import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { goUrl, parseGoUrl, plugins, type IfrcGoBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

describe('IFRC GO links', () => {
  it('reads an emergency, with any page of it after the id, and surrounding space', () => {
    expect(parseGoUrl('https://go.ifrc.org/emergencies/8083')).toEqual({ id: 8083 })
    expect(parseGoUrl('  https://go.ifrc.org/emergencies/8083/details?tab=1#x  ')).toEqual({ id: 8083 })
    expect(parseGoUrl('http://www.go.ifrc.org/emergencies/12/reports')).toEqual({ id: 12 })
  })

  it('is not fooled by other pages or hosts', () => {
    for (const bad of [
      'https://go.ifrc.org/emergencies/all',
      'https://go.ifrc.org/emergencies/slug/yemen-2026',
      'https://go.ifrc.org/emergencies/80x3',
      'https://go.ifrc.org/field-reports/18586',
      'https://go.ifrc.org/countries/10',
      'https://goadmin.ifrc.org/api/v2/event/8083/',
      'https://evil.example/go.ifrc.org/emergencies/8083',
      'yemen population movement',
    ]) {
      expect(parseGoUrl(bad), bad).toBeUndefined()
    }
  })

  it('spells the same emergency one way', () => {
    expect(goUrl(parseGoUrl('http://go.ifrc.org/emergencies/8083/details#x')!)).toBe('https://go.ifrc.org/emergencies/8083')
  })
})

describe('ifrcgo objects', () => {
  function setup() {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    return { rt, get: (id: string) => rt.board.get(id) as IfrcGoBoardObject }
  }

  it('adds a card for a link, at its default size', () => {
    const { rt, get } = setup()
    const rec = rt.dispatch('ifrcgo.add', canvas, { x: 0, y: 0, url: 'https://go.ifrc.org/emergencies/8083' })
    expect(rec.status).toBe('applied')
    expect(get(rec.created![0]!)).toMatchObject({ type: 'ifrcgo', url: 'https://go.ifrc.org/emergencies/8083', w: 380, h: 440 })
  })

  it('stores only the link of an emergency, not of another page', () => {
    const { rt } = setup()
    expect(rt.dispatch('ifrcgo.add', canvas, { url: 'https://go.ifrc.org/emergencies/all' }).status).toBe('failed')
    expect(rt.dispatch('ifrcgo.add', canvas, { url: 'https://go.ifrc.org/emergencies/8083/details' }).status).toBe('failed')
  })

  it('sets the link of a card made without one, from any spelling, and tells an agent what it shows', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('ifrcgo.add', canvas, {}).created![0]!
    const def = rt.registry.objectType('ifrcgo')!
    expect(def.summarize!(get(id))).toBe('no IFRC GO link yet')
    expect(rt.dispatch('ifrcgo.setUrl', { kind: 'objects', ids: [id] }, { url: 'https://go.ifrc.org/emergencies/8083/details#x' }).status).toBe('applied')
    expect(get(id).url).toBe('https://go.ifrc.org/emergencies/8083')
    expect(def.summarize!(get(id))).toBe('IFRC GO https://go.ifrc.org/emergencies/8083')
  })

  it('refuses a link that is not an emergency, and keeps the old one', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('ifrcgo.add', canvas, { url: 'https://go.ifrc.org/emergencies/8083' }).created![0]!
    expect(rt.dispatch('ifrcgo.setUrl', { kind: 'objects', ids: [id] }, { url: 'https://go.ifrc.org/emergencies/all' }).status).toBe('failed')
    expect(get(id).url).toBe('https://go.ifrc.org/emergencies/8083')
  })

  it('is a tool for the agent', () => {
    const { rt } = setup()
    expect(exportTools(rt.availableOps(canvas)).map((t) => t.name)).toContain('ifrcgo__add')
  })
})
