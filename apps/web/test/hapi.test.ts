import { afterEach, describe, expect, it, vi } from 'vitest'
import { appealsOf, displacementOf, loadContext, needsOf, populationOf, povertyOf, riskOf } from '../src/hapi/context'

// Rows as HDX HAPI returned them (October 2026), trimmed to the fields read.
const RISK = { risk_class: '3', global_rank: 59, overall_risk: 4.6, hazard_exposure_risk: 3.4, vulnerability_risk: 4.8, coping_capacity_risk: 5.9, reference_period_start: '2025-01-01T00:00:00', resource_hdx_id: 'inform', location_code: 'NPL' }
const POPULATION = [
  { admin_level: 0, resource_hdx_id: 'pop', gender: 'f', age_range: '0-4', population: 1271243, reference_period_start: '2023-01-01T00:00:00' },
  { admin_level: 0, resource_hdx_id: 'pop', gender: 'f', age_range: 'all', population: 15776443, reference_period_start: '2023-01-01T00:00:00' },
  { admin_level: 0, resource_hdx_id: 'pop', gender: 'm', age_range: 'all', population: 15123000, reference_period_start: '2023-01-01T00:00:00' },
]
const POVERTY = [
  { admin_level: 1, admin1_name: 'Koshi', resource_hdx_id: 'mpi-sub', mpi: 0.0704, headcount_ratio: 16.9578, reference_period_start: '2022-01-01T00:00:00' },
  { admin_level: 0, admin1_name: null, resource_hdx_id: 'mpi', mpi: 0.0744, headcount_ratio: 17.5129, reference_period_start: '2019-01-01T00:00:00' },
  { admin_level: 0, admin1_name: null, resource_hdx_id: 'mpi', mpi: 0.0678, headcount_ratio: 16.3857, reference_period_start: '2022-01-01T00:00:00' },
]
const need = (category: string, population_status: string, population: number, y: number) => ({
  sector_code: 'Intersectoral',
  category,
  population_status,
  population,
  reference_period_start: `${y}-01-01T00:00:00`,
  resource_hdx_id: 'hnrp',
})
const NEEDS = [
  need('', 'INN', 2252973, 2024),
  need('', 'INN', 2356162, 2026),
  need('total', 'INN', 2356162, 2026),
  need('', 'TGT', 1745582, 2026),
  need('', 'all', 35600000, 2026),
  need('IDP', 'INN', 594551, 2026),
]
const idp = (operation: string, population: number, date: string) => ({
  resource_hdx_id: 'dtm',
  operation,
  population,
  reference_period_start: `${date}T00:00:00`,
  reference_period_end: `${date}T23:59:59`,
})
const IDPS = [
  idp('Nepal Earthquake', 21315, '2016-06-30'),
  idp('Nepal Flash Floods 2026', 3888, '2026-09-30'),
  idp('Nepal Earthquake', 15595, '2016-12-31'),
  idp('Floods in Nepal (2020)', 13352, '2020-07-30'),
  idp('Nepal Floods (2017)', 5072, '2017-08-31'),
]
const appeal = (appeal_code: string, appeal_name: string, appeal_type: string, requirements_usd: number | null, funding_usd: number, funding_pct: number | null, y: number) => ({
  resource_hdx_id: 'fts',
  appeal_code,
  appeal_name,
  appeal_type,
  requirements_usd,
  funding_usd,
  funding_pct,
  reference_period_start: `${y}-01-01T00:00:00`,
})
const FUNDING = [
  appeal('Not specified', 'Not specified', '', null, 7112353, null, 2028),
  appeal('FMOZ25', 'Mozambique Drought Flash Appeal 2025', 'Flash appeal', 133082917, 10834599, 8, 2025),
  appeal('HMOZ26', 'Mozambique Humanitarian Needs and Response Plan 2026', 'Humanitarian needs and response plan', 534342584, 226178621, 42, 2026),
  appeal('Not specified', 'Not specified', '', null, 22339152, null, 2026),
  appeal('HMOZ24', 'Mozambique Humanitarian Response Plan 2024', 'Humanitarian response plan', 413377389, 133000000, 32, 2024),
]

describe('HDX HAPI figures for a country context', () => {
  it('reads INFORM risk and its dimensions', () => {
    expect(riskOf([RISK])).toEqual({ riskClass: 3, globalRank: 59, overall: 4.6, hazard: 3.4, vulnerability: 4.8, coping: 5.9, year: '2025', source: 'inform' })
    expect(riskOf([])).toBeUndefined()
  })

  it('adds up women and men of all ages for the total population, or takes a row for everyone', () => {
    expect(populationOf(POPULATION)).toEqual({ total: 30899443, year: '2023', source: 'pop' })
    expect(populationOf([...POPULATION, { ...POPULATION[1]!, gender: 'all', population: 30900000 }])?.total).toBe(30900000)
    expect(populationOf([])).toBeUndefined()
  })

  it("takes the latest national poverty rate, not a province's", () => {
    expect(povertyOf(POVERTY)).toEqual({ headcount: 16.3857, mpi: 0.0678, year: '2022', source: 'mpi' })
  })

  it('takes people in need and targeted, all sectors and groups together, from the latest plan', () => {
    expect(needsOf(NEEDS)).toEqual({ inNeed: 2356162, targeted: 1745582, year: '2026', source: 'hnrp' })
    expect(needsOf([])).toBeUndefined()
  })

  it("lists each displacement operation's latest round, the most recent operations first", () => {
    expect(displacementOf(IDPS).map((d) => [d.operation, d.idps, d.date])).toEqual([
      ['Nepal Flash Floods 2026', 3888, '2026-09-30'],
      ['Floods in Nepal (2020)', 13352, '2020-07-30'],
      ['Nepal Floods (2017)', 5072, '2017-08-31'],
    ])
  })

  it('lists the appeals of the latest two years, without the funding given outside any appeal', () => {
    expect(appealsOf(FUNDING).map((a) => [a.code, a.fundedPct, a.year])).toEqual([
      ['HMOZ26', 42, '2026'],
      ['FMOZ25', 8, '2025'],
    ])
    expect(appealsOf(FUNDING)[0]).toMatchObject({ requiredUsd: 534342584, fundedUsd: 226178621, type: 'Humanitarian needs and response plan' })
  })
})

describe('loading a country context', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /** Answers each HAPI endpoint through the Worker with `rows`, or fails it with a 500. */
  function stubHapi(rows: Record<string, unknown[] | 'fail'>) {
    const urls: URL[] = []
    vi.stubGlobal('fetch', async (path: string) => {
      const url = new URL(path, 'https://board.example')
      urls.push(url)
      const answer = rows[url.pathname.replace('/hapi/', '')] ?? []
      return answer === 'fail' ? new Response('{}', { status: 500 }) : new Response(JSON.stringify({ data: answer }))
    })
    return urls
  }

  it('reads every part through the Worker by country code, with the source of each figure', async () => {
    const urls = stubHapi({
      'metadata/location': [{ code: 'NPL', name: 'Nepal', has_hrp: false, in_gho: true }],
      'coordination-context/national-risk': [RISK],
      'affected-people/idps': IDPS,
      'metadata/resource': [{ dataset_hdx_title: 'INFORM Risk Index', dataset_hdx_provider_name: 'INFORM', dataset_hdx_link: 'https://data.humdata.org/dataset/x' }],
    })
    const c = await loadContext('NPL')
    expect(c.country).toEqual({ code: 'NPL', name: 'Nepal', hasHrp: false, inGho: true })
    expect(c.risk?.overall).toBe(4.6)
    expect(c.displacement).toHaveLength(3)
    expect(c.sources.inform).toEqual({ title: 'INFORM Risk Index', provider: 'INFORM', link: 'https://data.humdata.org/dataset/x' })
    expect(urls.every((u) => u.pathname.startsWith('/hapi/') && !u.searchParams.has('app_identifier'))).toBe(true)
    expect(urls.filter((u) => !u.pathname.endsWith('/resource')).every((u) => u.searchParams.get('location_code') === 'NPL' || u.searchParams.get('code') === 'NPL')).toBe(true)
  })

  it('shows the other parts when one fails, and fails for a country HAPI does not know', async () => {
    stubHapi({ 'metadata/location': [{ code: 'MOZ', name: 'Mozambique', has_hrp: true, in_gho: true }], 'coordination-context/funding': 'fail', 'coordination-context/national-risk': [RISK] })
    const c = await loadContext('MOZ')
    expect(c.failed).toEqual(['funding'])
    expect(c.risk).toBeDefined()
    stubHapi({})
    await expect(loadContext('XXX')).rejects.toThrow(/no data for XXX/)
  })
})
