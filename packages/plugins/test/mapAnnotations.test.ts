import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, summarizeBoard, type Actor } from '@ttx/core'
import { plugins, shapeFeatures, type MapBoardObject } from '../src/index'
import { distanceM } from '../src/mapAnnotations'

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

describe('shapes on a map', () => {
  it('draws an arrow for everyone, red by default, and the agent reads where it points', () => {
    const { rt, target, annotationsOf } = setup()
    rt.beginGesture()
    expect(rt.dispatch('map.addShape', target, { shape: 'arrow', points: [[34.8, -19.9], [34.85, -19.83]] }).status).toBe('applied')
    expect(annotationsOf()).toEqual([{ id: expect.any(String), kind: 'shape', shape: 'arrow', points: [[34.8, -19.9], [34.85, -19.83]], color: 'red' }])
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/shapes: red arrow from 34\.8, -19\.9 to 34\.85, -19\.83/)
    rt.undo()
    expect(annotationsOf()).toEqual([])
  })

  it('checks how many points each shape takes', () => {
    const { rt, target } = setup()
    const two: [number, number][] = [[0, 0], [1, 1]]
    expect(rt.dispatch('map.addShape', target, { shape: 'polygon', points: two })).toMatchObject({ status: 'failed', error: expect.stringMatching(/polygon takes 3 to 500 points/) })
    expect(rt.dispatch('map.addShape', target, { shape: 'circle', points: [...two, [2, 2]] }).status).toBe('failed')
    expect(rt.dispatch('map.addShape', target, { shape: 'freehand', points: [...two, [2, 2]], color: 'blue' }).status).toBe('applied')
    expect(rt.dispatch('map.addShape', target, { shape: 'line', points: two, color: 'purple' }).status).toBe('failed')
  })

  it('moves a whole shape by its first point, and removes it', () => {
    const { rt, target, annotationsOf } = setup()
    rt.dispatch('map.addShape', target, { shape: 'rectangle', points: [[10, 10], [11, 12]] })
    const [rect] = annotationsOf()
    rt.dispatch('map.moveAnnotation', target, { annotationId: rect!.id, lng: 20, lat: 5 })
    expect(annotationsOf()[0]).toMatchObject({ points: [[20, 5], [21, 7]] })
    rt.dispatch('map.removeAnnotation', target, { annotationId: rect!.id })
    expect(annotationsOf()).toEqual([])
  })
})

describe('shape geometry', () => {
  it('draws an arrow as its shaft and a solid head at its end', () => {
    const [shaft, head] = shapeFeatures('arrow', [[0, 0], [1, 0]], '#dc2626')
    expect(shaft!.geometry).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 0]] })
    expect(head!.properties.fill).toBe('solid')
    const ring = head!.geometry.coordinates[0] as [number, number][]
    expect(ring[0]![0]).toBeCloseTo(1)
    // The head is a quarter of the shaft, behind its tip.
    expect(Math.min(...ring.map((p) => p[0]))).toBeCloseTo(1 - 0.25 * Math.cos(Math.PI / 6), 3)
  })

  it('draws a circle on the ground, through the point on its edge', () => {
    const [circle] = shapeFeatures('circle', [[34.85, -19.83], [34.86, -19.83]], '#16a34a')
    const ring = circle!.geometry.coordinates[0] as [number, number][]
    const radius = distanceM([34.85, -19.83], [34.86, -19.83])
    for (const p of ring) expect(distanceM([34.85, -19.83], p)).toBeCloseTo(radius, 0)
    expect(ring[0]).toEqual(ring.at(-1))
  })

  it('closes rectangles and polygons, and draws a polygon in progress as a line', () => {
    expect(shapeFeatures('rectangle', [[0, 0], [2, 1]], '#000')[0]!.geometry.coordinates).toEqual([[[0, 0], [2, 0], [2, 1], [0, 1], [0, 0]]])
    expect(shapeFeatures('polygon', [[0, 0], [1, 0]], '#000')[0]!.geometry.type).toBe('LineString')
    expect(shapeFeatures('polygon', [[0, 0], [1, 0], [1, 1]], '#000')[0]!.geometry.coordinates).toEqual([[[0, 0], [1, 0], [1, 1], [0, 0]]])
  })
})
