import { afterEach, describe, expect, it, vi } from 'vitest'
import { hapiAll } from '../src/hapi/api'
import { conflictOf, startDate } from '../src/hapi/conflict'
import { presenceOf } from '../src/hapi/presence'

// Rows shaped as HDX HAPI returned them for Mozambique (October 2026), trimmed to the fields read.
const org = (org_acronym: string, org_type_description: string, sector_code: string, sector_name: string, admin1_code: string, admin1_name: string, admin2_name: string) => ({
  org_acronym,
  org_name: `${org_acronym} (full name)`,
  org_type_description,
  sector_code,
  sector_name,
  admin1_code,
  admin1_name,
  admin2_name,
  admin_level: 2,
  reference_period_start: '2026-01-01T00:00:00',
  resource_hdx_id: '3w',
})
const PRESENCE = [
  org('ACF-France', 'International NGO', 'HEA', 'Health', 'MZ01', 'Niassa', 'Cidade de Lichinga'),
  org('ACF-France', 'International NGO', 'HEA', 'Health', 'MZ01', 'Niassa', 'Cuamba'),
  org('ACF-France', 'International NGO', 'NUT', 'Nutrition', 'MZ02', 'Cabo Delgado', 'Pemba'),
  org('WFP', 'United Nations', 'FSC', 'Food Security', 'MZ02', 'Cabo Delgado', 'Pemba'),
  org('WFP', 'United Nations', 'NUT', 'Nutrition', 'MZ07', 'Sofala', 'Beira'),
  org('WFP', 'United Nations', 'FSC', 'Food Security', 'MZ01', 'Niassa', 'Cuamba'),
  org('UNICEF', 'United Nations', 'NUT', 'Nutrition', 'MZ02', 'Cabo Delgado', 'Mocímboa da Praia'),
  org('MISAU', 'Government', 'HEA', 'Health', 'MZ01', 'Niassa', 'Cuamba'),
]

describe("who's where", () => {
  it('counts each organization once, by province and by sector, with the ones in the most provinces first', () => {
    const p = presenceOf(PRESENCE, '')!
    expect(p).toMatchObject({ year: '2026', orgs: 4, source: '3w' })
    expect(p.provinces).toEqual([
      { code: 'MZ01', name: 'Niassa', orgs: 3 },
      { code: 'MZ02', name: 'Cabo Delgado', orgs: 3 },
      { code: 'MZ07', name: 'Sofala', orgs: 1 },
    ])
    expect(p.sectors).toEqual([
      { code: 'NUT', name: 'Nutrition', orgs: 3 },
      { code: 'HEA', name: 'Health', orgs: 2 },
      { code: 'FSC', name: 'Food Security', orgs: 1 },
    ])
    expect(p.topOrgs.map((o) => [o.name, o.provinces])).toEqual([
      ['WFP', 3],
      ['ACF-France', 2],
      ['MISAU', 1],
      ['UNICEF', 1],
    ])
    expect(p.topOrgs[0]).toMatchObject({ fullName: 'WFP (full name)', type: 'United Nations' })
  })

  it("shows one sector's organizations, and still offers every sector to filter by", () => {
    const p = presenceOf(PRESENCE, 'NUT')!
    expect(p.orgs).toBe(3)
    expect(p.provinces.map((r) => [r.name, r.orgs])).toEqual([
      ['Cabo Delgado', 2],
      ['Sofala', 1],
    ])
    expect(p.sectors).toHaveLength(3)
  })

  it('has nothing for a country without a 3W', () => {
    expect(presenceOf([], '')).toBeUndefined()
  })
})

const TODAY = new Date('2026-10-28T12:00:00Z')
const violence = (month: string, admin1_name: string | null, events: number, fatalities: number) => ({
  event_type: 'political_violence',
  admin1_name,
  events,
  fatalities,
  reference_period_start: `${month}-01T00:00:00`,
  resource_hdx_id: 'acled',
})

describe('conflict', () => {
  it('asks for the current month and the 11 before it', () => {
    expect(startDate(TODAY)).toBe('2025-11-01')
    expect(startDate(new Date('2026-01-15T00:00:00Z'))).toBe('2025-02-01')
  })

  it('adds up districts by month and by province, with every month shown and the current one marked as not over', () => {
    const c = conflictOf(
      [
        violence('2025-11', 'Cabo Delgado', 20, 50),
        violence('2025-11', 'Niassa', 3, 1),
        violence('2026-05', 'Cabo Delgado', 40, 100),
        violence('2026-10', 'Sofala', 2, 0),
        violence('2026-10', 'Gaza', 0, 0),
        violence('2025-10', 'Cabo Delgado', 99, 99), // before the 12 months
      ],
      TODAY,
    )
    expect(c.months).toHaveLength(12)
    expect(c.months[0]).toEqual({ month: '2025-11', events: 23, fatalities: 51, partial: false })
    expect(c.months[1]).toEqual({ month: '2025-12', events: 0, fatalities: 0, partial: false })
    expect(c.months.at(-1)).toEqual({ month: '2026-10', events: 2, fatalities: 0, partial: true })
    expect([c.events, c.fatalities]).toEqual([65, 151])
    expect(c.provinces.map((p) => [p.name, p.events])).toEqual([
      ['Cabo Delgado', 60],
      ['Niassa', 3],
      ['Sofala', 2],
    ])
    expect(c.source).toBe('acled')
  })

  it('leaves districts HAPI could not match out of the provinces, since their province can be wrong, but counts them', () => {
    const quissanga = { ...violence('2026-05', 'Niassa', 9, 2), admin1_code: 'MZ01', admin2_code: 'MZ01-XXX' }
    const c = conflictOf([violence('2026-05', 'Niassa', 4, 0), quissanga], TODAY)
    expect(c.events).toBe(13)
    expect(c.provinces).toEqual([{ name: 'Niassa', events: 4, fatalities: 0 }])
    expect(c.unplaced).toBe(9)
  })

  it('has months but no provinces for a country with national totals only', () => {
    const c = conflictOf([violence('2026-06', null, 319, 2)], TODAY)
    expect(c.events).toBe(319)
    expect(c.provinces).toEqual([])
  })
})

describe('reading HDX HAPI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reads every page of a query: HAPI stops at 10,000 rows without saying so', async () => {
    const offsets: string[] = []
    vi.stubGlobal('fetch', async (path: string) => {
      const url = new URL(path, 'https://board.example')
      offsets.push(url.searchParams.get('offset')!)
      const n = url.searchParams.get('offset') === '0' ? 10000 : 1234
      return new Response(JSON.stringify({ data: Array.from({ length: n }, (_, i) => ({ i })) }))
    })
    const rows = await hapiAll('coordination-context/conflict-events', { location_code: 'SDN' })
    expect(rows).toHaveLength(11234)
    expect(offsets).toEqual(['0', '10000'])
  })
})
