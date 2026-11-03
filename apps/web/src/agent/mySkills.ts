import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import { skillSchema, type Skill } from '@ttx/core'

/**
 * My skills (plans/plan-026.md): board skills this person saved, kept in this browser so they can add them to other
 * boards. Only in localStorage: never sent to the Worker, the doc, the chat or presence until someone adds one to a
 * board, which is the hidden op agent.setSkill as for any board skill.
 */
export interface KeptSkill extends Skill {
  /** When it was kept last (ms). */
  at: number
}

const KEY = 'ttx/skills'
/** Oldest skills are dropped beyond this. */
export const MAX_KEPT_SKILLS = 50

type Store = Pick<Storage, 'getItem' | 'setItem'>
const local = (): Store | undefined => globalThis.localStorage

const kept = skillSchema.extend({ at: z.number() })

function read(store = local()): KeptSkill[] {
  try {
    const list = JSON.parse(store?.getItem(KEY) ?? '[]') as unknown
    // A broken or older entry is left out, not thrown.
    return Array.isArray(list) ? list.flatMap((s) => (kept.safeParse(s).data ?? [])) : []
  } catch {
    return [] // blocked storage or broken JSON: start over
  }
}

function write(list: KeptSkill[], store = local()) {
  try {
    store?.setItem(KEY, JSON.stringify(list.slice(0, MAX_KEPT_SKILLS)))
  } catch {
    // Storage blocked or full: My skills is a convenience.
  }
  cached = undefined
  for (const listener of listeners) listener()
}

/** By name. */
export const listMySkills = (store = local()): KeptSkill[] => read(store).sort((a, b) => a.name.localeCompare(b.name))

/** Keep a skill, replacing the one of the same name. The newest is kept first when the list is full. */
export function keepSkill(skill: Skill, store = local(), now = Date.now()) {
  const { name, description, whenToUse, requires, optional, body } = skill
  write([{ name, description, whenToUse, requires, optional, body, at: now }, ...read(store).filter((s) => s.name !== name)], store)
}

export function forgetSkill(name: string, store = local()) {
  write(
    read(store).filter((s) => s.name !== name),
    store,
  )
}

/** True when the two have the same content (not the same time). */
export const sameSkill = (a: Skill, b: Skill) =>
  a.name === b.name && a.description === b.description && a.whenToUse === b.whenToUse && a.body === b.body && a.requires.join() === b.requires.join() && a.optional.join() === b.optional.join()

const listeners = new Set<() => void>()
let cached: KeptSkill[] | undefined

function subscribe(listener: () => void) {
  listeners.add(listener)
  // Another tab of this browser changed it.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return
    cached = undefined
    listener()
  }
  addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    removeEventListener('storage', onStorage)
  }
}

/** My skills, by name; re-renders when this tab or another tab changes them. */
export const useMySkills = (): KeptSkill[] => useSyncExternalStore(subscribe, () => (cached ??= listMySkills()))
