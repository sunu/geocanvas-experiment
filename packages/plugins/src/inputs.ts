import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'
import { applyLinks, planLinks } from './links/propagate.js'
import { area as areaSeed } from './templates/seeds.js'

/**
 * Input nodes (plans/plan-013.md): a seed on the canvas that has no content node of its own, such as an area of
 * interest. Other nodes follow it (links/): change the input and they re-render. No React here: the view is in
 * apps/web/src/inputs/. The value is stored resolved (a box, not the text typed), so everyone sees the same area.
 */

const box = z.object({
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
  name: z.string().min(1).optional(),
})

/** Only areas for now; countries and year ranges come with the templates that need them. */
export const INPUT_KINDS = ['area'] as const

/** value is absent until someone picks one. */
export type InputBoardObject = AnyObject & { type: 'input'; kind: (typeof INPUT_KINDS)[number]; value?: z.infer<typeof box> }

export const inputsPlugin = definePlugin({
  id: 'inputs',
  title: 'Inputs',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'input',
      title: 'Area of interest',
      description: 'An area of interest that other objects follow: change it, and the maps and widgets linked to it show the new area.',
      fields: z.object({ kind: z.enum(INPUT_KINDS).default('area'), value: box.optional() }),
      defaultSize: { w: 320, h: 120 },
      layer: 'top',
      summarize: (o) => {
        const { value } = o as InputBoardObject
        return value ? `area ${value.name ?? ''} [${[value.west, value.south, value.east, value.north].map((n) => n.toFixed(2)).join(', ')}]` : 'no area picked yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'input.setArea',
      title: 'Set area of interest',
      description:
        'Set the area of the selected input, for everyone, and re-render the objects that follow it. The area is a place to look up ({ "text": "Cabo Delgado" }, best match), a box, or "my view".',
      target: { kind: 'objects', types: ['input'], max: 1 },
      args: z.object({ area: areaSeed.schema.describe('Area of interest') }),
      async prepare(ctx, { area }) {
        const id = ctx.target.kind === 'objects' ? ctx.target.ids[0]! : ''
        const { facts, label } = await areaSeed.resolve(ctx, area)
        const value = { ...facts.area!, ...(facts.name && { name: facts.name }) }
        const links = await planLinks(ctx, { ...ctx.board.get(id)!, value } as InputBoardObject)
        return { id, value, links, label }
      },
      apply(tx, { id, value, links }) {
        tx.update({ [id]: { value } })
        applyLinks(tx, links)
      },
      describePlan: ({ label, links }) => `Area of interest: ${label}${links.patches.length ? `; ${links.patches.length} linked object(s) updated` : ''}`,
    }),
  ],
})
