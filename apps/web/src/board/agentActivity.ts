import { useEffect, useState } from 'react'
import type { OplogEntry, Runtime } from '@ttx/core'

/** How long the agent's work stays marked on the canvas (ms). */
export const AGENT_TOUCH_MS = 5000

/**
 * The ids of the objects the agent added or changed in the last few seconds, from the shared op log, so everyone
 * sees where it worked, whichever agent (the room's or a person's own) did it. The agent has no cursor or
 * selection of its own, so this is how its work is shown.
 */
export function useAgentTouched(runtime: Runtime): Set<string> {
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = () => {
      clearTimeout(timer)
      const now = Date.now()
      const ids = new Set<string>()
      let oldest = Infinity
      const entries = runtime.oplog.toArray() as OplogEntry[]
      for (let i = entries.length - 1; i >= 0; i--) {
        const e = entries[i]!
        if (now - e.at > AGENT_TOUCH_MS) break
        if (e.kind !== 'invocation' || e.actor.kind !== 'agent' || e.status !== 'applied') continue
        for (const id of [...(e.created ?? []), ...(e.target.kind === 'objects' ? e.target.ids : [])]) ids.add(id)
        oldest = Math.min(oldest, e.at)
      }
      setTouched((prev) => (prev.size === ids.size && [...ids].every((id) => prev.has(id)) ? prev : ids))
      if (ids.size) timer = setTimeout(update, oldest + AGENT_TOUCH_MS - now + 50)
    }
    update()
    runtime.oplog.observe(update)
    return () => {
      runtime.oplog.unobserve(update)
      clearTimeout(timer)
    }
  }, [runtime])
  return touched
}
