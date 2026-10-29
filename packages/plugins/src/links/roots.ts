import type { AnyObject, OpContext } from '@ttx/core'
import type { EventBoardObject } from '../events.js'
import type { InputBoardObject } from '../inputs.js'
import { complete, event, type Facts } from '../templates/seeds.js'

/**
 * Roots (plans/plan-013.md): the objects others can follow, and the facts each gives its followers. A root is a
 * content node when one exists (an event card), or an input node for seeds that have none (an area).
 */
export const ROOT_TYPES = ['event', 'input']

/** The facts of a root as it is, or as an op is about to make it. Empty for a root with nothing picked yet. */
export async function factsOf(ctx: OpContext, root: AnyObject): Promise<Facts> {
  if (root.type === 'event') {
    const { eventId } = root as EventBoardObject
    return eventId ? complete(ctx, (await event.resolve(ctx, eventId)).facts) : {}
  }
  if (root.type === 'input') {
    const { value } = root as InputBoardObject
    if (!value) return {}
    const { name, ...area } = value
    return complete(ctx, { area, ...(name && { name }) })
  }
  throw new Error(`A ${root.type} cannot be followed: only ${ROOT_TYPES.join(' and ')} objects can`)
}
