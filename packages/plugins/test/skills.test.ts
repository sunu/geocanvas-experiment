import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, ToolRunner } from '@ttx/core'
import { agentTools, boardGet, eventsGet, eventsSearch, geocodeTools, parseSkill, plugins, SKILLS, type Geocoder } from '../src/index'
import { openeoCollections, openeoCoverage, openeoPreview } from '../src/openeoTools'
import type { MontyClient } from '../src/monty/client'

describe('skills', () => {
  it('reads the frontmatter and the body', () => {
    const s = parseSkill('---\nname: a\ndescription: Does a.\nwhen_to_use: Asked for a: now.\nrequires: x.y, z.w\n---\n# Steps\n1. Go.\n')
    expect(s).toEqual({ name: 'a', description: 'Does a.', whenToUse: 'Asked for a: now.', requires: ['x.y', 'z.w'], optional: [], body: '# Steps\n1. Go.' })
    expect(() => parseSkill('# no frontmatter')).toThrow()
  })

  it('names only ops and tools that exist', () => {
    // Every read-only tool the room's agent can have, with its keys set.
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: { kind: 'agent', id: 'agent' } })
    const monty = {} as MontyClient
    const geocoder: Geocoder = { forward: async () => [], reverse: async () => undefined }
    const all = new ToolRunner([
      boardGet(runtime),
      eventsSearch(monty),
      eventsGet(monty),
      ...geocodeTools(geocoder),
      openeoCollections('https://openeo.test'),
      openeoCoverage('https://openeo.test'),
      openeoPreview(async () => new Response()),
    ])
    const ids = new Set([...runtime.registry.ops().map((op) => op.id), ...all.list().map((t) => t.id)])
    const names = new Set(SKILLS.map((s) => s.name))
    expect(names.size).toBe(SKILLS.length)
    for (const s of SKILLS) for (const id of [...s.requires, ...s.optional]) expect(ids, `${s.name}: ${id}`).toContain(id)
    expect(agentTools(runtime, all).length).toBeGreaterThan(0)
  })
})
