import { z } from 'zod'
import { defineTool, type ToolDef } from '@ttx/core'
import type { Bbox } from './mapLayers.js'

/** OpenCage's geocoding API. The browser calls it through the Worker (apps/worker/src/geocode.ts); the room's agent directly. */
export const OPENCAGE_URL = 'https://api.opencagedata.com/geocode/v1/json'

/** A geocoded place. */
export interface Place {
  /** OpenCage `formatted`. */
  name: string
  lngLat: [number, number]
  bbox?: Bbox
  iso2?: string
  iso3?: string
  country?: string
  /** OpenCage `components._type`, e.g. 'city'. */
  type?: string
  confidence?: number
}

export interface Geocoder {
  forward(query: string, opts: { limit?: number; signal?: AbortSignal }): Promise<Place[]>
  reverse(lngLat: [number, number], opts?: { signal?: AbortSignal }): Promise<Place | undefined>
}

interface LatLng {
  lat: number
  lng: number
}

interface OpenCageResult {
  formatted: string
  geometry: LatLng
  bounds?: { northeast: LatLng; southwest: LatLng }
  components?: Record<string, unknown>
  confidence?: number
}

/** Places from an OpenCage geocoding response (forward or reverse). */
export function parseOpenCage(json: { results?: OpenCageResult[] }): Place[] {
  return (json.results ?? []).map((r) => {
    const c = r.components ?? {}
    const str = (k: string) => (typeof c[k] === 'string' ? (c[k] as string) : undefined)
    const place: Place = { name: r.formatted, lngLat: [r.geometry.lng, r.geometry.lat] }
    if (r.bounds) place.bbox = [r.bounds.southwest.lng, r.bounds.southwest.lat, r.bounds.northeast.lng, r.bounds.northeast.lat]
    const extra = {
      iso2: str('ISO_3166-1_alpha-2'),
      iso3: str('ISO_3166-1_alpha-3'),
      country: str('country'),
      type: str('_type'),
      confidence: r.confidence,
    }
    for (const [k, v] of Object.entries(extra)) if (v !== undefined) (place as unknown as Record<string, unknown>)[k] = v
    return place
  })
}

/**
 * Geocoder on OpenCage. In the browser, `url` is the Worker's proxy, which adds the key so the browser never
 * sees it: GET /tools/geocode -> OPENCAGE_URL. The room's agent calls OPENCAGE_URL with its `key`.
 */
export class OpenCageGeocoder implements Geocoder {
  private opts: { url: string; key?: string }

  constructor(opts: { url: string; key?: string }) {
    this.opts = opts
  }

  forward(query: string, opts: { limit?: number; signal?: AbortSignal } = {}) {
    const params = new URLSearchParams({ q: query })
    if (opts.limit !== undefined) params.set('limit', String(opts.limit))
    return this.get(params, opts.signal)
  }

  async reverse([lng, lat]: [number, number], opts: { signal?: AbortSignal } = {}) {
    const places = await this.get(new URLSearchParams({ q: `${lat},${lng}`, limit: '1' }), opts.signal)
    return places[0]
  }

  private async get(params: URLSearchParams, signal?: AbortSignal): Promise<Place[]> {
    const { url, key } = this.opts
    if (key) {
      params.set('no_annotations', '1')
      params.set('key', key)
    }
    const res = await fetch(`${url}?${params}`, signal ? { signal } : {})
    // The key must not reach an error message, which can end up in the chat.
    const text = key ? (await res.text()).replaceAll(key, '***') : await res.text()
    let json: any
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    if (!res.ok) {
      const message = json?.status?.message ?? json?.error ?? text
      throw new Error(`Geocoding failed (${res.status})${message ? `: ${message}` : ''}`)
    }
    return parseOpenCage(json ?? {})
  }
}

/** A GeoJSON FeatureCollection of points, written out: this package does not load the GeoJSON types. */
export interface PlaceFeatures {
  type: 'FeatureCollection'
  features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Place }[]
}

/** Places as GeoJSON points. The properties are the Place fields. */
function placeFeatures(places: Place[]): PlaceFeatures {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p.lngLat }, properties: p })),
  }
}

const lngLat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).describe('[longitude, latitude]')

/** The geocoding tools, on top of a geocoder (the Worker in the app, a fake in tests). */
export function geocodeTools(geocoder: Geocoder): ToolDef[] {
  const geocode = defineTool({
    id: 'data.geocode',
    title: 'Find a place',
    description:
      'Forward geocoding: find places by name or address (city, district, country, landmark). ' +
      'Returns points, best match first. Properties: name, lngLat, bbox [west, south, east, north] when known, ' +
      'iso2, iso3, country, type (e.g. city, state, country), confidence (1-10).',
    input: z.object({
      query: z.string().min(1).describe('Place name or address, e.g. "Beira, Mozambique"'),
      limit: z.number().int().min(1).max(10).default(5).describe('Maximum number of places'),
    }),
    output: 'geo.features',
    async run({ query, limit }, ctx) {
      return placeFeatures(await geocoder.forward(query, { limit, signal: ctx.signal }))
    },
  })

  const reverseGeocode = defineTool({
    id: 'data.reverseGeocode',
    title: 'What is here',
    description:
      'Reverse geocoding: the place at a [longitude, latitude] point. Returns 0 or 1 point. ' +
      'Properties: name, lngLat, bbox, iso2, iso3, country, type, confidence. Use it to find the country (iso3) of a location.',
    input: z.object({ lngLat }),
    output: 'geo.features',
    async run({ lngLat }, ctx) {
      const place = await geocoder.reverse(lngLat, { signal: ctx.signal })
      return placeFeatures(place ? [place] : [])
    },
  })

  return [geocode, reverseGeocode]
}
