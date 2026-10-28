import * as Y from 'yjs'

/**
 * The shared board: one Yjs map of objects, keyed by id. Each object is a Y.Map of plain
 * fields, so two people editing different fields of the same object both win.
 *
 * Layer order: every object has a float `z`; higher draws on top, ties broken by id.
 * Moving one object between two others only rewrites that object's `z`.
 *
 * Map views (center, zoom) are not here on purpose: each person pans their own maps.
 * A map's data layers are recipes (tool and input), and an event holds only its Montandon id:
 * each person's browser fetches the data.
 *
 * Object types are defined in objects/ (one file each, listed in objects/registry.ts).
 */

interface Placed {
  id: string
  x: number
  y: number
  w: number
  h: number
  z: number
}

/**
 * The stored fields of each object type, by type name. Each type adds its entry in its own file in
 * objects/, with `declare module '../board/board'`. A field added after objects of that type
 * already exist must be optional, with a default where it is read.
 */
export interface ObjectFields {}

export type ObjectType = keyof ObjectFields

export type BoardObject = { [T in ObjectType]: Placed & { type: T } & ObjectFields[T] }[ObjectType]

/** Fields for a new object: everything but id; z is optional (see add). */
export type NewObject = DistributiveOmit<BoardObject, 'id' | 'z'> & { z?: number }

/** A change to any fields of an object. */
export type ObjectPatch = Partial<Omit<Placed, 'id'>> & Partial<UnionToIntersection<ObjectFields[ObjectType]>>

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type UnionToIntersection<U> = (U extends unknown ? (u: U) => void : never) extends (i: infer I) => void ? I : never

export class Board {
  readonly doc: Y.Doc
  readonly objects: Y.Map<Y.Map<unknown>>
  /** Undo and redo of this person's own edits; remote changes are not tracked. */
  readonly undo: Y.UndoManager
  private cached: BoardObject[] | null = null
  private listeners = new Set<() => void>()

  constructor(doc: Y.Doc) {
    this.doc = doc
    this.objects = doc.getMap('objects')
    // One undo step per gesture: the UI calls undo.stopCapturing() when a gesture starts.
    this.undo = new Y.UndoManager(this.objects, { captureTimeout: Infinity })
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
  snapshot = (): BoardObject[] => (this.cached ??= this.list())

  /** All objects, bottom to top. */
  list(): BoardObject[] {
    const out: BoardObject[] = []
    this.objects.forEach((m, id) => out.push({ ...(m.toJSON() as Omit<BoardObject, 'id'>), id } as BoardObject))
    return out.sort((a, b) => a.z - b.z || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  }

  get(id: string): BoardObject | undefined {
    const m = this.objects.get(id)
    return m && ({ ...(m.toJSON() as Omit<BoardObject, 'id'>), id } as BoardObject)
  }

  /**
   * Add an object. Without a z, it goes on top, or to the bottom with layer 'bottom' (each type
   * says which in objects/: backgrounds and frames go to the bottom, so they never cover content).
   */
  add(fields: NewObject, layer: 'top' | 'bottom' = 'top'): string {
    const id = crypto.randomUUID()
    this.doc.transact(() => {
      const m = new Y.Map<unknown>()
      const z = fields.z ?? (layer === 'top' ? this.topZ() + 1 : this.bottomZ() - 1)
      for (const [k, v] of Object.entries({ ...fields, z })) m.set(k, v)
      this.objects.set(id, m)
    })
    return id
  }

  /** Change fields of several objects in one transaction (one undo step, one network update). */
  update(patches: Record<string, ObjectPatch>) {
    this.doc.transact(() => {
      for (const [id, patch] of Object.entries(patches)) {
        const m = this.objects.get(id)
        if (!m) continue
        for (const [k, v] of Object.entries(patch)) if (v !== undefined) m.set(k, v)
      }
    })
  }

  remove(ids: Iterable<string>) {
    this.doc.transact(() => {
      for (const id of ids) this.objects.delete(id)
    })
  }

  // --- Layer order ---------------------------------------------------------

  bringToFront(ids: Set<string>) {
    const selected = this.list().filter((o) => ids.has(o.id))
    const top = this.topZ()
    this.update(Object.fromEntries(selected.map((o, i) => [o.id, { z: top + 1 + i }])))
  }

  sendToBack(ids: Set<string>) {
    const selected = this.list().filter((o) => ids.has(o.id))
    const bottom = this.bottomZ()
    this.update(Object.fromEntries(selected.map((o, i) => [o.id, { z: bottom - selected.length + i }])))
  }

  /** Move each selected object one place up (1) or down (-1), past the next object that is not selected. */
  step(ids: Set<string>, dir: 1 | -1) {
    this.doc.transact(() => {
      const selected = this.list().filter((o) => ids.has(o.id))
      // Move the far end first, so selected objects do not block one another.
      if (dir === 1) selected.reverse()
      for (const s of selected) {
        let z = this.stepZ(s.id, ids, dir)
        // Out of float precision between two neighbours: renumber everything, then retry.
        if (z === null) {
          this.normalizeZ()
          z = this.stepZ(s.id, ids, dir)
        }
        if (typeof z === 'number') this.objects.get(s.id)!.set('z', z)
      }
    })
  }

  /** The z that puts `id` just past its next unselected neighbour; undefined at the end, null if no float fits. */
  private stepZ(id: string, ids: Set<string>, dir: 1 | -1): number | null | undefined {
    const order = this.list()
    let j = order.findIndex((o) => o.id === id) + dir
    while (order[j] && ids.has(order[j]!.id)) j += dir
    const past = order[j]
    if (!past) return undefined
    const beyond = order[j + dir]
    const z = beyond ? (past.z + beyond.z) / 2 : past.z + dir
    return z === past.z || z === beyond?.z ? null : z
  }

  private normalizeZ() {
    this.list().forEach((o, i) => this.objects.get(o.id)!.set('z', i))
  }

  private topZ(): number {
    const list = this.list()
    return list.length ? list[list.length - 1]!.z : 0
  }

  private bottomZ(): number {
    return this.list()[0]?.z ?? 0
  }
}
