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
  const mapOf = () => rt.board.get(map) as MapBoardObject
  return { rt, target: { kind: 'objects' as const, ids: [map] }, mapOf }
}

const PORT = { lng: 34.838, lat: -19.826 }
const HOSPITAL = { lng: 34.858, lat: -19.83 }
const FILE = '0b9f3c2e-8d4a-4e1b-9a7c-2f6d5e4c3b2a'

describe('routes in a scenario', () => {
  it('adds a route, renames it, moves an end, changes its vehicle and removes it, each an undo step', () => {
    const { rt, target, mapOf } = setup()
    rt.beginGesture()
    expect(rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL }).status).toBe('applied')
    const [route] = mapOf().scenario!.routes
    expect(route).toEqual({ id: expect.any(String), title: 'Route 1', from: [34.838, -19.826], to: [34.858, -19.83], profile: 'car', color: 'orange' })

    rt.beginGesture()
    rt.dispatch('map.setRoute', target, { routeId: route!.id, title: 'Port → Hospital', to: { lng: 34.87, lat: -19.84 }, profile: 'truck' })
    expect(mapOf().scenario!.routes).toEqual([{ ...route, title: 'Port → Hospital', to: [34.87, -19.84], profile: 'truck' }])

    rt.beginGesture()
    rt.dispatch('map.removeRoute', target, { routeId: route!.id })
    expect(mapOf().scenario!.routes).toEqual([])
    rt.undo()
    rt.undo()
    expect(mapOf().scenario!.routes).toEqual([route])
  })

  it('gives each new route its own color and name', () => {
    const { rt, target, mapOf } = setup()
    rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL })
    rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL, title: 'To the airport' })
    expect(mapOf().scenario!.routes.map((r) => [r.title, r.color])).toEqual([
      ['Route 1', 'orange'],
      ['To the airport', 'emerald'],
    ])
    // A removed route's color is free again.
    rt.dispatch('map.removeRoute', target, { routeId: mapOf().scenario!.routes[0]!.id })
    rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL })
    expect(mapOf().scenario!.routes[1]!.color).toBe('orange')
  })

  it('refuses ends too far apart for the browser to route', () => {
    const { rt, target, mapOf } = setup()
    expect(rt.dispatch('map.addRoute', target, { from: PORT, to: { lng: 33.6, lat: -19.1 } })).toMatchObject({ status: 'failed', error: expect.stringMatching(/km apart/) })
    rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL })
    const [route] = mapOf().scenario!.routes
    expect(rt.dispatch('map.setRoute', target, { routeId: route!.id, to: { lng: 33.6, lat: -19.1 } }).status).toBe('failed')
    expect(mapOf().scenario!.routes).toEqual([route])
  })
})

describe('road closures', () => {
  it('closes roads by shape or around a place, switches one off and on, and removes it', () => {
    const { rt, target, mapOf } = setup()
    rt.dispatch('map.addClosure', target, { geometry: { type: 'Point', coordinates: [34.85, -19.83] }, note: 'Bridge down' })
    rt.dispatch('map.addClosure', target, { around: { lng: 34.85, lat: -19.83, meters: 1000 } })
    const [bridge, area] = mapOf().scenario!.closures
    expect(bridge).toEqual({ id: expect.any(String), geometry: { type: 'Point', coordinates: [34.85, -19.83] }, note: 'Bridge down' })
    const ring = area!.geometry.type === 'Polygon' ? area!.geometry.coordinates[0]! : []
    expect(ring).toHaveLength(33)
    expect(ring[0]).toEqual(ring[32])
    expect(ring[0]![0]).toBeCloseTo(34.85 + 1000 / 111_195 / Math.cos((19.83 * Math.PI) / 180), 5)

    rt.dispatch('map.setClosure', target, { closureId: bridge!.id, off: true })
    expect(mapOf().scenario!.closures[0]).toEqual({ ...bridge, off: true })
    rt.dispatch('map.setClosure', target, { closureId: bridge!.id, off: false, note: 'Bridge repaired?' })
    expect(mapOf().scenario!.closures[0]).toEqual({ ...bridge, note: 'Bridge repaired?' })

    rt.dispatch('map.removeClosure', target, { closureId: bridge!.id })
    expect(mapOf().scenario!.closures).toEqual([area])
  })

  it('needs exactly one of a shape or a place, and keeps closures apart from drawings', () => {
    const { rt, target, mapOf } = setup()
    expect(rt.dispatch('map.addClosure', target, {})).toMatchObject({ status: 'failed', error: expect.stringMatching(/either/) })
    rt.dispatch('map.addClosure', target, { geometry: { type: 'LineString', coordinates: [[34.85, -19.83], [34.86, -19.83]] } })
    expect(mapOf().annotations).toBeUndefined()
    expect(rt.dispatch('map.removeClosure', target, { closureId: 'nope' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/no closure/) })
  })
})

describe('affected areas from data', () => {
  it('adds an uploaded GeoJSON file as a layer that blocks roads, and stops it blocking', () => {
    const { rt, target, mapOf } = setup()
    rt.dispatch('map.addUploadLayer', target, { fileId: FILE, name: 'flood.geojson', blocks: true })
    const [layer] = mapOf().layers!
    expect(layer).toEqual({ id: expect.any(String), tool: 'data.uploadFeatures', input: { fileId: FILE }, title: 'flood.geojson', blocks: true })
    rt.dispatch('map.setLayerBlocks', target, { layerId: layer!.id, blocks: false })
    expect(mapOf().layers![0]).toEqual({ id: layer!.id, tool: 'data.uploadFeatures', input: { fileId: FILE }, title: 'flood.geojson' })
    expect(rt.dispatch('map.addUploadLayer', target, { fileId: '../x', name: 'x' }).status).toBe('failed')
  })

  it('tells the agent the routes, closures and blocking layers', () => {
    const { rt, target, mapOf } = setup()
    rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL, profile: 'truck', title: 'Port → Hospital' })
    rt.dispatch('map.addClosure', target, { geometry: { type: 'Point', coordinates: [34.85, -19.83] }, note: 'Bridge down' })
    rt.dispatch('map.setClosure', target, { closureId: mapOf().scenario!.closures[0]!.id, off: true })
    rt.dispatch('map.addUploadLayer', target, { fileId: FILE, name: 'flood.geojson', blocks: true })
    const text = summarizeBoard(rt.board, rt.registry)
    expect(text).toMatch(/routes: "Port → Hospital", truck from 34.838, -19.826 to 34.858, -19.83 \(/)
    expect(text).toMatch(/road closures: point "Bridge down", switched off \(/)
    expect(text).toMatch(/flood.geojson \([^)]*, blocks roads\)/)
  })
})

describe('exposure in a scenario', () => {
  it('switches the building count on and off for everyone, keeping routes and closures, as undo steps', () => {
    const { rt, target, mapOf } = setup()
    rt.dispatch('map.addRoute', target, { from: PORT, to: HOSPITAL })
    rt.beginGesture()
    expect(rt.dispatch('map.setExposure', target, { buildings: true }).status).toBe('applied')
    expect(mapOf().scenario).toMatchObject({ routes: [expect.any(Object)], closures: [], exposure: { buildings: true } })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/exposure: buildings in flood areas counted/)

    rt.beginGesture()
    rt.dispatch('map.setExposure', target, { buildings: false })
    expect(mapOf().scenario).not.toHaveProperty('exposure')
    expect(mapOf().scenario!.routes).toHaveLength(1)
    rt.undo()
    expect(mapOf().scenario!.exposure).toEqual({ buildings: true })
  })

  it('keeps a flood of a GloFAS return period for depth and damage, and only those', () => {
    const { rt, target, mapOf } = setup()
    expect(rt.dispatch('map.setExposure', target, { buildings: true, returnPeriod: 100 }).status).toBe('applied')
    expect(mapOf().scenario!.exposure).toEqual({ buildings: true, returnPeriod: 100 })
    expect(summarizeBoard(rt.board, rt.registry)).toMatch(/depth and damage of a 100-year river flood/)
    expect(rt.dispatch('map.setExposure', target, { buildings: true, returnPeriod: 30 }).status).toBe('failed')
    rt.dispatch('map.setExposure', target, { buildings: true })
    expect(mapOf().scenario!.exposure).toEqual({ buildings: true })
  })
})
