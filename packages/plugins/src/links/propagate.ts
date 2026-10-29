import type { AnyObject, BoardTx, OpContext } from '@ttx/core'
import { MAP_HEADER_PX, viewOfArea } from '../mapView.js'
import type { Facts } from '../templates/seeds.js'
import { RECIPES, type Rendered } from './recipes.js'
import { factsOf } from './roots.js'

/** What one linked node gets when its root changes. */
export interface LinkPatch extends Rendered {
  id: string
}

/** What propagation writes: the patches, and whose map views follow (the person who changed the root). */
export interface LinkPlan {
  patches: LinkPatch[]
  person?: string
}

/** The person an op runs for: the user, or the person an agent acts for. */
export const personOf = (ctx: OpContext) => (ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf)

/** Render each node's recipe for these facts. Nodes whose recipe this app does not know are left as they are. */
export function renderLinks(facts: Facts, nodes: AnyObject[]): LinkPatch[] {
  return nodes.flatMap((node) => {
    const recipe = node.link && RECIPES[node.link.recipe]
    return recipe ? [{ id: node.id, ...recipe.render(facts, node, node.link!.args ?? {}) }] : []
  })
}

/**
 * Read-only, for an op's prepare: the patches for every object that follows `root`, given the root as the op is
 * about to make it. Facts are looked up once, and only when something follows the root.
 */
export async function planLinks(ctx: OpContext, root: AnyObject): Promise<LinkPlan> {
  const followers = ctx.board.list().filter((o) => o.link?.from === root.id)
  const person = personOf(ctx)
  if (!followers.length) return { patches: [], ...(person && { person }) }
  return { patches: renderLinks(await factsOf(ctx, root), followers), ...(person && { person }) }
}

/** In apply, in the same transaction as the root's change: one undo step for both. */
export function applyLinks(tx: BoardTx, { patches, person }: LinkPlan) {
  for (const p of patches) {
    if (!tx.get(p.id)) continue // deleted meanwhile
    if (Object.keys(p.set).length) tx.update({ [p.id]: p.set })
    if (p.clear?.length) tx.clear(p.id, p.clear)
    const o = tx.get(p.id)!
    if (p.view && person && o.type === 'map') tx.setView(person, p.id, { ...viewOfArea(p.view, o.w, o.h - MAP_HEADER_PX), bearing: 0 })
  }
}
