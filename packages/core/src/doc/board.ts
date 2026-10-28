import * as Y from 'yjs'

/**
 * The shared board: one Yjs map of objects, keyed by id. Each object is a Y.Map of plain
 * fields, so two people editing different fields of the same object both win.
 *
 * Layer order: every object has a float `z`; higher draws on top, ties broken by id.
 * Moving one object between two others only rewrites that object's `z`.
 *
 * This class only reads. Every write is an op: the runtime (ops/runtime.ts) applies it through a
 * BoardTx (doc/tx.ts) in one transaction.
 */

export interface Placed {
  id: string
  x: number
  y: number
  w: number
  h: number
  z: number
}

/** Any object. The fields beside the placement come from its type (plugins/types.ts). */
export type AnyObject = Placed & { type: string }

/** Read an object from its Y.Map. */
export const readObject = <O extends AnyObject>(id: string, m: Y.Map<unknown>): O => ({ ...(m.toJSON() as Omit<O, 'id'>), id }) as O

export class Board<O extends AnyObject = AnyObject> {
  readonly doc: Y.Doc
  readonly objects: Y.Map<Y.Map<unknown>>
  private cached: O[] | null = null
  private listeners = new Set<() => void>()

  constructor(doc: Y.Doc) {
    this.doc = doc
    this.objects = doc.getMap('objects')
    // Observe from the start, so changes that arrive before the UI subscribes are not missed.
    this.objects.observeDeep(() => {
      this.cached = null
      for (const listener of this.listeners) listener()
    })
  }

  /** Call `listener` after every change, local or remote. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Same as list(), but the same array until the next change (for React). Not for use inside a transaction. */
  snapshot = (): O[] => (this.cached ??= this.list())

  /** All objects, bottom to top. */
  list(): O[] {
    const out: O[] = []
    this.objects.forEach((m, id) => out.push(readObject<O>(id, m)))
    return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  get(id: string): O | undefined {
    const m = this.objects.get(id)
    return m && readObject<O>(id, m)
  }
}
