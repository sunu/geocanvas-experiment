import { afterEach, describe, expect, it, vi } from 'vitest'
import { hapiProxy } from '../src/hapi'

const ID = 'aHVtYW5pdGFyaWFuLXR0eDp0ZXN0QGV4YW1wbGUub3Jn'
const get = (path: string, method = 'GET') => new Request(`https://board.example${path}`, { method })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HDX HAPI proxy', () => {
  it('reads a data endpoint with the app identifier in a header, never one from the browser, and lets the browser cache it', async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"data":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', upstream)
    const res = await hapiProxy(get('/hapi/coordination-context/national-risk?location_code=NPL&app_identifier=evil'), ID)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"data":[]}')
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600')
    const [url, init] = upstream.mock.calls[0]!
    expect(url).toBe('https://hapi.humdata.org/api/v2/coordination-context/national-risk?location_code=NPL')
    expect(new Headers(init?.headers).get('X-HDX-HAPI-APP-IDENTIFIER')).toBe(ID)
  })

  it('reaches data and metadata endpoints only, with GET only', async () => {
    const upstream = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', upstream)
    expect((await hapiProxy(get('/hapi/encode_app_identifier?application=x&email=y'), ID)).status).toBe(404)
    expect((await hapiProxy(get('/hapi/../../evil/x'), ID)).status).toBe(404)
    expect((await hapiProxy(get('/hapi/metadata/location', 'POST'), ID)).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('keeps the upstream status, never returns the identifier, and says when it is not set', async () => {
    vi.stubGlobal('fetch', async () => new Response(`{"detail":"bad identifier ${ID}"}`, { status: 403 }))
    const res = await hapiProxy(get('/hapi/metadata/location'), ID)
    expect(res.status).toBe(403)
    expect(res.headers.get('cache-control')).toBeNull()
    expect(await res.text()).not.toContain(ID)
    expect((await hapiProxy(get('/hapi/metadata/location'), undefined)).status).toBe(503)
    vi.stubGlobal('fetch', async () => Promise.reject(new Error(`fetch failed for ${ID}`)))
    const down = await hapiProxy(get('/hapi/metadata/location'), ID)
    expect(down.status).toBe(502)
    expect(await down.text()).not.toContain(ID)
  })
})
