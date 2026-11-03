import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseGithubUrl } from '@ttx/plugins'
import { bodySummary } from '../src/cards/text'
import { checksState, linkedPulls, loadGithub } from '../src/github/api'

afterEach(() => {
  vi.unstubAllGlobals()
})

const ref = parseGithubUrl('https://github.com/o/r/issues/12')!

describe('checks of a pull request', () => {
  const done = (conclusion: string) => ({ status: 'completed', conclusion })
  it('pass when every run succeeded, was skipped or was neutral', () => {
    expect(checksState([done('success'), done('skipped'), done('neutral')])).toBe('passing')
  })
  it('fail when any run or the commit status failed', () => {
    expect(checksState([done('success'), done('failure')])).toBe('failing')
    expect(checksState([done('timed_out')])).toBe('failing')
    expect(checksState([done('success')], { state: 'failure', total_count: 2 })).toBe('failing')
  })
  it('are running while a run is not completed, and failure wins over it', () => {
    expect(checksState([done('success'), { status: 'in_progress', conclusion: null }])).toBe('pending')
    expect(checksState([done('failure'), { status: 'queued', conclusion: null }])).toBe('failing')
  })
  it('are none without runs or statuses: GitHub says "pending" for a commit with no statuses', () => {
    expect(checksState([], { state: 'pending', total_count: 0 })).toBe('none')
    expect(checksState([])).toBe('none')
  })
  it('count a commit status when there are no runs', () => {
    expect(checksState([], { state: 'success', total_count: 1 })).toBe('passing')
    expect(checksState([], { state: 'pending', total_count: 1 })).toBe('pending')
  })
})

describe('the text of an issue', () => {
  it('drops template comments, images, code, tags and markup, and keeps link text', () => {
    const md = '<!-- Describe the bug -->\n## What happened\n\n**The map** is [blank](https://x.example) ![shot](https://x.example/a.png)\n\n```\nstack trace\n```\n- [ ] checked <b>twice</b>'
    expect(bodySummary(md)).toBe('What happened The map is blank checked twice')
  })
  it('is nothing for an empty text', () => {
    expect(bodySummary(null)).toBeUndefined()
    expect(bodySummary('<!-- only a template comment -->')).toBeUndefined()
  })
  it('cuts a long text at a word', () => {
    const s = bodySummary('flood response '.repeat(60))!
    expect(s.length).toBeLessThanOrEqual(281)
    expect(s.endsWith('…')).toBe(true)
    expect(s).not.toMatch(/ …$/)
  })
})

describe('pull requests that mention an issue', () => {
  const cross = (number: number, title: string, extra: object = {}, repo = 'o/r') => ({
    event: 'cross-referenced',
    source: { issue: { number, title, state: 'open', html_url: `https://github.com/${repo}/pull/${number}`, repository: { full_name: repo }, pull_request: {}, ...extra } },
  })
  it('lists pull requests, newest first, each once, with their state', () => {
    const timeline = [
      { event: 'labeled' },
      cross(20, 'First try', { state: 'closed' }),
      cross(21, 'Fix it', { pull_request: { merged_at: '2026-10-01T00:00:00Z' }, state: 'closed' }),
      cross(21, 'Fix it', { pull_request: { merged_at: '2026-10-01T00:00:00Z' }, state: 'closed' }),
      cross(22, 'Rework', { draft: true }, 'o/other'),
      { event: 'cross-referenced', source: { issue: { number: 30, title: 'Another issue', state: 'open', html_url: 'https://github.com/o/r/issues/30' } } },
    ]
    expect(linkedPulls(timeline, ref)).toEqual([
      { title: 'Rework', url: 'https://github.com/o/other/pull/22', label: 'o/other#22', state: 'draft' },
      { title: 'Fix it', url: 'https://github.com/o/r/pull/21', label: '#21', state: 'merged' },
      { title: 'First try', url: 'https://github.com/o/r/pull/20', label: '#20', state: 'closed' },
    ])
  })
})

describe('loadGithub', () => {
  const issue = { title: 'Map is blank', state: 'open', html_url: 'https://github.com/o/r/issues/12', user: { login: 'ada' }, assignees: [{ login: 'grace' }], labels: [{ name: 'bug', color: 'd73a4a' }], comments: 3, created_at: '2026-10-01T10:00:00Z', updated_at: '2026-10-02T10:00:00Z', body: 'It is **blank**.' }
  const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })

  it('reads an issue and the pull requests that mention it, once, and again on refresh', async () => {
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(url)
      return url.includes('/timeline') ? json([{ event: 'cross-referenced', source: { issue: { number: 13, title: 'Fix', state: 'open', html_url: 'https://github.com/o/r/pull/13', repository: { full_name: 'o/r' }, pull_request: {} } } }]) : json(issue)
    })
    const item = await loadGithub(ref)
    expect(item).toMatchObject({ kind: 'issue', title: 'Map is blank', state: 'open', author: 'ada', assignees: ['grace'], labels: [{ name: 'bug', color: 'd73a4a' }], comments: 3, summary: 'It is blank.' })
    expect(item.linked).toEqual([{ title: 'Fix', url: 'https://github.com/o/r/pull/13', label: '#13', state: 'open' }])
    expect(urls).toEqual(['https://api.github.com/repos/o/r/issues/12', 'https://api.github.com/repos/o/r/issues/12/timeline?per_page=100'])
    await loadGithub(ref)
    expect(urls).toHaveLength(2)
    await loadGithub(ref, { refresh: true })
    expect(urls).toHaveLength(4)
  })

  it('reads a pull request with its checks, and shows it without them when they cannot be read', async () => {
    const pull = { ...issue, title: 'Fix', html_url: 'https://github.com/o/r/pull/13', merged: false, draft: false, comments: 1, review_comments: 2, head: { sha: 'abc', ref: 'fix' }, base: { ref: 'main' }, changed_files: 3, additions: 10, deletions: 4 }
    const pullRef = parseGithubUrl('https://github.com/o/r/pull/13')!
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.endsWith('/pulls/13')) return json(pull)
      if (url.includes('/check-runs')) return json({ check_runs: [{ status: 'completed', conclusion: 'failure' }] })
      return json({ state: 'failure', total_count: 1 })
    })
    const item = await loadGithub(pullRef)
    expect(item).toMatchObject({ kind: 'pull', state: 'open', comments: 3, pull: { base: 'main', head: 'fix', changedFiles: 3, additions: 10, deletions: 4, checks: 'failing' } })

    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/pulls/13') ? json({ ...pull, merged: true, state: 'closed' }) : new Response('nope', { status: 500 })))
    const merged = await loadGithub(pullRef, { refresh: true })
    expect(merged.state).toBe('merged')
    expect(merged.pull?.checks).toBeUndefined()
  })

  it('treats an issue-spelled link to a pull request as one', async () => {
    const pull = { ...issue, pull_request: {}, merged: true, state: 'closed', head: { sha: 'abc', ref: 'fix' }, base: { ref: 'main' } }
    vi.stubGlobal('fetch', async (url: string) => (url.endsWith('/issues/40') ? json({ ...issue, pull_request: {}, state: 'closed' }) : url.endsWith('/pulls/40') ? json(pull) : json({ check_runs: [] })))
    const item = await loadGithub(parseGithubUrl('https://github.com/o/r/issues/40')!)
    expect(item).toMatchObject({ kind: 'pull', state: 'merged' })
    expect(item.linked).toEqual([])
  })

  it('says a private or missing item is not found, and a reached limit when it resets', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 404 }))
    await expect(loadGithub(ref, { refresh: true })).rejects.toThrow('Only public repositories')
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' } }))
    await expect(loadGithub(ref)).rejects.toThrow(/limit .* reached\. Try again at/)
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 502 }))
    await expect(loadGithub(ref)).rejects.toThrow('GitHub answered 502')
  })

  it('does not keep a failure', async () => {
    let fail = true
    vi.stubGlobal('fetch', async (url: string) => {
      if (fail) {
        fail = false
        return new Response('{}', { status: 500 })
      }
      return url.includes('/timeline') ? json([]) : json(issue)
    })
    await expect(loadGithub(ref, { refresh: true })).rejects.toThrow()
    expect((await loadGithub(ref)).title).toBe('Map is blank')
  })
})
