import { afterEach, describe, expect, it, vi } from 'vitest'
import { geocode } from '../src/geocode'

const KEY = 'secret-key-123'
const get = (params: Record<string, string>, method = 'GET') =>
  new Request(`https://board.example/tools/geocode?${new URLSearchParams(params)}`, { method })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenCage proxy', () => {
  it('passes only allowed params, adds the key and no_annotations, and returns the response as is', async () => {
    const body = JSON.stringify({ results: [{ formatted: 'Beira' }], status: { code: 200, message: 'OK' } })
    const upstream = vi.fn(async (_url: URL) => new Response(body, { status: 200 }))
    vi.stubGlobal('fetch', upstream)
    const res = await geocode(
      get({ q: '-19.8,34.8', limit: '1', countrycode: 'mz', bounds: '30,-27,41,-10', language: 'pt', key: 'evil', no_annotations: '0', abbrv: '1' }),
      KEY,
    )
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(body)
    const url = upstream.mock.calls[0]![0]
    expect(url.origin + url.pathname).toBe('https://api.opencagedata.com/geocode/v1/json')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: '-19.8,34.8',
      limit: '1',
      countrycode: 'mz',
      bounds: '30,-27,41,-10',
      language: 'pt',
      no_annotations: '1',
      key: KEY,
    })
  })

  it('keeps the upstream status, and never returns the key', async () => {
    vi.stubGlobal('fetch', async () => new Response(`{"status":{"code":402,"message":"quota exceeded for ${KEY}"}}`, { status: 402 }))
    const res = await geocode(get({ q: 'x' }), KEY)
    expect(res.status).toBe(402)
    expect(await res.text()).not.toContain(KEY)

    vi.stubGlobal('fetch', async () => {
      throw new Error(`connect failed ?key=${KEY}`)
    })
    const failed = await geocode(get({ q: 'x' }), KEY)
    expect(failed.status).toBe(502)
    expect(await failed.text()).not.toContain(KEY)
  })

  it('answers 503 without a key, and does not call OpenCage', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    const res = await geocode(get({ q: 'x' }), undefined)
    expect(res.status).toBe(503)
    expect((await res.json()).error).toMatch(/OPENCAGE_API_KEY/)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('only accepts GET', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    expect((await geocode(get({ q: 'x' }, 'POST'), KEY)).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })
})
