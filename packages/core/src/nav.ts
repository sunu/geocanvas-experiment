import * as Y from 'yjs'

/**
 * Requests to show an object to one person, in the doc's `nav` map: person id → the latest request. The canvas
 * camera stays local and is never synced; this carries only "show this person that object", so the room's agent,
 * which has no camera, can move the view of the person who asked (core.view.show). Each person's browser shows the
 * object when a newer request comes. Like views, not undone: the undo manager tracks `objects` only.
 */

export interface ShowRequest {
  /** The object to show. */
  id: string
  /** When it was asked (ms). A browser follows only requests newer than its page. */
  at: number
}

export class Nav {
  readonly people: Y.Map<ShowRequest>

  constructor(doc: Y.Doc) {
    this.people = doc.getMap('nav')
  }

  get(person: string): ShowRequest | undefined {
    const r = this.people.get(person)
    return r && typeof r.id === 'string' && typeof r.at === 'number' ? r : undefined
  }

  /** Ask a person's browser to show an object. `at` defaults to now. */
  show(person: string, id: string, at = Date.now()) {
    this.people.set(person, { id, at })
  }

  /** Call `listener` with a person's request each time it changes, local or remote. Returns the unsubscribe function. */
  subscribe(person: string, listener: (request: ShowRequest) => void) {
    const observer = (e: Y.YMapEvent<ShowRequest>) => {
      if (!e.keysChanged.has(person)) return
      const r = this.get(person)
      if (r) listener(r)
    }
    this.people.observe(observer)
    return () => this.people.unobserve(observer)
  }
}
