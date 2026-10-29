import * as Y from 'yjs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Runtime } from '@ttx/core'
import { EXAMPLE_GRAPH, plugins, type MapBoardObject, type OpenEOAnalysisObject } from '@ttx/plugins'
import { OpenEOServiceManager, sarChangeGraph, tileAt } from '../src/openeo'

const objects = (ids: string[]) => ({ kind: 'objects' as const, ids })

// Each test gets the mock again: unstubAllGlobals() in an afterEach removes it for good.
beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
})

describe('EOPF openEO service lifecycle', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('validates and creates only after approval, stores the XYZ layer, and deletes it on stop', async () => {
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: { kind: 'user', id: 'u', name: 'User' } })
    const mapId = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    const proposal = await runtime.invoke('openeo.proposeSarChange', objects([mapId]), {
      area: { west: 10, south: 10, east: 11, north: 11 },
      preStart: '2026-08-01', preEnd: '2026-08-20', postStart: '2026-08-21', postEnd: '2026-09-10',
    })
    const analysisId = proposal.created![0]!
    const tasks: Promise<unknown>[] = []
    const manager = new OpenEOServiceManager(runtime, { OPENEO_USER: 'test-user', OPENEO_PASS: 'test-pass' }, (work) => tasks.push(work))
    manager.start()

    expect((runtime.board.get(analysisId) as OpenEOAnalysisObject).status).toBe('proposed')
    expect(tasks).toHaveLength(0)
    await runtime.invoke('openeo.approveSarChange', objects([analysisId]), {})
    await Promise.all(tasks)

    expect((runtime.board.get(analysisId) as OpenEOAnalysisObject).status).toBe('ready')
    expect((runtime.board.get(mapId) as MapBoardObject).layers?.[0]?.input).toMatchObject({
      analysisId,
      tiles: 'https://api.explorer.eopf.copernicus.eu/openeo/services/xyz/test-service/tiles/{z}/{x}/{y}',
    })

    await runtime.invoke('openeo.cancelSarChange', objects([analysisId]), {})
    await Promise.all(tasks.slice(1))
    expect((runtime.board.get(analysisId) as OpenEOAnalysisObject).status).toBe('cancelled')
    expect((runtime.board.get(mapId) as MapBoardObject).layers).toEqual([])
    expect(requests.filter((r) => r.method === 'DELETE')).toHaveLength(1)
    expect(created[0]!.process!.process_graph!.change).toBeDefined()
    // openEO wants "Bearer oidc/<provider id>/<token>"; a bare token is read as the auth method (EOPF answers 400).
    const openEO = requests.filter((r) => new URL(r.url).pathname.startsWith('/openeo/') && !r.url.includes('/tiles/'))
    expect(openEO.length).toBeGreaterThan(0)
    expect(new Set(openEO.map((r) => r.authorization))).toEqual(new Set(['Bearer oidc/oidc/fake-access-token']))
  })
})

describe('EOPF openEO graph proposals', () => {
  beforeEach(() => {
    created.length = 0
  })

  async function proposed() {
    const doc = new Y.Doc()
    const runtime = new Runtime({ doc, plugins, actor: { kind: 'user', id: 'u', name: 'User' } })
    const mapId = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    const analysisId = (await runtime.invoke('openeo.proposeGraph', objects([mapId]), { title: 'Rome NDVI', area: { west: 12.35, south: 41.75, east: 12.65, north: 42 }, processGraph: EXAMPLE_GRAPH })).created![0]!
    const tasks: Promise<unknown>[] = []
    new OpenEOServiceManager(runtime, { OPENEO_USER: 'test-user', OPENEO_PASS: 'test-pass' }, (work) => tasks.push(work)).start()
    return { doc, runtime, analysisId, tasks }
  }

  it('runs the stored graph as the service, with no Sentinel-1 dates needed', async () => {
    const { runtime, analysisId, tasks } = await proposed()
    await runtime.invoke('openeo.approveSarChange', objects([analysisId]), {})
    await Promise.all(tasks)
    const analysis = runtime.board.get(analysisId) as OpenEOAnalysisObject
    expect(analysis.status).toBe('ready')
    expect(created).toHaveLength(1)
    expect(created[0]!.process!.process_graph!.save).toMatchObject({ process_id: 'save_result' })
    expect(created[0]!.process!.process_graph!.load.arguments.spatial_extent).toMatchObject({ west: 12.35, north: 42 })
  })

  it('checks the stored graph again before creating a billable service', async () => {
    const { doc, runtime, analysisId, tasks } = await proposed()
    const stored = JSON.parse((runtime.board.get(analysisId) as OpenEOAnalysisObject).graph!)
    delete stored.save // what the op would refuse, as a hand-edited or older board could hold it
    doc.getMap<Y.Map<unknown>>('objects').get(analysisId)!.set('graph', JSON.stringify(stored))
    await runtime.invoke('openeo.approveSarChange', objects([analysisId]), {})
    await Promise.all(tasks)
    const analysis = runtime.board.get(analysisId) as OpenEOAnalysisObject
    expect(analysis.status).toBe('error')
    expect(analysis.error).toMatch(/save_result/)
    expect(created).toHaveLength(0)
  })
})

describe('EOPF openEO test tile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    tile = pngTile
  })

  async function approved() {
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: { kind: 'user', id: 'u', name: 'User' } })
    const mapId = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    const proposal = await runtime.invoke('openeo.proposeSarChange', objects([mapId]), {
      area: { west: 10, south: 10, east: 11, north: 11 },
      preStart: '2026-08-01', preEnd: '2026-08-20', postStart: '2026-08-21', postEnd: '2026-09-10',
    })
    const analysisId = proposal.created![0]!
    const tasks: Promise<unknown>[] = []
    new OpenEOServiceManager(runtime, { OPENEO_USER: 'test-user', OPENEO_PASS: 'test-pass' }, (work) => tasks.push(work)).start()
    await runtime.invoke('openeo.approveSarChange', objects([analysisId]), {})
    await Promise.all(tasks)
    return runtime.board.get(analysisId) as OpenEOAnalysisObject
  }

  it('is ready only after EOPF rendered a tile at the centre of the area, fetched without credentials like the browser', async () => {
    requests.length = 0
    expect((await approved()).status).toBe('ready')
    const tiles = requests.filter((r) => r.url.includes('/tiles/'))
    expect(tiles).toHaveLength(1)
    expect(tiles[0]!.url).toContain('/tiles/10/541/481')
    expect(tiles[0]!.authorization).toBeNull()
  })

  it('says when EOPF has no data for the dates, and keeps the service so it can be deleted', async () => {
    tile = () => Response.json({ code: 'NoDataAvailable', message: 'There is no data available for the given extents.' }, { status: 404 })
    const analysis = await approved()
    expect(analysis.status).toBe('error')
    expect(analysis.serviceId).toBe('test-service')
    expect(analysis.error).toMatch(/no data at the centre/i)
  })

  it('shows EOPF\'s own message when a tile cannot be rendered', async () => {
    tile = () => Response.json({ code: 'InvalidRequest', message: "Couldn't find a `save_result` process" }, { status: 400 })
    const analysis = await approved()
    expect(analysis.status).toBe('error')
    expect(analysis.error).toMatch(/400/)
    expect(analysis.error).toMatch(/save_result/)
  })

  it('does not call a response without an image ready', async () => {
    tile = () => new Response('<html>', { headers: { 'content-type': 'text/html' } })
    expect((await approved()).status).toBe('error')
  })
})

describe('tileAt', () => {
  it('gives the web-mercator tile of a point', () => {
    expect(tileAt(-0.376, 39.47, 10)).toEqual({ x: 510, y: 389 })
    expect(tileAt(0, 0, 1)).toEqual({ x: 1, y: 1 })
    expect(tileAt(-179.9, 85, 3)).toEqual({ x: 0, y: 0 })
  })
})

describe('sarChangeGraph', () => {
  const analysis = { area: [10, 10, 11, 11], preStart: '2026-08-01', preEnd: '2026-08-20', postStart: '2026-08-21', postEnd: '2026-09-10' } as OpenEOAnalysisObject
  type Node = { process_id: string; arguments: Record<string, any>; result?: boolean }
  const graph = sarChangeGraph(analysis) as Record<string, Node>

  // EOPF validates a graph without it, but every tile of an XYZ service answers 400 "Couldn't find a `save_result`".
  it('ends in a PNG save_result, as a tile service needs', () => {
    const results = Object.values(graph).filter((node) => node.result)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ process_id: 'save_result', arguments: { format: 'PNG' } })
  })

  it('scales the change to 0-255 first, as a PNG holds bytes', () => {
    const save = Object.values(graph).find((node) => node.process_id === 'save_result')!
    const scale = graph[save.arguments.data.from_node]!
    expect(scale.process_id).toBe('apply')
    expect(JSON.stringify(scale.arguments.process)).toMatch(/linear_scale_range/)
    expect(graph[scale.arguments.data.from_node]!.process_id).toBe('multiply')
  })
})

const pngTile = () => new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { 'content-type': 'image/png' } })
let tile: () => Response = pngTile
const created: { process?: { process_graph?: Record<string, any> } }[] = []
const requests: { url: string; method: string; authorization: string | null }[] = []
async function mockFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const url = new URL(String(input))
  const method = init.method ?? 'GET'
  requests.push({ url: url.href, method, authorization: new Headers(init.headers).get('authorization') })
  if (url.hostname === 'identity.dataspace.copernicus.eu') {
    return Response.json({ access_token: 'fake-access-token', expires_in: 3600 })
  }
  if (url.pathname === '/openeo/validation') return Response.json({ errors: [] })
  if (url.pathname === '/openeo/services' && method === 'GET') return Response.json({ services: [] })
  if (url.pathname === '/openeo/services' && method === 'POST') {
    const body = JSON.parse(String(init.body)) as { process?: { process_graph?: Record<string, unknown> }; configuration?: { scope?: string } }
    created.push(body)
    expect(body.configuration?.scope).toBe('public')
    return new Response(null, { status: 201, headers: { location: '/openeo/services/test-service' } })
  }
  if (url.pathname === '/openeo/services/test-service' && method === 'GET') {
    return Response.json({ url: '/openeo/services/xyz/test-service/tiles/{z}/{x}/{y}' })
  }
  if (url.pathname.startsWith('/openeo/services/xyz/test-service/tiles/')) return tile()
  if (url.pathname === '/openeo/services/test-service' && method === 'DELETE') return new Response(null, { status: 204 })
  return new Response('unexpected request', { status: 404 })
}
