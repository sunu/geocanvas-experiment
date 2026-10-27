import { countryName, extractCountries, fold } from './countries'
import { extractHazardTypes } from './hazards'
import { extractSources, sourceLabel } from './sources'
import type { DisasterType, EventSummary } from './types'

/** What a search text asks for. Types, countries and years narrow the search; `words` are left for names. */
export interface ParsedSearch {
  types: DisasterType[]
  /** ISO 3166-1 alpha-3, as Monty stores them. */
  countries: string[]
  fromYear?: number
  toYear?: number
  /** Sources named in the text, e.g. "emdat". Only these are asked. */
  sources: string[]
  words: string[]
}

const FILLER = new Set(['a', 'an', 'the', 'in', 'of', 'on', 'at', 'to', 'for', 'from', 'and', 'event', 'events', 'disaster', 'disasters'])

export function parseSearch(text: string): ParsedSearch {
  const { types, rest: noHazards } = extractHazardTypes(text)
  const { countries, rest: noCountries } = extractCountries(fold(noHazards))
  const { sources, rest } = extractSources(noCountries)
  const years = (rest.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number)
  const words = rest
    .replace(/\b(?:19|20)\d{2}\b/g, ' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
  return {
    types,
    countries,
    sources,
    ...(years.length && { fromYear: Math.min(...years), toYear: Math.max(...years) }),
    words,
  }
}

/** True when the search names a type, country, source or year, so that results can be filtered without the words. */
export const isStructured = (q: ParsedSearch) => q.types.length > 0 || q.countries.length > 0 || q.sources.length > 0 || q.fromYear !== undefined

/**
 * Newest first, then events whose name has the words first. Events whose name has any of the words are the
 * only ones kept. When none has, the events stay if the rest of the search was structured, otherwise
 * nothing matches.
 */
export function narrowByName<T extends { name: string; start: string }>(events: T[], q: ParsedSearch): T[] {
  const newest = [...events].sort((a, b) => b.start.localeCompare(a.start))
  if (!q.words.length) return newest
  const hits = (e: T) => q.words.filter((w) => fold(e.name).includes(w)).length
  const scored = newest.map((e) => ({ e, n: hits(e) }))
  const matched = scored.filter((s) => s.n > 0)
  if (!matched.length) return isStructured(q) ? newest : []
  return matched.sort((a, b) => b.n - a.n).map((s) => s.e)
}

/** How a search text was read, for showing to the user: "Nepal", "flood", "2023". */
export function describeSearch(text: string): string[] {
  const q = parseSearch(text)
  const years = q.fromYear === undefined ? [] : [q.fromYear === q.toYear ? String(q.fromYear) : `${q.fromYear}–${q.toYear}`]
  return [...q.countries.map((c) => countryName(c) ?? c), ...q.types, ...years, ...q.sources.map(sourceLabel), ...q.words.map((w) => `"${w}"`)]
}

/** One line over a list of results: how the search was read, how many events, and from which sources. */
export function overviewOf(text: string, events: EventSummary[], limit = 60): string {
  const read = describeSearch(text).join(' · ')
  if (!events.length) return read ? `${read} — no events` : 'No events'
  const bySource = new Map<string, number>()
  for (const e of events) bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1)
  const n = events.length
  const count = `${n >= limit ? `${n}+` : n} ${n === 1 ? 'event' : 'events'}`
  const sources = [...bySource].map(([source, k]) => `${source} ${k}`).join(', ')
  return `${read ? `${read} — ` : ''}${count} (${sources})`
}
