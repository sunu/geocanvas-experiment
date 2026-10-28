import { randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * How browser tabs pair with the companion. No React and no MCP here: the web app's dev server (apps/web/vite.config.ts)
 * reads the same file, to hand the token to the app's own pages.
 */

export const DEFAULT_PORT = 8790

/** The companion's pairing token, kept across runs so paired tabs reconnect after a restart. Delete it to unpair every browser. */
export const TOKEN_FILE = join(homedir(), '.config', 'ttx-mcp', 'token')

/** The saved token, or a new one, saved readable by this user only. */
export function savedToken(file = TOKEN_FILE): string {
  try {
    return readFileSync(file, 'utf8').trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
  }
  const token = randomBytes(24).toString('base64url')
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
  try {
    writeFileSync(file, `${token}\n`, { mode: 0o600, flag: 'wx' })
    return token
  } catch (err) {
    // Another companion (the stdio entry, say) saved one first: use that.
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return readFileSync(file, 'utf8').trim()
    throw err
  }
}
