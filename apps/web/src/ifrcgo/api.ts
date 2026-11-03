import type { GoRef } from '@ttx/plugins'
import { perPage } from '../cards/perPage'
import { cutAtWord, SUMMARY_CHARS } from '../cards/text'
import { decode } from '../reliefweb/feed'

/**
 * An emergency on IFRC GO, read straight from GO's API (https://goadmin.ifrc.org/api/v2), which sends CORS headers
 * for any origin and needs no key for public emergencies, so there is no Worker proxy. An emergency costs 2
 * requests (the emergency, and its hazard type's name), kept per page; the card's refresh button asks again.
 * The emergency's contacts (names, emails) are in the answer and are never read.
 */

export interface GoAppeal {
  /** "DREF", "Emergency Appeal"… */
  type: string
  code: string
  /** "Active", "Closed"… */
  status: string
  /** Swiss francs. */
  requested: number
  funded: number
  beneficiaries: number
}

export interface GoFieldReport {
  id: number
  title: string
  /** ISO date. */
  date: string
}

export interface GoEmergency {
  id: number
  name: string
  /** The emergency's page on GO. */
  url: string
  hazard?: string
  countries: string[]
  /** IFRC's severity: level 0, 1, 2 for Yellow, Orange, Red. */
  severity?: { level: number; label: string }
  /** ISO date. */
  startDate?: string
  glide?: string
  /** People affected, when GO has a figure. */
  affected?: number
  /** The first words of the text, without markup. */
  summary?: string
  /** What the emergency page headlines: "1,282 · Number of deaths · WHO 11 Oct 2026". */
  keyFigures: { value: string; label: string; source?: string }[]
  appeals: GoAppeal[]
  /** The newest few; `fieldReportCount` counts them all. */
  fieldReports: GoFieldReport[]
  fieldReportCount: number
  updatedAt: string
}

const MAX_FIGURES = 4
const MAX_REPORTS = 3

/** The first words of GO's text, which is HTML with inline styles: blocks become spaces, tags go, entities are decoded. */
export function htmlSummary(html: string | null | undefined): string | undefined {
  const text = decode(
    (html ?? '')
      .replace(/<(?:br|\/p|\/div|\/h\d|\/li|\/tr)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim()
  return text ? cutAtWord(text, SUMMARY_CHARS) : undefined
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
/** Swiss francs as GO shows them, shortened: "CHF 1.5M". */
export const chf = (amount: number) => `CHF ${compact.format(amount)}`

/** The share of an appeal that is funded, in whole percent; none for an appeal that asks for nothing. */
export const fundedShare = (a: Pick<GoAppeal, 'requested' | 'funded'>) => (a.requested > 0 ? Math.round((a.funded / a.requested) * 100) : undefined)

interface RawEmergency {
  id: number
  name: string
  /** The hazard type's id: the emergency's own answer has no name for it. */
  dtype?: number | { name?: string }
  countries?: { name?: string }[]
  ifrc_severity_level?: number | null
  ifrc_severity_level_display?: string | null
  disaster_start_date?: string | null
  glide?: string | null
  num_affected?: number | null
  summary?: string | null
  key_figures?: { number?: string; deck?: string; source?: string | null }[] | null
  appeals?: { atype_display: string; code: string; status_display: string; amount_requested?: number | null; amount_funded?: number | null; num_beneficiaries?: number | null }[]
  field_reports?: { id: number; summary?: string | null; report_date?: string | null; created_at: string }[]
  updated_at: string
}

export function toEmergency(raw: RawEmergency, hazard?: string): GoEmergency {
  const reports = [...(raw.field_reports ?? [])].map((f) => ({ id: f.id, title: f.summary?.trim() || `Field report ${f.id}`, date: f.report_date ?? f.created_at })).sort((a, b) => b.date.localeCompare(a.date))
  return {
    id: raw.id,
    name: raw.name,
    url: `https://go.ifrc.org/emergencies/${raw.id}`,
    hazard,
    countries: (raw.countries ?? []).flatMap((c) => (c.name ? [c.name] : [])),
    severity: raw.ifrc_severity_level_display ? { level: raw.ifrc_severity_level ?? 0, label: raw.ifrc_severity_level_display } : undefined,
    startDate: raw.disaster_start_date ?? undefined,
    glide: raw.glide || undefined,
    affected: raw.num_affected ?? undefined,
    summary: htmlSummary(raw.summary),
    keyFigures: (raw.key_figures ?? []).flatMap((k) => (k.number && k.deck ? [{ value: k.number, label: k.deck, source: k.source?.trim() || undefined }] : [])).slice(0, MAX_FIGURES),
    appeals: (raw.appeals ?? []).map((a) => ({ type: a.atype_display, code: a.code, status: a.status_display, requested: a.amount_requested ?? 0, funded: a.amount_funded ?? 0, beneficiaries: a.num_beneficiaries ?? 0 })),
    fieldReports: reports.slice(0, MAX_REPORTS),
    fieldReportCount: reports.length,
    updatedAt: raw.updated_at,
  }
}

export class GoError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`https://goadmin.ifrc.org/api/v2${path}`, { headers: { Accept: 'application/json' } })
  if (res.ok) return (await res.json()) as T
  if (res.status === 404) throw new GoError('Not found. An emergency link looks like https://go.ifrc.org/emergencies/8083.')
  throw new GoError(`IFRC GO answered ${res.status}.`)
}

/** A hazard type's name, such as "Flood", once per page for all cards. */
const hazardName = perPage((id: number) => get<{ name: string }>(`/disaster_type/${id}/`).then((d) => d.name), String)

async function read({ id }: GoRef): Promise<GoEmergency> {
  const raw = await get<RawEmergency>(`/event/${id}/`)
  // The hazard's name is extra: the card is still worth showing without it.
  const hazard = typeof raw.dtype === 'number' ? await hazardName(raw.dtype).catch(() => undefined) : raw.dtype?.name
  return toEmergency(raw, hazard)
}

/** The emergency, once per page; `refresh` asks GO again. A failure is not kept. */
export const loadEmergency = perPage(read, (ref: GoRef) => String(ref.id))
