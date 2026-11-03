import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, summarizeBoard, type Actor } from '@ttx/core'
import { analysisOf, plugins, type MapBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

function setup(fields: Record<string, unknown> = {}) {
  const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
  const map = rt.dispatch('map.add', canvas, { x: 0, y: 0, ...fields }).created![0]!
  return { rt, map, target: { kind: 'objects' as const, ids: [map] }, mapOf: () => rt.board.get(map) as MapBoardObject }
}

describe('what a map is for', () => {
  it('is set when the map is added, as the toolbar adds a route map, and tells the agent', () => {
    const { rt, mapOf } = setup({ analysis: 'routes' })
    expect(mapOf().analysis).toBe('routes')
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/route map; basemap light/)
  })

  it('changes for everyone, keeps the scenario, and a plain map has none', () => {
    const { rt, target, mapOf } = setup()
    rt.dispatch('map.addClosure', target, { geometry: { type: 'Point', coordinates: [34.85, -19.83] } })
    rt.beginGesture()
    rt.dispatch('map.setAnalysis', target, { analysis: 'exposure' })
    expect(mapOf()).toMatchObject({ analysis: 'exposure', scenario: { closures: [expect.any(Object)] } })
    rt.beginGesture()
    rt.dispatch('map.setAnalysis', target, { analysis: '' })
    expect(mapOf()).not.toHaveProperty('analysis')
    expect(mapOf().scenario!.closures).toHaveLength(1)
    rt.undo()
    expect(mapOf().analysis).toBe('exposure')
    expect(rt.dispatch('map.setAnalysis', target, { analysis: 'weather' }).status).toBe('failed')
  })

  it('is taken from the scenario of maps made before it: routes, or exposure counted', () => {
    const route = { id: 'r', title: 'R', from: [0, 0] as [number, number], to: [0.1, 0] as [number, number], profile: 'car' as const, color: 'orange' as const }
    expect(analysisOf({})).toBeUndefined()
    expect(analysisOf({ scenario: { routes: [route], closures: [] } })).toBe('routes')
    expect(analysisOf({ scenario: { routes: [], closures: [], exposure: { buildings: true } } })).toBe('exposure')
    expect(analysisOf({ analysis: 'exposure', scenario: { routes: [route], closures: [] } })).toBe('exposure')
  })
})
