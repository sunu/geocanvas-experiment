import { afterEach, describe, expect, it, vi } from 'vitest'
import { notebooksProxy } from '../src/notebooks'

const BASE = 'https://nbf.example/'
const get = (path: string, method = 'GET') => new Request(`https://board.example/notebooks/${path}`, { method })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Notebook Factory proxy', () => {
  it('forwards run and template reads with their query, and passes the answer through', async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) => new Response('{"count":0,"results":[]}', { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', upstream)
    const res = await notebooksProxy(get('api/runs/?status=published&search=nepal'), BASE)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(await res.json()).toEqual({ count: 0, results: [] })
    expect(upstream.mock.calls[0]![0]).toBe('https://nbf.example/api/runs/?status=published&search=nepal')

    await notebooksProxy(get('api/runs/810ece91-3c34-4752-b61a-684614eb7fa0/'), BASE)
    await notebooksProxy(get('api/templates/'), BASE)
    await notebooksProxy(get('published/runs/810ece91-3c34/outputs/subdivisions.geojson'), BASE)
    await notebooksProxy(get('published/runs/810ece91-3c34/notebook.ipynb'), BASE)
    expect(upstream.mock.calls.map((c) => c[0])).toEqual([
      'https://nbf.example/api/runs/?status=published&search=nepal',
      'https://nbf.example/api/runs/810ece91-3c34-4752-b61a-684614eb7fa0/',
      'https://nbf.example/api/templates/',
      'https://nbf.example/published/runs/810ece91-3c34/outputs/subdivisions.geojson',
      'https://nbf.example/published/runs/810ece91-3c34/notebook.ipynb',
    ])
  })

  it('refuses paths the board does not read, and anything but GET, without calling Notebook Factory', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const path of ['api/catalogs/', 'api/runs/x/cancel/', 'admin/', 'published/runs/x/outputs/../../secret', 'api/runs/../catalogs/']) {
      expect((await notebooksProxy(get(path), BASE)).status, path).toBe(404)
    }
    expect((await notebooksProxy(get('api/runs/', 'POST'), BASE)).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('answers 502 when Notebook Factory cannot be reached', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed')
    })
    const res = await notebooksProxy(get('api/templates/'), BASE)
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/unreachable/)
  })
})
