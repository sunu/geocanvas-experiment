export interface LiveState<T> {
  loading: boolean
  /** Results of the last finished search. Kept on screen while the next one loads. Absent when no search is active. */
  results?: T
  error?: unknown
}

/**
 * Search as the user types. Waits for a pause in typing, then searches. Only the answer to the latest text is
 * used: a slower answer to an earlier text is dropped, so results never go back to an older search.
 * (The request itself is not aborted. It only stops mattering.)
 */
export function createLiveSearch<T>(search: (text: string) => Promise<T>, onState: (state: LiveState<T>) => void, delayMs = 250) {
  let latest = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let state: LiveState<T> = { loading: false }
  const set = (next: LiveState<T>) => {
    state = next
    onState(next)
  }

  return {
    update(text: string) {
      const id = ++latest
      clearTimeout(timer)
      if (!text.trim()) return set({ loading: false })
      set({ loading: true, results: state.results })
      timer = setTimeout(() => {
        search(text).then(
          (results) => id === latest && set({ loading: false, results }),
          (error) => id === latest && set({ loading: false, results: state.results, error }),
        )
      }, delayMs)
    },
    /** Call when the input goes away. Later answers are ignored. */
    dispose() {
      latest++
      clearTimeout(timer)
    },
  }
}
