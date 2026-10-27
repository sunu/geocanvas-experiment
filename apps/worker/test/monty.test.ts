import { afterEach, describe, expect, it, vi } from 'vitest'
import { montySearch } from '../src/monty'

const BASE = 'https://monty.example/stac/'
const search = (body: unknown, method = 'POST') =>
  new Request('https://board.example/monty/search', { method, ...(method === 'POST' && { body: JSON.stringify(body) }) })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Montandon proxy', () => {
  it('forwards the search body to {base}/search with the token, and passes the answer through', async () => {
    const upstream = vi.fn(async () => new Response('{"features":[]}', { status: 200, headers: { 'content-type': 'application/geo+json' } }))
    vi.stubGlobal('fetch', upstream)
    const res = await montySearch(search({ collections: ['gdacs-events'], limit: 1 }), { baseUrl: BASE, token: 'secret' })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/geo+json')
    expect(await res.json()).toEqual({ features: [] })
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://monty.example/stac/search')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer secret')
    expect(JSON.parse(init.body as string)).toEqual({ collections: ['gdacs-events'], limit: 1 })
  })

  it("passes Montandon's own errors through", async () => {
    vi.stubGlobal('fetch', async () => new Response('{"detail":"Not authenticated"}', { status: 401 }))
    const res = await montySearch(search({}), { baseUrl: BASE, token: 'expired' })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ detail: 'Not authenticated' })
  })

  it('answers 503 without calling Montandon when no token is set', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const res = await montySearch(search({}), { baseUrl: BASE })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/MONTANDON_TOKEN/)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 502 when Montandon cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const res = await montySearch(search({}), { baseUrl: BASE, token: 'secret' })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/unreachable/)
  })

  it('only accepts POST', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const res = await montySearch(search(undefined, 'GET'), { baseUrl: BASE, token: 'secret' })
    expect(res.status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })
})
