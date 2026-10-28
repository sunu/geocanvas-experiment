import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import { countryName } from './monty/countries.js'

/**
 * Widgets on a country's data from HDX HAPI: its humanitarian context (INFORM risk, population, poverty, people in
 * need, displacement and appeals), who works where (operational presence), and conflict (ACLED). No React here: the
 * views are registered in apps/web/src/hapi/ui.tsx. The board stores the country's ISO3 code and a widget's
 * filters; each browser reads the figures (apps/web/src/hapi/).
 */

/** country is absent until someone picks one. */
export type CountryBoardObject = AnyObject & { type: 'country'; country?: string }
/** sector is a HAPI sector code, e.g. "HEA"; '' for all sectors. */
export type PresenceBoardObject = AnyObject & { type: 'presence'; country?: string; sector: string }
export type ConflictBoardObject = AnyObject & { type: 'conflict'; country?: string }

/** The widgets that show one country, picked with country.setCountry. */
const COUNTRY_WIDGETS = ['country', 'presence', 'conflict']

const iso3 = z.string().regex(/^[A-Z]{3}$/, 'An ISO 3166-1 alpha-3 code, e.g. "NPL"')
const sector = z.string().describe('A HAPI sector code, e.g. "HEA" for health, or "" for all sectors')

/** "<what> in <country>", or that no country is picked yet. */
const forCountry = (what: string, country?: string) => (country ? `${what} in ${countryName(country) ?? country} (${country})` : 'no country picked yet')

export const hapiPlugin = definePlugin({
  id: 'hapi',
  title: 'HDX HAPI',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'country',
      title: 'Country context',
      description: "A country's humanitarian context from HDX HAPI: INFORM risk, population, poverty, people in need, displacement and appeal funding.",
      fields: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country').optional() }),
      defaultSize: { w: 380, h: 460 },
      layer: 'top',
      summarize: (o) => {
        const { country } = o as CountryBoardObject
        return country ? `HDX HAPI context for ${countryName(country) ?? country} (${country})` : 'no country picked yet'
      },
    },
    {
      type: 'presence',
      title: "Who's where",
      description: 'The organizations working in a country by province and sector, this year (HDX HAPI operational presence, 3W).',
      fields: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country').optional(), sector: sector.default('') }),
      defaultSize: { w: 380, h: 420 },
      layer: 'top',
      summarize: (o) => {
        const { country, sector } = o as PresenceBoardObject
        return forCountry(`Organizations by province${sector ? `, sector ${sector}` : ''}`, country)
      },
    },
    {
      type: 'conflict',
      title: 'Conflict',
      description: 'Political violence events and fatalities in a country over the last 12 months, by month and province (ACLED through HDX HAPI).',
      fields: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country').optional() }),
      defaultSize: { w: 380, h: 420 },
      layer: 'top',
      summarize: (o) => forCountry('Political violence over the last 12 months', (o as ConflictBoardObject).country),
    },
  ],
  ops: [
    defineOp({
      id: 'country.setCountry',
      title: 'Pick country',
      description: "Show a country (by ISO3 code) in the selected country widget: country context, who's where or conflict.",
      target: { kind: 'objects', types: COUNTRY_WIDGETS, max: 1 },
      args: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country') }),
      apply: (tx, { country }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { country } }),
    }),
    defineOp({
      id: 'presence.setSector',
      title: 'Filter by sector',
      description: "Show only one sector's organizations in the selected who's where, for everyone, or all sectors with \"\".",
      target: { kind: 'objects', types: ['presence'] },
      args: z.object({ sector }),
      apply: (tx, { sector }, target) => target.kind === 'objects' && tx.update(Object.fromEntries(target.ids.map((id) => [id, { sector }]))),
    }),
  ],
})
