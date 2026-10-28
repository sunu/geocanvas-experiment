import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocodeTools, OpenCageGeocoder, parseOpenCage, type Geocoder, type Place } from '../src/data/geocode'
import { ToolRunner } from '../src/tools/runner'

// Shape of real OpenCage responses (no_annotations=1), trimmed.
const forwardResponse = {
  results: [
    {
      bounds: { northeast: { lat: -19.6853, lng: 34.9524 }, southwest: { lat: -19.9101, lng: 34.7402 } },
      components: {
        'ISO_3166-1_alpha-2': 'MZ',
        'ISO_3166-1_alpha-3': 'MOZ',
        'ISO_3166-2': ['MZ-S'],
        _category: 'place',
        _type: 'city',
        city: 'Beira',
        country: 'Mozambique',
        country_code: 'mz',
      },
      confidence: 7,
      formatted: 'Beira, Sofala Province, Mozambique',
      geometry: { lat: -19.8436, lng: 34.8389 },
    },
    {
      components: { _category: 'travel/tourism', _type: 'attraction', country: 'Portugal' },
      confidence: 9,
      formatted: 'Beira, Portugal',
      geometry: { lat: 40.5, lng: -7.5 },
    },
  ],
  status: { code: 200, message: 'OK' },
}

const reverseResponse = {
  results: [
    {
      bounds: { northeast: { lat: -19.8, lng: 34.85 }, southwest: { lat: -19.81, lng: 34.84 } },
      components: { 'ISO_3166-1_alpha-2': 'MZ', 'ISO_3166-1_alpha-3': 'MOZ', _type: 'road', country: 'Mozambique' },
      confidence: 10,
      formatted: 'Avenida Eduardo Mondlane, Beira, Mozambique',
      geometry: { lat: -19.8051, lng: 34.8453 },
    },
  ],
  status: { code: 200, message: 'OK' },
}

const beira: Place = {
  name: 'Beira, Sofala Province, Mozambique',
  lngLat: [34.8389, -19.8436],
  bbox: [34.7402, -19.9101, 34.9524, -19.6853],
  iso2: 'MZ',
  iso3: 'MOZ',
  country: 'Mozambique',
  type: 'city',
  confidence: 7,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseOpenCage', () => {
  it('reads forward results', () => {
    const [first, second] = parseOpenCage(forwardResponse)
    expect(first).toEqual(beira)
    // No bounds, no ISO codes: those fields are left out.
    expect(second).toEqual({ name: 'Beira, Portugal', lngLat: [-7.5, 40.5], country: 'Portugal', type: 'attraction', confidence: 9 })
  })

  it('reads a reverse result, and no results', () => {
    expect(parseOpenCage(reverseResponse)).toEqual([
      {
        name: 'Avenida Eduardo Mondlane, Beira, Mozambique',
        lngLat: [34.8453, -19.8051],
        bbox: [34.84, -19.81, 34.85, -19.8],
        iso2: 'MZ',
        iso3: 'MOZ',
        country: 'Mozambique',
        type: 'road',
        confidence: 10,
      },
    ])
    expect(parseOpenCage({ results: [] })).toEqual([])
  })
})

describe('OpenCageGeocoder', () => {
  const stubFetch = (status: number, body: unknown) => {
    const fetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response(JSON.stringify(body), { status }))
    vi.stubGlobal('fetch', fetch)
    return fetch
  }

  it('calls the Worker for forward and reverse geocoding', async () => {
    const fetch = stubFetch(200, forwardResponse)
    expect(await new OpenCageGeocoder().forward('Beira', { limit: 2 })).toHaveLength(2)
    const url = fetch.mock.calls[0]![0]
    expect(url.startsWith('/tools/geocode?')).toBe(true)
    expect(Object.fromEntries(new URLSearchParams(url.split('?')[1]))).toEqual({ q: 'Beira', limit: '2' })

    const reverse = stubFetch(200, reverseResponse)
    expect((await new OpenCageGeocoder().reverse([34.8453, -19.8051]))?.iso3).toBe('MOZ')
    // OpenCage reverse geocoding is "lat,lng".
    expect(new URLSearchParams(reverse.mock.calls[0]![0].split('?')[1]).get('q')).toBe('-19.8051,34.8453')
  })

  it('throws with the service message on errors', async () => {
    stubFetch(401, { status: { code: 401, message: 'invalid API key' }, results: [] })
    await expect(new OpenCageGeocoder().forward('x', {})).rejects.toThrow('Geocoding failed (401): invalid API key')
    stubFetch(503, { error: 'OPENCAGE_API_KEY is not set' })
    await expect(new OpenCageGeocoder().forward('x', {})).rejects.toThrow(/OPENCAGE_API_KEY/)
  })
})

describe('geocoding tools', () => {
  function setup(here?: Place) {
    const calls: { forward: unknown[]; reverse: unknown[] } = { forward: [], reverse: [] }
    const geocoder: Geocoder = {
      async forward(query, { limit }) {
        calls.forward.push([query, limit])
        return [beira]
      },
      async reverse(lngLat) {
        calls.reverse.push(lngLat)
        return here
      },
    }
    return { calls, runner: new ToolRunner(geocodeTools(geocoder)) }
  }

  it('geocode returns points with the Place fields as properties, 5 by default', async () => {
    const { calls, runner } = setup()
    const found = await runner.run<GeoJSON.FeatureCollection>('data.geocode', { query: 'Beira' })
    expect(found.features).toEqual([{ type: 'Feature', geometry: { type: 'Point', coordinates: beira.lngLat }, properties: beira }])
    expect(calls.forward).toEqual([['Beira', 5]])
    await expect(runner.run('data.geocode', { query: '' })).rejects.toThrow(/Invalid input/)
  })

  it('reverseGeocode returns the place at a point, or none', async () => {
    const here = await setup(beira).runner.run<GeoJSON.FeatureCollection>('data.reverseGeocode', { lngLat: [34.8, -19.8] })
    expect(here.features[0]?.properties?.iso3).toBe('MOZ')
    const nowhere = await setup().runner.run<GeoJSON.FeatureCollection>('data.reverseGeocode', { lngLat: [0, 0] })
    expect(nowhere.features).toEqual([])
    await expect(setup().runner.run('data.reverseGeocode', { lngLat: [200, 0] })).rejects.toThrow(/Invalid input/)
  })
})
