import { describe, expect, it } from 'vitest'
import { MontyClient, type StacSearch } from '../src/monty/client'
import { stacItem, type FakeItem } from './stacFixture'

/** Records every request and answers event searches with `events`. Other collections answer empty. */
function fakeApi(events: FakeItem[]) {
  const requests: Record<string, any>[] = []
  const search: StacSearch = async (body) => {
    requests.push(body)
    const collections = body.collections as string[]
    return { features: collections.some((c) => c.endsWith('-events')) ? events.map(stacItem) : [] }
  }
  return { requests, search }
}

describe('Monty client: listEvents', () => {
  it('lists events newest first, whatever order the API returns them in', async () => {
    const api = fakeApi([
      { id: 'a', title: 'Flood A', start: '2021-03-01' },
      { id: 'b', title: 'Flood B', start: '2024-07-15' },
      { id: 'c', title: 'Flood C', start: '2022-11-30' },
    ])
    const list = await new MontyClient(api.search).listEvents()
    expect(list.map((e) => e.id)).toEqual(['b', 'c', 'a'])
    expect(list.map((e) => e.start)).toEqual(['2024-07-15', '2022-11-30', '2021-03-01'])
  })

  it('builds the list from event collections only, without querying impacts', async () => {
    const api = fakeApi([{ id: 'a', title: 'Flood A', start: '2024-01-01' }])
    await new MontyClient(api.search).listEvents()
    const collections = api.requests.flatMap((r) => r.collections as string[])
    expect(collections.length).toBeGreaterThan(0)
    expect(collections.every((c) => c.endsWith('-events'))).toBe(true)
  })

  it('names the source of each event', async () => {
    const api = fakeApi([
      { id: 'a', title: 'Flood A', start: '2024-01-01', collection: 'gdacs-events' },
      { id: 'b', title: 'Flood B', start: '2023-01-01', collection: 'emdat-events' },
    ])
    const list = await new MontyClient(api.search).listEvents()
    expect(list.map((e) => e.source)).toEqual(['GDACS', 'EM-DAT'])
  })
})

describe('Monty client: hazard codes', () => {
  it('filters on UNDRR-ISC codes, with the GLIDE and EM-DAT equivalents', async () => {
    const api = fakeApi([{ id: 'a', title: 'Flood A', start: '2024-01-01' }])
    await new MontyClient(api.search).listEvents()
    const requested = JSON.stringify(api.requests[0]!.filter)
    for (const code of ['MH0309', 'MH0604', 'GH0101', 'MH0401', 'FL', 'nat-hyd-flo-riv']) expect(requested).toContain(`"${code}"`)
  })

  it('types an item that carries only an UNDRR-ISC code', async () => {
    const api = fakeApi([{ id: 'a', title: 'Flood A', start: '2024-01-01', hazards: ['MH0604'] }])
    const [e] = await new MontyClient(api.search).listEvents()
    expect(e!.type).toBe('flood')
  })
})

/**
 * One flood that three sources record under different correlation ids, as upstream warns can happen.
 * https://github.com/IFRCGo/monty-stac-extension/blob/main/docs/model/stac-api/correlation_algorithms.md
 */
const GDACS = stacItem({ id: 'gdacs-event-1', title: 'Flood in Nepal', start: '2024-03-10', collection: 'gdacs-events', hazards: ['MH0604'], corrId: 'A' })
const EMDAT = stacItem({ id: 'emdat-event-2', title: 'Flood in Nepal', start: '2024-03-11', collection: 'emdat-events', hazards: ['nat-hyd-flo-riv'], corrId: 'B' })
const USGS = stacItem({ id: 'usgs-event-3', title: 'Flood in Nepal', start: '2024-03-10', collection: 'usgs-events', hazards: ['FL'], corrId: 'C' })

const impact = (collection: string, corrId: string, type: string, value: number) => ({
  id: `${collection}-${corrId}-${type}`,
  collection,
  properties: { 'monty:corr_id': corrId, 'monty:impact_detail': { type, value } },
})
const IMPACTS = [
  impact('gdacs-impacts', 'A', 'death', 10),
  impact('emdat-impacts', 'B', 'death', 25),
  impact('emdat-impacts', 'B', 'affected_total', 500),
]

/** The corr ids a filter asks for with `monty:corr_id in [...]` or `= id`. */
function corrIdsOf(filter: any): string[] {
  if (filter?.op === 'in') return filter.args[1]
  if (filter?.op === '=') return [filter.args[1]]
  return []
}

function multiSourceApi(opts: { correlationFails?: boolean; lookupFails?: number } = {}) {
  const requests: Record<string, any>[] = []
  let lookupFailures = opts.lookupFails ?? 0
  const search: StacSearch = async (body) => {
    requests.push(body)
    if (body.ids) {
      if (lookupFailures-- > 0) throw new Error('Monty search failed (502)')
      return { features: [GDACS] }
    }
    const collections = body.collections as string[]
    if (body.datetime && collections.every((c) => c.endsWith('-events'))) {
      if (opts.correlationFails) throw new Error('Monty search failed (500)')
      return { features: [GDACS, EMDAT, USGS] }
    }
    if (collections.some((c) => c.endsWith('-impacts'))) {
      const wanted = corrIdsOf(body.filter)
      return { features: IMPACTS.filter((i) => wanted.includes(i.properties['monty:corr_id'])) }
    }
    return { features: [] }
  }
  return { requests, client: new MontyClient(search) }
}

describe('Monty client: one event across sources', () => {
  it('finds the same event in the other sources by hazard, country and time, not by correlation id', async () => {
    const { requests, client } = multiSourceApi()
    await client.getEvent('gdacs-event-1')
    const query = requests.find((r) => !r.ids && r.datetime)!
    const filter = JSON.stringify(query.filter)
    expect(filter).toContain('"MH0604"')
    expect(filter).toContain('"NPL"')
    expect(query.datetime).toBe('2024-03-09T00:00:00Z/2024-03-11T23:59:59Z')
  })

  it('searches the event collections of every source it knows, and no `roles` filter', async () => {
    // The live API returns nothing for `roles in (event)`, and takes 30 s or fails without a collection list.
    const { requests, client } = multiSourceApi()
    await client.getEvent('gdacs-event-1')
    const query = requests.find((r) => !r.ids && r.datetime)!
    expect(query.collections).toEqual(expect.arrayContaining(['gdacs-events', 'emdat-events', 'idmc-gidd-events', 'idmc-idu-events', 'pdc-events', 'ifrcevent-events', 'usgs-events']))
    expect((query.collections as string[]).every((c) => c.endsWith('-events'))).toBe(true)
    expect(JSON.stringify(query.filter)).not.toContain('roles')
  })

  it('lists the sources that reported the event, the one that was picked first', async () => {
    const event = await multiSourceApi().client.getEvent('gdacs-event-1')
    expect(event.sources?.map((s) => [s.source, s.eventIds])).toEqual([
      ['gdacs', ['gdacs-event-1']],
      ['emdat', ['emdat-event-2']],
      ['usgs', ['usgs-event-3']],
    ])
  })

  it('collects impacts of every correlation id, with what each source says', async () => {
    const { requests, client } = multiSourceApi()
    const event = await client.getEvent('gdacs-event-1')
    const asked = requests.filter((r) => (r.collections as string[] | undefined)?.some((c) => c.endsWith('-impacts')))
    expect(asked.flatMap((r) => corrIdsOf(r.filter)).sort()).toEqual(['A', 'B', 'C'])
    expect(event.sources?.find((s) => s.source === 'gdacs')?.impacts).toEqual({ deaths: 10 })
    expect(event.sources?.find((s) => s.source === 'emdat')?.impacts).toEqual({ deaths: 25, affected: 500 })
    expect(event.sources?.find((s) => s.source === 'usgs')?.impacts).toBeUndefined()
  })

  it('reports the largest figure as the headline when sources disagree', async () => {
    const event = await multiSourceApi().client.getEvent('gdacs-event-1')
    expect(event.impacts).toEqual({ deaths: 25, affected: 500 })
  })

  it('still returns the event with its own source when the correlation search fails', async () => {
    const event = await multiSourceApi({ correlationFails: true }).client.getEvent('gdacs-event-1')
    expect(event.id).toBe('gdacs-event-1')
    expect(event.sources?.map((s) => s.source)).toEqual(['gdacs'])
    expect(event.impacts).toEqual({ deaths: 10 })
  })
})

describe('Monty client: hazard intensity', () => {
  /** An earthquake whose event item carries its intensity, as GDACS and EM-DAT items do. */
  async function hazardLabel(severity: number, severityunit: string) {
    const item = stacItem({ id: 'emdat-event-1', title: 'Earthquake', start: '2023-02-06', collection: 'emdat-events', hazards: ['GH0101'] })
    const withSeverity = { ...item, properties: { ...item.properties, severitydata: { severity, severityunit } } }
    const client = new MontyClient(async (body) => ({ features: body.ids ? [withSeverity] : [] }))
    return (await client.getEvent('emdat-event-1')).hazard?.label
  }

  it.each([
    ['Moment Magnitude', 'Mw 7.8'],
    ['mww', 'Mw 7.8'],
    ['Mw', 'Mw 7.8'],
    ['M', 'M 7.8'],
    ['mb', 'M 7.8'],
  ])('labels a magnitude in "%s" as %s', async (unit, label) => {
    expect(await hazardLabel(7.8, unit)).toBe(label)
  })

  it('keeps other units after the value', async () => {
    expect(await hazardLabel(204, 'km/h')).toBe('204 km/h')
  })

  it('has none when Monty gives -1 for "no value"', async () => {
    expect(await hazardLabel(-1, 'mww')).toBeUndefined()
  })
})

describe('Monty client: getEvent requests', () => {
  it('asks once when several events on the board show the same id', async () => {
    const { requests, client } = multiSourceApi()
    const [a, b] = await Promise.all([client.getEvent('gdacs-event-1'), client.getEvent('gdacs-event-1')])
    expect(a).toBe(b)
    expect(requests.filter((r) => r.ids)).toHaveLength(1)
  })

  it('tries again after a failed load', async () => {
    const { client } = multiSourceApi({ lookupFails: 1 })
    await expect(client.getEvent('gdacs-event-1')).rejects.toThrow(/502/)
    expect((await client.getEvent('gdacs-event-1')).id).toBe('gdacs-event-1')
  })
})
