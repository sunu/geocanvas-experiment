import { describe, expect, it } from 'vitest'
import { buildFromEnv, formatBuild, formatTime } from '../src/build'

describe('formatTime', () => {
  it('is UTC, with no leading zero on the day and a padded clock', () => {
    expect(formatTime('2026-11-02T14:05:09.000Z')).toBe('2 Nov 2026 14:05 UTC')
    expect(formatTime('2026-01-31T00:07:00.000Z')).toBe('31 Jan 2026 00:07 UTC')
  })
  it('gives back what it cannot read', () => {
    expect(formatTime('later')).toBe('later')
  })
})

describe('formatBuild', () => {
  it('is the commit and the time, the commit first', () => {
    expect(formatBuild({ sha: 'abc1234', time: '2026-11-02T14:05:00Z' })).toBe('abc1234 · 2 Nov 2026 14:05 UTC')
  })
  it('names the branch of a branch Worker', () => {
    expect(formatBuild({ sha: 'abc1234', branch: 'feat/maps', time: '2026-11-02T14:05:00Z' })).toBe('abc1234 · feat/maps · 2 Nov 2026 14:05 UTC')
  })
  it('is just dev for the dev server', () => {
    expect(formatBuild({ sha: 'dev' })).toBe('dev')
  })
})

describe('buildFromEnv', () => {
  const now = new Date('2026-11-02T14:05:00Z')
  it('shortens the commit and leaves the branch out for main', () => {
    expect(buildFromEnv({ GITHUB_SHA: 'abc1234def5678', GITHUB_REF_NAME: 'main' }, now)).toEqual({ sha: 'abc1234', time: now.toISOString() })
  })
  it('keeps the branch of another branch', () => {
    expect(buildFromEnv({ GITHUB_SHA: 'abc1234def5678', GITHUB_REF_NAME: 'feat/maps' }, now).branch).toBe('feat/maps')
  })
  it('is local outside CI', () => {
    expect(buildFromEnv({}, now)).toEqual({ sha: 'local', time: now.toISOString() })
  })
})
