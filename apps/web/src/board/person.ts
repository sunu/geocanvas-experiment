import { useSyncExternalStore } from 'react'
import type { Actor } from '@ttx/core'
import { colorFor, isUserColor } from './collaborators'
import type { Awareness } from './presence'

const ANIMALS = ['Otter', 'Heron', 'Lynx', 'Ibex', 'Gecko', 'Puffin', 'Marten', 'Kestrel', 'Tapir', 'Wombat', 'Oryx', 'Quokka']
const pick = <T,>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)]!

const KEY = 'ttx-person'
type Person = { id: string; name: string; color: string }

/** Longest name a person can give themselves; longer ones are cut. */
export const MAX_NAME = 32

/**
 * One person per browser: the id, name and color are kept in localStorage, so a person keeps them across tabs
 * and reloads (there are no accounts yet). The name starts as a random animal; the person can change it
 * (rename). Their map views (Views in @ttx/core) are keyed by this id. Undo is still per tab: each tab has its
 * own runtime, and a runtime undoes only its own writes.
 */
export function personActor(): Actor {
  const make = (): Person => {
    const id = crypto.randomUUID()
    return { id, name: pick(ANIMALS), color: colorFor(id) }
  }
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Person> | null
    // Records from before the id moved here have a name and color but no id.
    const person = { ...make(), ...kept, ...(!kept?.id && { id: crypto.randomUUID() }) }
    // A color from before the palette had roles (cyan is yours alone, violet the agent's): choose a new one.
    if (!isUserColor(person.color)) person.color = make().color
    localStorage.setItem(KEY, JSON.stringify(person))
    return { kind: 'user', ...person }
  } catch {
    // Storage blocked: a new person each load is fine.
    return { kind: 'user', ...make() }
  }
}

/** A name as typed, trimmed and cut to MAX_NAME; undefined when nothing is left. */
export function cleanName(input: string): string | undefined {
  return input.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME).trim() || undefined
}

/**
 * Give this person a new name. The actor is changed in place: it is the runtime's actor, which chat
 * messages, op log entries and presence read, so later writes carry the new name. Others see it at once through
 * presence, and the board's people map takes it from there (connect.ts), so older chat messages and code runs
 * show it too. False for an empty name.
 */
export function rename(actor: Actor, awareness: Pick<Awareness, 'setLocalStateField'>, input: string): boolean {
  const name = cleanName(input)
  if (!name) return false
  actor.name = name
  savePerson(actor)
  awareness.setLocalStateField('user', { ...actor })
  return true
}

/** Keep the actor's name and color for the next visit. */
export function savePerson(actor: Actor) {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Person> | null
    localStorage.setItem(KEY, JSON.stringify({ ...kept, id: actor.id, name: actor.name, color: actor.color }))
  } catch {
    // Storage blocked: they last until the page reloads.
  }
}

/** This person's name; re-renders when their presence changes (rename publishes it). */
export function usePersonName(actor: Actor, awareness: Awareness): string {
  return useSyncExternalStore(
    (onChange) => {
      awareness.on('change', onChange)
      return () => awareness.off('change', onChange)
    },
    () => actor.name ?? '',
  )
}
