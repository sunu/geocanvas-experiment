import * as Y from 'yjs'
import type { Registry } from '../plugins/registry.js'
import { Views, type SavedView } from '../views.js'
import type { AnyObject, Board } from './board.js'

/**
 * The only write API for a board. An op's `apply` gets one BoardTx, and all its calls run inside
 * the yjs transaction of that invocation: one undo step, one network update.
 * Fields are checked against the object type's schema (plugins/types.ts).
 */
export class BoardTx {
  /** Ids of the objects this tx added, in order. */
  readonly created: string[] = []

  readonly board: Board
  private registry: Registry

  constructor(board: Board, registry: Registry) {
    this.board = board
    this.registry = registry
  }

  get(id: string): AnyObject | undefined {
    return this.board.get(id)
  }

  list(): AnyObject[] {
    return this.board.list()
  }

  /**
   * Add an object. Without `z`, it goes on top or at the bottom, as its type says.
   * `id` is for restoring a deleted object with its old id; it must not be in use.
   */
  add(type: string, fields: Record<string, unknown>, id: string = crypto.randomUUID()): string {
    const def = this.registry.objectType(type)
    if (!def) throw new Error(`Unknown object type: ${type}`)
    if (this.board.objects.has(id)) throw new Error(`Object ${id} already exists`)
    const z = typeof fields.z === 'number' ? fields.z : def.layer === 'top' ? this.topZ() + 1 : this.bottomZ() - 1
    const parsed = this.registry.objectSchema(type).parse({ ...fields, z })
    const m = new Y.Map<unknown>()
    m.set('type', type)
    for (const [k, v] of Object.entries(parsed)) if (v !== undefined) m.set(k, v)
    this.board.objects.set(id, m)
    this.created.push(id)
    return id
  }

  /**
   * Change fields of several objects. Objects that are gone (someone else deleted them) are skipped.
   * A field with value undefined is left as it is.
   */
  update(patches: Record<string, Record<string, unknown>>) {
    for (const [id, patch] of Object.entries(patches)) {
      const m = this.board.objects.get(id)
      if (!m) continue
      const current = this.board.get(id)!
      const schema = this.registry.objectSchema(current.type)
      for (const k of Object.keys(patch)) {
        if (k === 'id' || k === 'type' || !(k in schema.shape)) throw new Error(`${current.type} has no field ${k}`)
      }
      const merged = schema.loose().parse({ ...current, ...stripUndefined(patch) })
      for (const k of Object.keys(patch)) {
        const v = merged[k]
        if (v !== undefined && JSON.stringify(v) !== JSON.stringify(m.get(k))) m.set(k, v)
      }
    }
  }

  /**
   * Remove optional fields of an object, e.g. a linked country card's country when the root has none
   * (update leaves undefined fields as they are). Fails for a field the type requires.
   */
  clear(id: string, keys: string[]) {
    const m = this.board.objects.get(id)
    if (!m) return
    const { type } = this.board.get(id)!
    const shape = this.registry.objectSchema(type).shape
    for (const k of keys) {
      if (!(k in shape) || !shape[k]!.safeParse(undefined).success) throw new Error(`${type} cannot clear ${k}`)
    }
    for (const k of keys) m.delete(k)
  }

  /** Also forgets their views (views.ts). */
  remove(ids: Iterable<string>) {
    const gone = [...ids]
    for (const id of gone) this.board.objects.delete(id)
    new Views(this.board.doc).removeObjects(gone)
  }

  /** Put an object back as it was, with its id, replacing it if it exists. Its views stay. For undoing an agent turn. */
  restore(id: string, type: string, fields: Record<string, unknown>) {
    this.board.objects.delete(id)
    this.add(type, fields, id)
  }

  /** Change a person's view of an object, e.g. the agent moves the map of the person who asked. */
  setView(person: string, objectId: string, view: Omit<SavedView, 'at'>) {
    if (!this.board.objects.has(objectId)) throw new Error(`Object ${objectId} does not exist`)
    new Views(this.board.doc).set(person, objectId, view)
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
      if (typeof z === 'number') this.board.objects.get(s.id)!.set('z', z)
    }
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
    this.list().forEach((o, i) => this.board.objects.get(o.id)!.set('z', i))
  }

  private topZ(): number {
    const list = this.list()
    return list.length ? list[list.length - 1]!.z : 0
  }

  private bottomZ(): number {
    return this.list()[0]?.z ?? 0
  }
}

function stripUndefined(o: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))
}
