import { afterEach, describe, expect, it, vi } from 'vitest'
import { floodmapsProxy, GLOFAS_URL } from '../src/floodmaps'

const get = (path: string, init: RequestInit = {}) => new Request(`https://board.example/floodmaps/${path}`, init)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GloFAS flood maps proxy', () => {
  it('forwards a range of a depth tile, and passes the partial answer through, cacheable', async () => {
    const upstream = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(new Uint8Array(1024), { status: 206, headers: { 'content-type': 'image/tiff', 'content-range': 'bytes 0-1023/59210723', 'content-length': '1024' } }),
    )
    vi.stubGlobal('fetch', upstream)
    const res = await floodmapsProxy(get('RP100/ID192_N30_E80_RP100_depth.tif', { headers: { range: 'bytes=0-1023' } }))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 0-1023/59210723')
    expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(upstream.mock.calls[0]![0]).toBe(`${GLOFAS_URL}/RP100/ID192_N30_E80_RP100_depth.tif`)
    expect(upstream.mock.calls[0]![1]).toEqual({ headers: { range: 'bytes=0-1023' } })

    await floodmapsProxy(get('tile_extents.geojson'))
    expect(upstream.mock.calls[1]![0]).toBe(`${GLOFAS_URL}/tile_extents.geojson`)
  })

  it('reads only the tile index and depth tiles, by GET', async () => {
    const upstream = vi.fn()
    vi.stubGlobal('fetch', upstream)
    for (const path of ['README.txt', 'RP100/ID192_N30_E80_RP100_depth_reclass.tif', 'RP100/ID192_N30_E80_RP10_depth.tif', 'RP30/ID1_N70_W180_RP30_depth.tif', '../../etc/passwd'])
      expect((await floodmapsProxy(get(path))).status).toBe(404)
    expect((await floodmapsProxy(get('tile_extents.geojson', { method: 'POST' }))).status).toBe(405)
    expect(upstream).not.toHaveBeenCalled()
  })
})
