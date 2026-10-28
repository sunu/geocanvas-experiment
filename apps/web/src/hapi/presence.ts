/**
 * Who works where in a country: HDX HAPI's operational presence (api.ts), the organizations a 3W lists by sector and
 * district for the current year. Only countries with a humanitarian response have one.
 */
import { hapiAll, sourceOf, type Row, type Source } from './api'

export interface Presence {
  year: string
  /** Organizations, in the sector shown. */
  orgs: number
  /** Every sector, the most organizations first: the choices of the sector filter. */
  sectors: { code: string; name: string; orgs: number }[]
  /** Provinces, the most organizations first. */
  provinces: { code: string; name: string; orgs: number }[]
  /** The organizations working in the most provinces. */
  topOrgs: { name: string; fullName: string; type: string; provinces: number }[]
  source: string
}

/** An organization by its acronym, which HAPI gives for nearly all; else its name. */
const orgKey = (r: Row): string => r.org_acronym || r.org_name

/** Distinct organizations per key, the most first. */
function countOrgs<K>(rows: Row[], keyOf: (r: Row) => K | undefined): { key: K; orgs: number }[] {
  const by = new Map<K, Set<string>>()
  for (const r of rows) {
    const k = keyOf(r)
    if (k === undefined) continue
    let orgs = by.get(k)
    if (!orgs) by.set(k, (orgs = new Set()))
    orgs.add(orgKey(r))
  }
  return [...by].map(([key, orgs]) => ({ key, orgs: orgs.size })).sort((a, b) => b.orgs - a.orgs)
}

/** The figures for one sector, or all sectors with ''. Undefined when the country has no 3W. */
export function presenceOf(rows: Row[], sector: string, topOrgs = 8): Presence | undefined {
  if (!rows.length) return undefined
  const names = new Map(rows.map((r) => [r.sector_code as string, r.sector_name as string]))
  const shown = sector ? rows.filter((r) => r.sector_code === sector) : rows
  const provinceNames = new Map(rows.map((r) => [r.admin1_code as string, r.admin1_name as string]))
  // Per organization: the provinces it works in, and its full name and type.
  const byOrg = new Map<string, { row: Row; provinces: Set<string> }>()
  for (const r of shown) {
    const o = byOrg.get(orgKey(r)) ?? byOrg.set(orgKey(r), { row: r, provinces: new Set() }).get(orgKey(r))!
    if (r.admin1_code) o.provinces.add(r.admin1_code)
  }
  return {
    year: String(rows[0]!.reference_period_start).slice(0, 4),
    orgs: byOrg.size,
    sectors: countOrgs(rows, (r) => r.sector_code as string).map(({ key, orgs }) => ({ code: key, name: names.get(key) ?? key, orgs })),
    provinces: countOrgs(shown, (r) => (r.admin1_code as string | null) ?? undefined).map(({ key, orgs }) => ({ code: key, name: provinceNames.get(key) ?? key, orgs })),
    topOrgs: [...byOrg.values()]
      .sort((a, b) => b.provinces.size - a.provinces.size || orgKey(a.row).localeCompare(orgKey(b.row)))
      .slice(0, topOrgs)
      .map(({ row, provinces }) => ({ name: orgKey(row), fullName: row.org_name, type: row.org_type_description, provinces: provinces.size })),
    source: rows[0]!.resource_hdx_id,
  }
}

const loads = new Map<string, Promise<{ rows: Row[]; source?: Source }>>()

/** A country's 3W rows and their source. Asked once per country; the sector filter is applied to them in the browser. */
export function loadPresence(iso3: string): Promise<{ rows: Row[]; source?: Source }> {
  let pending = loads.get(iso3)
  if (!pending) {
    pending = hapiAll('coordination-context/operational-presence', { location_code: iso3 }).then(async (rows) => ({
      rows,
      source: rows[0] && (await sourceOf(rows[0].resource_hdx_id)),
    }))
    pending.catch(() => loads.delete(iso3))
    loads.set(iso3, pending)
  }
  return pending
}
