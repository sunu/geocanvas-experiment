import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Actor } from '@ttx/core'
import { cleanName, rename } from '../src/board/person'

describe('cleanName', () => {
  it('trims, collapses spaces and cuts long names', () => {
    expect(cleanName('  Ana   María ')).toBe('Ana María')
    expect(cleanName('x'.repeat(40))).toBe('x'.repeat(32))
  })

  it('gives undefined for an empty name', () => {
    expect(cleanName('   ')).toBeUndefined()
  })
})

describe('rename', () => {
  let store: Map<string, string>
  beforeEach(() => {
    store = new Map([['ttx-person', JSON.stringify({ id: 'p1', name: 'Otter', color: '#e11d48' })]])
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renames the actor, keeps the name and tells others', () => {
    const actor: Actor = { kind: 'user', id: 'p1', name: 'Otter', color: '#e11d48' }
    const awareness = { setLocalStateField: vi.fn() }
    expect(rename(actor, awareness, ' Sunu ')).toBe(true)
    expect(actor.name).toBe('Sunu')
    expect(JSON.parse(store.get('ttx-person')!)).toEqual({ id: 'p1', name: 'Sunu', color: '#e11d48' })
    expect(awareness.setLocalStateField).toHaveBeenCalledWith('user', { kind: 'user', id: 'p1', name: 'Sunu', color: '#e11d48' })
  })

  it('keeps the old name when the new one is empty', () => {
    const actor: Actor = { kind: 'user', id: 'p1', name: 'Otter', color: '#e11d48' }
    const awareness = { setLocalStateField: vi.fn() }
    expect(rename(actor, awareness, '  ')).toBe(false)
    expect(actor.name).toBe('Otter')
    expect(awareness.setLocalStateField).not.toHaveBeenCalled()
  })
})
