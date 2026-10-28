import { describe, expect, it, vi } from 'vitest'
import type { Map as MapLibreMap } from 'maplibre-gl'

// The pmtiles protocol is registered on MapLibre's module; these tests use a fake map.
vi.mock('maplibre-gl', () => ({ addProtocol: vi.fn() }))

const { adminLayerSpecs, classify, codab, RAMP, syncAdminLayers, ZERO } = await import('../src/map/adminAreas')
const { conflictByArea, organizationsByArea } = await import('../src/hapi/choropleth')

describe('choropleth classes', () => {
  it('splits the values above 0 into five classes of about as many areas, 0 apart', () => {
    const values = { A: 0, B: 1, C: 2, D: 3, E: 5, F: 8, G: 13, H: 21, I: 34, J: 55, K: 76 }
    const { colorOf, legend } = classify(values)
    expect(legend.classes.map((c) => c.label)).toEqual(['0', '1–2', '3–5', '8–13', '21–34', '55–76'])
    expect(colorOf(0)).toBe(ZERO)
    expect(colorOf(1)).toBe(RAMP[0])
    expect(colorOf(76)).toBe(RAMP[4])
  })

  it('uses the darker colors when there are fewer distinct values than classes', () => {
    const { colorOf, legend } = classify({ A: 4, B: 9 })
    expect(legend.classes).toEqual([
      { color: RAMP[3], label: '4' },
      { color: RAMP[4], label: '9' },
    ])
    expect(colorOf(9)).toBe(RAMP[4])
  })
})

describe('COD-AB layers', () => {
  it("reads each level's PMTiles on Source Cooperative, by P-code", () => {
    expect(codab(2)).toEqual({
      url: 'pmtiles://https://data.source.coop/hdx/cod-ab/global/admin2/admin2.pmtiles',
      sourceLayer: 'admin2',
      pcode: 'adm2_pcode',
      name: 'adm2_name',
    })
  })

  it('draws boundaries alone as outlines, everywhere', () => {
    const specs = adminLayerSpecs('b1', { level: 1, attribution: '' })
    expect(specs).toEqual([expect.objectContaining({ id: 'admin-b1-line', type: 'line', source: 'codab-admin1', 'source-layer': 'admin1' })])
    expect(specs[0]).not.toHaveProperty('filter')
  })

  it("colors one country's areas by their values, joined on P-code, and leaves areas without one clear", () => {
    const [fill, line] = adminLayerSpecs('c1', { level: 1, country: 'MOZ', values: { MZ01: 76, MZ07: 0 }, attribution: '' }) as any[]
    expect(fill).toMatchObject({ id: 'admin-c1-fill', type: 'fill', filter: ['==', ['get', 'iso3'], 'MOZ'] })
    expect(fill.paint['fill-color']).toEqual(['match', ['get', 'adm1_pcode'], 'MZ01', RAMP[4], 'MZ07', ZERO, 'rgba(0, 0, 0, 0)'])
    expect(line).toMatchObject({ id: 'admin-c1-line', filter: ['==', ['get', 'iso3'], 'MOZ'] })
  })
})

/** Just enough of a MapLibre map: a style with a basemap label layer, sources and layers. */
function fakeMap() {
  let layers: { id: string; type: string }[] = [
    { id: 'water', type: 'fill' },
    { id: 'place-labels', type: 'symbol' },
  ]
  let sources = new Map<string, unknown>()
  const map = {
    getStyle: () => ({ layers }),
    getSource: (id: string) => sources.get(id),
    addSource: vi.fn((id: string, spec: unknown) => void sources.set(id, spec)),
    removeSource: vi.fn((id: string) => void sources.delete(id)),
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: vi.fn((spec: { id: string; type: string }, before?: string) => {
      const i = before ? layers.findIndex((l) => l.id === before) : layers.length
      layers.splice(i, 0, spec)
    }),
    removeLayer: vi.fn((id: string) => void (layers = layers.filter((l) => l.id !== id))),
    /** A basemap change: only the basemap's layers are left. */
    reloadStyle() {
      layers = layers.filter((l) => !l.id.startsWith('admin-'))
      sources = new Map()
    },
    ids: () => layers.map((l) => l.id),
  }
  return map
}

const state = (id: string, value: object) => ({ id, title: id, output: 'geo.adminAreas', loading: false, value })

describe('keeping the map in step with its COD-AB layers', () => {
  it('adds layers under the labels, leaves unchanged ones, and removes ones that went', () => {
    const map = fakeMap()
    const as = (m: ReturnType<typeof fakeMap>) => m as unknown as MapLibreMap
    syncAdminLayers(as(map), [state('b1', { level: 1, attribution: '' }), state('c1', { level: 2, country: 'MOZ', values: { MZ0701: 3 }, attribution: '' })])
    expect(map.ids()).toEqual(['water', 'admin-b1-line', 'admin-c1-fill', 'admin-c1-line', 'place-labels'])
    expect(map.addSource).toHaveBeenCalledWith('codab-admin1', expect.objectContaining({ type: 'vector', url: codab(1).url }))

    map.addLayer.mockClear()
    syncAdminLayers(as(map), [state('b1', { level: 1, attribution: '' }), state('c1', { level: 2, country: 'MOZ', values: { MZ0701: 3 }, attribution: '' })])
    expect(map.addLayer).not.toHaveBeenCalled()

    syncAdminLayers(as(map), [state('b1', { level: 1, attribution: '' })])
    expect(map.ids()).toEqual(['water', 'admin-b1-line', 'place-labels'])
    expect(map.removeSource).toHaveBeenCalledWith('codab-admin2')
  })

  it('adds them again after a basemap change, which drops them', () => {
    const map = fakeMap()
    const states = [state('b1', { level: 1, attribution: '' })]
    syncAdminLayers(map as unknown as MapLibreMap, states)
    map.reloadStyle()
    syncAdminLayers(map as unknown as MapLibreMap, states)
    expect(map.ids()).toEqual(['water', 'admin-b1-line', 'place-labels'])
  })

  it('ignores other data layers and layers still loading', () => {
    const map = fakeMap()
    syncAdminLayers(map as unknown as MapLibreMap, [
      { id: 'p', title: 'p', output: 'geo.features', loading: false, value: { type: 'FeatureCollection', features: [] } },
      { id: 'c', title: 'c', output: 'geo.adminAreas', loading: true },
    ])
    expect(map.addLayer).not.toHaveBeenCalled()
  })
})

// Rows as HDX HAPI returned them for Mozambique (October 2026), trimmed.
const presence = (org_acronym: string, sector_code: string, admin1_code: string, admin2_code: string) => ({ org_acronym, sector_code, admin1_code, admin2_code })
const violence = (admin1_code: string, admin2_code: string, events: number, fatalities: number) => ({ admin1_code, admin2_code, events, fatalities })

describe('HDX HAPI figures by area', () => {
  it('counts each organization once per area, at either level, in one sector or all', () => {
    const rows = [
      presence('WFP', 'FSC', 'MZ07', 'MZ0701'),
      presence('WFP', 'NUT', 'MZ07', 'MZ0702'),
      presence('MSF', 'HEA', 'MZ07', 'MZ0701'),
      presence('MSF', 'HEA', 'MZ02', 'MZ0201'),
    ]
    expect(organizationsByArea(rows, 1)).toEqual({ values: { MZ07: 2, MZ02: 1 }, unmatched: 0 })
    expect(organizationsByArea(rows, 2)).toEqual({ values: { MZ0701: 2, MZ0702: 1, MZ0201: 1 }, unmatched: 0 })
    expect(organizationsByArea(rows, 1, 'HEA').values).toEqual({ MZ07: 1, MZ02: 1 })
  })

  it('leaves out organizations in areas HAPI could not place, counting each organization once', () => {
    const rows = [presence('IOM', 'CCM', 'MZ01', 'MZ01-XXX'), presence('IOM', 'PRO', 'MZ01', 'MZ01-XXX'), presence('IOM', 'CCM', 'MZ02', 'MZ0201'), presence('WFP', 'FSC', 'MZ07', 'MZ07-XXX')]
    expect(organizationsByArea(rows, 2)).toEqual({ values: { MZ0201: 1 }, unmatched: 2 })
  })

  it("sums conflict over the months, keeps areas with none at 0, and leaves out districts HAPI could not place", () => {
    const rows = [violence('MZ02', 'MZ0201', 4, 1), violence('MZ02', 'MZ0201', 3, 0), violence('MZ09', 'MZ0901', 0, 0), violence('MZ01', 'MZ01-XXX', 9, 2)]
    expect(conflictByArea(rows, 2, 'events')).toEqual({ values: { MZ0201: 7, MZ0901: 0 }, unmatched: 9 })
    expect(conflictByArea(rows, 1, 'fatalities')).toEqual({ values: { MZ02: 1, MZ09: 0 }, unmatched: 2 })
  })
})
