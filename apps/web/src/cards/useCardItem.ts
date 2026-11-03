import { useEffect, useState } from 'react'
import { useReportLoading } from '../canvas/loading'

/**
 * What a card made from a link shows: the item `load` reads for `key`, or why it could not. Loads again when the
 * key changes, and `refresh` asks the source again. `enabled` is false for a card with no link yet. The canvas is
 * told while it loads (the agent's cursor waits for it).
 */
export function useCardItem<T>(key: string, enabled: boolean, load: (refresh: boolean) => Promise<T>) {
  const [state, setState] = useState<{ key: string; item?: T; error?: unknown }>()
  const [refreshing, setRefreshing] = useState(false)

  const run = (refresh: boolean) => {
    if (!enabled) return () => {}
    let current = true
    setRefreshing(refresh)
    load(refresh)
      .then(
        (item) => current && setState({ key, item }),
        (error) => current && setState({ key, error }),
      )
      .finally(() => current && setRefreshing(false))
    return () => {
      current = false
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => run(false), [key])

  // A state from another link is no answer for this one.
  const shown = state?.key === key ? state : undefined
  useReportLoading(enabled && !shown)
  return { item: shown?.item, error: shown?.error, refreshing, refresh: () => void run(true) }
}
