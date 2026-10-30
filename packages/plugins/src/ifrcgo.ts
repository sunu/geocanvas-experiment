import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'

/**
 * An emergency on IFRC GO (go.ifrc.org), from a pasted link. No React here: the card is registered in
 * apps/web/src/ifrcgo/ui.tsx. The board stores only the link; each browser reads the emergency from GO's API
 * (apps/web/src/ifrcgo/api.ts), which allows CORS and anonymous reads, so there is no proxy and no key.
 */

export interface GoRef {
  /** The emergency's id in GO: the <id> in /emergencies/<id>. */
  id: number
}

// A link to an emergency, with anything after it: /overview, /details, /reports, ?query, #section.
const EMERGENCY = /^https?:\/\/(?:www\.)?go\.ifrc\.org\/emergencies\/(\d+)(?:[/?#].*)?$/i

/** The emergency a pasted GO link points to, or undefined for any other link (a slug link, a country, a list). */
export function parseGoUrl(text: string): GoRef | undefined {
  const m = EMERGENCY.exec(text.trim())
  return m ? { id: Number(m[1]) } : undefined
}

/** The link as stored: the same for any spelling of it. */
export const goUrl = ({ id }: GoRef) => `https://go.ifrc.org/emergencies/${id}`

const STORED = /^https:\/\/go\.ifrc\.org\/emergencies\/\d+$/

/** url is absent until a link is set. */
export type IfrcGoBoardObject = AnyObject & { type: 'ifrcgo'; url?: string }

export const ifrcgoPlugin = definePlugin({
  id: 'ifrcgo',
  title: 'IFRC GO',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'ifrcgo',
      title: 'IFRC GO emergency',
      description: "An emergency on IFRC GO, shown as a card with its severity, key figures, appeals and field reports.",
      fields: z.object({
        url: z.string().regex(STORED).optional().describe('Link to the emergency, e.g. https://go.ifrc.org/emergencies/8083'),
      }),
      defaultSize: { w: 380, h: 440 },
      layer: 'top',
      summarize: (o) => {
        const { url } = o as IfrcGoBoardObject
        return url ? `IFRC GO ${url}` : 'no IFRC GO link yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'ifrcgo.setUrl',
      title: 'Set IFRC GO link',
      description: 'Show an IFRC GO emergency in the selected IFRC GO card. Other pages of the emergency (overview, details, reports) are read as the emergency.',
      target: { kind: 'objects', types: ['ifrcgo'], max: 1 },
      args: z.object({
        url: z.string().refine((v) => !!parseGoUrl(v), 'Not a link to an IFRC GO emergency, e.g. https://go.ifrc.org/emergencies/8083').describe('Link to an IFRC GO emergency'),
      }),
      apply: (tx, { url }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { url: goUrl(parseGoUrl(url)!) } }),
    }),
  ],
})
