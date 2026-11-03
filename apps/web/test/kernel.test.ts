import { afterEach, describe, expect, it, vi } from 'vitest'
import { hubBase, JupyterSession } from '../src/code/kernel'

afterEach(() => vi.unstubAllGlobals())

describe('the JupyterHub client', () => {
  it('reads a hub URL as people paste it', () => {
    expect(hubBase('https://hub.example.org/hub/home/')).toBe('https://hub.example.org')
    expect(hubBase(' http://127.0.0.1:8000 ')).toBe('http://127.0.0.1:8000')
  })

  it("says that the person's server does not allow this site when the hub does", async () => {
    // The hub answers; the browser blocks the request to the server (CORS), which fetch reports as a TypeError.
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/hub/api/user')) return new Response(JSON.stringify({ name: 'ada', server: '/user/ada/', pending: null }))
      throw new TypeError('NetworkError when attempting to fetch resource.')
    })
    const session = new JupyterSession({ url: 'http://127.0.0.1:8000', token: 't' }, '')
    await expect(session.checkServer()).rejects.toThrow('does not allow this site')
  })
})
