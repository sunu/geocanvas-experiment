import { mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { savedToken } from '../src/pairing.ts'

describe('savedToken', () => {
  it('makes a token once, readable by this user only, and reuses it', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'ttx-mcp-')), 'config', 'token')
    const token = savedToken(file)
    expect(token).toMatch(/^[\w-]{32}$/)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(readFileSync(file, 'utf8').trim()).toBe(token)
    expect(savedToken(file)).toBe(token)
  })
})
