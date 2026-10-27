import type { DisasterEvent, DisasterType, EventSummary, ImpactTotals, SourceReport } from './types'
import { ALL_EVENT_COLLECTIONS, eventCollections, sourceLabel } from './sources'
import { isStructured, narrowByName, parseSearch } from './search'
import { DISASTER_TYPES, disasterTypeOf, hazardCodes } from './hazards'

/**
 * Events from the IFRC Montandon / Monty STAC API. The API needs a token, so the browser never calls it
 * directly: it posts to the Worker, which adds the token (apps/worker/src/monty.ts).
 *   POST /monty/search  ->  POST {MONTANDON_BASE_URL}/search
 */

export type StacSearch = (body: Record<string, unknown>) => Promise<{ features: StacItem[] }>

/** The fields of a STAC item that are read here. */
interface StacItem {
  id: string
  collection: string
  properties: Record<string, any>
}

/** The picker lists these sources unless a search names another. GDACS is near-real-time; EM-DAT is the historical archive. */
const EVENT_COLLECTIONS = ['gdacs-events', 'emdat-events']
/**
 * Every source's events are searched for the same event in other sources. Collections are named, not found by
 * `roles in (event)`, because the live API returns nothing for that filter and takes 30 s or fails when no
 * collection is given.
 */
const CORRELATION_COLLECTIONS = ALL_EVENT_COLLECTIONS
const HAZARD_COLLECTIONS = ['gdacs-hazards', 'emdat-hazards', 'usgs-hazards', 'ibtracs-hazards', 'pdc-hazards', 'cems-hazards', 'gfd-hazards', 'glide-hazards']
const IMPACT_COLLECTIONS = [
  'gdacs-impacts',
  'emdat-impacts',
  'idmc-gidd-impacts',
  'idmc-idu-impacts',
  'ifrcevent-impacts',
  'pdc-impacts',
  'usgs-impacts',
  'cems-impacts',
  'gfd-impacts',
  'desinventar-impacts',
]
/** Impact types that the totals use. */
const IMPACT_TYPES = new Set(['death', 'missing', 'injured', 'affected_total', 'potentially_affected', 'displaced_total', 'cost'])

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

const TYPE_LABEL: Record<DisasterType, string> = { cyclone: 'Cyclone', flood: 'Flood', earthquake: 'Earthquake', drought: 'Drought' }

/** EM-DAT titles are generic ("Ground movement in Türkiye"). Build a clearer name. GDACS titles are fine. */
function nameOf(item: StacItem, type: DisasterType, start: string): string {
  const title: string = item.properties.title ?? item.id
  if (!item.collection.startsWith('emdat')) return title
  const place = /\bin (.+?)(?: of [A-Z][a-z]+ \d{4})?$/.exec(title)?.[1] ?? item.properties['monty:country_codes']?.[0] ?? ''
  return `${TYPE_LABEL[type]} in ${place} (${start.slice(0, 4)})`
}

/** "Moment Magnitude" or "mww" 7.8 -> "Mw 7.8"; "km/h" 204 -> "204 km/h". */
function hazardOf(value: number, unit: string | undefined) {
  if (!(value > 0)) return undefined // Monty uses -1 for "no value"
  const u = unit ?? ''
  const v = Math.round(value * 10) / 10
  // Magnitude scales are "M", "Mb", "Ml", or moment magnitudes "Mw", "Mww" (USGS).
  const label = /magnitude|^m\w{0,2}$/i.test(u) ? `${/moment|^mw/i.test(u) ? 'Mw' : 'M'} ${v}` : `${v.toLocaleString('en-US')} ${u}`.trim()
  return { value, unit: u, label }
}

function toEvent(item: StacItem): DisasterEvent | undefined {
  const p = item.properties
  const type = disasterTypeOf(p['monty:hazard_codes'] ?? [])
  if (!type) return undefined
  const start = String(p.start_datetime ?? p.datetime).slice(0, 10)
  const end = String(p.end_datetime ?? p.datetime).slice(0, 10)
  const sd = p.severitydata
  return {
    id: item.id,
    type,
    name: nameOf(item, type, start),
    source: sourceLabel(sourceOf(item.collection)),
    hazard: sd && typeof sd.severity === 'number' ? hazardOf(sd.severity, sd.severityunit) : undefined,
    country: (p['monty:country_codes'] ?? [])[0] ?? '',
    start,
    end,
    year: Number(start.slice(0, 4)),
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

/** The source in a collection name: "gdacs-events" -> "gdacs". */
const sourceOf = (collection: string) => collection.split('-')[0]!

const summaryOf = ({ id, name, type, start, year, country, source }: DisasterEvent): EventSummary => ({ id, name, type, start, year, country, source })

/** An event as one source recorded it. */
interface SourceEvent {
  id: string
  source: string
  corrId?: string
}

const DAY_MS = 86400000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export class MontyClient {
  private cache = new Map<string, DisasterEvent>()
  private enriched = new Map<string, Promise<DisasterEvent>>()
  private search: StacSearch

  constructor(search: StacSearch = postSearch) {
    this.search = search
  }

  private async fetchEvents(body: Record<string, unknown>, limit: number): Promise<DisasterEvent[]> {
    const page = await this.search({
      collections: EVENT_COLLECTIONS,
      limit,
      'filter-lang': 'cql2-json',
      sortby: [{ field: 'datetime', direction: 'desc' }],
      ...body,
    })
    const events = latestEpisodes(page.features)
      .map(toEvent)
      .filter((e): e is DisasterEvent => !!e)
    for (const e of events) if (!this.cache.has(e.id)) this.cache.set(e.id, e)
    return events
  }

  /** The most recent events, newest first. */
  async listEvents(): Promise<EventSummary[]> {
    const recent = await this.fetchEvents({ filter: overlaps('monty:hazard_codes', DISASTER_TYPES.flatMap(hazardCodes)) }, 150)
    return narrowByName(recent, parseSearch('')).map(summaryOf)
  }

  /**
   * Events that match a search text such as "nepal floods 2023": newest first, and the ones whose name has the
   * text's other words first. An empty text is `listEvents()`.
   */
  async findEvents(text: string, limit = 50): Promise<EventSummary[]> {
    const q = parseSearch(text)
    if (!isStructured(q) && !q.words.length) return (await this.listEvents()).slice(0, limit)
    const clauses = [overlaps('monty:hazard_codes', (q.types.length ? q.types : DISASTER_TYPES).flatMap(hazardCodes))]
    if (q.countries.length) clauses.push(overlaps('monty:country_codes', q.countries))
    const events = await this.fetchEvents(
      {
        ...(q.sources.length && { collections: q.sources.flatMap(eventCollections) }),
        filter: clauses.length > 1 ? { op: 'and', args: clauses } : clauses[0],
        ...(q.fromYear !== undefined && { datetime: `${q.fromYear}-01-01T00:00:00Z/${q.toYear}-12-31T23:59:59Z` }),
      },
      isStructured(q) ? 100 : 150,
    )
    return narrowByName(events, q).slice(0, limit).map(summaryOf)
  }

  /** The event with its hazard intensity, impact totals, and what each source reports. Asked once per event. */
  getEvent(id: string): Promise<DisasterEvent> {
    let pending = this.enriched.get(id)
    if (!pending) {
      pending = this.loadEvent(id)
      // A failed load is not kept, so the next call tries again.
      pending.catch(() => this.enriched.delete(id))
      this.enriched.set(id, pending)
    }
    return pending
  }

  private async loadEvent(id: string): Promise<DisasterEvent> {
    let base = this.cache.get(id)
    if (!base) {
      const page = await this.search({ collections: [collectionOf(id)], ids: [id], limit: 1 })
      const f = page.features[0]
      base = f && toEvent(f)
      if (!base) throw new Error(`Unknown event: ${id}`)
    }
    const own: SourceEvent = { id: base.id, source: sourceOf(collectionOf(base.id)), corrId: base.corrId }
    const reports = await this.sameEvent(base).then((others) => [own, ...others.filter((o) => o.id !== base!.id)]).catch(() => [own])
    const corrIds = [...new Set(reports.flatMap((r) => (r.corrId ? [r.corrId] : [])))]
    const [hazard, rows] = await Promise.all([
      base.hazard ?? this.hazardFor(corrIds).catch(() => undefined),
      this.impactRows(corrIds).catch(() => []),
    ])
    return { ...base, hazard, impacts: totalsOf(rows), sources: sourceReports(reports, rows) }
  }

  /**
   * The same event in the other sources. `monty:corr_id` cannot do this: it is made per source, so two sources
   * can give one event different ids. Upstream matches hazard, country and time instead (Algorithm 1):
   * https://github.com/IFRCGo/monty-stac-extension/blob/main/docs/model/stac-api/correlation_algorithms.md
   */
  private async sameEvent(event: DisasterEvent): Promise<SourceEvent[]> {
    if (!event.country) return []
    const page = await this.search({
      collections: CORRELATION_COLLECTIONS,
      limit: 50,
      'filter-lang': 'cql2-json',
      datetime: `${isoDay(Date.parse(event.start) - DAY_MS)}T00:00:00Z/${isoDay(Date.parse(event.end) + DAY_MS)}T23:59:59Z`,
      filter: {
        op: 'and',
        args: [
          overlaps('monty:hazard_codes', hazardCodes(event.type)),
          { op: 'a_contains', args: [{ property: 'monty:country_codes' }, event.country] },
        ],
      },
    })
    return latestEpisodes(page.features).map((f) => ({ id: f.id, source: sourceOf(f.collection), corrId: f.properties['monty:corr_id'] }))
  }

  private async hazardFor(corrIds: string[]) {
    if (!corrIds.length) return undefined
    const page = await this.search({
      collections: HAZARD_COLLECTIONS,
      limit: 20,
      'filter-lang': 'cql2-json',
      filter: { op: 'in', args: [{ property: 'monty:corr_id' }, corrIds] },
    })
    const rows = page.features.map((f) => f.properties['monty:hazard_detail']).filter((d) => d && typeof d.severity_value === 'number')
    const d = rows.find((r) => r.estimate_type === 'primary') ?? rows[0]
    return d ? hazardOf(d.severity_value, d.severity_unit) : undefined
  }

  private async impactRows(corrIds: string[]): Promise<ImpactItem[]> {
    if (!corrIds.length) return []
    const page = await this.search({
      collections: IMPACT_COLLECTIONS,
      limit: 200,
      'filter-lang': 'cql2-json',
      filter: { op: 'in', args: [{ property: 'monty:corr_id' }, corrIds] },
    })
    return page.features.flatMap((f) => {
      const d = f.properties['monty:impact_detail']
      return d && typeof d.value === 'number' && IMPACT_TYPES.has(d.type) ? [{ type: d.type as string, value: d.value as number, collection: f.collection }] : []
    })
  }
}

/** The one client for the app, so its caches are shared by every event on the board. */
export const monty = new MontyClient()

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

/** What each source reports. Sources are in the order the event was found in, the picked one first. */
function sourceReports(events: SourceEvent[], rows: ImpactItem[]): SourceReport[] {
  const reports = new Map<string, SourceReport>()
  const report = (source: string) => reports.get(source) ?? reports.set(source, { source, eventIds: [] }).get(source)!
  for (const e of events) report(e.source).eventIds.push(e.id)
  for (const r of rows) report(sourceOf(r.collection))
  return [...reports.values()].map((r) => {
    const own = rows.filter((row) => sourceOf(row.collection) === r.source)
    return own.length ? { ...r, impacts: totalsOf(own) } : r
  })
}
