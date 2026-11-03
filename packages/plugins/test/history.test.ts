import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, summarizeBoard, type Actor } from '@ttx/core'
import { plugins, type HistoryBoardObject, type MapBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

describe('disaster history', () => {
  it('picks a country and a hazard family for everyone, and tells the agent', () => {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    const id = rt.dispatch('history.add', canvas, { x: 0, y: 0 }).created![0]!
    const target = { kind: 'objects' as const, ids: [id] }
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/no country picked yet/)
    rt.dispatch('history.setCountry', target, { country: 'NPL' })
    rt.dispatch('history.setHazard', target, { hazard: 'flood' })
    expect(rt.board.get(id) as HistoryBoardObject).toMatchObject({ country: 'NPL', hazard: 'flood' })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/Floods in Nepal \(NPL\) since 1900/)
    expect(rt.dispatch('history.setHazard', target, { hazard: 'meteor' }).status).toBe('failed')
  })

  it('adds the DesInventar map layer for an area, colored by hazard', () => {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    const map = rt.dispatch('map.add', canvas, { x: 0, y: 0 }).created![0]!
    rt.dispatch('map.addLayer', { kind: 'objects', ids: [map] }, { layer: 'desinventar', area: { west: 84, south: 27.3, east: 84.8, north: 27.8 } })
    expect((rt.board.get(map) as MapBoardObject).layers![0]).toMatchObject({ tool: 'history.desinventar', input: { area: [84, 27.3, 84.8, 27.8] }, style: { byProperty: 'hazard' } })
  })
})
