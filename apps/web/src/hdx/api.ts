import type { HdxRef } from '@ttx/plugins'
import { perPage } from '../cards/perPage'
import { bodySummary, cutAtWord } from '../cards/text'

/**
 * A dataset on HDX, read straight from its CKAN API (https://data.humdata.org/api/3/action/package_show), which sends
 * CORS headers for any origin and needs no key for public datasets, so there is no Worker proxy. One request per
 * dataset, kept per page; the card's refresh button asks again. Only the metadata is read: a file's download redirects
 * to a signed address that sends no CORS headers for other origins.
 */

export interface HdxResource {
  id: string
  name: string
  /** "CSV", "SHP", "GeoJSON"… */
  format?: string
  /** Bytes. */
  size?: number
  /** The file's page on HDX. */
  url?: string
}

export interface HdxDataset {
  name: string
  title: string
  /** The dataset's page on HDX. */
  url: string
  organization?: string
  countries: string[]
  /** The first words of the description, without markup. */
  summary?: string
  /** The period the data covers, ISO dates. */
  period?: { from: string; to: string }
  /** "Every year", "As needed"… */
  updates?: string
  /** ISO date of the last change to the data. */
  modified?: string
  license?: string
  source?: string
  caveats?: string
  tags: string[]
  /** Its files are not published: they are asked for through HDX. */
  onRequest: boolean
  archived: boolean
  /** The first few; `resourceCount` counts them all. */
  resources: HdxResource[]
  resourceCount: number
}

const MAX_RESOURCES = 5
const MAX_TAGS = 6
const CAVEATS_CHARS = 200

/** The dates in HDX's `[2024-03-14T00:00:00 TO 2025-10-30T23:59:59]`: the period the data covers. */
export function periodOf(datasetDate: string | null | undefined): HdxDataset['period'] {
  const [from, to] = datasetDate?.match(/\d{4}-\d{2}-\d{2}/g) ?? []
  return from ? { from, to: to ?? from } : undefined
}

/** HDX's update frequency, in days as a string, named as HDX names it: "-1" Never, "-2" As needed, "0" Live, then every n days. */
export function updateFrequency(days: string | number | null | undefined): string | undefined {
  if (days === null || days === undefined || days === '') return undefined
  const n = Number(days)
  if (!Number.isInteger(n)) return undefined
  const named: Record<number, string> = { [-2]: 'As needed', [-1]: 'Never', 0: 'Live', 1: 'Every day', 7: 'Every week', 14: 'Every two weeks', 30: 'Every month', 90: 'Every three months', 180: 'Every six months', 365: 'Every year' }
  return named[n] ?? (n > 0 ? `Every ${n} days` : undefined)
}

const UNITS = ['B', 'KB', 'MB', 'GB']
/** A file's size as a person reads it: "51.2 MB". */
export function fileSize(bytes: number): string {
  let n = bytes
  let u = 0
  while (n >= 1024 && u < UNITS.length - 1) {
    n /= 1024
    u++
  }
  return `${u === 0 || n >= 100 ? Math.round(n) : n.toFixed(1)} ${UNITS[u]}`
}

interface RawDataset {
  name: string
  title: string
  notes?: string | null
  organization?: { title?: string } | null
  groups?: { title?: string; display_name?: string }[]
  tags?: { name?: string }[]
  dataset_date?: string | null
  data_update_frequency?: string | number | null
  last_modified?: string | null
  metadata_modified?: string | null
  license_title?: string | null
  dataset_source?: string | null
  caveats?: string | null
  is_requestdata_type?: boolean | null
  archived?: boolean | null
  resources?: { id: string; name?: string | null; format?: string | null; size?: number | string | null }[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (v: string | null | undefined) => v?.trim() || undefined

export function toDataset(raw: RawDataset): HdxDataset {
  const url = `https://data.humdata.org/dataset/${raw.name}`
  const resources = raw.resources ?? []
  return {
    name: raw.name,
    title: raw.title,
    url,
    organization: text(raw.organization?.title),
    countries: (raw.groups ?? []).flatMap((g) => text(g.title ?? g.display_name) ?? []),
    summary: bodySummary(raw.notes),
    period: periodOf(raw.dataset_date),
    updates: updateFrequency(raw.data_update_frequency),
    modified: (raw.last_modified ?? raw.metadata_modified)?.slice(0, 10) || undefined,
    license: text(raw.license_title),
    source: text(raw.dataset_source),
    caveats: (() => {
      const c = bodySummary(raw.caveats)
      return c ? cutAtWord(c, CAVEATS_CHARS) : undefined
    })(),
    tags: (raw.tags ?? []).flatMap((t) => text(t.name) ?? []).slice(0, MAX_TAGS),
    onRequest: !!raw.is_requestdata_type,
    archived: !!raw.archived,
    resources: resources.slice(0, MAX_RESOURCES).map((r) => {
      const size = Number(r.size)
      return {
        id: r.id,
        name: text(r.name) ?? 'Unnamed file',
        format: text(r.format),
        size: r.size !== null && r.size !== undefined && Number.isFinite(size) && size > 0 ? size : undefined,
        // Built from the dataset's link and the file's id, never from an address in the answer.
        url: UUID.test(r.id) ? `${url}/resource/${r.id}` : undefined,
      }
    }),
    resourceCount: resources.length,
  }
}

export class HdxError extends Error {}

async function read({ name }: HdxRef): Promise<HdxDataset> {
  const res = await fetch(`https://data.humdata.org/api/3/action/package_show?id=${encodeURIComponent(name)}`, { headers: { Accept: 'application/json' } })
  if (res.status === 404) throw new HdxError('Not found. A dataset link looks like https://data.humdata.org/dataset/cod-ab-npl.')
  if (res.status === 403) throw new HdxError('Not available: the dataset may be private.')
  if (!res.ok) throw new HdxError(`HDX answered ${res.status}.`)
  const body = (await res.json()) as { success?: boolean; result?: RawDataset }
  if (!body.success || !body.result) throw new HdxError('HDX did not give this dataset.')
  return toDataset(body.result)
}

/** The dataset, once per page; `refresh` asks HDX again. A failure is not kept. */
export const loadDataset = perPage(read, (ref: HdxRef) => ref.name)
