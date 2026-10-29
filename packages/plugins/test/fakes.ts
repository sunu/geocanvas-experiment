import * as Y from 'yjs'
import { z } from 'zod'
import { defineTool, Runtime, ToolRunner, type Actor, type ToolDef } from '@ttx/core'
import { plugins, type EventFacts, type PlaceFeatures } from '../src/index'

/** Fakes of Montandon and the geocoder for templates and links (plans/plan-012.md, plan-013.md). */

export const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
export const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent', onBehalfOf: 'ada' }
export const canvas = { kind: 'canvas' } as const

export const nepal: EventFacts = {
  id: 'gdacs-event-1104124-1',
  name: 'Flood in Nepal',
  start: '2026-08-02',
  end: '2026-08-09',
  country: 'NPL',
  glides: ['FF-2026-000162-NPL'],
  bbox: [83, 27, 86, 29],
}

export const idai: EventFacts = {
  id: 'gdacs-event-1000552-1',
  name: 'Cyclone Idai',
  start: '2019-03-04',
  end: '2019-03-21',
  country: 'MOZ',
  glides: ['TC-2019-000021-MOZ'],
  bbox: [32, -21, 36, -17],
}

export const beira = { name: 'Beira, Mozambique', lngLat: [34.84, -19.84] as [number, number], bbox: [34.74, -19.91, 34.95, -19.69] as [number, number, number, number], iso3: 'MOZ' }

export const points = (places: object[]): PlaceFeatures =>
  ({ type: 'FeatureCollection', features: places.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: p })) }) as PlaceFeatures

/** Montandon and the geocoder, faked. Search finds the first event; `calls` lists each tool call. */
export function fakeTools(events: EventFacts[] = [nepal]) {
  const calls: string[] = []
  const tool = (id: string, run: (input: any) => unknown): ToolDef =>
    defineTool({ id, title: id, description: id, input: z.any(), output: 'json', cache: false, run: (input) => (calls.push(`${id} ${JSON.stringify(input)}`), run(input)) })
  const runner = new ToolRunner([
    tool('events.search', ({ text }) => (text === 'nothing' ? 'No events found.' : [{ id: events[0]!.id, name: events[0]!.name }])),
    tool('events.get', ({ id }) => {
      const e = events.find((e) => e.id === id)
      if (!e) throw new Error(`Unknown event: ${id}`)
      return e
    }),
    tool('data.geocode', ({ query }) =>
      points(query === 'Nepal' ? [{ name: 'Nepal', lngLat: [84, 28], bbox: [80, 26, 88, 30.5], iso3: 'NPL' }] : query === 'nowhere' ? [] : [beira]),
    ),
    tool('data.reverseGeocode', () => points([{ name: 'Somewhere', lngLat: [0, 0], iso3: 'MOZ' }])),
  ])
  return { runner, calls }
}

export function setup(tools?: ToolRunner) {
  const doc = new Y.Doc()
  const rt = new Runtime({ doc, plugins, actor: ada, ...(tools && { tools }) })
  return { doc, rt }
}
