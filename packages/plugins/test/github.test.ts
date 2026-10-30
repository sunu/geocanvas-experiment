import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { exportTools, Runtime, type Actor } from '@ttx/core'
import { githubUrl, parseGithubUrl, plugins, type GithubBoardObject } from '../src/index'

const ada: Actor = { kind: 'user', id: 'ada', name: 'Ada' }
const canvas = { kind: 'canvas' } as const

describe('GitHub links', () => {
  it('reads an issue and a pull request', () => {
    expect(parseGithubUrl('https://github.com/developmentseed/humanitarian-ttx/issues/12')).toEqual({ owner: 'developmentseed', repo: 'humanitarian-ttx', kind: 'issue', number: 12 })
    expect(parseGithubUrl('https://github.com/developmentseed/humanitarian-ttx/pull/87')).toEqual({ owner: 'developmentseed', repo: 'humanitarian-ttx', kind: 'pull', number: 87 })
  })

  it('reads a link with a page, query or comment after it, and surrounding space', () => {
    expect(parseGithubUrl('  https://github.com/o/r/pull/87/files?diff=split  ')?.number).toBe(87)
    expect(parseGithubUrl('https://github.com/o/r/issues/12#issuecomment-345')?.number).toBe(12)
    expect(parseGithubUrl('https://www.github.com/o/r.js/issues/3')).toMatchObject({ repo: 'r.js' })
  })

  it('is not fooled by other pages or hosts', () => {
    for (const bad of ['https://github.com/o/r', 'https://github.com/o/r/issues', 'https://github.com/o/r/issues/abc', 'https://github.com/o/r/pulls', 'https://github.com/o/r/issues/12x', 'https://evil.example/github.com/o/r/issues/12', 'https://gist.github.com/o/r/issues/1', 'nepal floods']) {
      expect(parseGithubUrl(bad), bad).toBeUndefined()
    }
  })

  it('spells the same item one way', () => {
    expect(githubUrl(parseGithubUrl('http://github.com/o/r/pull/87/commits')!)).toBe('https://github.com/o/r/pull/87')
    expect(githubUrl(parseGithubUrl('https://github.com/o/r/issues/12#x')!)).toBe('https://github.com/o/r/issues/12')
  })
})

describe('github objects', () => {
  function setup() {
    const rt = new Runtime({ doc: new Y.Doc(), plugins, actor: ada })
    return { rt, get: (id: string) => rt.board.get(id) as GithubBoardObject }
  }

  it('adds a card for a link, at its default size', () => {
    const { rt, get } = setup()
    const rec = rt.dispatch('github.add', canvas, { x: 0, y: 0, url: 'https://github.com/o/r/issues/12' })
    expect(rec.status).toBe('applied')
    expect(get(rec.created![0]!)).toMatchObject({ type: 'github', url: 'https://github.com/o/r/issues/12', w: 380, h: 300 })
  })

  it('stores only the link of an item, not of another page', () => {
    const { rt } = setup()
    expect(rt.dispatch('github.add', canvas, { url: 'https://github.com/o/r' }).status).toBe('failed')
    expect(rt.dispatch('github.add', canvas, { url: 'https://github.com/o/r/pull/87/files' }).status).toBe('failed')
  })

  it('sets the link of a card made without one, from any spelling, and tells an agent what it shows', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('github.add', canvas, {}).created![0]!
    const def = rt.registry.objectType('github')!
    expect(def.summarize!(get(id))).toBe('no GitHub link yet')
    expect(rt.dispatch('github.setUrl', { kind: 'objects', ids: [id] }, { url: 'https://github.com/o/r/pull/87/files#diff' }).status).toBe('applied')
    expect(get(id).url).toBe('https://github.com/o/r/pull/87')
    expect(def.summarize!(get(id))).toBe('GitHub https://github.com/o/r/pull/87')
  })

  it('refuses a link that is not an issue or a pull request, and keeps the old one', () => {
    const { rt, get } = setup()
    const id = rt.dispatch('github.add', canvas, { url: 'https://github.com/o/r/issues/12' }).created![0]!
    const rec = rt.dispatch('github.setUrl', { kind: 'objects', ids: [id] }, { url: 'https://github.com/o/r' })
    expect(rec.status).toBe('failed')
    expect(get(id).url).toBe('https://github.com/o/r/issues/12')
  })

  it('is a tool for the agent', () => {
    const { rt } = setup()
    expect(exportTools(rt.availableOps(canvas)).map((t) => t.name)).toContain('github__add')
  })
})
