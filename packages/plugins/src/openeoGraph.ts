import type { Bbox } from './mapLayers.js'

/**
 * The openEO process graphs an agent writes (openeo.proposeGraph). The checks are pure and worded for the model that
 * wrote the graph: an op that fails sends them back, and the model fixes its graph. They keep a graph to what a tile
 * service needs and to a bounded cost; EOPF itself validates the rest (an unknown process or a bad argument).
 */

export const MAX_NODES = 40
export const MAX_WINDOW_DAYS = 90
export const MAX_AREA_SQ_DEG = 20
/** These read from any URL, not from EOPF's collections. */
const DENIED_PROCESSES = ['load_url', 'load_zarr']

export interface ProcessNode {
  process_id: string
  arguments?: Record<string, unknown>
  result?: boolean
}
export type ProcessGraph = Record<string, ProcessNode>

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Every process id in a graph, also in the graphs nested in a reducer or an apply. */
function* processIds(graph: Record<string, unknown>): Generator<string> {
  for (const node of Object.values(graph)) {
    if (!isRecord(node)) continue
    if (typeof node.process_id === 'string') yield node.process_id
    yield* nestedProcessIds(node.arguments)
  }
}

function* nestedProcessIds(value: unknown): Generator<string> {
  if (Array.isArray(value)) for (const item of value) yield* nestedProcessIds(item)
  else if (isRecord(value)) {
    if (isRecord(value.process_graph)) yield* processIds(value.process_graph)
    else for (const item of Object.values(value)) yield* nestedProcessIds(item)
  }
}

/** The nodes an argument points at. A nested graph has nodes of its own, so it is left out. */
function* fromNodes(value: unknown): Generator<string> {
  if (Array.isArray(value)) for (const item of value) yield* fromNodes(item)
  else if (isRecord(value)) {
    if (typeof value.from_node === 'string') yield value.from_node
    for (const [key, item] of Object.entries(value)) if (key !== 'process_graph') yield* fromNodes(item)
  }
}

/** The graphs nested directly in some arguments (a reducer, an apply); each is checked on its own. */
function* nestedGraphs(value: unknown): Generator<Record<string, unknown>> {
  if (Array.isArray(value)) for (const item of value) yield* nestedGraphs(item)
  else if (isRecord(value)) {
    if (isRecord(value.process_graph)) yield value.process_graph
    else for (const item of Object.values(value)) yield* nestedGraphs(item)
  }
}

/**
 * What EOPF would only report as an error on every tile, at one level of a graph and then in the graphs nested in it:
 * a node without process_id, a from_node that is no node, and (in a nested graph) not exactly one result node.
 */
function levelProblems(graph: Record<string, unknown>, where: string, nested: boolean): string[] {
  const nodes = Object.entries(graph) as [string, ProcessNode][]
  const problems = nodes.filter(([, node]) => !isRecord(node) || typeof node.process_id !== 'string').map(([id]) => `${where}node "${id}" has no process_id.`)
  if (problems.length) return problems
  for (const [id, node] of nodes) {
    for (const ref of fromNodes(node.arguments)) if (!(ref in graph)) problems.push(`${where}node "${id}" refers to "${ref}", which is not a node of the graph.`)
  }
  if (nested && nodes.filter(([, node]) => node.result === true).length !== 1) problems.push(`${where}exactly one node must have "result": true.`)
  for (const [id, node] of nodes) {
    for (const inner of nestedGraphs(node.arguments)) problems.push(...levelProblems(inner, `In the reducer or apply of "${id}", `, true))
  }
  return problems
}

/** What is wrong with a graph, one sentence each; empty when it is fine. */
export function graphProblems(graph: unknown): string[] {
  if (!isRecord(graph) || !Object.keys(graph).length) {
    return ['The process graph must be an object of nodes, e.g. {"load": {"process_id": "load_collection", "arguments": {…}}, …}.']
  }
  const nodes = Object.entries(graph) as [string, ProcessNode][]
  const problems: string[] = []
  if (nodes.length > MAX_NODES) problems.push(`The process graph has ${nodes.length} nodes; use at most ${MAX_NODES}.`)
  problems.push(...levelProblems(graph, 'In the graph, ', false))
  if (nodes.some(([, node]) => !isRecord(node) || typeof node.process_id !== 'string')) return problems // the checks below need well-formed nodes

  const denied = [...new Set([...processIds(graph)].filter((id) => DENIED_PROCESSES.includes(id)))]
  if (denied.length) problems.push(`These processes are not allowed: ${denied.join(', ')}. Load data with load_collection.`)

  const results = nodes.filter(([, node]) => node.result === true)
  if (results.length !== 1) {
    problems.push(`Exactly one node must have "result": true (this graph has ${results.length}), and it must be the save_result node.`)
  } else if (results[0]![1].process_id !== 'save_result' || String(results[0]![1].arguments?.format).toUpperCase() !== 'PNG') {
    problems.push(
      'The node with "result": true must be a save_result with "format": "PNG", which a tile service needs. Add ' +
        '"save": {"process_id": "save_result", "arguments": {"data": {"from_node": "<your last node>"}, "format": "PNG"}, "result": true} ' +
        'and remove "result" from the other nodes.',
    )
  }

  const loads = nodes.filter(([, node]) => node.process_id === 'load_collection')
  if (!loads.length) problems.push('The graph must load data with a load_collection node.')
  for (const [id, node] of loads) {
    const extent = node.arguments?.temporal_extent
    const [start, end] = Array.isArray(extent) ? extent : []
    const days = (Date.parse(String(end)) - Date.parse(String(start))) / 86_400_000
    if (typeof start !== 'string' || typeof end !== 'string' || !Number.isFinite(days)) {
      problems.push(`load_collection "${id}" needs temporal_extent with both dates, e.g. ["2026-09-01", "2026-09-10"].`)
    } else if (days === 0) {
      const next = new Date(Date.parse(start) + 86_400_000).toISOString().slice(0, 10)
      problems.push(`load_collection "${id}": the end of temporal_extent is exclusive, so a window from a day to the same day is empty. For one day use ["${start.slice(0, 10)}", "${next}"].`)
    } else if (days < 0 || days > MAX_WINDOW_DAYS) {
      problems.push(`load_collection "${id}": temporal_extent must run forward and cover at most ${MAX_WINDOW_DAYS} days (this one covers ${Math.round(days)}).`)
    }
  }
  return problems
}

/** The graph with every load_collection on the area. The agent does not set it: the area is the layer's extent. */
export function withArea(graph: ProcessGraph, area: Bbox): ProcessGraph {
  const [west, south, east, north] = area
  const out = structuredClone(graph)
  for (const node of Object.values(out)) {
    if (node.process_id === 'load_collection') node.arguments = { ...node.arguments, spatial_extent: { west, south, east, north, crs: 'EPSG:4326' } }
  }
  return out
}

/** What a graph loads and does, for the person who approves it and for the board's summary. */
export function describeGraph(graph: ProcessGraph): string[] {
  const loads = Object.values(graph)
    .filter((node) => node.process_id === 'load_collection')
    .map((node) => {
      const { id, bands, temporal_extent: extent } = node.arguments ?? {}
      const [start, end] = Array.isArray(extent) ? extent : []
      return `${id} · ${Array.isArray(bands) ? bands.join(', ') : 'all bands'} · ${start} to ${end}`
    })
  const steps = [...new Set([...processIds(graph)].filter((id) => id !== 'load_collection' && id !== 'save_result'))]
  return [...loads, `Steps: ${steps.join(', ')}`]
}

/** Sentinel-2 NDVI as a median over the dates; EOPF rendered it (its /result), so it is a safe example for a model to copy. */
export const EXAMPLE_GRAPH: ProcessGraph = {
  load: { process_id: 'load_collection', arguments: { id: 'sentinel-2-l2a', temporal_extent: ['2026-09-01', '2026-09-10'], bands: ['reflectance|bands=b04', 'reflectance|bands=b08'] } },
  median: { process_id: 'reduce_dimension', arguments: { data: { from_node: 'load' }, dimension: 'time', reducer: { process_graph: { m: { process_id: 'median', arguments: { data: { from_parameter: 'data' } }, result: true } } } } },
  ndvi: {
    process_id: 'reduce_dimension',
    arguments: {
      data: { from_node: 'median' },
      dimension: 'bands',
      reducer: {
        process_graph: {
          red: { process_id: 'array_element', arguments: { data: { from_parameter: 'data' }, index: 0 } },
          nir: { process_id: 'array_element', arguments: { data: { from_parameter: 'data' }, index: 1 } },
          nd: { process_id: 'normalized_difference', arguments: { x: { from_node: 'nir' }, y: { from_node: 'red' } }, result: true },
        },
      },
    },
  },
  scaled: { process_id: 'apply', arguments: { data: { from_node: 'ndvi' }, process: { process_graph: { s: { process_id: 'linear_scale_range', arguments: { x: { from_parameter: 'x' }, inputMin: -1, inputMax: 1, outputMin: 0, outputMax: 255 }, result: true } } } } },
  save: { process_id: 'save_result', arguments: { data: { from_node: 'scaled' }, format: 'PNG' }, result: true },
}
