import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Board, BoardSkills, BoardTx, corePlugin, Registry } from '../src/index'

const skill = { name: 'sitrep-style', description: 'Write a sitrep.', whenToUse: 'Asked for a sitrep.', requires: [], optional: [], body: 'Steps.', at: 1 }

describe('board skills', () => {
  it('lists the skills BoardTx wrote, by name, and tells listeners', () => {
    const doc = new Y.Doc()
    const skills = new BoardSkills(doc)
    const tx = new BoardTx(new Board(doc), new Registry([corePlugin]))
    let changes = 0
    skills.subscribe(() => changes++)
    tx.setSkill('b', skill)
    tx.setSkill('a', { ...skill, name: 'aa' })
    expect(skills.list().map((s) => [s.id, s.name])).toEqual([['a', 'aa'], ['b', 'sitrep-style']])
    expect(skills.list()).toBe(skills.list())
    tx.removeSkill('b')
    expect(skills.list().map((s) => s.id)).toEqual(['a'])
    expect(changes).toBe(3)
  })

  it('leaves out entries that do not match the schema', () => {
    const doc = new Y.Doc()
    const skills = new BoardSkills(doc)
    skills.entries.set('bad', { name: 'Not A Name' })
    skills.entries.set('junk', 42)
    skills.entries.set('ok', skill)
    expect(skills.list().map((s) => s.id)).toEqual(['ok'])
  })
})
