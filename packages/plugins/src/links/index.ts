import { z } from 'zod'
import { defineOp, definePlugin } from '@ttx/core'
import { applyLinks, planLinks } from './propagate.js'
import { RECIPES } from './recipes.js'
import { ROOT_TYPES } from './roots.js'

/**
 * Links (plans/plan-013.md): a node can follow a root (an event card, an input). The root's own ops re-render
 * the followers in the same transaction (event.setEvent, input.setArea); these ops refresh and unlink.
 */
export const linksPlugin = definePlugin({
  id: 'links',
  title: 'Links',
  dependsOn: ['core'],
  ops: [
    defineOp({
      id: 'link.refresh',
      title: 'Refresh linked objects',
      description: 'Re-render the objects that follow the selected root (an event or an input), e.g. after its source has new data.',
      target: { kind: 'objects', types: ROOT_TYPES, max: 1 },
      args: z.object({}),
      when: (ctx) => ctx.target.kind === 'objects' && ctx.board.list().some((o) => o.link?.from === (ctx.target as { ids: string[] }).ids[0]),
      prepare: (ctx) => planLinks(ctx, ctx.board.get(ctx.target.kind === 'objects' ? ctx.target.ids[0]! : '')!),
      apply: (tx, links) => applyLinks(tx, links),
      describePlan: (links) => `${links.patches.length} linked object(s) updated`,
    }),
    defineOp({
      id: 'link.remove',
      title: 'Unlink',
      description: 'Stop the selected objects from following their root: they keep what they show now, and changes to the root no longer reach them.',
      target: { kind: 'objects' },
      args: z.object({}),
      when: (ctx) => ctx.target.kind === 'objects' && ctx.target.ids.some((id) => ctx.board.get(id)?.link),
      apply(tx, _args, target) {
        for (const id of target.kind === 'objects' ? target.ids : []) if (tx.get(id)?.link) tx.clear(id, ['link'])
      },
    }),
  ],
})

export { applyLinks, personOf, planLinks, renderLinks, type LinkPatch, type LinkPlan } from './propagate.js'
export { linkedLayerId, RECIPES, type Recipe, type Rendered } from './recipes.js'
export { factsOf, ROOT_TYPES } from './roots.js'
