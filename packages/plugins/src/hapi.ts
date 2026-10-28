import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import { countryName } from './monty/countries.js'

/**
 * A country's humanitarian context from HDX HAPI: INFORM risk, population, poverty, people in need, displacement
 * and appeals. No React here: the view is registered in apps/web/src/hapi/ui.tsx. The board stores the country's
 * ISO3 code; each browser reads the figures (apps/web/src/hapi/context.ts).
 */

/** country is absent until someone picks one. */
export type CountryBoardObject = AnyObject & { type: 'country'; country?: string }

const iso3 = z.string().regex(/^[A-Z]{3}$/, 'An ISO 3166-1 alpha-3 code, e.g. "NPL"')

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
  ],
  ops: [
    defineOp({
      id: 'country.setCountry',
      title: 'Pick country',
      description: 'Show the humanitarian context of a country (by ISO3 code) in the selected country context.',
      target: { kind: 'objects', types: ['country'], max: 1 },
      args: z.object({ country: iso3.meta({ widget: 'country' }).describe('Country') }),
      apply: (tx, { country }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { country } }),
    }),
  ],
})
