import { describe, expect, it } from 'vitest'
import { LOGIN_PATH, passwordGate } from '../src/password'

const PASSWORD = 'correct horse battery staple'
const BASE = 'https://board.example'

const page = (cookie?: string) =>
  new Request(`${BASE}/`, { headers: { accept: 'text/html,application/xhtml+xml', ...(cookie ? { cookie } : {}) } })

const login = (password: string) => {
  const body = new FormData()
  body.set('password', password)
  return new Request(`${BASE}${LOGIN_PATH}`, { method: 'POST', body })
}

async function cookieFor(password: string): Promise<string> {
  const res = await passwordGate(login(password), password)
  return res!.headers.get('set-cookie')!.split(';')[0]!
}

describe('password gate', () => {
  it('lets everything through when no password is set', async () => {
    expect(await passwordGate(page(), undefined)).toBeUndefined()
    expect(await passwordGate(page(), '')).toBeUndefined()
  })

  it('shows the login page for a page request without the cookie', async () => {
    const res = await passwordGate(page(), PASSWORD)
    expect(res?.status).toBe(401)
    expect(res?.headers.get('content-type')).toContain('text/html')
    expect(res?.headers.get('cache-control')).toBe('no-store')
    expect(await res?.text()).toContain('type="password"')
  })

  it('answers 401 JSON to API, upload and websocket requests without the cookie', async () => {
    for (const request of [
      new Request(`${BASE}/monty/search`, { method: 'POST', body: '{}' }),
      new Request(`${BASE}/uploads/abc`),
      new Request(`${BASE}/connect/room1`, { headers: { upgrade: 'websocket' } }),
    ]) {
      const res = await passwordGate(request, PASSWORD)
      expect(res?.status).toBe(401)
      expect(await res?.json()).toEqual({ error: 'Password required' })
    }
  })

  it('sets a cookie for the right password, and refuses a wrong one', async () => {
    const ok = await passwordGate(login(PASSWORD), PASSWORD)
    expect(ok?.status).toBe(204)
    const cookie = ok?.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^ttx_auth=[0-9a-f]{64}; /)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).not.toContain(PASSWORD)

    const wrong = await passwordGate(login('nope'), PASSWORD)
    expect(wrong?.status).toBe(401)
    expect(wrong?.headers.get('set-cookie')).toBeNull()
  })

  it('takes only POST on the login path', async () => {
    expect((await passwordGate(new Request(`${BASE}${LOGIN_PATH}`), PASSWORD))?.status).toBe(405)
  })

  it('lets a request with the cookie through, among other cookies', async () => {
    const cookie = await cookieFor(PASSWORD)
    expect(await passwordGate(page(cookie), PASSWORD)).toBeUndefined()
    expect(await passwordGate(page(`theme=dark; ${cookie}; x=1`), PASSWORD)).toBeUndefined()
  })

  it('ends old logins when the password changes', async () => {
    const old = await cookieFor('old password')
    expect((await passwordGate(page(old), PASSWORD))?.status).toBe(401)
  })
})
