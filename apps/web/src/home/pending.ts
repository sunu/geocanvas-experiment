/**
 * What the New board dialog chose, for the board page to set up after it loads (App.tsx). It is kept in
 * sessionStorage under the new room, so only the tab that made the board sets it up, and only once: the same
 * rule as a ReliefWeb feed added on an event pick, since every browser adding it would add one per person.
 */
export interface PendingSetup {
  title?: string
  /** A template's id: its op is `template.<id>`. Without one, a blank board. */
  template?: string
  /** The template's seeds, by arg name, as its pickers gave them. A seed left out gives empty widgets. */
  seeds?: Record<string, unknown>
}

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const session = (): Store | undefined => globalThis.sessionStorage
const key = (room: string) => `ttx/pending/${room}`

export function savePending(room: string, setup: PendingSetup, store = session()) {
  try {
    store?.setItem(key(room), JSON.stringify(setup))
  } catch {
    // Storage blocked: the board opens without its setup.
  }
}

/** The setup for this room, removed as it is read. */
export function takePending(room: string, store = session()): PendingSetup | undefined {
  try {
    const raw = store?.getItem(key(room))
    store?.removeItem(key(room))
    return raw ? (JSON.parse(raw) as PendingSetup) : undefined
  } catch {
    return undefined
  }
}
