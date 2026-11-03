import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'

/**
 * A dataset on the Humanitarian Data Exchange (data.humdata.org), from a pasted link, shown as a preview of its
 * metadata. No React here: the card is registered in apps/web/src/hdx/ui.tsx. The board stores only the link; each
 * browser reads the dataset from HDX's CKAN API (apps/web/src/hdx/api.ts), which allows CORS and anonymous reads for
 * public datasets, so there is no proxy and no key. The files themselves are not read: their downloads redirect to
 * addresses that a browser on another origin cannot follow (plans/plan-032.md).
 */

export interface HdxRef {
  /** The dataset's name: the <name> in /dataset/<name>. */
  name: string
}

const NAME = '[a-z0-9][a-z0-9_.-]*'

// A link to a dataset, with anything after it: /resource/<id>, ?query, #section.
const DATASET = new RegExp(`^https?://(?:www\\.)?data\\.humdata\\.org/dataset/(${NAME})(?:[/?#].*)?$`, 'i')

/** The dataset a pasted HDX link points to, or undefined for any other link (a search, an organization, a group). */
export function parseHdxUrl(text: string): HdxRef | undefined {
  const m = DATASET.exec(text.trim())
  // HDX names are lowercase: an uppercase name is not found on the site either.
  return m && m[1] === m[1]!.toLowerCase() ? { name: m[1]! } : undefined
}

/** The link as stored: the same for any spelling of it, so a resource or a section link finds its card. */
export const hdxUrl = ({ name }: HdxRef) => `https://data.humdata.org/dataset/${name}`

const STORED = new RegExp(`^https://data\\.humdata\\.org/dataset/${NAME}$`)

/** url is absent until a link is set. */
export type HdxBoardObject = AnyObject & { type: 'hdx'; url?: string }

export const hdxPlugin = definePlugin({
  id: 'hdx',
  title: 'HDX',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'hdx',
      title: 'HDX dataset',
      description: 'A dataset on the Humanitarian Data Exchange, shown as a preview of its metadata: who published it, the period it covers, how often it is updated, its license and its files.',
      fields: z.object({
        url: z.string().regex(STORED).optional().describe('Link to the dataset, e.g. https://data.humdata.org/dataset/cod-ab-npl'),
      }),
      defaultSize: { w: 380, h: 440 },
      layer: 'top',
      summarize: (o) => {
        const { url } = o as HdxBoardObject
        return url ? `HDX dataset ${url}` : 'no HDX link yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'hdx.setUrl',
      title: 'Set HDX link',
      description: 'Show an HDX dataset in the selected HDX card. A link to one of its files or sections is read as the dataset.',
      target: { kind: 'objects', types: ['hdx'], max: 1 },
      args: z.object({
        url: z.string().refine((v) => !!parseHdxUrl(v), 'Not a link to an HDX dataset, e.g. https://data.humdata.org/dataset/cod-ab-npl').describe('Link to an HDX dataset'),
      }),
      apply: (tx, { url }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { url: hdxUrl(parseHdxUrl(url)!) } }),
    }),
  ],
})
