import { useSyncExternalStore } from 'react'

/**
 * The page in view of each focused PDF in this tab, by object id. The Options panel is drawn outside the
 * PDF's view (canvas/OptionsPanel.tsx), and offers this page for the card.
 */
const pages = new Map<string, number>()
const listeners = new Set<() => void>()

export function setPageInView(id: string, page: number | undefined) {
  if (pages.get(id) === page) return
  if (page === undefined) pages.delete(id)
  else pages.set(id, page)
  for (const listener of listeners) listener()
}

export function usePageInView(id: string): number | undefined {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange)
      return () => {
        listeners.delete(onChange)
      }
    },
    () => pages.get(id),
  )
}
