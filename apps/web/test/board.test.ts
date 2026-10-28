import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { corePlugin, Runtime } from '@ttx/core'
import { eventsPlugin } from '../src/events/plugin'
import { mapPlugin } from '../src/map/plugin'
import { newRoomId, roomFromHash, roomHash } from '../src/board/room'

// The headless plugins of plugins.ts (that file also loads the React views).
const runtime = (doc = new Y.Doc()) => new Runtime({ doc, plugins: [corePlugin, mapPlugin, eventsPlugin], actor: { kind: 'user', id: 'a' } })
const canvas = { kind: 'canvas' } as const

describe('the app plugins', () => {
  it('add new texts and events on top, and new boxes and maps at the bottom', () => {
    const rt = runtime()
    for (const [type, x] of [['text', 0], ['text', 1], ['box', 10], ['map', 11], ['text', 12], ['event', 13]] as const) {
      expect(rt.dispatch(`${type}.add`, canvas, { x, y: 0, w: 10, h: 10 }).status).toBe('applied')
    }
    expect(rt.board.list().map((o) => o.x)).toEqual([11, 10, 0, 1, 12, 13])
    expect(rt.board.list()[0]).toMatchObject({ type: 'map', basemap: 'light' })
  })

  it('set the basemap and the event through ops, checked against their fields', () => {
    const rt = runtime()
    const map = rt.dispatch('map.add', canvas, {}).created![0]!
    const event = rt.dispatch('event.add', canvas, {}).created![0]!
    expect(rt.dispatch('map.setBasemap', { kind: 'objects', ids: [map] }, { basemap: 'satellite' }).status).toBe('applied')
    expect(rt.dispatch('map.setBasemap', { kind: 'objects', ids: [map] }, { basemap: 'moon' }).status).toBe('failed')
    expect(rt.dispatch('event.setEvent', { kind: 'objects', ids: [event] }, { eventId: 'usgs-123' }).status).toBe('applied')
    expect(rt.dispatch('event.setEvent', { kind: 'objects', ids: [map] }, { eventId: 'usgs-123' }).status).toBe('failed')
    expect(rt.board.get(map)).toMatchObject({ basemap: 'satellite' })
    expect(rt.board.get(event)).toMatchObject({ eventId: 'usgs-123' })
  })

  it('read and edit boards made before the op runtime', () => {
    // The board format before ops: flat fields on a Y.Map per object, no color or fontSize yet.
    const doc = new Y.Doc()
    const old = (id: string, fields: Record<string, unknown>) => {
      const m = new Y.Map<unknown>()
      for (const [k, v] of Object.entries(fields)) m.set(k, v)
      doc.getMap('objects').set(id, m)
    }
    old('t', { type: 'text', x: 0, y: 0, w: 240, h: 40, z: 1, text: 'hello' })
    old('m', { type: 'map', x: 0, y: 0, w: 520, h: 360, z: 0, basemap: 'dark' })
    old('e', { type: 'event', x: 0, y: 0, w: 380, h: 320, z: 2 })
    const rt = runtime(doc)
    expect(rt.board.list().map((o) => o.id)).toEqual(['m', 't', 'e'])
    expect(rt.dispatch('core.object.setColor', { kind: 'objects', ids: ['t'] }, { color: 'red' }).status).toBe('applied')
    expect(rt.dispatch('core.object.setRect', { kind: 'objects', ids: ['m', 'e'] }, { rects: { m: { x: 5 }, e: { x: 6 } } }).status).toBe('applied')
    expect(rt.board.get('t')).toMatchObject({ text: 'hello', color: 'red' })
    expect(rt.board.get('e')).toMatchObject({ x: 6 })
  })
})

describe('rooms', () => {
  it('reads the room from the URL hash', () => {
    expect(roomFromHash('#room=abc-123')).toBe('abc-123')
    expect(roomFromHash('#x=1&room=r_2')).toBe('r_2')
    expect(roomFromHash('')).toBeUndefined()
    expect(roomFromHash('#room=')).toBeUndefined()
    expect(roomFromHash('#room=has spaces')).toBeUndefined()
    expect(roomFromHash('#bedroom=abc')).toBeUndefined()
  })

  it('makes new room ids that the Worker accepts and that do not repeat', () => {
    const ids = new Set(Array.from({ length: 1000 }, newRoomId))
    expect(ids.size).toBe(1000)
    for (const id of ids) expect(roomFromHash(roomHash(id))).toBe(id)
  })
})
