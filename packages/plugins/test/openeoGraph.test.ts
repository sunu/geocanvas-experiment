import { describe, expect, it } from 'vitest'
import { describeGraph, EXAMPLE_GRAPH, graphProblems, MAX_NODES, withArea, type ProcessGraph } from '../src/openeoGraph.js'

/** A graph EOPF renders (checked with its /result): Sentinel-2 NDVI, a median over the dates. */
const ndvi = (): ProcessGraph => ({
  load: { process_id: 'load_collection', arguments: { id: 'sentinel-2-l2a', temporal_extent: ['2026-09-01', '2026-09-10'], bands: ['reflectance|bands=b04', 'reflectance|bands=b08'] } },
  median: { process_id: 'reduce_dimension', arguments: { data: { from_node: 'load' }, dimension: 'time', reducer: { process_graph: { m: { process_id: 'median', arguments: { data: { from_parameter: 'data' } }, result: true } } } } },
  ndvi: {
    process_id: 'reduce_dimension',
    arguments: {
      data: { from_node: 'median' },
      dimension: 'bands',
      reducer: { process_graph: { red: { process_id: 'array_element', arguments: { data: { from_parameter: 'data' }, index: 0 } }, nir: { process_id: 'array_element', arguments: { data: { from_parameter: 'data' }, index: 1 } }, nd: { process_id: 'normalized_difference', arguments: { x: { from_node: 'nir' }, y: { from_node: 'red' } }, result: true } } },
    },
  },
  scaled: { process_id: 'apply', arguments: { data: { from_node: 'ndvi' }, process: { process_graph: { s: { process_id: 'linear_scale_range', arguments: { x: { from_parameter: 'x' }, inputMin: -1, inputMax: 1, outputMin: 0, outputMax: 255 }, result: true } } } } },
  save: { process_id: 'save_result', arguments: { data: { from_node: 'scaled' }, format: 'PNG' }, result: true },
})

describe('graphProblems', () => {
  it('accepts a graph that loads data and ends in a PNG save_result', () => {
    expect(graphProblems(ndvi())).toEqual([])
  })

  it('says what to add when there is no save_result, as a tile service needs one', () => {
    const graph = ndvi()
    delete graph.save
    graph.scaled!.result = true
    const [problem] = graphProblems(graph)
    expect(problem).toMatch(/save_result/)
    expect(problem).toMatch(/PNG/)
  })

  it('wants the one result node to be a PNG', () => {
    const graph = ndvi()
    graph.save!.arguments!.format = 'GTiff'
    expect(graphProblems(graph).join(' ')).toMatch(/PNG/)
  })

  it('wants exactly one result node', () => {
    const graph = ndvi()
    graph.scaled!.result = true
    expect(graphProblems(graph).join(' ')).toMatch(/exactly one/i)
  })

  it('wants a collection to load, with both dates, in a window of at most 90 days', () => {
    const none = ndvi()
    delete none.load
    expect(graphProblems(none).join(' ')).toMatch(/load_collection/)
    const open = ndvi()
    open.load!.arguments!.temporal_extent = ['2026-09-01', null]
    expect(graphProblems(open).join(' ')).toMatch(/both dates/)
    const long = ndvi()
    long.load!.arguments!.temporal_extent = ['2026-01-01', '2026-09-10']
    expect(graphProblems(long).join(' ')).toMatch(/90 days/)
    const reversed = ndvi()
    reversed.load!.arguments!.temporal_extent = ['2026-09-10', '2026-09-01']
    expect(graphProblems(reversed).join(' ')).toMatch(/90 days|before/)
  })

  // EOPF answers 404 NoDataAvailable for ["2026-10-23", "2026-10-23"], though that day has a scene: the end is exclusive.
  it('explains that the end of a window is exclusive when it is the start', () => {
    const graph = ndvi()
    graph.load!.arguments!.temporal_extent = ['2026-10-23', '2026-10-23']
    const problems = graphProblems(graph).join(' ')
    expect(problems).toMatch(/exclusive/)
    expect(problems).toContain('["2026-10-23", "2026-10-24"]')
  })

  it('refuses processes that read from any URL, also inside a reducer', () => {
    const graph = ndvi()
    graph.median!.arguments!.reducer = { process_graph: { x: { process_id: 'load_url', arguments: { url: 'https://example.com/a.zarr' }, result: true } } }
    expect(graphProblems(graph).join(' ')).toMatch(/load_url/)
  })

  it('names a from_node that points at no node', () => {
    const graph = ndvi()
    graph.scaled!.arguments!.data = { from_node: 'ndwi' }
    expect(graphProblems(graph).join(' ')).toMatch(/"ndwi"/)
  })

  // A small model left process_id off two nodes inside a reducer: EOPF validated the graph, then failed every tile.
  it('checks the graphs inside a reducer or apply as well', () => {
    const noId = ndvi()
    delete (noId.ndvi!.arguments!.reducer as any).process_graph.red.process_id
    expect(graphProblems(noId).join(' ')).toMatch(/"ndvi".*"red".*process_id/)

    const noResult = ndvi()
    delete (noResult.ndvi!.arguments!.reducer as any).process_graph.nd.result
    expect(graphProblems(noResult).join(' ')).toMatch(/"ndvi".*exactly one node must have "result": true/)

    const typo = ndvi()
    ;(typo.ndvi!.arguments!.reducer as any).process_graph.nd.arguments.x = { from_node: 'nirr' }
    expect(graphProblems(typo).join(' ')).toMatch(/"ndvi".*"nirr"/)
  })

  it('rejects what is not a graph, and a graph that is too big', () => {
    expect(graphProblems(null)).not.toEqual([])
    expect(graphProblems({ a: { arguments: {} } }).join(' ')).toMatch(/process_id/)
    const big: ProcessGraph = {}
    for (let i = 0; i <= MAX_NODES; i++) big[`n${i}`] = { process_id: 'add', arguments: { x: 1, y: 2 } }
    expect(graphProblems(big).join(' ')).toMatch(new RegExp(String(MAX_NODES)))
  })
})

describe('EXAMPLE_GRAPH', () => {
  it('passes the checks it teaches', () => {
    expect(graphProblems(EXAMPLE_GRAPH)).toEqual([])
  })
})

describe('withArea', () => {
  it('sets every load_collection extent to the area, whatever the graph says, and leaves the input alone', () => {
    const graph = ndvi()
    graph.load!.arguments!.spatial_extent = { west: -180, south: -90, east: 180, north: 90 }
    const out = withArea(graph, [12.35, 41.75, 12.65, 42])
    expect(out.load!.arguments!.spatial_extent).toEqual({ west: 12.35, south: 41.75, east: 12.65, north: 42, crs: 'EPSG:4326' })
    expect(graph.load!.arguments!.spatial_extent).toEqual({ west: -180, south: -90, east: 180, north: 90 })
  })
})

describe('describeGraph', () => {
  it('says in plain words what is loaded and what is done to it', () => {
    expect(describeGraph(ndvi())).toEqual([
      'sentinel-2-l2a · reflectance|bands=b04, reflectance|bands=b08 · 2026-09-01 to 2026-09-10',
      'Steps: reduce_dimension, median, array_element, normalized_difference, apply, linear_scale_range',
    ])
  })
})
