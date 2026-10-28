import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { plugins, type CountryBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

function setup() {
  const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
  return { rt, get: (id: string) => rt.board.get(id) as CountryBoardObject }
}

describe('country context objects', () => {
  it('adds a country context for a country, or none yet, at its default size', () => {
    const { rt, get } = setup()
    const nepal = rt.dispatch('country.add', canvas, { x: 0, y: 0, country: 'NPL' }).created![0]!
    expect(get(nepal)).toMatchObject({ type: 'country', country: 'NPL', w: 380, h: 460 })
    const empty = rt.dispatch('country.add', canvas, { x: 0, y: 500 }).created![0]!
    expect(get(empty).country).toBeUndefined()
  })

  it('takes ISO3 codes only', () => {
    const { rt } = setup()
    expect(rt.dispatch('country.add', canvas, { country: 'Nepal' }).status).toBe('failed')
    expect(rt.dispatch('country.add', canvas, { country: 'npl' }).status).toBe('failed')
  })

  it('picks the country, and tells an agent which one it shows', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('country.add', canvas, {}).created![0]!
    const def = rt.registry.objectType('country')!
    expect(def.summarize!(get(id))).toBe('no country picked yet')
    expect(rt.dispatch('country.setCountry', { kind: 'objects', ids: [id] }, { country: 'MOZ' }).status).toBe('applied')
    expect(def.summarize!(get(id))).toBe('HDX HAPI context for Mozambique (MOZ)')
  })

  it('is in the palette and a tool for the agent', () => {
    const { rt } = setup()
    expect(exportTools(rt.availableOps(canvas)).map((t) => t.name)).toContain('country__add')
  })
})
