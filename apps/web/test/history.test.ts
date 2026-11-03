import { describe, expect, it } from 'vitest'
import { ToolRunner } from '@ttx/core'
import { hazardFamily } from '@ttx/plugins'
import type { StacSearch } from '@ttx/plugins/monty/client'
import { desinventarTool, recordsOf } from '../src/history/desinventar'
import { historyOf, readHistory, type PastEvent } from '../src/history/history'

const event = (year: number, family: PastEvent['family'], deaths = 0, affected = 0): PastEvent => ({
  id: `e${year}${family}${deaths}`,
  title: `${family} in Nepal`,
  date: `${year}-07-01`,
  year,
  family,
  deaths,
  affected,
})

describe('hazard families', () => {
  it("come from EM-DAT's classification code, technological apart", () => {
    expect(hazardFamily(['MH0600', 'FL', 'nat-hyd-flo-riv'])).toBe('flood')
    expect(hazardFamily(['GH0007', 'nat-hyd-mmw-lan'])).toBe('landslide')
    expect(hazardFamily(['nat-geo-ear-gro'])).toBe('earthquake')
    expect(hazardFamily(['nat-bio-inf-inf'])).toBe('otherNatural')
    expect(hazardFamily(['tec-tra-roa-roa'])).toBe('technological')
    expect(hazardFamily(['FL'])).toBeUndefined()
  })
})

describe("a country's history", () => {
  const events = [event(1988, 'earthquake', 721), event(2015, 'earthquake', 8969, 5_600_000), event(2017, 'flood', 160, 1_700_000), event(2019, 'flood', 0, 100), event(2021, 'technological', 30)]
  const now = new Date('2026-10-30')

  it('counts natural hazard disasters by decade and family, the deadliest first, and leaves accidents out', () => {
    const h = historyOf(events, '', now, 2)
    expect(h).toMatchObject({ events: 4, deaths: 9850, affected: 7_300_100, first: 1988, last: 2019, technological: 1 })
    expect(h.decades.map((d) => [d.decade, d.total])).toEqual([[1980, 1], [1990, 0], [2000, 0], [2010, 3], [2020, 0]])
    expect(h.decades[3]!.byFamily).toEqual({ earthquake: 1, flood: 2 })
    expect(h.deadliest.map((e) => e.year)).toEqual([2015, 1988])
    // As many earthquakes as floods: the deadlier first.
    expect(h.families).toEqual([
      { family: 'earthquake', events: 2, deaths: 9690, affected: 5_600_000 },
      { family: 'flood', events: 2, deaths: 160, affected: 1_700_100 },
    ])
  })

  it('shows one family when filtered', () => {
    const h = historyOf(events, 'flood', now)
    expect(h).toMatchObject({ events: 2, first: 2017, technological: 0 })
    expect(h.decades.map((d) => d.decade)).toEqual([2010, 2020])
  })

  it("reads every page of events and impacts by country, without geometry, and joins them by EM-DAT's id in the item ids", async () => {
    const bodies: Record<string, unknown>[] = []
    const search = (async (body: Record<string, unknown>) => {
      bodies.push(body)
      const coll = (body.collections as string[])[0]
      if (coll === 'emdat-events')
        return {
          features: [{ id: 'emdat-event-2015-0114-NPL', collection: coll, properties: { title: 'Ground movement in Nepal', datetime: '2015-04-25T00:00:00Z', 'monty:src_event_id': null, 'monty:hazard_codes': ['nat-geo-ear-gro'] } }],
        }
      // Impacts in two pages: Montandon's next link is a POST body with a token.
      if (!body.token)
        return {
          features: [{ id: 'emdat-impact-2015-0114-NPL-total_deaths', collection: coll, properties: { 'monty:src_event_id': null, 'monty:impact_detail': { type: 'death', value: 8969 } } }],
          links: [{ rel: 'next', body: { ...body, token: 'next:2' } }],
        } as never
      return { features: [{ id: 'emdat-impact-2015-0114-NPL-total_affected', collection: coll, properties: { 'monty:impact_detail': { type: 'affected_total', value: 5_600_000 } } }] }
    }) as StacSearch
    expect(await readHistory(search, 'NPL')).toEqual([{ id: 'emdat-event-2015-0114-NPL', title: 'Ground movement in Nepal', date: '2015-04-25', year: 2015, family: 'earthquake', deaths: 8969, affected: 5_600_000 }])
    expect(bodies[0]).toMatchObject({ filter: { op: 'a_overlaps', args: [{ property: 'monty:country_codes' }, ['NPL']] }, fields: { exclude: expect.arrayContaining(['geometry']) } })
    expect(bodies).toHaveLength(3)
  })
})

/** A DesInventar impact item as Montandon has it, trimmed. */
const impact = (record: number, type: string, value: number, title = 'FLOOD in Ward no. 8 on 2013-07-30 00:00:00+00:00') => ({
  id: `desinventar-impact-${record}-${type}s`,
  collection: 'desinventar-impacts',
  geometry: { type: 'Polygon', coordinates: [[[84.4, 27.6], [84.42, 27.6], [84.42, 27.62], [84.4, 27.6]]] },
  properties: { title: `${title} - ${type}s`, datetime: '2013-07-30T00:00:00Z', 'monty:hazard_codes': ['nat-hyd-flo-flo'], 'monty:impact_detail': { type, value } },
})

describe('DesInventar records', () => {
  it('folds the impact items of a record into one point with its losses, newest first', () => {
    const f = recordsOf([impact(1, 'death', 2), impact(1, 'destroyed', 14), impact(1, 'cost', 9000), impact(2, 'death', 1, 'FIRE in None on 2009-01-02 00:00:00+00:00')])
    expect(f).toHaveLength(2)
    expect(f[0]!.geometry.coordinates).toEqual([84.41, 27.61])
    expect(f[0]!.properties).toEqual({ name: 'FLOOD in Ward no. 8', hazard: 'Floods', event: 'FLOOD', place: 'Ward no. 8', date: '2013-07-30', year: 2013, deaths: 2, housesDestroyed: 14 })
    expect(f[1]!.properties).toMatchObject({ name: 'FIRE', place: null })
  })

  it('reads an area up to about a district, and says when DesInventar has nothing there', async () => {
    const asked: Record<string, unknown>[] = []
    const search: StacSearch = async (body) => (asked.push(body), { features: asked.length > 1 ? [] : [impact(1, 'death', 2)] }) as never
    const runner = new ToolRunner([desinventarTool(search)])
    const fc = await runner.run<GeoJSON.FeatureCollection & { attribution: string }>('history.desinventar', { area: [84, 27.3, 84.8, 27.8] })
    expect(fc.features).toHaveLength(1)
    expect(fc.attribution).toMatch(/DesInventar/)
    expect(asked[0]).toMatchObject({ collections: ['desinventar-impacts'], intersects: { type: 'Polygon' } })
    await expect(runner.run('history.desinventar', { area: [80, 26, 88, 30] })).rejects.toThrow(/too large/)
    await expect(runner.run('history.desinventar', { area: [10, 10, 10.5, 10.5] })).rejects.toThrow(/no records here/)
  })
})
