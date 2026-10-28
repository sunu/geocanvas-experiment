/**
 * A country's humanitarian context from HDX HAPI (https://hapi.humdata.org), read through the Worker, which adds
 * the app identifier (apps/worker/src/hapi.ts). Each endpoint gives rows tagged by country and reference period;
 * the functions below pick the figures a context card shows. HAPI answers an unknown code with no rows, not an error.
 */

/** A HAPI row: the fields read here, by endpoint. */
type Row = Record<string, any>

export async function hapi(endpoint: string, params: Record<string, string | number>, signal?: AbortSignal): Promise<Row[]> {
  const res = await fetch(`/hapi/${endpoint}?${new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))}`, { signal })
  if (!res.ok) throw new Error(`HDX HAPI ${endpoint} failed (${res.status})`)
  return ((await res.json()) as { data: Row[] }).data
}

export interface Country {
  code: string
  name: string
  /** It has a humanitarian response plan. */
  hasHrp: boolean
  /** It is in the Global Humanitarian Overview. */
  inGho: boolean
}

export interface Risk {
  /** INFORM risk class, 1 (very low) to 5 (very high). */
  riskClass: number
  globalRank: number
  /** 0 to 10, and its three dimensions. */
  overall: number
  hazard: number
  vulnerability: number
  coping: number
  year: string
  source: string
}

export interface Population {
  total: number
  year: string
  source: string
}

export interface Poverty {
  /** Percent of people in multidimensional poverty. */
  headcount: number
  mpi: number
  year: string
  source: string
}

export interface Needs {
  inNeed: number
  targeted?: number
  year: string
  source: string
}

export interface Displacement {
  operation: string
  idps: number
  /** ISO date the figure is for. */
  date: string
  source: string
}

export interface Appeal {
  code: string
  name: string
  type: string
  requiredUsd: number
  fundedUsd: number
  /** Percent funded. */
  fundedPct: number
  year: string
  source: string
}

export interface Source {
  title: string
  provider: string
  link: string
}

export interface CountryContext {
  country: Country
  risk?: Risk
  population?: Population
  poverty?: Poverty
  needs?: Needs
  displacement: Displacement[]
  appeals: Appeal[]
  /** By HDX resource id, the `source` of each figure. */
  sources: Record<string, Source>
  /** Parts that could not be read, e.g. "funding". The others still show. */
  failed: string[]
}

const year = (r: Row) => String(r.reference_period_start).slice(0, 4)
const newestFirst = (a: Row, b: Row) => String(b.reference_period_start).localeCompare(String(a.reference_period_start))

export const countryOf = (r: Row): Country => ({ code: r.code, name: r.name, hasHrp: !!r.has_hrp, inGho: !!r.in_gho })

export function riskOf(rows: Row[]): Risk | undefined {
  const r = [...rows].sort(newestFirst)[0]
  if (!r) return undefined
  return {
    riskClass: Number(r.risk_class),
    globalRank: r.global_rank,
    overall: r.overall_risk,
    hazard: r.hazard_exposure_risk,
    vulnerability: r.vulnerability_risk,
    coping: r.coping_capacity_risk,
    year: year(r),
    source: r.resource_hdx_id,
  }
}

/** The latest year's total: its all-ages row for everyone, or for women and men added up. */
export function populationOf(rows: Row[]): Population | undefined {
  const latest = [...rows].sort(newestFirst)[0]
  if (!latest) return undefined
  const ofYear = rows.filter((r) => year(r) === year(latest) && String(r.age_range).toLowerCase() === 'all')
  const everyone = ofYear.find((r) => r.gender === 'all')
  const bySex = ofYear.filter((r) => r.gender === 'f' || r.gender === 'm')
  const total = everyone ? everyone.population : bySex.length === 2 ? bySex[0]!.population + bySex[1]!.population : undefined
  return total === undefined ? undefined : { total, year: year(latest), source: (everyone ?? bySex[0]!).resource_hdx_id }
}

export function povertyOf(rows: Row[]): Poverty | undefined {
  const r = rows.filter((r) => r.admin_level === 0).sort(newestFirst)[0]
  return r && { headcount: r.headcount_ratio, mpi: r.mpi, year: year(r), source: r.resource_hdx_id }
}

/**
 * People in need and targeted, all sectors together (`Intersectoral`), in the latest plan. HAPI has a row with
 * no category and one with category "total" for the same figure: either will do.
 */
export function needsOf(rows: Row[]): Needs | undefined {
  const totals = rows.filter((r) => r.sector_code === 'Intersectoral' && (r.category === '' || r.category === 'total'))
  const inNeed = totals.filter((r) => r.population_status === 'INN').sort(newestFirst)[0]
  if (!inNeed) return undefined
  const targeted = totals.find((r) => r.population_status === 'TGT' && year(r) === year(inNeed))
  return { inNeed: inNeed.population, ...(targeted && { targeted: targeted.population }), year: year(inNeed), source: inNeed.resource_hdx_id }
}

/** IDPs by operation (a displacement crisis IOM tracks), its latest round each, the most recent operations first. */
export function displacementOf(rows: Row[], limit = 3): Displacement[] {
  const latest = new Map<string, Row>()
  for (const r of [...rows].sort(newestFirst)) if (!latest.has(r.operation)) latest.set(r.operation, r)
  return [...latest.values()].slice(0, limit).map((r) => ({
    operation: r.operation,
    idps: r.population,
    date: String(r.reference_period_end ?? r.reference_period_start).slice(0, 10),
    source: r.resource_hdx_id,
  }))
}

/**
 * Appeals (response plans, flash appeals) of the latest two years, newest first. HAPI also lists the funding
 * given outside any appeal, as "Not specified" rows with no requirements: those are left out.
 */
export function appealsOf(rows: Row[], limit = 3): Appeal[] {
  const appeals = rows.filter((r) => r.appeal_type && r.appeal_code !== 'Not specified' && r.requirements_usd > 0).sort(newestFirst)
  const since = Number(year(appeals[0] ?? {})) - 1
  return appeals
    .filter((r) => Number(year(r)) >= since)
    .slice(0, limit)
    .map((r) => ({
      code: r.appeal_code,
      name: r.appeal_name,
      type: r.appeal_type,
      requiredUsd: r.requirements_usd,
      fundedUsd: r.funding_usd ?? 0,
      fundedPct: r.funding_pct ?? 0,
      year: year(r),
      source: r.resource_hdx_id,
    }))
}

let countries: Promise<Country[]> | undefined

/** The countries HAPI has data for, by name. Asked once. */
export function loadCountries(): Promise<Country[]> {
  countries ??= hapi('metadata/location', { limit: 1000 }).then((rows) => rows.map(countryOf).sort((a, b) => a.name.localeCompare(b.name)))
  countries.catch(() => (countries = undefined))
  return countries
}

const sources = new Map<string, Promise<Source | undefined>>()

/** Where a figure comes from: its HDX dataset and provider. Datasets are shared by countries, so asked once each. */
function sourceOf(resourceId: string): Promise<Source | undefined> {
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

const contexts = new Map<string, Promise<CountryContext>>()

/** A country's context: one request per endpoint, each part on its own, so one failing part does not hide the rest. Asked once per country. */
export function loadContext(iso3: string): Promise<CountryContext> {
  let pending = contexts.get(iso3)
  if (!pending) {
    pending = readContext(iso3)
    pending.catch(() => contexts.delete(iso3))
    contexts.set(iso3, pending)
  }
  return pending
}

async function readContext(iso3: string): Promise<CountryContext> {
  const failed: string[] = []
  const part = <T>(name: string, read: Promise<Row[]>, pick: (rows: Row[]) => T, none: T) =>
    read.then(pick, () => {
      failed.push(name)
      return none
    })
  const country = { location_code: iso3 }
  const [location, risk, population, poverty, needs, displacement, appeals] = await Promise.all([
    hapi('metadata/location', { code: iso3 }),
    part('risk', hapi('coordination-context/national-risk', country), riskOf, undefined),
    part('population', hapi('geography-infrastructure/baseline-population', { ...country, admin_level: 0, limit: 1000 }), populationOf, undefined),
    part('poverty', hapi('food-security-nutrition-poverty/poverty-rate', { ...country, admin_level: 0 }), povertyOf, undefined),
    part('people in need', hapi('affected-people/humanitarian-needs', { ...country, admin_level: 0, sector_code: 'Intersectoral' }), needsOf, undefined),
    part('displacement', hapi('affected-people/idps', { ...country, admin_level: 0, limit: 1000 }), (rows) => displacementOf(rows), []),
    part('funding', hapi('coordination-context/funding', { ...country, limit: 1000 }), (rows) => appealsOf(rows), []),
  ])
  if (!location[0]) throw new Error(`HDX HAPI has no data for ${iso3}`)
  const ids = [risk, population, poverty, needs, ...displacement, ...appeals].flatMap((f) => (f?.source ? [f.source] : []))
  const found = await Promise.all([...new Set(ids)].map(async (id) => [id, await sourceOf(id)] as const))
  return {
    country: countryOf(location[0]),
    ...(risk && { risk }),
    ...(population && { population }),
    ...(poverty && { poverty }),
    ...(needs && { needs }),
    displacement,
    appeals,
    sources: Object.fromEntries(found.filter((f): f is readonly [string, Source] => !!f[1])),
    failed,
  }
}
