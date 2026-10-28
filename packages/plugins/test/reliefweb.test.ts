import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { feedFor, glidesOf, plugins, type ReliefWebBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

describe('GLIDE numbers of an event', () => {
  it("reads them from the event's GLIDE records in other sources", () => {
    expect(
      glidesOf({
        id: 'gdacs-event-1102171',
        sources: [
          { source: 'gdacs', eventIds: ['gdacs-event-1102171'] },
          { source: 'glide', eventIds: ['glide-event-FF-2026-000162-NPL', 'glide-event-FL-2026-000167-NPL'] },
        ],
      }),
    ).toEqual(['FF-2026-000162-NPL', 'FL-2026-000167-NPL'])
  })

  it('reads the GLIDE number of a GLIDE event itself, once', () => {
    expect(glidesOf({ id: 'glide-event-FF-2026-000162-NPL', sources: [{ source: 'glide', eventIds: ['glide-event-FF-2026-000162-NPL'] }] })).toEqual([
      'FF-2026-000162-NPL',
    ])
  })

  it('has none for an event without a GLIDE record, and skips ids that are not GLIDE numbers', () => {
    expect(glidesOf({ id: 'emdat-event-2026-0326-NPL', sources: [{ source: 'emdat', eventIds: ['emdat-event-2026-0326-NPL'] }] })).toEqual([])
    expect(glidesOf({ id: 'x', sources: [{ source: 'glide', eventIds: ['glide-event-not-a-glide'] }] })).toEqual([])
    expect(glidesOf({ id: 'x' })).toEqual([])
  })
})

describe('a feed for a disaster', () => {
  it('finds a feed with the same GLIDE numbers, in any order, so a picked event does not get a second one', () => {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    rt.dispatch('event.add', canvas, {})
    const id = rt.dispatch('reliefweb.add', canvas, { glides: ['FF-2026-000162-NPL', 'FL-2026-000167-NPL'] }).created![0]!
    const objects = rt.board.list()
    expect(feedFor(objects, ['FL-2026-000167-NPL', 'FF-2026-000162-NPL'])?.id).toBe(id)
    expect(feedFor(objects, ['FF-2026-000162-NPL'])).toBeUndefined()
    expect(feedFor(objects, ['TC-2026-000001-MOZ'])).toBeUndefined()
  })
})

describe('reliefweb objects', () => {
  function setup() {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    return { rt, get: (id: string) => rt.board.get(id) as ReliefWebBoardObject }
  }

  it('adds a feed for GLIDE numbers, at its default size, with a title', () => {
    const { rt, get } = setup()
    const rec = rt.dispatch('reliefweb.add', canvas, { x: 0, y: 0, glides: ['FF-2026-000162-NPL'], title: 'Flood in Nepal' })
    expect(rec.status).toBe('applied')
    expect(get(rec.created![0]!)).toMatchObject({ type: 'reliefweb', glides: ['FF-2026-000162-NPL'], title: 'Flood in Nepal', w: 380, h: 440 })
  })

  it('takes only GLIDE numbers', () => {
    const { rt } = setup()
    expect(rt.dispatch('reliefweb.add', canvas, { glides: ['nepal floods'] }).status).toBe('failed')
    expect(rt.dispatch('reliefweb.add', canvas, { glides: ['ff-2026-000162-npl'] }).status).toBe('failed')
  })

  it('sets the disaster of a feed made without one, and tells an agent what it shows', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('reliefweb.add', canvas, {}).created![0]!
    const def = rt.registry.objectType('reliefweb')!
    expect(get(id).glides).toEqual([])
    expect(def.summarize!(get(id))).toBe('no disaster set yet')
    expect(rt.dispatch('reliefweb.setDisaster', { kind: 'objects', ids: [id] }, { glides: ['FF-2026-000162-NPL'], title: 'Flood in Rasuwa' }).status).toBe('applied')
    expect(def.summarize!(get(id))).toBe('ReliefWeb updates for Flood in Rasuwa, GLIDE FF-2026-000162-NPL')
    expect(rt.dispatch('reliefweb.setDisaster', { kind: 'objects', ids: [id] }, { glides: [] }).status).toBe('failed')
  })

  it('is a tool for the agent', () => {
    const { rt } = setup()
    expect(exportTools(rt.availableOps(canvas)).map((t) => t.name)).toContain('reliefweb__add')
  })
})
