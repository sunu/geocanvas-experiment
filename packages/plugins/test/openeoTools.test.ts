import { afterEach, describe, expect, it, vi } from 'vitest'
import { openeoCollections, openeoCoverage } from '../src/openeoTools.js'

const BASE = 'https://eopf.example/openeo'
const ctx = {} as never // the tools use neither the board nor other tools

function stubFetch(routes: Record<string, (init: RequestInit) => unknown>) {
  const calls: { url: string; body?: any }[] = []
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    calls.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[url]
    return route ? Response.json(route(init)) : new Response('unexpected request', { status: 500 })
  })
  return calls
}

describe('openeo.collections', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('lists each collection with its first date and the band names to use in load_collection', async () => {
    stubFetch({
      [`${BASE}/collections`]: () => ({
        collections: [
          { id: 'sentinel-2-l2a', title: 'Sentinel-2 Level-2A', extent: { temporal: { interval: [['2015-01-01T00:00:00Z', null]] } }, 'cube:dimensions': { bands: { type: 'bands', values: ['SCL_20m', 'reflectance|bands=b04', 'reflectance|bands=b08'] } } },
          { id: 'sentinel-3-olci', title: 'OLCI', extent: { temporal: { interval: [['2016-04-25T00:00:00Z', null]] } }, summaries: { bands: [{ name: 'Oa01' }] } },
        ],
      }),
    })
    const text = (await openeoCollections(BASE).run({}, ctx)) as string
    expect(text).toContain('sentinel-2-l2a · Sentinel-2 Level-2A · from 2015-01-01 · bands: SCL_20m, reflectance|bands=b04, reflectance|bands=b08')
    expect(text).toContain('sentinel-3-olci · OLCI · from 2016-04-25 · bands: Oa01')
  })
})

describe('openeo.coverage', () => {
  afterEach(() => vi.unstubAllGlobals())
  const input = { collection: 'sentinel-2-l2a', west: 12.35, south: 41.75, east: 12.65, north: 42, start: '2026-08-01', end: '2026-09-30' }
  const feature = (datetime: string, cloud?: number) => ({ properties: { datetime, ...(cloud === undefined ? {} : { 'eo:cloud_cover': cloud }) } })

  it('counts the scenes over the area in the dates, with their dates and cloud cover', async () => {
    const calls = stubFetch({ 'https://eopf.example/stac/search': () => ({ features: [feature('2026-08-02T10:00:00Z', 4), feature('2026-08-07T10:00:00Z', 30), feature('2026-08-12T10:00:00Z', 10)] }) })
    const text = (await openeoCoverage(BASE).run(input, ctx)) as string
    // The centre, not the whole box: a scene that clips the box's edge makes a layer that is empty where it is tested and shown.
    expect(calls[0]!.body).toMatchObject({ collections: ['sentinel-2-l2a'], intersects: { type: 'Point', coordinates: [12.5, 41.875] }, datetime: '2026-08-01T00:00:00Z/2026-09-30T23:59:59Z' })
    expect(calls[0]!.body.bbox).toBeUndefined()
    expect(text).toContain('3 scenes over the centre of this area')
    expect(text).toContain('2026-08-02 (4% cloud), 2026-08-07 (30% cloud), 2026-08-12 (10% cloud)')
  })

  it('gives a day its lowest cloud cover when several scenes share it', async () => {
    stubFetch({ 'https://eopf.example/stac/search': () => ({ features: [feature('2026-08-02T10:00:00Z', 40), feature('2026-08-02T10:00:05Z', 6)] }) })
    expect(((await openeoCoverage(BASE).run(input, ctx)) as string)).toContain('2026-08-02 (6% cloud)')
  })

  it('says when there are none, and when the newest scene over the area is', async () => {
    let n = 0
    const calls = stubFetch({ 'https://eopf.example/stac/search': () => (n++ === 0 ? { features: [] } : { features: [feature('2026-07-02T05:00:00Z')] }) })
    const text = (await openeoCoverage(BASE).run(input, ctx)) as string
    expect(text).toMatch(/no scenes/i)
    expect(text).toContain('2026-07-02')
    expect(calls[1]!.body).toMatchObject({ intersects: { type: 'Point', coordinates: [12.5, 41.875] }, sortby: [{ field: 'datetime', direction: 'desc' }], limit: 1 })
    expect(calls[1]!.body.datetime).toBeUndefined()
  })

  it('reads the dates of a collection whose scenes span a time range and have no single datetime', async () => {
    const ranged = (start: string) => ({ properties: { datetime: null, start_datetime: `${start}T00:00:00Z`, end_datetime: `${start}T23:59:59Z` } })
    stubFetch({ 'https://eopf.example/stac/search': () => ({ features: [ranged('2026-06-23'), ranged('2026-06-29')] }) })
    const text = (await openeoCoverage(BASE).run(input, ctx)) as string
    expect(text).toContain('2026-06-23, 2026-06-29')
    expect(text).not.toMatch(/cloud/)
  })

  it('does not claim a count when the search was cut off', async () => {
    stubFetch({ 'https://eopf.example/stac/search': () => ({ features: Array.from({ length: 100 }, (_, i) => feature(`2026-08-${String(1 + (i % 28)).padStart(2, '0')}T00:00:00Z`)) }) })
    expect(((await openeoCoverage(BASE).run(input, ctx)) as string)).toContain('100 or more scenes')
  })
})
