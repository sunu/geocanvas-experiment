import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { People } from '../src/index'

describe('People', () => {
  it("gives a person's current name, else the name a record kept", () => {
    const people = new People(new Y.Doc())
    expect(people.nameOf('ada', 'Otter')).toBe('Otter')
    people.set({ kind: 'user', id: 'ada', name: 'Ada', color: '#f00' })
    expect(people.nameOf('ada', 'Otter')).toBe('Ada')
    expect(people.nameOf(undefined, 'Agent')).toBe('Agent')
  })

  it('writes only when the name or color changed, and never for an agent', () => {
    const doc = new Y.Doc()
    const people = new People(doc)
    let updates = 0
    doc.on('update', () => updates++)
    const ada = { kind: 'user' as const, id: 'ada', name: 'Ada', color: '#f00' }
    people.set(ada)
    people.set({ ...ada })
    expect(updates).toBe(1)
    people.set({ ...ada, name: 'Ada L.' })
    expect(updates).toBe(2)
    people.set({ kind: 'agent', id: 'agent', name: 'Agent' })
    expect(people.map.has('agent')).toBe(false)
  })
})
