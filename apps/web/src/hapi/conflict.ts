/**
 * Conflict in a country: ACLED's monthly counts of political violence events and fatalities, by district, through
 * HDX HAPI (api.ts). HAPI's event types overlap: "political_violence" includes "civilian_targeting", and
 * "demonstration" is counted apart, so only political violence is read here, never a sum of the types.
 */
import { hapiAll, sourceOf, unmatched, type Row, type Source } from './api'

/** Months shown, the current one included. */
export const MONTHS = 12

export interface ConflictMonth {
  /** "YYYY-MM". */
  month: string
  events: number
  fatalities: number
  /** The month is not over yet, so its counts will grow. */
  partial: boolean
}

export interface Conflict {
  months: ConflictMonth[]
  events: number
  fatalities: number
  /** Provinces with the most events, when ACLED's rows are by district (some countries have national totals only). */
  provinces: { name: string; events: number; fatalities: number }[]
  /** Events in districts HAPI could not match to a P-code: in the totals, not in a province. */
  unplaced: number
  source?: string
}

const monthOf = (d: Date) => d.toISOString().slice(0, 7)

/** The first day of the first month shown, as HAPI's start_date: the current month and the 11 before it. */
export function startDate(today: Date): string {
  return `${monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - (MONTHS - 1), 1)))}-01`
}

/** Totals by month (every month shown, also those without events) and by province. */
export function conflictOf(rows: Row[], today: Date, topProvinces = 5): Conflict {
  const months = new Map<string, ConflictMonth>()
  for (let i = MONTHS - 1; i >= 0; i--) {
    const month = monthOf(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - i, 1)))
    months.set(month, { month, events: 0, fatalities: 0, partial: i === 0 })
  }
  const provinces = new Map<string, { name: string; events: number; fatalities: number }>()
  let unplaced = 0
  for (const r of rows) {
    const m = months.get(String(r.reference_period_start).slice(0, 7))
    if (!m) continue
    m.events += r.events ?? 0
    m.fatalities += r.fatalities ?? 0
    if (r.admin1_name && unmatched(r)) unplaced += r.events ?? 0
    else if (r.admin1_name) {
      const p = provinces.get(r.admin1_name) ?? provinces.set(r.admin1_name, { name: r.admin1_name, events: 0, fatalities: 0 }).get(r.admin1_name)!
      p.events += r.events ?? 0
      p.fatalities += r.fatalities ?? 0
    }
  }
  const all = [...months.values()]
  return {
    months: all,
    events: all.reduce((n, m) => n + m.events, 0),
    fatalities: all.reduce((n, m) => n + m.fatalities, 0),
    provinces: [...provinces.values()].filter((p) => p.events > 0).sort((a, b) => b.events - a.events).slice(0, topProvinces),
    unplaced,
    ...(rows[0] && { source: rows[0].resource_hdx_id }),
  }
}

const rowLoads = new Map<string, Promise<Row[]>>()

/** A country's political violence rows (by district and month) of the last 12 months. Asked once per country and page. */
export function loadConflictRows(iso3: string, today = new Date()): Promise<Row[]> {
  let pending = rowLoads.get(iso3)
  if (!pending) {
    pending = hapiAll('coordination-context/conflict-events', { location_code: iso3, event_type: 'political_violence', start_date: startDate(today) })
    pending.catch(() => rowLoads.delete(iso3))
    rowLoads.set(iso3, pending)
  }
  return pending
}

/** A country's last 12 months of political violence, with its source. */
export async function loadConflict(iso3: string): Promise<{ conflict: Conflict; source?: Source }> {
  const conflict = conflictOf(await loadConflictRows(iso3), new Date())
  return { conflict, source: conflict.source ? await sourceOf(conflict.source) : undefined }
}
