/**
 * HDX HAPI (https://hapi.humdata.org), read through the Worker, which adds the app identifier (apps/worker/src/hapi.ts).
 * Each data endpoint gives rows tagged by country (ISO3), often by province and district (P-codes), and by reference
 * period. HAPI answers an unknown code with no rows, not an error, and matches text filters as wildcards: filter by code.
 */

/** A HAPI row: the fields read here, by endpoint. */
export type Row = Record<string, any>

/** HAPI's most rows per request. */
const PAGE = 10000

/** One page of an endpoint's rows. */
export async function hapi(endpoint: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<Row[]> {
  const res = await fetch(`/hapi/${endpoint}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, { signal })
  if (!res.ok) throw new Error(`HDX HAPI ${endpoint} failed (${res.status})`)
  return ((await res.json()) as { data: Row[] }).data
}

/** Every row of a query, page by page: HAPI cuts an answer at 10,000 rows without saying so. */
export async function hapiAll(endpoint: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<Row[]> {
  const rows: Row[] = []
  for (;;) {
    const page = await hapi(endpoint, { ...params, limit: PAGE, offset: rows.length }, signal)
    rows.push(...page)
    if (page.length < PAGE) return rows
  }
}

export interface Country {
  code: string
  name: string
  /** It has a humanitarian response plan. */
  hasHrp: boolean
  /** It is in the Global Humanitarian Overview. */
  inGho: boolean
}

export const countryOf = (r: Row): Country => ({ code: r.code, name: r.name, hasHrp: !!r.has_hrp, inGho: !!r.in_gho })

let countries: Promise<Country[]> | undefined

/** The countries HAPI has data for, by name. Asked once. */
export function loadCountries(): Promise<Country[]> {
  countries ??= hapi('metadata/location', { limit: 1000 }).then((rows) => rows.map(countryOf).sort((a, b) => a.name.localeCompare(b.name)))
  countries.catch(() => (countries = undefined))
  return countries
}

export interface Source {
  title: string
  provider: string
  link: string
}

const sources = new Map<string, Promise<Source | undefined>>()

/** Where a figure comes from: its HDX dataset and provider. Datasets are shared by countries, so asked once each. */
export function sourceOf(resourceId: string): Promise<Source | undefined> {
  let pending = sources.get(resourceId)
  if (!pending) {
    pending = hapi('metadata/resource', { resource_hdx_id: resourceId }).then(
      ([r]) => r && { title: r.dataset_hdx_title, provider: r.dataset_hdx_provider_name, link: r.dataset_hdx_link },
      () => {
        sources.delete(resourceId)
        return undefined
      },
    )
    sources.set(resourceId, pending)
  }
  return pending
}
