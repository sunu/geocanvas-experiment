import { z } from 'zod'
import { ulid } from 'ulid'
import type { Layout, LinkEnd, NodeRecord } from '../doc/schema.js'
import { validateDataLink } from '../reactivity/graph.js'
import { instantiateTemplateOp } from '../templates/instantiate.js'
import { defineOp, type OpDef } from './types.js'

const nodeIdsOf = (target: { kind: string; ids?: string[] }) => (target.kind === 'nodes' ? target.ids! : [])

export const createNodeOp = defineOp({
  id: 'core.node.create',
  title: 'Add node',
  description: 'Add a node of a given type to the canvas.',
  target: { kind: 'canvas' },
  args: z.object({
    type: z.string().meta({ widget: 'nodeType' }).describe('Node type'),
    props: z.record(z.string(), z.unknown()).optional(),
    x: z.number().default(0),
    y: z.number().default(0),
    w: z.number().optional(),
    h: z.number().optional(),
    parentId: z.string().optional(),
  }),
  prepare: (_ctx, args) => ({ ...args, id: ulid() }),
  apply(tx, plan) {
    tx.createNode({
      id: plan.id,
      type: plan.type,
      props: plan.props,
      layout: { x: plan.x, y: plan.y, w: plan.w, h: plan.h },
      parentId: plan.parentId,
    })
  },
})

export const deleteNodesOp = defineOp({
  id: 'core.node.delete',
  title: 'Delete',
  description: 'Delete the selected nodes, their children, and their links.',
  target: { kind: 'node' },
  args: z.object({}),
  apply(tx, _plan, target) {
    for (const id of nodeIdsOf(target)) tx.deleteNode(id)
  },
})

export const moveNodesOp = defineOp({
  id: 'core.node.move',
  title: 'Move',
  description: 'Move the selected nodes by an offset in canvas units.',
  target: { kind: 'node' },
  args: z.object({ dx: z.number().default(0), dy: z.number().default(0) }),
  prepare(ctx, args) {
    return nodeIdsOf(ctx.target).map((id) => {
      const n = ctx.reader.node(id)!
      return { id, x: n.layout.x + args.dx, y: n.layout.y + args.dy }
    })
  },
  apply(tx, plan) {
    for (const p of plan) tx.setLayout(p.id, { x: p.x, y: p.y })
  },
})

/** Absolute layout change. The canvas gesture bridge uses this at the end of a drag or resize. */
export const setLayoutOp = defineOp({
  id: 'core.node.setLayout',
  title: 'Set layout',
  description: 'Set position and size of nodes.',
  target: { kind: 'node' },
  hidden: true,
  args: z.object({
    layouts: z.record(
      z.string(),
      z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number(), z: z.number() }).partial(),
    ),
  }),
  apply(tx, plan) {
    for (const [id, layout] of Object.entries(plan.layouts)) tx.setLayout(id, layout as Partial<Layout>)
  },
})

export const updatePropsOp = defineOp({
  id: 'core.node.updateProps',
  title: 'Edit properties',
  description: 'Change properties of a node.',
  target: { kind: 'node', min: 1, max: 1 },
  args: z.object({ props: z.record(z.string(), z.unknown()) }),
  hidden: true,
  apply(tx, plan, target) {
    tx.updateProps(nodeIdsOf(target)[0]!, plan.props)
  },
})

export const duplicateNodesOp = defineOp({
  id: 'core.node.duplicate',
  title: 'Duplicate',
  description: 'Make a copy of the selected nodes, next to the originals.',
  target: { kind: 'node' },
  args: z.object({ offset: z.number().default(40) }),
  prepare(ctx, args) {
    return nodeIdsOf(ctx.target).map((id) => ({ source: ctx.reader.node(id)!, id: ulid(), offset: args.offset }))
  },
  apply(tx, plan) {
    for (const { source, id, offset } of plan) {
      tx.createNode({
        id,
        type: source.type,
        props: source.props,
        layout: { ...source.layout, x: source.layout.x + offset, y: source.layout.y + offset },
        parentId: source.parentId,
      })
    }
  },
})

const linkEnd = z.object({ nodeId: z.string(), port: z.string() })

export const createLinkOp = defineOp({
  id: 'core.link.create',
  title: 'Link nodes',
  description: 'Add a link from an output port of one node to an input port of another node.',
  target: { kind: 'canvas' },
  hidden: true,
  args: z.object({
    from: linkEnd,
    to: linkEnd,
    kind: z.enum(['data', 'visual']).default('data'),
  }),
  prepare: (_ctx, args) => ({ ...args, id: ulid() }),
  apply(tx, plan) {
    tx.createLink(plan)
  },
})

/** Palette op: select two nodes and connect them. It finds matching ports. */
export const connectNodesOp = defineOp<
  { fromPort?: string; toPort?: string },
  { id: string; from: LinkEnd; to: LinkEnd; kind: 'data' | 'visual' }
>({
  id: 'core.node.connect',
  title: 'Connect',
  description:
    'Link the first selected node to the second. Uses a data link if a port type matches, else a visual arrow.',
  target: { kind: 'node', min: 2, max: 2 },
  args: z.object({ fromPort: z.string().optional(), toPort: z.string().optional() }),
  prepare(ctx, args) {
    const [a, b] = nodeIdsOf(ctx.target).map((id) => ctx.reader.node(id)!) as [NodeRecord, NodeRecord]
    const outs = ctx.registry.outputsOf(a)
    const ins = ctx.registry.inputsOf(b)
    for (const [op, ospec] of Object.entries(outs)) {
      if (args.fromPort && op !== args.fromPort) continue
      for (const [ip, ispec] of Object.entries(ins)) {
        if (args.toPort && ip !== args.toPort) continue
        if (!ctx.registry.portAccepts(ospec.type, ispec.type)) continue
        const from = { nodeId: a.id, port: op }
        const to = { nodeId: b.id, port: ip }
        if (!validateDataLink(from, to, ctx.reader, ctx.registry)) return { id: ulid(), from, to, kind: 'data' }
      }
    }
    if (args.fromPort || args.toPort) throw new Error('No matching ports')
    return { id: ulid(), from: { nodeId: a.id, port: 'out' }, to: { nodeId: b.id, port: 'in' }, kind: 'visual' }
  },
  apply(tx, plan) {
    tx.createLink(plan)
  },
  describePlan: (p) => (p.kind === 'data' ? `Data link ${p.from.port} → ${p.to.port}` : 'Visual arrow'),
})

export const deleteLinkOp = defineOp({
  id: 'core.link.delete',
  title: 'Delete link',
  description: 'Delete a link.',
  target: { kind: 'canvas' },
  hidden: true,
  args: z.object({ linkId: z.string() }),
  apply(tx, plan) {
    tx.deleteLink(plan.linkId)
  },
})

export const enablePluginOp = defineOp({
  id: 'core.plugin.enable',
  title: 'Enable plugin',
  description: 'Turn on a plugin for this canvas. All users get its node types and ops.',
  target: { kind: 'canvas' },
  args: z.object({ pluginId: z.string().meta({ widget: 'pluginId' }) }),
  apply(tx, plan) {
    const list = (tx.reader.meta('enabledPlugins') as string[] | undefined) ?? []
    if (!list.includes(plan.pluginId)) tx.setMeta('enabledPlugins', [...list, plan.pluginId])
  },
})

export const disablePluginOp = defineOp({
  id: 'core.plugin.disable',
  title: 'Disable plugin',
  description: 'Turn off a plugin for this canvas.',
  target: { kind: 'canvas' },
  args: z.object({ pluginId: z.string().meta({ widget: 'pluginId' }) }),
  apply(tx, plan) {
    const list = (tx.reader.meta('enabledPlugins') as string[] | undefined) ?? []
    tx.setMeta('enabledPlugins', list.filter((p) => p !== plan.pluginId))
  },
})

export const focusOp = defineOp({
  id: 'core.view.focus',
  title: 'Focus',
  description: 'Move the camera to the selected nodes.',
  scope: 'view',
  target: { kind: 'node' },
  args: z.object({}),
  applyView: (view, _plan, target) => view.focusNodes(nodeIdsOf(target)),
})

export const fitAllOp = defineOp({
  id: 'core.view.fitAll',
  title: 'Zoom to fit',
  description: 'Move the camera so that all nodes are visible.',
  scope: 'view',
  target: { kind: 'canvas' },
  args: z.object({}),
  applyView: (view) => view.fitAll(),
})

export const zoomToOp = defineOp({
  id: 'core.view.zoomTo',
  title: 'Zoom to level',
  description: 'Set the camera zoom. 1 is 100%.',
  scope: 'view',
  target: { kind: 'canvas' },
  args: z.object({ zoom: z.number().min(0.05).max(8).default(1) }),
  applyView: (view, plan) => view.zoomTo(plan.zoom),
})

export const builtinOps: OpDef<any, any>[] = [
  createNodeOp,
  deleteNodesOp,
  moveNodesOp,
  setLayoutOp,
  updatePropsOp,
  duplicateNodesOp,
  createLinkOp,
  connectNodesOp,
  deleteLinkOp,
  enablePluginOp,
  disablePluginOp,
  instantiateTemplateOp,
  focusOp,
  fitAllOp,
  zoomToOp,
]
