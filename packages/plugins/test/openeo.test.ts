import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { Runtime, type Actor } from '@ttx/core'
import { plugins, type MapBoardObject, type OpenEOAnalysisObject } from '../src/index.js'
import type { ProcessGraph } from '../src/openeoGraph.js'

const user: Actor = { kind: 'user', id: 'analyst', name: 'Analyst' }
const agent: Actor = { kind: 'agent', id: 'agent', name: 'Agent', onBehalfOf: user.id }
const objects = (ids: string[]) => ({ kind: 'objects' as const, ids })

describe('openEO SAR change workflow', () => {
  it('lets the agent propose, but only a user approve the remote run', async () => {
    const doc = new Y.Doc()
    const runtime = new Runtime({ doc, plugins, actor: user })
    const map = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    const request = await runtime.invoke('openeo.proposeSarChange', objects([map]), {
      title: 'Flood corridor change',
      area: { west: 84.8, south: 27.8, east: 86, north: 28.8 },
      preStart: '2026-08-05', preEnd: '2026-08-25', postStart: '2026-08-27', postEnd: '2026-09-10',
    }, { actor: agent })
    expect(request.status).toBe('applied')
    const analysisId = request.created![0]!
    expect((runtime.board.get(analysisId) as OpenEOAnalysisObject).status).toBe('proposed')
    expect((runtime.board.get(map) as MapBoardObject).layers ?? []).toEqual([])

    const denied = await runtime.callTool('openeo__approveSarChange', { ids: [analysisId], args: {} }, agent)
    expect(denied.status).toBe('failed')
    expect(denied.error).toContain('Only a user may run')

    const approved = await runtime.invoke('openeo.approveSarChange', objects([analysisId]), {}, { actor: user })
    expect(approved.status).toBe('applied')
    expect((runtime.board.get(analysisId) as OpenEOAnalysisObject).status).toBe('requested')
    expect((runtime.board.get(map) as MapBoardObject).layers).toEqual([
      { id: expect.any(String), title: 'Flood corridor change', tool: 'openeo.tiles', input: { analysisId } },
    ])
  })

  it('puts the ready XYZ URL on the map recipe and removes it when cancelled', async () => {
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: user })
    const map = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    const proposal = await runtime.invoke('openeo.proposeSarChange', objects([map]), {
      area: { west: 10, south: 10, east: 11, north: 11 },
      preStart: '2026-08-05', preEnd: '2026-08-25', postStart: '2026-08-27', postEnd: '2026-09-10',
    })
    const id = proposal.created![0]!
    await runtime.invoke('openeo.approveSarChange', objects([id]), {})
    await runtime.dispatch('openeo.setStatus', objects([id]), {
      status: 'ready', tileUrl: 'https://eopf.example/services/xyz/demo/tiles/{z}/{x}/{y}', serviceId: 'demo',
    })
    expect((runtime.board.get(map) as MapBoardObject).layers?.[0]?.input).toMatchObject({
      analysisId: id,
      tiles: 'https://eopf.example/services/xyz/demo/tiles/{z}/{x}/{y}',
    })
    await runtime.invoke('openeo.cancelSarChange', objects([id]), {})
    expect((runtime.board.get(map) as MapBoardObject).layers).toEqual([])
  })
})

describe('openeo.proposeSarChange dates', () => {
  // The old defaults (Aug-Sep 2026) had no Sentinel-1 scenes over Rome: a model that left them out proposed an empty layer.
  it('has no default dates, so a model must choose windows, after checking coverage', async () => {
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: user })
    const map = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    const proposal = await runtime.invoke('openeo.proposeSarChange', objects([map]), { area: { west: 12.35, south: 41.75, east: 12.65, north: 42 } }, { actor: agent })
    expect(proposal.status).toBe('failed')
    expect(proposal.error).toMatch(/preStart/)
  })
})

describe('openeo.proposeGraph', () => {
  const area = { west: 12.35, south: 41.75, east: 12.65, north: 42 }
  const graph = (): ProcessGraph => ({
    load: { process_id: 'load_collection', arguments: { id: 'sentinel-2-l2a', temporal_extent: ['2026-09-01', '2026-09-10'], bands: ['reflectance|bands=b04', 'reflectance|bands=b08'], spatial_extent: { west: -180, south: -90, east: 180, north: 90 } } },
    save: { process_id: 'save_result', arguments: { data: { from_node: 'load' }, format: 'PNG' }, result: true },
  })

  async function setup() {
    const runtime = new Runtime({ doc: new Y.Doc(), plugins, actor: user })
    const map = runtime.dispatch('map.add', { kind: 'canvas' }, { x: 0, y: 0 }).created![0]!
    return { runtime, map }
  }

  it('lets the agent propose any graph, on the area, and a user approve it like a SAR proposal', async () => {
    const { runtime, map } = await setup()
    const proposal = await runtime.invoke('openeo.proposeGraph', objects([map]), { title: 'Rome NDVI', area, processGraph: graph() }, { actor: agent })
    expect(proposal.status).toBe('applied')
    const analysis = runtime.board.get(proposal.created![0]!) as OpenEOAnalysisObject
    expect(analysis).toMatchObject({ status: 'proposed', title: 'Rome NDVI', mapId: map, area: [12.35, 41.75, 12.65, 42] })
    // The agent does not choose the extent: the area is the layer's.
    expect(JSON.parse(analysis.graph!).load.arguments.spatial_extent).toEqual({ ...area, crs: 'EPSG:4326' })
    expect((runtime.board.get(map) as MapBoardObject).layers ?? []).toEqual([])

    const approved = await runtime.invoke('openeo.approveSarChange', objects([analysis.id]), {}, { actor: user })
    expect(approved.status).toBe('applied')
    expect((runtime.board.get(analysis.id) as OpenEOAnalysisObject).status).toBe('requested')
  })

  // A small model scaled reflectance as 0-3000, as in most Sentinel-2 tutorials: the layer was valid and entirely black.
  it('tells the agent that Sentinel-2 reflectance here is 0-1, so true colour scales to 0.3', async () => {
    const { runtime } = await setup()
    const description = runtime.registry.op('openeo.proposeGraph')!.description
    expect(description).toMatch(/reflectance.*0-1/i)
    expect(description).toContain('inputMax 0.3')
  })

  it('sends a graph the Worker could not run back to the agent with the reason, and adds nothing', async () => {
    const { runtime, map } = await setup()
    const bad = graph()
    delete bad.save
    const proposal = await runtime.invoke('openeo.proposeGraph', objects([map]), { title: 'No save', area, processGraph: bad }, { actor: agent })
    expect(proposal.status).toBe('failed')
    expect(proposal.error).toMatch(/save_result/)
    expect(runtime.board.list().filter((o) => o.type === 'openeo')).toHaveLength(0)
  })

  it('refuses an area larger than the Worker accepts', async () => {
    const { runtime, map } = await setup()
    const proposal = await runtime.invoke('openeo.proposeGraph', objects([map]), { title: 'Everything', area: { west: -10, south: 30, east: 20, north: 60 }, processGraph: graph() }, { actor: agent })
    expect(proposal.status).toBe('failed')
    expect(proposal.error).toMatch(/20 square degrees/)
  })

  it('summarizes a graph proposal by what it loads, for the agent reading the board', async () => {
    const { runtime, map } = await setup()
    const id = (await runtime.invoke('openeo.proposeGraph', objects([map]), { title: 'Rome NDVI', area, processGraph: graph() }, { actor: agent })).created![0]!
    const summary = runtime.registry.objectType('openeo')!.summarize!(runtime.board.get(id)!)
    expect(summary).toContain('proposed: Rome NDVI')
    expect(summary).toContain('sentinel-2-l2a')
  })
})
