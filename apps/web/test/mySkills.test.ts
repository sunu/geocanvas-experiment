import { describe, expect, it } from 'vitest'
import { forgetSkill, keepSkill, listMySkills, MAX_KEPT_SKILLS, sameSkill } from '../src/agent/mySkills'

/** A Storage stand-in in memory. */
function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) }
}
const skill = (name: string, body = 'Steps.') => ({ name, description: 'Does it.', whenToUse: 'Asked.', requires: ['map.add'], optional: [], body })

describe('my skills', () => {
  it('keeps skills by name, replacing one of the same name, and forgets them', () => {
    const store = memory()
    keepSkill(skill('bb'), store, 1)
    keepSkill(skill('aa'), store, 2)
    keepSkill(skill('bb', 'New steps.'), store, 3)
    expect(listMySkills(store).map((s) => [s.name, s.body, s.at])).toEqual([
      ['aa', 'Steps.', 2],
      ['bb', 'New steps.', 3],
    ])
    forgetSkill('aa', store)
    expect(listMySkills(store).map((s) => s.name)).toEqual(['bb'])
  })

  it('keeps only what a skill is, not a board skill id or author', () => {
    const store = memory()
    keepSkill({ ...skill('aa'), id: 'x', by: 'me' } as never, store, 1)
    expect(listMySkills(store)[0]).toEqual({ ...skill('aa'), at: 1 })
  })

  it('leaves out broken entries, and starts over on broken JSON', () => {
    expect(listMySkills(memory({ 'ttx/skills': JSON.stringify([{ name: 'Bad Name' }, 42, { ...skill('ok'), at: 1 }]) })).map((s) => s.name)).toEqual(['ok'])
    expect(listMySkills(memory({ 'ttx/skills': '{oops' }))).toEqual([])
  })

  it('drops the oldest beyond the limit', () => {
    const store = memory()
    for (let i = 0; i <= MAX_KEPT_SKILLS; i++) keepSkill(skill(`s-${i}`), store, i)
    const names = listMySkills(store).map((s) => s.name)
    expect(names).toHaveLength(MAX_KEPT_SKILLS)
    expect(names).not.toContain('s-0')
  })

  it('compares content, not time', () => {
    expect(sameSkill(skill('aa'), { ...skill('aa'), at: 5 } as never)).toBe(true)
    expect(sameSkill(skill('aa'), skill('aa', 'Other.'))).toBe(false)
  })
})
