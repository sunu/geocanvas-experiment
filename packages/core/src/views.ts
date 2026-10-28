import * as Y from 'yjs'

/**
 * Each person's view of objects that have a camera (maps), in the doc's `views` map: person id → (object id →
 * view). Views are per person: one person's pan never moves another person's map. They are in the doc so
 * that the agent can read and change them, and so that one person can follow another later (plans/plan-008.md).
 *
 * A person's own pans are written here directly, like the chat: no op log entry and no undo (the undo manager
 * tracks `objects` only). The agent changes views through ops (BoardTx.setView).
 *
 * No cache: a Views is cheap to make, and lists are short (one entry per person).
 */

export interface SavedView {
  /** [longitude, latitude] */
  center: [number, number]
  zoom: number
  bearing: number
  /** When it was saved (ms). The latest view of an object is where people without their own view start. */
  at: number
}

export class Views {
  readonly people: Y.Map<Y.Map<SavedView>>

  constructor(doc: Y.Doc) {
    this.people = doc.getMap('views')
  }

  get(person: string, objectId: string): SavedView | undefined {
    return this.people.get(person)?.get(objectId)
  }

  /** Save a person's view. `at` defaults to now. */
  set(person: string, objectId: string, view: Omit<SavedView, 'at'> & { at?: number }) {
    const doc = this.people.doc
    const write = () => {
      let mine = this.people.get(person)
      if (!mine) this.people.set(person, (mine = new Y.Map()))
      mine.set(objectId, { center: view.center, zoom: view.zoom, bearing: view.bearing, at: view.at ?? Date.now() })
    }
    // Inside a transaction already (BoardTx) or on its own.
    if (doc) doc.transact(write)
    else write()
  }

  /** Every person's view of an object. */
  of(objectId: string): { person: string; view: SavedView }[] {
    const out: { person: string; view: SavedView }[] = []
    this.people.forEach((views, person) => {
      const view = views.get(objectId)
      if (view) out.push({ person, view })
    })
    return out
  }

  /** The most recently saved view of an object, by anyone. */
  latest(objectId: string): { person: string; view: SavedView } | undefined {
    return this.of(objectId).reduce<{ person: string; view: SavedView } | undefined>((best, v) => (!best || v.view.at > best.view.at ? v : best), undefined)
  }

  /** Forget the views of deleted objects. */
  removeObjects(ids: Iterable<string>) {
    const gone = [...ids]
    this.people.forEach((views) => {
      for (const id of gone) if (views.has(id)) views.delete(id)
    })
  }

  /** Call `listener` after every change, local or remote. Returns the unsubscribe function. */
  subscribe(listener: () => void) {
    const observer = () => listener()
    this.people.observeDeep(observer)
    return () => this.people.unobserveDeep(observer)
  }
}
