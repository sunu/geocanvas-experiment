import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { BoardSkills, defineTool, exportTools, MAX_BOARD_SKILLS, Runtime, ToolRunner } from '@ttx/core'
import { z } from 'zod'
import { agentTools, availableSkills, boardGet, CODE_EXECUTE_TOOL, eventsGet, eventsSearch, geocodeTools, parseSkill, plugins, SKILLS, type Geocoder } from '../src/index'
import { openeoCollections, openeoCoverage, openeoPreview } from '../src/openeoTools'
import type { MontyClient } from '../src/monty/client'

/** The browser's code.execute (apps/web/src/code/execute.ts), which only browsers have. */
const codeExecute = defineTool({ id: CODE_EXECUTE_TOOL, title: 'Run code', description: 'Run code', input: z.object({ source: z.string() }), output: 'code.result', run: () => ({ ok: true, stdout: '', ms: 0 }) })

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
      codeExecute,
    ])
    const ids = new Set([...runtime.registry.ops().map((op) => op.id), ...all.list().map((t) => t.id)])
    const names = new Set(SKILLS.map((s) => s.name))
    expect(names.size).toBe(SKILLS.length)
    for (const s of SKILLS) for (const id of [...s.requires, ...s.optional]) expect(ids, `${s.name}: ${id}`).toContain(id)
    expect(agentTools(runtime, all).length).toBeGreaterThan(0)
  })

  it('give code ops and the run-code skill only to an agent that can run code', () => {
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: { kind: 'agent', id: 'agent' } })
    const names = (tools: ToolRunner) => new Set(agentTools(runtime, tools).map((t) => t.function.name))
    const room = names(new ToolRunner([boardGet(runtime)]))
    const browser = names(new ToolRunner([boardGet(runtime), codeExecute]))
    expect(room.has('code__add')).toBe(false)
    expect(availableSkills(room).map((s) => s.name)).not.toContain('run-code')
    expect(browser.has('code__add')).toBe(true)
    expect(browser.has('code__execute')).toBe(true)
    expect(availableSkills(browser).map((s) => s.name)).toContain('run-code')
  })
})

const canvas = { kind: 'canvas' } as const
const status = async (r: Promise<{ status: string; error?: string }>) => {
  const { status, error } = await r
  return status === 'applied' ? status : error
}
const skill = (name: string) => ({ name, description: 'Write a sitrep.', whenToUse: 'Asked for a sitrep.', requires: [], optional: [], body: 'Steps.' })

describe('board skills', () => {
  const setup = () => {
    const doc = new Y.Doc()
    const person = new Runtime({ doc, plugins, actor: { kind: 'user', id: 'me' } })
    return { doc, person, skills: new BoardSkills(doc) }
  }

  it('are added, replaced and removed by people', async () => {
    const { person, skills } = setup()
    expect(await status(person.invoke('agent.setSkill', canvas, { skill: skill('sitrep-style') }))).toBe('applied')
    const [saved] = skills.list()
    expect(saved).toMatchObject({ name: 'sitrep-style', by: 'me' })
    await person.invoke('agent.setSkill', canvas, { id: saved!.id, skill: { ...skill('sitrep-style'), body: 'New steps.' } })
    expect(skills.list().map((s) => s.body)).toEqual(['New steps.'])
    await person.invoke('agent.removeSkill', canvas, { id: saved!.id })
    expect(skills.list()).toEqual([])
  })

  it('refuse a name that is taken, a bad name and one skill too many', async () => {
    const { person, skills } = setup()
    const save = (name: string) => status(person.invoke('agent.setSkill', canvas, { skill: skill(name) }))
    expect(await save(SKILLS[0]!.name)).toMatch(/built-in/)
    expect(await save('Bad Name')).toMatch(/a-z, 0-9/)
    for (let i = 0; i < MAX_BOARD_SKILLS; i++) expect(await save(`s-${i}`)).toBe('applied')
    expect(await save('s-0')).toMatch(/has a skill named/)
    expect(await save('one-more')).toMatch(/at most/)
    expect(skills.list()).toHaveLength(MAX_BOARD_SKILLS)
  })

  it('are never written by an agent', async () => {
    const { doc, skills } = setup()
    const agent = new Runtime({ doc, plugins, actor: { kind: 'agent', id: 'agent' } })
    const tools = exportTools(agent.availableOps(canvas)).map((t) => t.name)
    expect(tools.some((n) => n.includes('Skill'))).toBe(false)
    expect(await status(agent.callTool('agent__setSkill', { args: { skill: skill('sneaky') } }))).toMatch(/not a tool/)
    expect(await status(agent.invoke('agent.setSkill', canvas, { skill: skill('sneaky') }))).toMatch(/Only people/)
    expect(skills.list()).toEqual([])
  })
})
