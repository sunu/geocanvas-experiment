import { afterEach, describe, expect, it, vi } from 'vitest'
import { reliefwebUpdates } from '../src/reliefweb'

const get = (query: string, method = 'GET') => new Request(`https://board.example/reliefweb/updates?${query}`, { method })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ReliefWeb updates proxy', () => {
  it("reads the RSS of a disaster's updates by GLIDE, and passes it through", async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => new Response('<rss/>', { status: 200, headers: { 'content-type': 'application/rss+xml; charset=utf-8' } }))
    vi.stubGlobal('fetch', upstream)
    const res = await reliefwebUpdates(get('glide=FF-2026-000162-NPL&glide=fl-2026-000167-npl'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/rss+xml; charset=utf-8')
    expect(await res.text()).toBe('<rss/>')
    const url = new URL(upstream.mock.calls[0]![0])
    expect(url.origin + url.pathname).toBe('https://reliefweb.int/updates/rss.xml')
    expect(url.searchParams.get('search')).toBe('disaster.glide:"FF-2026-000162-NPL" OR disaster.glide:"FL-2026-000167-NPL"')
  })

  it('refuses anything but GLIDE numbers, and anything but GET, without calling ReliefWeb', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const q of ['', 'glide=', 'glide=nepal', 'glide=FF-2026-000162-NPL" OR title:"x', `${'glide=FF-2026-000162-NPL&'.repeat(11)}`]) {
      expect((await reliefwebUpdates(get(q))).status, q).toBe(400)
    }
    expect((await reliefwebUpdates(get('glide=FF-2026-000162-NPL', 'POST'))).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 502 when ReliefWeb cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const res = await reliefwebUpdates(get('glide=FF-2026-000162-NPL'))
    expect(res.status).toBe(502)
    expect(await res.text()).toMatch(/unreachable/)
  })
})
