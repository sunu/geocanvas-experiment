import type { DocReader, LinkEnd, LinkRecord, NodeId } from '../doc/schema.js'
import type { Registry } from '../plugins/registry.js'

export function dataLinks(links: LinkRecord[]): LinkRecord[] {
  return links.filter((l) => l.kind === 'data')
}

/** Node ids that a data link from `nodeId` reaches directly. */
export function downstreamOf(nodeId: NodeId, links: LinkRecord[]): NodeId[] {
  return dataLinks(links)
    .filter((l) => l.from.nodeId === nodeId)
    .map((l) => l.to.nodeId)
}

/** True if a data link from -> to makes a cycle. */
export function wouldCreateCycle(from: NodeId, to: NodeId, links: LinkRecord[]): boolean {
  if (from === to) return true
  const stack = [to]
  const seen = new Set<NodeId>()
  while (stack.length) {
    const id = stack.pop()!
    if (id === from) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...downstreamOf(id, links))
  }
  return false
}

/**
 * Check a new data link. Returns an error message, or undefined if the link is valid.
 */
export function validateDataLink(
  from: LinkEnd,
  to: LinkEnd,
  reader: DocReader,
  registry: Registry,
): string | undefined {
  const a = reader.node(from.nodeId)
  const b = reader.node(to.nodeId)
  if (!a) return `Node ${from.nodeId} does not exist`
  if (!b) return `Node ${to.nodeId} does not exist`
  const out = registry.outputsOf(a)[from.port]
  if (!out) return `${a.type} has no output port "${from.port}"`
  const inp = registry.inputsOf(b)[to.port]
  if (!inp) return `${b.type} has no input port "${to.port}"`
  if (!registry.portAccepts(out.type, inp.type)) {
    return `Port type ${out.type} does not match ${inp.type}`
  }
  const links = reader.links()
  if (links.some((l) => l.kind === 'data' && l.to.nodeId === to.nodeId && l.to.port === to.port)) {
    return `Input port "${to.port}" of ${b.type} already has a link`
  }
  if (wouldCreateCycle(from.nodeId, to.nodeId, links)) return 'Link makes a cycle'
  return undefined
}

/** All nodes downstream of `roots` (not including roots), in topological order. */
export function topoDownstream(roots: NodeId[], links: LinkRecord[]): NodeId[] {
  const data = dataLinks(links)
  const reach = new Set<NodeId>()
  const stack = [...roots]
  while (stack.length) {
    const id = stack.pop()!
    for (const next of downstreamOf(id, data)) {
      if (!reach.has(next)) {
        reach.add(next)
        stack.push(next)
      }
    }
  }
  return topoSort([...reach], data)
}

/** Topological sort of `ids`, using only links among them and their upstream. */
export function topoSort(ids: NodeId[], links: LinkRecord[]): NodeId[] {
  const set = new Set(ids)
  const indeg = new Map<NodeId, number>(ids.map((id) => [id, 0]))
  for (const l of dataLinks(links)) {
    if (set.has(l.from.nodeId) && set.has(l.to.nodeId)) {
      indeg.set(l.to.nodeId, (indeg.get(l.to.nodeId) ?? 0) + 1)
    }
  }
  const queue = ids.filter((id) => indeg.get(id) === 0)
  const out: NodeId[] = []
  while (queue.length) {
    const id = queue.shift()!
    out.push(id)
    for (const l of dataLinks(links)) {
      if (l.from.nodeId !== id || !set.has(l.to.nodeId)) continue
      const d = (indeg.get(l.to.nodeId) ?? 0) - 1
      indeg.set(l.to.nodeId, d)
      if (d === 0) queue.push(l.to.nodeId)
    }
  }
  return out
}
