import { createContext, useContext, useEffect } from 'react'

/**
 * Which objects are loading their data in this browser (an event's details, a map's layers, a country's figures),
 * so an object the agent worked on stays busy until its data is in (canvas/agentCursor.ts). Each browser fetches
 * what it shows, so this is local and never synced. A view reports with useReportLoading, anywhere inside it.
 */

/** The id of the object a view draws; ObjectView provides it. */
export const ObjectIdContext = createContext<string | undefined>(undefined)

const counts = new Map<string, number>()
const listeners = new Set<() => void>()

function change(id: string, by: number) {
  const n = (counts.get(id) ?? 0) + by
  if (n > 0) counts.set(id, n)
  else counts.delete(id)
  for (const listener of listeners) listener()
}

export const isLoading = (id: string) => counts.has(id)

export function subscribeLoading(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Counts this view's object as loading while `loading` is true. Unmounting stops it, so nothing stays loading. */
export function useReportLoading(loading: boolean) {
  const id = useContext(ObjectIdContext)
  useEffect(() => {
    if (!loading || !id) return
    change(id, 1)
    return () => change(id, -1)
  }, [id, loading])
}
