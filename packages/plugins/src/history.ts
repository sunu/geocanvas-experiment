import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import { countryName } from './monty/countries.js'

/**
 * A country's disaster history from Montandon (plans/plan-019.md): EM-DAT's events since 1900 with their deaths and
 * people affected, by year and hazard. No React here: the view is in apps/web/src/history/. The board stores the
 * country's ISO3 code and a hazard filter; each browser reads the events.
 */

/** country is absent until someone picks one; hazard is a HAZARD_FAMILIES key, or '' for every natural hazard. */
export type HistoryBoardObject = AnyObject & { type: 'history'; country?: string; hazard: string }

/**
 * Families of hazards, by the EM-DAT classification code every EM-DAT and DesInventar item in Montandon carries in
 * `monty:hazard_codes` (e.g. "nat-hyd-flo-riv"): its first three parts, the group, type and subtype's family.
 * Technological events (road, air and water transport accidents, "tec-…") are kept apart.
 */
export const HAZARD_FAMILIES = {
  flood: { label: 'Floods', prefixes: ['nat-hyd-flo', 'nat-cli-glo'] },
  landslide: { label: 'Landslides and avalanches', prefixes: ['nat-hyd-mmw', 'nat-geo-mmd'] },
  storm: { label: 'Storms', prefixes: ['nat-met-sto'] },
  earthquake: { label: 'Earthquakes', prefixes: ['nat-geo-ear'] },
  volcano: { label: 'Volcanic activity', prefixes: ['nat-geo-vol'] },
  drought: { label: 'Droughts', prefixes: ['nat-cli-dro'] },
  wildfire: { label: 'Wildfires and fires', prefixes: ['nat-cli-wil'] },
  temperature: { label: 'Extreme temperatures', prefixes: ['nat-met-ext'] },
  epidemic: { label: 'Epidemics', prefixes: ['nat-bio-epi'] },
  otherNatural: { label: 'Other natural hazards', prefixes: ['nat-'] },
  technological: { label: 'Technological', prefixes: ['tec-'] },
} as const
export type HazardFamily = keyof typeof HAZARD_FAMILIES

/** The family of an item from its hazard codes: the first family, in HAZARD_FAMILIES' order, that one of its codes starts with. */
export function hazardFamily(codes: string[]): HazardFamily | undefined {
  for (const [family, { prefixes }] of Object.entries(HAZARD_FAMILIES) as [HazardFamily, { prefixes: readonly string[] }][]) {
    if (codes.some((c) => prefixes.some((p) => c.startsWith(p)))) return family
  }
}

const iso3 = z.string().regex(/^[A-Z]{3}$/, 'An ISO 3166-1 alpha-3 code, e.g. "NPL"')
const hazard = z
  .union([z.literal(''), z.enum(Object.keys(HAZARD_FAMILIES) as [HazardFamily, ...HazardFamily[]])])
  .describe(`A hazard family (${Object.keys(HAZARD_FAMILIES).join(', ')}), or "" for every natural hazard`)

export const historyPlugin = definePlugin({
  id: 'history',
  title: 'Disaster history',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'history',
      title: 'Disaster history',
      description: "A country's disasters since 1900 from EM-DAT (through Montandon): events per year by hazard, the deadliest, and totals by hazard.",
      fields: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country').optional(), hazard: hazard.default('') }),
      defaultSize: { w: 400, h: 500 },
      layer: 'top',
      summarize: (o) => {
        const { country, hazard } = o as HistoryBoardObject
        const what = hazard ? HAZARD_FAMILIES[hazard as HazardFamily].label : 'Natural hazard disasters'
        return country ? `${what} in ${countryName(country) ?? country} (${country}) since 1900, from EM-DAT` : 'no country picked yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'history.setCountry',
      title: 'Pick country',
      description: 'Show the disaster history of a country (by ISO3 code) in the selected history widget.',
      target: { kind: 'objects', types: ['history'], max: 1 },
      args: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country') }),
      apply: (tx, { country }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { country } }),
    }),
    defineOp({
      id: 'history.setHazard',
      title: 'Filter by hazard',
      description: 'Show only one family of hazards (e.g. floods) in the selected history widgets, for everyone, or every natural hazard with "".',
      target: { kind: 'objects', types: ['history'] },
      args: z.object({ hazard }),
      apply: (tx, { hazard }, target) => target.kind === 'objects' && tx.update(Object.fromEntries(target.ids.map((id) => [id, { hazard }]))),
    }),
  ],
})
