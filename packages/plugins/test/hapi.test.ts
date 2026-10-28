import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { plugins, type CountryBoardObject, type MapBoardObject, type PresenceBoardObject } from '../src/index'

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

describe("who's where and conflict", () => {
  it('adds them for a country, all sectors to start with, and picks their country with the same op', () => {
    const { rt } = setup()
    const presence = rt.dispatch('presence.add', canvas, { x: 0, y: 0, country: 'MOZ' }).created![0]!
    const conflict = rt.dispatch('conflict.add', canvas, { x: 400, y: 0 }).created![0]!
    expect(rt.board.get(presence)).toMatchObject({ type: 'presence', country: 'MOZ', sector: '' })
    expect(rt.dispatch('country.setCountry', { kind: 'objects', ids: [conflict] }, { country: 'SDN' }).status).toBe('applied')
    expect(rt.board.get(conflict)).toMatchObject({ type: 'conflict', country: 'SDN' })
    expect(rt.dispatch('conflict.add', canvas, { country: 'Sudan' }).status).toBe('failed')
  })

  it('filters who is where by sector for everyone, and back to all sectors', () => {
    const { rt } = setup()
    const id = rt.dispatch('presence.add', canvas, { country: 'MOZ' }).created![0]!
    const get = () => rt.board.get(id) as PresenceBoardObject
    const def = rt.registry.objectType('presence')!
    rt.dispatch('presence.setSector', { kind: 'objects', ids: [id] }, { sector: 'HEA' })
    expect(get().sector).toBe('HEA')
    expect(def.summarize!(get())).toBe('Organizations by province, sector HEA in Mozambique (MOZ)')
    rt.dispatch('presence.setSector', { kind: 'objects', ids: [id] }, { sector: '' })
    expect(def.summarize!(get())).toBe('Organizations by province in Mozambique (MOZ)')
  })

  it('are in the palette and tools for the agent', () => {
    const { rt } = setup()
    const names = exportTools(rt.availableOps(canvas)).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining(['presence__add', 'conflict__add']))
  })
})

describe('HDX HAPI figures and boundaries on a map', () => {
  function withMap() {
    const { rt } = setup()
    const map = rt.dispatch('map.add', canvas, { x: 0, y: 0 }).created![0]!
    return { rt, target: { kind: 'objects' as const, ids: [map] }, layers: () => (rt.board.get(map) as MapBoardObject).layers }
  }

  it('adds province or district boundaries, with no area', () => {
    const { rt, target, layers } = withMap()
    rt.dispatch('map.addBoundaries', target, { level: 1 })
    rt.dispatch('map.addBoundaries', target, { level: 2 })
    expect(layers()).toEqual([
      { id: expect.any(String), tool: 'boundaries.codab', input: { level: 1 }, title: 'Provinces (COD-AB)' },
      { id: expect.any(String), tool: 'boundaries.codab', input: { level: 2 }, title: 'Districts (COD-AB)' },
    ])
    expect(rt.dispatch('map.addBoundaries', target, { level: 3 }).status).toBe('failed')
  })

  it('colors areas by a HAPI figure, as a recipe that names the figure, with a sector for organizations only', () => {
    const { rt, target, layers } = withMap()
    rt.dispatch('map.addChoropleth', target, { country: 'MOZ', indicator: 'organizations', level: 1, sector: 'HEA' })
    rt.dispatch('map.addChoropleth', target, { country: 'SDN', indicator: 'conflictEvents', level: 2, sector: 'HEA' })
    expect(layers()).toEqual([
      { id: expect.any(String), tool: 'hapi.choropleth', input: { country: 'MOZ', indicator: 'organizations', level: 1, sector: 'HEA' }, title: 'Organizations (HEA) by province · Mozambique' },
      { id: expect.any(String), tool: 'hapi.choropleth', input: { country: 'SDN', indicator: 'conflictEvents', level: 2 }, title: 'Conflict events by district · Sudan' },
    ])
    expect(rt.dispatch('map.addChoropleth', target, { country: 'MOZ', indicator: 'rainfall' }).status).toBe('failed')
  })

  it('are tools for the agent', () => {
    const { rt, target } = withMap()
    expect(exportTools(rt.availableOps(target)).map((t) => t.name)).toEqual(expect.arrayContaining(['map__addBoundaries', 'map__addChoropleth']))
  })
})
