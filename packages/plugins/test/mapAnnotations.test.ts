import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, summarizeBoard, type Actor } from '@ttx/core'
import { plugins, type MapBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

function setup() {
  const doc = new Y.Doc()
  const rt = new Runtime({ doc, plugins, actor: ada })
  const map = rt.dispatch('map.add', canvas, { x: 0, y: 0 }).created![0]!
  const annotationsOf = () => (rt.board.get(map) as MapBoardObject).annotations ?? []
  return { rt, target: { kind: 'objects' as const, ids: [map] }, annotationsOf }
}

describe('sticky notes on a map', () => {
  it('pins a note to a place, writes in it, moves it and removes it, each an undo step', () => {
    const { rt, target, annotationsOf } = setup()
    rt.beginGesture()
    expect(rt.dispatch('map.addSticky', target, { lng: 34.85, lat: -19.83 }).status).toBe('applied')
    const [note] = annotationsOf()
    expect(note).toEqual({ id: expect.any(String), kind: 'sticky', lngLat: [34.85, -19.83], text: '' })

    rt.beginGesture()
    rt.dispatch('map.setStickyText', target, { annotationId: note!.id, text: 'Bridge' })
    rt.dispatch('map.setStickyText', target, { annotationId: note!.id, text: 'Bridge out' })
    rt.beginGesture()
    rt.dispatch('map.moveAnnotation', target, { annotationId: note!.id, lng: 34.9, lat: -19.8 })
    expect(annotationsOf()).toEqual([{ ...note, lngLat: [34.9, -19.8], text: 'Bridge out' }])

    rt.beginGesture()
    rt.dispatch('map.removeAnnotation', target, { annotationId: note!.id })
    expect(annotationsOf()).toEqual([])
    rt.undo()
    rt.undo()
    expect(annotationsOf()).toEqual([{ ...note, text: 'Bridge out' }])
    rt.undo()
    expect(annotationsOf()).toEqual([note])
  })

  it('refuses a note off the globe or an annotation the map does not have', () => {
    const { rt, target, annotationsOf } = setup()
    expect(rt.dispatch('map.addSticky', target, { lng: 200, lat: 0 }).status).toBe('failed')
    expect(rt.dispatch('map.removeAnnotation', target, { annotationId: 'nope' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/no annotation/) })
    expect(annotationsOf()).toEqual([])
  })

  it('tells the agent what the notes say and where', () => {
    const { rt, target } = setup()
    rt.dispatch('map.addSticky', target, { lng: 34.85, lat: -19.83, text: 'Bridge out' })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/sticky notes: "Bridge out" at 34.85, -19.83 \(/)
  })
})
