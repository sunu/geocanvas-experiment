import { useMemo, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { People, type Actor } from '@ttx/core'

/** How many times each people map changed: the snapshot that tells React to render again. */
const versions = new WeakMap<object, number>()

/**
 * A function that gives a person's current name (People in @ttx/core) from the actor a record kept, else the name
 * it kept; re-renders when anyone on the board renames themselves.
 */
export function usePeopleNames(doc: Y.Doc): (actor: Pick<Actor, 'id' | 'name'> | undefined, fallback?: string) => string {
  const people = useMemo(() => new People(doc), [doc])
  const version = useSyncExternalStore(
    (onChange) => {
      const changed = () => {
        versions.set(people.map, (versions.get(people.map) ?? 0) + 1)
        onChange()
      }
      people.map.observe(changed)
      return () => people.map.unobserve(changed)
    },
    () => versions.get(people.map) ?? 0,
  )
  return useMemo(() => {
    void version
    return (actor, fallback = 'Someone') => people.nameOf(actor?.id, actor?.name) ?? fallback
  }, [people, version])
}
