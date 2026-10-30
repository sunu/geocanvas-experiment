import { HAZARD_FAMILIES, hazardFamily, type HazardFamily } from '@ttx/plugins'
import type { StacSearch } from '@ttx/plugins/monty/client'
import { postSearch } from '../events/monty'
import type { Source } from '../hapi/api'

/**
 * A country's disaster history from EM-DAT through Montandon (plans/plan-020.md): every event with its deaths and
 * people affected, read by country code without geometry (Nepal: 212 events and 551 impact items, about 2 s; by shape
 * it took 2 minutes and caught other countries' events). The summary is pure, for tests.
 */

export const HISTORY_SOURCE: Source = { title: 'EM-DAT', provider: 'CRED / UCLouvain, through IFRC Montandon', link: 'https://www.emdat.be/' }

/** One event as EM-DAT records it. */
export interface PastEvent {
  id: string
  title: string
  /** YYYY-MM-DD */
  date: string
  year: number
  family: HazardFamily | undefined
  deaths: number
  affected: number
}

/** A STAC search's items, page by page (Montandon's next link is a POST with a token), at most `maxPages` pages. */
export async function searchAll(search: StacSearch, body: Record<string, unknown>, maxPages = 20) {
  const items: Awaited<ReturnType<StacSearch>>['features'] = []
  let next: Record<string, unknown> | undefined = body
  for (let page = 0; next && page < maxPages; page++) {
    const res = (await search(next)) as Awaited<ReturnType<StacSearch>> & { links?: { rel?: string; body?: Record<string, unknown> }[] }
    items.push(...res.features)
    next = res.features.length ? res.links?.find((l) => l.rel === 'next')?.body : undefined
  }
  return items
}

const byCountry = (iso3: string) => ({ 'filter-lang': 'cql2-json', filter: { op: 'a_overlaps', args: [{ property: 'monty:country_codes' }, [iso3]] } })
/** Geometry is most of an EM-DAT item (country outlines); none is needed here. */
const NO_GEOMETRY = { fields: { exclude: ['geometry', 'links', 'assets'] } }

/**
 * EM-DAT's id of an event or impact item ("2015-0114-NPL"), from the item's id ("emdat-event-2015-0114-NPL",
 * "emdat-impact-2015-0114-NPL-total_deaths"): most items in Montandon have no `monty:src_event_id`.
 */
export const emdatId = (item: { id: string; properties: Record<string, unknown> }): string | undefined =>
  /^emdat-(?:event|impact)-(\d{4}-\d{4}-[A-Z]{3})/.exec(item.id)?.[1] ?? ((item.properties['monty:src_event_id'] as string | null) || undefined)

/** EM-DAT's events of a country, with their deaths and people affected. */
export async function readHistory(search: StacSearch, iso3: string): Promise<PastEvent[]> {
  const [events, impacts] = await Promise.all([
    searchAll(search, { collections: ['emdat-events'], limit: 1000, ...byCountry(iso3), ...NO_GEOMETRY }),
    searchAll(search, { collections: ['emdat-impacts'], limit: 1000, ...byCountry(iso3), ...NO_GEOMETRY }),
  ])
  // An impact names its event by EM-DAT's id, e.g. "2026-0627-NPL".
  const figures = new Map<string, { deaths: number; affected: number }>()
  for (const i of impacts) {
    const src = emdatId(i)
    const detail = i.properties['monty:impact_detail'] as { type?: string; value?: number } | undefined
    if (!src || typeof detail?.value !== 'number' || detail.value < 0) continue
    const f = figures.get(src) ?? figures.set(src, { deaths: 0, affected: 0 }).get(src)!
    if (detail.type === 'death') f.deaths += detail.value
    if (detail.type === 'affected_total') f.affected += detail.value
  }
  return events.flatMap((e) => {
    const p = e.properties
    const date = String(p.start_datetime ?? p.datetime ?? '').slice(0, 10)
    if (!date) return []
    const f = figures.get(emdatId(e) ?? '') ?? { deaths: 0, affected: 0 }
    return [{ id: e.id, title: String(p.title ?? e.id), date, year: Number(date.slice(0, 4)), family: hazardFamily((p['monty:hazard_codes'] as string[]) ?? []), ...f }]
  })
}

const cache = new Map<string, Promise<PastEvent[]>>()

/** A country's history, read once per page. */
export function loadHistory(iso3: string): Promise<PastEvent[]> {
  let p = cache.get(iso3)
  if (!p) {
    p = readHistory(postSearch, iso3)
    p.catch(() => cache.delete(iso3))
    cache.set(iso3, p)
  }
  return p
}

export interface History {
  events: number
  deaths: number
  affected: number
  first?: number
  last?: number
  /** Events per decade (1950 means 1950–1959), each split by family, from the first decade to the current one. */
  decades: { decade: number; byFamily: Partial<Record<HazardFamily, number>>; total: number }[]
  /** The deadliest events, most deaths first. */
  deadliest: PastEvent[]
  /** Events, deaths and people affected per family, most events first. */
  families: { family: HazardFamily; events: number; deaths: number; affected: number }[]
  /** Technological events left out (road, air and water transport accidents). */
  technological: number
}

/** The history of a country's events, of one family or every natural hazard (''). */
export function historyOf(all: PastEvent[], hazard: HazardFamily | '', now = new Date(), deadliest = 5): History {
  const technological = hazard ? 0 : all.filter((e) => e.family === 'technological').length
  const events = all.filter((e) => (hazard ? e.family === hazard : e.family !== 'technological'))
  const years = events.map((e) => e.year)
  const first = years.length ? Math.min(...years) : undefined
  const decades: History['decades'] = []
  if (first !== undefined) {
    for (let d = Math.floor(first / 10) * 10; d <= now.getUTCFullYear(); d += 10) decades.push({ decade: d, byFamily: {}, total: 0 })
  }
  const families = new Map<HazardFamily, History['families'][number]>()
  for (const e of events) {
    const family = e.family ?? 'otherNatural'
    const d = decades[Math.floor(e.year / 10) - Math.floor(first! / 10)]
    if (d) {
      d.byFamily[family] = (d.byFamily[family] ?? 0) + 1
      d.total++
    }
    const f = families.get(family) ?? families.set(family, { family, events: 0, deaths: 0, affected: 0 }).get(family)!
    f.events++
    f.deaths += e.deaths
    f.affected += e.affected
  }
  return {
    events: events.length,
    deaths: events.reduce((n, e) => n + e.deaths, 0),
    affected: events.reduce((n, e) => n + e.affected, 0),
    first,
    last: years.length ? Math.max(...years) : undefined,
    decades,
    deadliest: events.filter((e) => e.deaths > 0).sort((a, b) => b.deaths - a.deaths || b.date.localeCompare(a.date)).slice(0, deadliest),
    families: [...families.values()].sort((a, b) => b.events - a.events || b.deaths - a.deaths),
    technological,
  }
}

/** The families in display order, for colors and the filter. */
export const FAMILIES = Object.keys(HAZARD_FAMILIES) as HazardFamily[]
