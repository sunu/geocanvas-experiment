import { describe, expect, it } from 'vitest'
import { MontyClient, type StacSearch } from '../src/events/monty'
import { describeSearch, overviewOf, parseSearch } from '../src/events/search'
import { sourceLabel } from '../src/events/sources'
import { stacItem, type FakeItem } from './stacFixture'

describe('parse a search', () => {
  it('reads country, hazard type and year', () => {
    expect(parseSearch('nepal floods 2023')).toEqual({
      types: ['flood'],
      countries: ['NPL'],
      fromYear: 2023,
      toYear: 2023,
      sources: [],
      words: [],
    })
  })

  it('leaves the words it does not recognise, minus filler words', () => {
    expect(parseSearch('Cyclone Idai in the Mozambique').words).toEqual(['idai'])
    expect(parseSearch('nep').words).toEqual(['nep'])
  })

  it('picks the longest country name that fits', () => {
    expect(parseSearch('south sudan').countries).toEqual(['SSD'])
    expect(parseSearch('sudan').countries).toEqual(['SDN'])
    expect(parseSearch('niger').countries).toEqual(['NER'])
    expect(parseSearch('nigeria').countries).toEqual(['NGA'])
    expect(parseSearch('papua new guinea').countries).toEqual(['PNG'])
  })

  it('knows the names people use, with or without accents', () => {
    expect(parseSearch('Turkey').countries).toEqual(['TUR'])
    expect(parseSearch('türkiye').countries).toEqual(['TUR'])
    expect(parseSearch('turkiye').countries).toEqual(['TUR'])
    expect(parseSearch('vietnam').countries).toEqual(['VNM'])
    expect(parseSearch('ivory coast').countries).toEqual(['CIV'])
    expect(parseSearch('USA').countries).toEqual(['USA'])
  })

  it('takes several countries and a range of years', () => {
    const q = parseSearch('india and bangladesh 2019 2022')
    expect(q.countries.sort()).toEqual(['BGD', 'IND'])
    expect([q.fromYear, q.toYear]).toEqual([2019, 2022])
  })

  it('has nothing to say about an empty search', () => {
    expect(parseSearch('  ')).toEqual({ types: [], countries: [], sources: [], words: [] })
  })
})

describe('parse a source name', () => {
  it.each([
    ['gdacs', ['gdacs']],
    ['GDACS floods', ['gdacs']],
    ['emdat', ['emdat']],
    ['EM-DAT', ['emdat']],
    ['em dat earthquakes', ['emdat']],
    ['gdacs emdat', ['gdacs', 'emdat']],
    ['nepal floods', []],
    ['pdc', ['pdc']],
    ['IFRC', ['ifrcevent']],
    ['ifrc event', ['ifrcevent']],
    ['usgs earthquakes', ['usgs']],
    ['GLIDE', ['glide']],
    ['cems', ['cems']],
    ['IBTrACS', ['ibtracs']],
    ['gfd', ['gfd']],
    ['idmc', ['idmc']],
    ['DesInventar', ['desinventar']],
  ])('%s', (text, sources) => {
    expect(parseSearch(text).sources).toEqual(sources)
  })

  it('does not leave the source name behind as a word', () => {
    expect(parseSearch('EM-DAT nepal floods 2023').words).toEqual([])
  })
})

describe('Monty client: findEvents', () => {
  const events: FakeItem[] = [
    { id: 'idai', title: 'Tropical Cyclone IDAI-19', start: '2019-03-09', hazards: ['MH0309'], countries: ['MOZ'] },
    { id: 'flood', title: 'Flood in Mozambique', start: '2023-02-01', hazards: ['MH0604'], countries: ['MOZ'] },
  ]
  function api(items = events) {
    const requests: Record<string, any>[] = []
    const search: StacSearch = async (body) => {
      requests.push(body)
      return { features: items.map(stacItem) }
    }
    return { requests, client: new MontyClient(search) }
  }

  it('asks Monty for the country, hazard codes and years named in the search', async () => {
    const { requests, client } = api()
    await client.findEvents('nepal floods 2023')
    const body = requests[0]!
    const filter = JSON.stringify(body.filter)
    expect(filter).toContain('"NPL"')
    expect(filter).toContain('"MH0604"')
    expect(filter).not.toContain('"MH0309"')
    expect(body.datetime).toBe('2023-01-01T00:00:00Z/2023-12-31T23:59:59Z')
    expect(body.sortby).toEqual([{ field: 'datetime', direction: 'desc' }])
  })

  it('searches every supported hazard when the text names none', async () => {
    const { requests, client } = api()
    await client.findEvents('nepal')
    expect(JSON.stringify(requests[0]!.filter)).toContain('"MH0309"')
    expect(requests[0]!.datetime).toBeUndefined()
  })

  it('narrows to the events whose name has the leftover words', async () => {
    const found = await api().client.findEvents('mozambique idai')
    expect(found.map((e) => e.id)).toEqual(['idai'])
  })

  it('keeps the structured matches when no name has the leftover words', async () => {
    const found = await api().client.findEvents('mozambique zzzz')
    expect(found.map((e) => e.id)).toEqual(['flood', 'idai'])
  })

  it('finds nothing when only leftover words are given and none match', async () => {
    expect(await api().client.findEvents('zzzz')).toEqual([])
  })

  it('lists the newest events for an empty search', async () => {
    const found = await api().client.findEvents('')
    expect(found.map((e) => e.id)).toEqual(['flood', 'idai'])
  })

  it('asks only the source it was named, whatever else is in the text', async () => {
    const { requests, client } = api()
    await client.findEvents('EM-DAT nepal floods')
    expect(requests[0]!.collections).toEqual(['emdat-events'])
    expect(JSON.stringify(requests[0]!.filter)).toContain('"NPL"')
  })

  it.each([
    ['pdc nepal', ['pdc-events']],
    ['ifrc', ['ifrcevent-events']],
    ['idmc', ['idmc-gidd-events', 'idmc-idu-events']],
    ['usgs earthquakes', ['usgs-events']],
    ['gdacs emdat', ['gdacs-events', 'emdat-events']],
  ])('asks the collections of the source in "%s"', async (text, collections) => {
    const { requests, client } = api()
    await client.findEvents(text)
    expect(requests[0]!.collections).toEqual(collections)
  })

  it('asks both listed sources when none is named', async () => {
    const { requests, client } = api()
    await client.findEvents('nepal')
    expect(requests[0]!.collections).toEqual(['gdacs-events', 'emdat-events'])
  })

  it('stops at the limit', async () => {
    expect(await api().client.findEvents('mozambique', 1)).toHaveLength(1)
  })
})

describe('describe a search', () => {
  it('says how the text was read', () => {
    expect(describeSearch('nepal floods 2023')).toEqual(['Nepal', 'flood', '2023'])
    expect(describeSearch('Cyclone Idai in Mozambique')).toEqual(['Mozambique', 'cyclone', '"idai"'])
    expect(describeSearch('india and bangladesh earthquakes 2019 2022')).toEqual(['India', 'Bangladesh', 'earthquake', '2019–2022'])
  })

  it('has nothing to say about an empty search', () => {
    expect(describeSearch('')).toEqual([])
  })

  it('names the source', () => {
    expect(describeSearch('emdat floods in nepal')).toEqual(['Nepal', 'flood', 'EM-DAT'])
  })
})

describe('overview of results', () => {
  const event = (source: string) => ({ id: source + Math.random(), name: 'x', type: 'flood' as const, start: '2024-01-01', year: 2024, country: 'NPL', source })

  it('counts the events and where they come from', () => {
    const events = [event('GDACS'), event('GDACS'), event('EM-DAT')]
    expect(overviewOf('nepal floods', events)).toBe('Nepal · flood — 3 events (GDACS 2, EM-DAT 1)')
  })

  it('leaves out the reading of the text when nothing in it was recognised', () => {
    expect(overviewOf('', [event('GDACS')])).toBe('1 event (GDACS 1)')
  })

  it('says when the list may be cut off', () => {
    const events = Array.from({ length: 60 }, () => event('GDACS'))
    expect(overviewOf('', events, 60)).toBe('60+ events (GDACS 60)')
  })

  it('says when there are none', () => {
    expect(overviewOf('nepal floods', [])).toBe('Nepal · flood — no events')
  })
})

describe('source labels', () => {
  it('uses the names people know', () => {
    expect(sourceLabel('emdat')).toBe('EM-DAT')
    expect(sourceLabel('gdacs')).toBe('GDACS')
    expect(sourceLabel('usgs')).toBe('USGS')
    expect(sourceLabel('ifrcevent')).toBe('IFRC')
    expect(sourceLabel('ibtracs')).toBe('IBTrACS')
    expect(sourceLabel('desinventar')).toBe('DesInventar')
  })
})
