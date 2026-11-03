import { afterEach, describe, expect, it, vi } from 'vitest'
import { fileSize, loadDataset, periodOf, toDataset, updateFrequency } from '../src/hdx/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

// The shape of GET /api/3/action/package_show?id=cod-ab-npl, shortened.
const raw = {
  name: 'cod-ab-npl',
  title: 'Nepal - Subnational Administrative Boundaries',
  notes: 'Nepal administrative level 0-3 boundaries (COD-AB) dataset version 02.  \n  \nThis dataset is structured into 3 levels:  \n- Admin 1: 7   \n- Admin 2: 77',
  organization: { title: 'OCHA Field Information Services Section (FISS)' },
  groups: [{ title: 'Nepal', display_name: 'Nepal' }],
  tags: [{ name: 'administrative boundaries-divisions' }, { name: 'gazetteer' }, { name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }, { name: 'e' }],
  dataset_date: '[2024-03-14T00:00:00 TO 2025-10-30T23:59:59]',
  data_update_frequency: '365',
  last_modified: '2026-08-14T07:21:20.227565',
  metadata_modified: '2026-08-14T07:21:29.781136',
  license_title: 'Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)',
  dataset_source: 'Survey Department of Nepal',
  caveats: null,
  is_requestdata_type: false,
  archived: false,
  resources: [
    { id: '37775d96-2b6a-47b4-8465-2b3238368567', name: 'npl_admin_boundaries.gdb.zip', format: 'Geodatabase', size: 26311337, download_url: 'https://data.humdata.org/dataset/x/download/a.zip' },
    { id: 'b6ab1a5a-8b6e-41fb-a61f-8202ce98d16c', name: 'npl_admin_boundaries.shp.zip', format: 'SHP', size: 53706823 },
    { id: 'dea34e50-37d5-4e36-98ae-2b7b1b4c43de', name: 'npl_admin_boundaries.geojson.zip', format: 'GeoJSON', size: '60438906' },
    { id: '5bf18581-ef08-471c-b5d4-582c2d70228d', name: 'npl_admin_boundaries.xlsx', format: 'XLSX', size: null },
    { id: 'not-an-id', name: '  ', format: '', size: 0 },
    { id: '11111111-2222-3333-4444-555555555555', name: 'a sixth file', format: 'CSV', size: 10 },
  ],
}

describe('the period, the update frequency and file sizes', () => {
  it('reads the period from the dates in HDX’s range', () => {
    expect(periodOf('[2024-03-14T00:00:00 TO 2025-10-30T23:59:59]')).toEqual({ from: '2024-03-14', to: '2025-10-30' })
    expect(periodOf('[2023-08-29T00:00:00 TO 2023-08-29T23:59:59]')).toEqual({ from: '2023-08-29', to: '2023-08-29' })
    expect(periodOf('2023-08-29')).toEqual({ from: '2023-08-29', to: '2023-08-29' })
    expect(periodOf(null)).toBeUndefined()
    expect(periodOf('whenever')).toBeUndefined()
  })
  it('names the update frequencies HDX uses, and counts the others in days', () => {
    expect(['-2', '-1', '0', '1', '7', '14', '30', '90', '180', '365'].map(updateFrequency)).toEqual(['As needed', 'Never', 'Live', 'Every day', 'Every week', 'Every two weeks', 'Every month', 'Every three months', 'Every six months', 'Every year'])
    expect(updateFrequency('45')).toBe('Every 45 days')
    expect(updateFrequency(7)).toBe('Every week')
    expect(updateFrequency(null)).toBeUndefined()
    expect(updateFrequency('')).toBeUndefined()
    expect(updateFrequency('often')).toBeUndefined()
    expect(updateFrequency('-5')).toBeUndefined()
  })
  it('writes sizes as a person reads them', () => {
    expect(fileSize(10)).toBe('10 B')
    expect(fileSize(1536)).toBe('1.5 KB')
    expect(fileSize(26311337)).toBe('25.1 MB')
    expect(fileSize(53706823)).toBe('51.2 MB')
    expect(fileSize(500 * 1024 * 1024)).toBe('500 MB')
    expect(fileSize(3 * 1024 ** 3)).toBe('3.0 GB')
  })
})

describe('a dataset from HDX’s answer', () => {
  const d = toDataset(raw)
  it('reads its facts', () => {
    expect(d).toMatchObject({
      name: 'cod-ab-npl',
      title: 'Nepal - Subnational Administrative Boundaries',
      url: 'https://data.humdata.org/dataset/cod-ab-npl',
      organization: 'OCHA Field Information Services Section (FISS)',
      countries: ['Nepal'],
      period: { from: '2024-03-14', to: '2025-10-30' },
      updates: 'Every year',
      modified: '2026-08-14',
      license: 'Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)',
      source: 'Survey Department of Nepal',
      caveats: undefined,
      onRequest: false,
      archived: false,
    })
    expect(d.summary).toBe('Nepal administrative level 0-3 boundaries (COD-AB) dataset version 02. This dataset is structured into 3 levels: Admin 1: 7 Admin 2: 77')
  })
  it('keeps the first six tags', () => {
    expect(d.tags).toEqual(['administrative boundaries-divisions', 'gazetteer', 'a', 'b', 'c', 'd'])
  })
  it('lists the first five files, counts all, and builds each link from the dataset and the file’s id', () => {
    expect(d.resourceCount).toBe(6)
    expect(d.resources).toHaveLength(5)
    expect(d.resources[0]).toEqual({ id: '37775d96-2b6a-47b4-8465-2b3238368567', name: 'npl_admin_boundaries.gdb.zip', format: 'Geodatabase', size: 26311337, url: 'https://data.humdata.org/dataset/cod-ab-npl/resource/37775d96-2b6a-47b4-8465-2b3238368567' })
    // A size given as text is read; a missing size, an empty name and format, and an id that is not a UUID are left plain.
    expect(d.resources[2]!.size).toBe(60438906)
    expect(d.resources[3]!.size).toBeUndefined()
    expect(d.resources[4]).toEqual({ id: 'not-an-id', name: 'Unnamed file', format: undefined, size: undefined, url: undefined })
  })
  it('never links to an address that is in the answer', () => {
    expect(JSON.stringify(d)).not.toContain('/download/')
  })
  it('knows a dataset whose files are on request, and an archived one', () => {
    const r = toDataset({ ...raw, is_requestdata_type: true, archived: true, resources: [] })
    expect(r).toMatchObject({ onRequest: true, archived: true, resourceCount: 0, resources: [] })
  })
  it('cuts long caveats', () => {
    const c = toDataset({ ...raw, caveats: 'The area is the observed extent. '.repeat(20) }).caveats!
    expect(c.length).toBeLessThanOrEqual(201)
    expect(c.endsWith('…')).toBe(true)
  })
})

describe('loadDataset', () => {
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })

  it('reads the dataset, once, and again on refresh', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return json({ success: true, result: raw })
    })
    expect((await loadDataset({ name: 'cod-ab-npl' })).title).toBe('Nepal - Subnational Administrative Boundaries')
    expect(urls).toEqual(['https://data.humdata.org/api/3/action/package_show?id=cod-ab-npl'])
    await loadDataset({ name: 'cod-ab-npl' })
    expect(urls).toHaveLength(1)
    await loadDataset({ name: 'cod-ab-npl' }, { refresh: true })
    expect(urls).toHaveLength(2)
  })

  it('says a missing dataset is not found, a private one is not available, and names other failures', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    await expect(loadDataset({ name: 'nope' })).rejects.toThrow('Not found')
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403 }))
    await expect(loadDataset({ name: 'nope' })).rejects.toThrow('may be private')
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    await expect(loadDataset({ name: 'nope' })).rejects.toThrow('HDX answered 502')
    vi.stubGlobal('fetch', async () => json({ success: false }))
    await expect(loadDataset({ name: 'nope' })).rejects.toThrow('did not give')
  })

  it('does not keep a failure', async () => {
    let fail = true
    vi.stubGlobal('fetch', async () => {
      if (fail) {
        fail = false
        return new Response('{}', { status: 500 })
      }
      return json({ success: true, result: raw })
    })
    await expect(loadDataset({ name: 'again' })).rejects.toThrow()
    expect((await loadDataset({ name: 'again' })).name).toBe('cod-ab-npl')
  })
})
