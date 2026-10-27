import area from '@turf/area'
import distance from '@turf/distance'
import { point, polygon } from '@turf/helpers'
import type {
  DisasterEvent,
  DisasterProvider,
  DisasterType,
  EventQuery,
  EventSummary,
  ImpactRow,
  ImpactTotals,
  Severity,
} from './types.js'

/**
 * Real data from the IFRC Montandon / Monty STAC API.
 * The browser never calls the API directly (it needs a token). It calls the gateway, which adds the token:
 *   POST /monty/search  ->  POST {MONTANDON_BASE_URL}/search
 */

export type StacSearch = (body: Record<string, unknown>) => Promise<{ features: StacItem[] }>

interface StacItem {
  id: string
  collection: string
  geometry: GeoJSON.Geometry | null
  properties: Record<string, any>
}

/** Hazard types this plugin shows, with the short Monty hazard code for each. */
const HAZARD_CODE: Record<DisasterType, string> = { cyclone: 'TC', flood: 'FL', earthquake: 'EQ', drought: 'DR' }
const TYPE_OF_CODE = Object.fromEntries(Object.entries(HAZARD_CODE).map(([t, c]) => [c, t])) as Record<string, DisasterType>
const ALL_CODES = Object.values(HAZARD_CODE)

/** Event sources. GDACS is near-real-time; EM-DAT is the historical archive. */
const EVENT_COLLECTIONS = ['gdacs-events', 'emdat-events']
const HAZARD_COLLECTIONS = ['gdacs-hazards', 'emdat-hazards', 'usgs-hazards', 'ibtracs-hazards']
const IMPACT_COLLECTIONS = ['gdacs-impacts', 'emdat-impacts', 'idmc-gidd-impacts', 'ifrcevent-impacts']

/** Point events get a disc this big as their footprint (km). Rough: Monty has no footprint for them. */
const DISC_KM: Record<DisasterType, number> = { cyclone: 200, flood: 120, earthquake: 80, drought: 300 }
const KM_PER_DEG = 111.32

const postSearch: StacSearch = async (body) => {
  const res = await fetch('/monty/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Monty search failed (${res.status}): ${await res.text()}`)
  return res.json()
}

const overlaps = (property: string, values: string[]) => ({ op: 'a_overlaps', args: [{ property }, values] })

function disc(center: [number, number], radiusKm: number): GeoJSON.Feature<GeoJSON.Polygon> {
  const [lon, lat] = center
  const ring: [number, number][] = []
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    ring.push([
      lon + (radiusKm * Math.cos(a)) / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180)),
      lat + (radiusKm * Math.sin(a)) / KM_PER_DEG,
    ])
  }
  ring.push(ring[0]!)
  return polygon([ring])
}

function centerOf(g: GeoJSON.Geometry | null, bbox?: number[]): [number, number] {
  if (g?.type === 'Point') return g.coordinates as [number, number]
  if (bbox && bbox.length >= 4) return [(bbox[0]! + bbox[2]!) / 2, (bbox[1]! + bbox[3]!) / 2]
  return [0, 0]
}

/** Polygon footprint for any geometry: points become discs, MultiPolygon keeps its largest part. */
function footprintOf(g: GeoJSON.Geometry | null, center: [number, number], type: DisasterType) {
  if (g?.type === 'Polygon') return polygon(g.coordinates)
  if (g?.type === 'MultiPolygon') {
    const parts = g.coordinates.map((c) => polygon(c))
    return parts.reduce((a, b) => (area(b) > area(a) ? b : a))
  }
  return disc(center, DISC_KM[type])
}

const TYPE_LABEL: Record<DisasterType, string> = { cyclone: 'Cyclone', flood: 'Flood', earthquake: 'Earthquake', drought: 'Drought' }

/** EM-DAT titles are generic ("Ground movement in Türkiye"). Build a clearer name. GDACS titles are fine. */
function nameOf(item: StacItem, type: DisasterType, start: string): string {
  const title: string = item.properties.title ?? item.id
  if (!item.collection.startsWith('emdat')) return title
  const place = /\bin (.+?)(?: of [A-Z][a-z]+ \d{4})?$/.exec(title)?.[1] ?? item.properties['monty:country_codes']?.[0] ?? ''
  return `${TYPE_LABEL[type]} in ${place} (${start.slice(0, 4)})`
}

/** "Moment Magnitude" 7.8 -> "Mw 7.8"; "km/h" 204 -> "204 km/h". */
function hazardOf(value: number, unit: string | undefined) {
  if (!(value > 0)) return undefined // Monty uses -1 for "no value"
  const u = unit ?? ''
  const v = Math.round(value * 10) / 10
  const label = /magnitude|^M\w?$/i.test(u) ? `${/moment/i.test(u) ? 'Mw' : 'M'} ${v}` : `${v.toLocaleString('en-US')} ${u}`.trim()
  return { value, unit: u, label }
}

/** GDACS descriptions start with the alert level ("Red Tropical Cyclone ..."). Other sources have none. */
function severityOf(p: Record<string, any>): Severity {
  const m = /^(green|orange|red)\b/i.exec(p.description ?? '')
  return (m?.[1]?.toLowerCase() as Severity | undefined) ?? 'green'
}

function typeOf(p: Record<string, any>): DisasterType | undefined {
  for (const c of p['monty:hazard_codes'] ?? []) if (TYPE_OF_CODE[c]) return TYPE_OF_CODE[c]
}

function toEvent(item: StacItem, bbox?: number[]): DisasterEvent | undefined {
  const p = item.properties
  const type = typeOf(p)
  if (!type) return undefined
  const center = centerOf(item.geometry, bbox)
  const start = String(p.start_datetime ?? p.datetime).slice(0, 10)
  const end = String(p.end_datetime ?? p.datetime).slice(0, 10)
  const country = (p['monty:country_codes'] ?? [])[0] ?? ''
  const sd = p.severitydata
  return {
    id: item.id,
    type,
    name: nameOf(item, type, start),
    source: `IFRC Montandon (${item.collection.replace('-events', '').toUpperCase()})`,
    hazard: sd && typeof sd.severity === 'number' ? hazardOf(sd.severity, sd.severityunit) : undefined,
    region: country,
    country,
    start,
    end,
    year: Number(start.slice(0, 4)),
    center,
    severity: severityOf(p),
    footprint: footprintOf(item.geometry, center, type),
    corrId: p['monty:corr_id'],
  }
}

/** GDACS publishes one item per update (episode) of the same event. Keep the latest of each. */
function latestEpisodes(items: StacItem[]): StacItem[] {
  const best = new Map<string, StacItem>()
  for (const it of items) {
    const key = `${it.collection}:${it.properties['monty:src_event_id'] ?? it.id}`
    const cur = best.get(key)
    if (!cur || (it.properties['monty:episode_number'] ?? 0) > (cur.properties['monty:episode_number'] ?? 0)) best.set(key, it)
  }
  return [...best.values()]
}

const collectionOf = (id: string) => `${id.split('-event-')[0]}-events`

const IMPACT_LABEL: Record<string, string> = {
  death: 'People killed',
  missing: 'People missing',
  injured: 'People injured',
  affected_total: 'People affected',
  potentially_affected: 'People potentially affected',
  displaced_total: 'People displaced',
  cost: 'Economic damage',
}

export class MontyDisasterProvider implements DisasterProvider {
  private cache = new Map<string, DisasterEvent>()
  private enriched = new Map<string, DisasterEvent>()

  constructor(private search: StacSearch = postSearch) {}

  private async fetchEvents(body: Record<string, unknown>, limit: number): Promise<DisasterEvent[]> {
    const page = await this.search({
      collections: EVENT_COLLECTIONS,
      limit,
      'filter-lang': 'cql2-json',
      sortby: [{ field: 'datetime', direction: 'desc' }],
      ...body,
    })
    const events = latestEpisodes(page.features)
      .map((f) => toEvent(f, (f as any).bbox))
      .filter((e): e is DisasterEvent => !!e)
    for (const e of events) if (!this.cache.has(e.id)) this.cache.set(e.id, e)
    return events
  }

  /** The biggest EM-DAT disasters by reported deaths, per hazard type. Good for testing with large impacts. */
  private async notable(): Promise<(EventSummary & { deaths: number })[]> {
    const out: (EventSummary & { deaths: number })[] = []
    await Promise.all(
      (Object.keys(HAZARD_CODE) as DisasterType[]).map(async (type) => {
        const page = await this.search({
          collections: ['emdat-impacts'],
          limit: 8,
          'filter-lang': 'cql2-json',
          filter: {
            op: 'and',
            args: [
              { op: '=', args: [{ property: 'monty:impact_detail.type' }, 'death'] },
              overlaps('monty:hazard_codes', [HAZARD_CODE[type]]),
            ],
          },
          sortby: [{ field: 'properties.monty:impact_detail.value', direction: 'desc' }],
        })
        const deaths = new Map(page.features.map((f) => [f.properties['monty:corr_id'] as string, f.properties['monty:impact_detail'].value as number]))
        if (!deaths.size) return
        const events = await this.fetchEvents(
          { collections: ['emdat-events'], limit: deaths.size, filter: { op: 'in', args: [{ property: 'monty:corr_id' }, [...deaths.keys()]] } },
          deaths.size,
        )
        for (const e of events) {
          const d = deaths.get(e.corrId ?? '') ?? 0
          out.push({ id: e.id, name: e.name, type: e.type, year: e.year, country: e.country, severity: e.severity, deaths: d, headline: `${d.toLocaleString('en-US')} deaths` })
        }
      }),
    )
    return out.sort((a, b) => b.deaths - a.deaths)
  }

  async listEvents(): Promise<EventSummary[]> {
    const [recent, notable] = await Promise.all([
      this.fetchEvents({ filter: overlaps('monty:hazard_codes', ALL_CODES) }, 150),
      this.notable().catch(() => []),
    ])
    const seen = new Set(notable.map((n) => n.id))
    return [
      ...notable.map(({ deaths: _d, ...e }) => e),
      ...recent.filter((e) => !seen.has(e.id)).map(({ id, name, type, year, country, severity }) => ({ id, name, type, year, country, severity })),
    ]
  }

  /** The event with its hazard intensity and impact totals. */
  async getEvent(id: string): Promise<DisasterEvent> {
    const done = this.enriched.get(id)
    if (done) return done
    let base = this.cache.get(id)
    if (!base) {
      const page = await this.search({ collections: [collectionOf(id)], ids: [id], limit: 1 })
      const f = page.features[0]
      base = f && toEvent(f, (f as any).bbox)
      if (!base) throw new Error(`Unknown event: ${id}`)
    }
    const [hazard, impacts] = await Promise.all([
      base.hazard ?? this.hazardFor(base.corrId).catch(() => undefined),
      this.impactRows(base.corrId).catch(() => []),
    ])
    const event: DisasterEvent = { ...base, hazard, impacts: totalsOf(impacts) }
    this.enriched.set(id, event)
    return event
  }

  private async hazardFor(corrId: string | undefined) {
    if (!corrId) return undefined
    const page = await this.search({
      collections: HAZARD_COLLECTIONS,
      limit: 20,
      'filter-lang': 'cql2-json',
      filter: { op: '=', args: [{ property: 'monty:corr_id' }, corrId] },
    })
    const rows = page.features.map((f) => f.properties['monty:hazard_detail']).filter((d) => d && typeof d.severity_value === 'number')
    const d = rows.find((r) => r.estimate_type === 'primary') ?? rows[0]
    return d ? hazardOf(d.severity_value, d.severity_unit) : undefined
  }

  private async impactRows(corrId: string | undefined): Promise<ImpactItem[]> {
    if (!corrId) return []
    const page = await this.search({
      collections: IMPACT_COLLECTIONS,
      limit: 200,
      'filter-lang': 'cql2-json',
      filter: { op: '=', args: [{ property: 'monty:corr_id' }, corrId] },
    })
    return page.features.flatMap((f) => {
      const d = f.properties['monty:impact_detail']
      return d && typeof d.value === 'number' && IMPACT_LABEL[d.type] ? [{ type: d.type as string, value: d.value as number, collection: f.collection }] : []
    })
  }

  async searchEvents(q: EventQuery): Promise<DisasterEvent[]> {
    const types = q.types ?? (Object.keys(HAZARD_CODE) as DisasterType[])
    const dLat = q.radiusKm / KM_PER_DEG
    const dLon = q.radiusKm / (KM_PER_DEG * Math.max(0.1, Math.cos((q.near[1] * Math.PI) / 180)))
    const events = await this.fetchEvents(
      {
        bbox: [q.near[0] - dLon, q.near[1] - dLat, q.near[0] + dLon, q.near[1] + dLat],
        datetime: `${q.fromYear}-01-01T00:00:00Z/${q.toYear}-12-31T23:59:59Z`,
        filter: overlaps('monty:hazard_codes', types.map((t) => HAZARD_CODE[t])),
      },
      200,
    )
    return events
      .filter((e) => e.id !== q.excludeId && types.includes(e.type))
      .filter((e) => distance(point(e.center), point(q.near), { units: 'kilometers' }) <= q.radiusKm)
  }

  /**
   * Monty impacts are not split by district. Rows here are one per impact type (deaths, affected, cost).
   * `district` holds the label. The AOI is ignored.
   */
  async getImpact(eventId: string): Promise<ImpactRow[]> {
    const event = await this.getEvent(eventId)
    const rows = await this.impactRows(event.corrId)
    const best = bestPerType(rows)
    return Object.entries(best)
      .map(([type, v]) => ({
        district: IMPACT_LABEL[type]!,
        people: type === 'cost' ? 0 : Math.round(v),
        damage: type === 'cost' ? Math.round((costUsd(rows, v) / 1e6) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.people - a.people)
  }
}

interface ImpactItem {
  type: string
  value: number
  collection: string
}

/** Sources can report the same impact more than once (EM-DAT "affected" vs "total affected"). Keep the largest. */
function bestPerType(rows: ImpactItem[]): Record<string, number> {
  const best: Record<string, number> = {}
  for (const r of rows) best[r.type] = Math.max(best[r.type] ?? 0, r.value)
  return best
}

/** EM-DAT costs are in thousands of USD. Other sources use USD. */
function costUsd(rows: ImpactItem[], value: number): number {
  const row = rows.find((r) => r.type === 'cost' && r.value === value)
  return row?.collection.startsWith('emdat') ? value * 1000 : value
}

function totalsOf(rows: ImpactItem[]): ImpactTotals {
  const b = bestPerType(rows)
  const t: ImpactTotals = {}
  if (b.death !== undefined) t.deaths = Math.round(b.death)
  if (b.injured !== undefined) t.injured = Math.round(b.injured)
  const affected = Math.max(b.affected_total ?? 0, b.potentially_affected ?? 0)
  if (affected) t.affected = Math.round(affected)
  if (b.displaced_total !== undefined) t.displaced = Math.round(b.displaced_total)
  if (b.cost !== undefined) t.damage = Math.round((costUsd(rows, b.cost) / 1e6) * 100) / 100
  return t
}
