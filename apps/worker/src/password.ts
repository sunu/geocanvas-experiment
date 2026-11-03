import { json } from './uploads'

/**
 * One shared password for the whole deployment (SITE_PASSWORD): pages, API paths, /connect websockets
 * and /uploads. A correct password sets a cookie, which browsers send with same-origin fetches, image and
 * iframe loads and the websocket handshake, so the app needs no change. Without a password, nothing is
 * checked (local dev, tests, Workers without the secret).
 */

export const LOGIN_PATH = '/__login'
const COOKIE = 'ttx_auth'
const MAX_AGE = 30 * 24 * 60 * 60

/** The response to send instead of the request's own, or undefined when the request may go on. */
export async function passwordGate(request: Request, password: string | undefined): Promise<Response | undefined> {
  if (!password) return undefined
  const token = await tokenFor(password)
  const url = new URL(request.url)
  if (url.pathname === LOGIN_PATH) {
    if (request.method !== 'POST') return json(405, { error: 'POST only' })
    const form = await request.formData().catch(() => undefined)
    const given = form?.get('password')
    if (typeof given !== 'string' || !sameText(await tokenFor(given), token)) return json(401, { error: 'Wrong password' })
    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}` },
    })
  }
  const cookie = cookieValue(request.headers.get('cookie'), COOKIE)
  if (cookie && sameText(cookie, token)) return undefined
  if (request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html')) {
    return new Response(LOGIN_PAGE, {
      status: 401,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  }
  return json(401, { error: 'Password required' })
}

/** The cookie's value: a hash of the password, so changing the password ends every login. */
async function tokenFor(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ttx-site:${password}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

/** Compares in time that does not depend on where the texts differ. */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// A reload after login keeps the URL's #room=… hash, which a server redirect would lose.
const LOGIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Humanitarian TTX</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --fg: #0a0a0a; --muted: #737373; --line: #e5e5e5; --card: #fff; --error: #dc2626; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0a0a0a; --fg: #fafafa; --muted: #a3a3a3; --line: #262626; --card: #171717; --error: #f87171; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--fg); font: 14px/1.4 system-ui, sans-serif; }
  form { width: 100%; max-width: 320px; display: grid; gap: 12px; padding: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  h1 { margin: 0; font-size: 16px; }
  p { margin: 0; color: var(--muted); }
  input, button { font: inherit; padding: 8px 12px; border-radius: 8px; border: 1px solid var(--line); background: transparent; color: inherit; }
  button { background: var(--fg); color: var(--bg); border-color: var(--fg); cursor: pointer; }
  button:disabled { opacity: 0.6; cursor: default; }
  .error { color: var(--error); min-height: 1.4em; }
</style>
</head>
<body>
<form id="login">
  <h1>Humanitarian TTX</h1>
  <p>Enter the password to open the boards.</p>
  <input name="password" type="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required autofocus>
  <button type="submit">Open</button>
  <div class="error" role="alert"></div>
</form>
<script>
  const form = document.getElementById('login')
  const error = form.querySelector('.error')
  const button = form.querySelector('button')
  form.addEventListener('submit', async (event) => {
    event.preventDefault()
    button.disabled = true
    error.textContent = ''
    try {
      const response = await fetch('${LOGIN_PATH}', { method: 'POST', body: new FormData(form) })
      if (response.ok) return location.reload()
      error.textContent = response.status === 401 ? 'Wrong password' : 'Could not log in (' + response.status + ')'
    } catch {
      error.textContent = 'Could not reach the server'
    }
    button.disabled = false
  })
</script>
</body>
</html>
`
