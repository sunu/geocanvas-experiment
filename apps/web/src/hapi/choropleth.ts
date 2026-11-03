import { z } from 'zod'
import { defineTool } from '@ttx/core'
import { ADMIN_LEVELS, CHOROPLETH_TOOL, INDICATORS, type AdminLevel, type Indicator } from '@ttx/plugins'
import { ADMIN_AREAS, CODAB_ATTRIBUTION, type AdminAreas } from '../map/adminAreas'
import { unmatched, type Row } from './api'
import { loadConflictRows } from './conflict'
import { loadPresence } from './presence'

/**
 * A HAPI figure by province or district, for a choropleth: values by P-code, which the map joins to COD-AB's
 * boundaries (map/adminAreas.ts). HAPI's rows carry the same P-codes, since its areas come from the CODs.
 */

/** Values by P-code at one level, and how much was left out because HAPI could not match its area (in the values' unit). */
export interface ByArea {
  values: Record<string, number>
  unmatched: number
}

const codeOf = (r: Row, level: AdminLevel): string | undefined => (level === 1 ? r.admin1_code : r.admin2_code) ?? undefined

/** Distinct organizations per area, in one sector or all (''). Left out: the organizations with an unmatched area. */
export function organizationsByArea(rows: Row[], level: AdminLevel, sector = ''): ByArea {
  const orgs = new Map<string, Set<string>>()
  const skipped = new Set<string>()
  for (const r of rows) {
    if (sector && r.sector_code !== sector) continue
    const code = codeOf(r, level)
    if (!code) continue
    if (unmatched(r)) {
      skipped.add(r.org_acronym || r.org_name)
      continue
    }
    const set = orgs.get(code) ?? orgs.set(code, new Set()).get(code)!
    set.add(r.org_acronym || r.org_name)
  }
  return { values: Object.fromEntries([...orgs].map(([code, set]) => [code, set.size])), unmatched: skipped.size }
}

/** Events or fatalities per area, summed over the months of the rows. Areas with rows but none get 0. */
export function conflictByArea(rows: Row[], level: AdminLevel, field: 'events' | 'fatalities'): ByArea {
  const values: Record<string, number> = {}
  let skipped = 0
  for (const r of rows) {
    const code = codeOf(r, level)
    if (!code) continue
    if (unmatched(r)) {
      skipped += r[field] ?? 0
      continue
    }
    values[code] = (values[code] ?? 0) + (r[field] ?? 0)
  }
  return { values, unmatched: skipped }
}

export const choroplethTool = defineTool({
  id: CHOROPLETH_TOOL,
  plugin: 'hapi',
  title: 'HDX HAPI by area',
  description: `A figure from HDX HAPI for each province or district of a country, by P-code: ${Object.entries(INDICATORS)
    .map(([k, d]) => `${k} (${d.label})`)
    .join(', ')}.`,
  input: z.object({
    country: z.string().regex(/^[A-Z]{3}$/),
    indicator: z.enum(Object.keys(INDICATORS) as [Indicator, ...Indicator[]]),
    level: z.union(ADMIN_LEVELS.map((l) => z.literal(l))),
    sector: z.string().optional(),
  }),
  output: ADMIN_AREAS,
  async run({ country, indicator, level, sector }): Promise<AdminAreas> {
    const lvl = level as AdminLevel
    let by: ByArea
    let source: string
    if (indicator === 'organizations') {
      const { rows } = await loadPresence(country)
      by = organizationsByArea(rows, lvl, sector)
      source = 'HDX HAPI operational presence'
    } else {
      by = conflictByArea(await loadConflictRows(country), lvl, indicator === 'conflictEvents' ? 'events' : 'fatalities')
      source = 'ACLED via HDX HAPI'
    }
    if (!Object.keys(by.values).length) throw new Error(`HDX HAPI has no ${INDICATORS[indicator].unit} by area for ${country}`)
    return { level: lvl, country, values: by.values, unit: INDICATORS[indicator].unit, unmatched: by.unmatched, attribution: `${source}; ${CODAB_ATTRIBUTION}` }
  },
})
