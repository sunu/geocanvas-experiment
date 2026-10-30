import { afterEach, describe, expect, it, vi } from 'vitest'
import { chf, fundedShare, htmlSummary, loadEmergency, toEmergency } from '../src/ifrcgo/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

// The shape of GET /api/v2/event/8083/, shortened: the hazard type is an id, and contacts are in the answer.
const raw = {
  id: 8083,
  name: 'Yemen Population Movement -2026',
  dtype: 13,
  countries: [{ name: 'Yemen', iso3: 'YEM' }],
  ifrc_severity_level: 1,
  ifrc_severity_level_display: 'Orange',
  disaster_start_date: '2026-09-03T00:00:00Z',
  glide: 'OT-2026-000172-YEM',
  num_affected: null,
  summary: '<div style="margin: 0;">\r\n<h3 style="margin: 0;">1. Situation Overview</h3>\r\n<p>Escalation &amp; insecurity since&nbsp;September displaced families.</p></div>',
  key_figures: [
    { number: '1,282', deck: 'Number of deaths', source: 'WHO  6 Aug-11 Oct 2026' },
    { number: '8,624', deck: 'Suspected Cholera Cases', source: 'WHO 11 Oct 2026' },
    { number: '5,891', deck: 'Injuries reported', source: null },
    { number: '40', deck: 'Districts', source: '' },
    { number: '9', deck: 'A fifth figure', source: '' },
    { number: '', deck: 'No number', source: '' },
  ],
  appeals: [{ atype_display: 'Emergency Appeal', code: 'MDRYE018', status_display: 'Active', amount_requested: 15000000, amount_funded: 1490765.42, num_beneficiaries: 500000 }],
  field_reports: [
    { id: 18572, summary: 'First report', report_date: '2026-09-08T14:55:11Z', created_at: '2026-09-08T14:55:11Z' },
    { id: 18586, summary: 'Third report', report_date: '2026-09-21T12:16:32Z', created_at: '2026-09-21T12:16:32Z' },
    { id: 18575, summary: 'Second report', report_date: '2026-09-09T19:25:50Z', created_at: '2026-09-09T19:25:50Z' },
    { id: 18599, summary: ' ', report_date: null, created_at: '2026-09-30T00:00:00Z' },
  ],
  contacts: [{ ctype: 'IFRC', name: 'Someone', title: 'Head of Delegation', email: 'someone@ifrc.org' }],
  updated_at: '2026-10-21T08:38:02Z',
}

describe('the text of an emergency', () => {
  it('turns GO’s HTML into plain words: blocks become spaces, tags go, entities are decoded', () => {
    expect(htmlSummary(raw.summary)).toBe('1. Situation Overview Escalation & insecurity since September displaced families.')
  })
  it('is nothing for no text, and is cut at a word when long', () => {
    expect(htmlSummary(null)).toBeUndefined()
    expect(htmlSummary('<p> </p>')).toBeUndefined()
    const s = htmlSummary(`<p>${'flood response '.repeat(60)}</p>`)!
    expect(s.length).toBeLessThanOrEqual(281)
    expect(s.endsWith('…')).toBe(true)
  })
})

describe('appeal money', () => {
  it('shortens Swiss francs and gives the funded share', () => {
    expect(chf(15000000)).toBe('CHF 15M')
    expect(chf(1490765.42)).toBe('CHF 1.5M')
    expect(chf(93752)).toBe('CHF 93.8K')
    expect(fundedShare({ requested: 15000000, funded: 1490765.42 })).toBe(10)
    expect(fundedShare({ requested: 80000, funded: 80000 })).toBe(100)
  })
  it('has no share for an appeal that asks for nothing', () => {
    expect(fundedShare({ requested: 0, funded: 0 })).toBeUndefined()
  })
})

describe('an emergency from GO’s answer', () => {
  const e = toEmergency(raw, 'Other')
  it('reads its facts', () => {
    expect(e).toMatchObject({
      id: 8083,
      name: 'Yemen Population Movement -2026',
      url: 'https://go.ifrc.org/emergencies/8083',
      hazard: 'Other',
      countries: ['Yemen'],
      severity: { level: 1, label: 'Orange' },
      startDate: '2026-09-03T00:00:00Z',
      glide: 'OT-2026-000172-YEM',
      affected: undefined,
      appeals: [{ type: 'Emergency Appeal', code: 'MDRYE018', status: 'Active', requested: 15000000, funded: 1490765.42, beneficiaries: 500000 }],
    })
  })
  it('keeps the first four key figures that have a number, with a source only when there is one', () => {
    expect(e.keyFigures).toEqual([
      { value: '1,282', label: 'Number of deaths', source: 'WHO  6 Aug-11 Oct 2026' },
      { value: '8,624', label: 'Suspected Cholera Cases', source: 'WHO 11 Oct 2026' },
      { value: '5,891', label: 'Injuries reported', source: undefined },
      { value: '40', label: 'Districts', source: undefined },
    ])
  })
  it('lists the newest three field reports, counts all, and names one that has no title', () => {
    expect(e.fieldReportCount).toBe(4)
    expect(e.fieldReports.map((f) => [f.id, f.title])).toEqual([
      [18599, 'Field report 18599'],
      [18586, 'Third report'],
      [18575, 'Second report'],
    ])
  })
  it('never carries the contacts', () => {
    expect(JSON.stringify(e)).not.toContain('someone@ifrc.org')
    expect(JSON.stringify(e)).not.toContain('Someone')
  })
  it('has no severity when GO gives none', () => {
    expect(toEmergency({ ...raw, ifrc_severity_level_display: null }).severity).toBeUndefined()
  })
})

describe('loadEmergency', () => {
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })

  it('reads the emergency and its hazard type, once, and again on refresh', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return url.includes('/disaster_type/') ? json({ id: 13, name: 'Other' }) : json(raw)
    })
    const e = await loadEmergency({ id: 8083 })
    expect(e).toMatchObject({ name: 'Yemen Population Movement -2026', hazard: 'Other' })
    expect(urls).toEqual(['https://goadmin.ifrc.org/api/v2/event/8083/', 'https://goadmin.ifrc.org/api/v2/disaster_type/13/'])
    await loadEmergency({ id: 8083 })
    expect(urls).toHaveLength(2)
    // The hazard type's name is kept for every card: a refresh asks only for the emergency.
    await loadEmergency({ id: 8083 }, { refresh: true })
    expect(urls).toHaveLength(3)
  })

  it('shows the emergency without a hazard when its name cannot be read', async () => {
    vi.stubGlobal('fetch', async (url: string) => (url.includes('/disaster_type/') ? new Response('{}', { status: 500 }) : json({ ...raw, id: 8084, dtype: 99 })))
    const e = await loadEmergency({ id: 8084 })
    expect(e.name).toBe('Yemen Population Movement -2026')
    expect(e.hazard).toBeUndefined()
  })

  it('says a missing emergency is not found, and names other failures', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    await expect(loadEmergency({ id: 1 })).rejects.toThrow('Not found')
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    await expect(loadEmergency({ id: 1 })).rejects.toThrow('IFRC GO answered 502')
  })
})
