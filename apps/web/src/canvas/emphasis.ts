import { useSyncExternalStore } from 'react'

/**
 * Objects to point out to this person for a moment, e.g. the code cell and the map that a footnote row is about,
 * or the map a menu item would act on. Each source sets its own ids under its own key, so one does not clear
 * another's. Local to this tab and never synced: it is a hint while the pointer is somewhere, not a selection.
 */

const byKey = new Map<string, readonly string[]>()
let all: ReadonlySet<string> = new Set()
const listeners = new Set<() => void>()

function changed() {
  all = new Set([...byKey.values()].flat())
  for (const listener of listeners) listener()
}

export function emphasize(key: string, ids: readonly string[]) {
  const now = byKey.get(key)
  if (now && now.length === ids.length && now.every((id, i) => id === ids[i])) return
  if (ids.length) byKey.set(key, ids)
  else byKey.delete(key)
  changed()
}

export const clearEmphasis = (key: string) => byKey.has(key) && (byKey.delete(key), changed())

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const useEmphasizedIds = (): ReadonlySet<string> => useSyncExternalStore(subscribe, () => all)
export const useEmphasized = (id: string): boolean => useSyncExternalStore(subscribe, () => all.has(id))
