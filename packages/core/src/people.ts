import type * as Y from 'yjs'
import type { Actor } from './ops/types.js'

/**
 * Each person's current name and color, in the doc's `people` map: person id → entry. Chat messages, code runs and
 * other records keep the name their person had then; what shows them looks the name up here by id, so a rename
 * reaches them all (plans/plan-029.md). Each browser writes only its own person's entry, when it joins the board and
 * when the person renames themselves: like views, directly, with no op log entry and no undo. Ids are claimed, not
 * proven, until there are accounts.
 */

export interface PersonEntry {
  name: string
  color?: string
  /** When it was written (ms). */
  at: number
}

export class People {
  readonly map: Y.Map<PersonEntry>

  constructor(doc: Y.Doc) {
    this.map = doc.getMap('people')
  }

  /** Keep a person's name and color. Writes only when they changed, so joining a board writes once. */
  set(actor: Actor) {
    if (actor.kind !== 'user' || !actor.name) return
    const kept = this.map.get(actor.id)
    if (kept?.name === actor.name && kept.color === actor.color) return
    this.map.set(actor.id, { name: actor.name, ...(actor.color && { color: actor.color }), at: Date.now() })
  }

  /** The person's current name, else `fallback` (the name a record kept: old boards, people who never came back). */
  nameOf(id: string | undefined, fallback?: string): string | undefined {
    return (id && this.map.get(id)?.name) || fallback
  }
}
