import { z } from 'zod'
import { defineOp, type AnyObject, type OpContext, type OpDef } from '@ttx/core'
import { personOf, renderLinks } from '../links/propagate.js'
import { MAP_HEADER_PX, viewOfArea } from '../mapView.js'
import { complete, type Facts, type SeedKind } from './seeds.js'

/**
 * Templates (plans/plan-012.md, plan-013.md): a set of nodes put on the canvas from a few seeds. Each template is
 * one op, `template.<id>`, so the palette, the agent and the MCP companion list it, and one undo step takes it
 * back. Each seed becomes a root node (an event card, an area input); the other nodes and the frames follow it
 * (links/), so changing the root later re-renders them. They are filled with the same recipes.
 */

/** A seed's root node, e.g. the event card. */
export interface RootNode {
  root: string
  col: number
  frame?: number
}

/** A content node. With `link`, it follows a seed's root and the recipe fills it; it is blank when facts are missing. */
export interface ContentNode {
  type: string
  /** Fields that do not follow the root, e.g. a sticky note's text. */
  fields?: Record<string, unknown>
  link?: { recipe: string; args?: Record<string, unknown>; seed?: string }
  /** Its column: nodes of one column stack top to bottom, in order. */
  col: number
  /** Index in `frames`. Default: the first. */
  frame?: number
  /** Default: the type's default size. */
  size?: { w: number; h: number }
}

export type TemplateNode = RootNode | ContentNode

export interface TemplateDef {
  /** The op is `template.<id>`. */
  id: string
  title: string
  /** Palette help, and the tool description an agent sees. */
  description: string
  /** Seeds by arg name. When two give the same fact, the first one wins. A link without `seed` follows the first. */
  seeds: Record<string, { kind: SeedKind; label: string }>
  /** Frames left to right. The title follows a seed's root: `prefix` and its name, e.g. "Conflict: Cabo Delgado". */
  frames: { prefix: string; seed?: string }[]
  nodes: TemplateNode[]
}

/** Space between nodes, and around them inside a frame, in canvas units. */
export const GAP = 24

/** Op ids of templates start with this. */
export const TEMPLATE_OP_PREFIX = 'template.'

/** A node to add, with its id chosen in prepare so that links can name it. */
interface Planned {
  id: string
  type: string
  fields: Record<string, unknown>
}

interface Plan {
  nodes: Planned[]
  frames: Planned[]
  /** The person whose view of each new map is set to the area. */
  person?: string
  area?: Facts['area']
  summary: string
}

const isRoot = (n: TemplateNode): n is RootNode => 'root' in n

export function defineTemplate(def: TemplateDef): OpDef<any, Plan> {
  const seeds = Object.fromEntries(Object.entries(def.seeds).map(([k, s]) => [k, s.kind.schema.optional().describe(s.label)]))
  const firstSeed = Object.keys(def.seeds)[0]!
  return defineOp({
    id: `${TEMPLATE_OP_PREFIX}${def.id}`,
    title: def.title,
    description:
      `${def.description} Each seed takes text to look up (best match), e.g. { "text": "…" }. ` +
      "Its objects follow the seed's root object: change the root later and they update. " +
      'Leave a seed out only when asked to: its root and the objects that follow it are then added empty, to fill in on the board.',
    target: { kind: 'canvas' },
    args: z.object({
      ...seeds,
      x: z.number().optional().meta({ advanced: true }).describe('Middle of the set, in canvas units. Default: right of everything on the board'),
      y: z.number().optional().meta({ advanced: true }).describe('Middle of the set, in canvas units'),
    }),
    async prepare(ctx, args) {
      let facts: Facts = {}
      const labels: string[] = []
      const roots: Record<string, Planned> = {}
      for (const [key, seed] of Object.entries(def.seeds)) {
        const value = (args as Record<string, unknown>)[key]
        // A seed left out gives an empty root (an event card to pick an event in), and its followers stay blank.
        if (value === undefined) {
          roots[key] = { id: crypto.randomUUID(), ...seed.kind.root({}) }
          labels.push(`no ${seed.label.toLowerCase()} yet`)
          continue
        }
        const r = await seed.kind.resolve(ctx, value)
        const own = await complete(ctx, r.facts)
        roots[key] = { id: crypto.randomUUID(), ...seed.kind.root(own) }
        // Facts already known win: the first seed's.
        facts = { ...own, ...facts }
        labels.push(r.label)
      }
      return { ...build(ctx, def, facts, roots, firstSeed, args), summary: `${def.title} for ${labels.join(', ')}` }
    },
    apply(tx, plan) {
      const ids = plan.nodes.map((n) => tx.add(n.type, n.fields, n.id))
      // Frames go under every node, maps included (they go to the bottom too).
      const lowest = Math.min(...ids.map((id) => tx.get(id)!.z))
      plan.frames.forEach((f, i) => tx.add(f.type, { ...f.fields, z: lowest - 1 - i }, f.id))
      if (!plan.person || !plan.area) return
      for (const id of ids) {
        const o = tx.get(id)!
        if (o.type === 'map') tx.setView(plan.person, id, { ...viewOfArea(plan.area, o.w, o.h - MAP_HEADER_PX), bearing: 0 })
      }
    },
    describePlan: (plan) => plan.summary,
  })
}

/**
 * Lay the nodes out and fill them. Frames go left to right; in a frame, columns go left to right and the nodes of
 * a column stack top to bottom. Each node is checked against its type before any write.
 */
function build(ctx: OpContext, def: TemplateDef, facts: Facts, roots: Record<string, Planned>, firstSeed: string, at: { x?: number; y?: number }) {
  const linkTo = (seed: string | undefined) => {
    const root = roots[seed ?? firstSeed]
    if (!root) throw new Error(`${def.title}: no seed ${seed}`)
    return root.id
  }
  const sizeOf = (type: string, size?: { w: number; h: number }) => {
    const t = ctx.registry.objectType(type)
    if (!t) throw new Error(`Unknown object type: ${type}`)
    return size ?? t.defaultSize
  }
  // Each node as it will be, relative to the set's top-left corner.
  const placed: (Planned & { x: number; y: number; w: number; h: number })[] = []
  const frameRects: { x: number; y: number; w: number; h: number }[] = []
  let left = 0
  def.frames.forEach((_, f) => {
    const inFrame = def.nodes.filter((n) => (n.frame ?? 0) === f)
    const cols = [...new Set(inFrame.map((n) => n.col))].sort((a, b) => a - b)
    let x = left + GAP
    let bottom = GAP
    for (const col of cols) {
      let y = GAP
      let width = 0
      for (const n of inFrame.filter((n) => n.col === col)) {
        const node: Planned = isRoot(n)
          ? roots[n.root]!
          : { id: crypto.randomUUID(), type: n.type, fields: { ...n.fields, ...(n.link && { link: { from: linkTo(n.link.seed), recipe: n.link.recipe, ...(n.link.args && { args: n.link.args }) } }) } }
        const { w, h } = sizeOf(node.type, isRoot(n) ? undefined : n.size)
        placed.push({ ...node, x, y, w, h })
        y += h + GAP
        width = Math.max(width, w)
      }
      bottom = Math.max(bottom, y)
      x += width + GAP
    }
    frameRects.push({ x: left, y: 0, w: x - left, h: bottom })
    left = x + 2 * GAP
  })
  const total = { w: left - 2 * GAP, h: Math.max(...frameRects.map((r) => r.h)) }
  const origin = at.x !== undefined && at.y !== undefined ? { x: at.x - total.w / 2, y: at.y - total.h / 2 } : besideBoard(ctx.board.list())
  const place = (r: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(origin.x + r.x), y: Math.round(origin.y + r.y), w: r.w, h: r.h })

  const nodes = placed.map((p) => ({ id: p.id, type: p.type, fields: { ...p.fields, ...place(p) } }))
  const frames = def.frames.map((f, i) => ({
    id: crypto.randomUUID(),
    type: 'frame',
    fields: { ...place(frameRects[i]!), link: { from: linkTo(f.seed), recipe: 'frameTitle', args: { prefix: f.prefix } } },
  }))
  // The first fill uses the recipes that re-render the nodes later, on objects as they will be.
  const asObject = (p: Planned): AnyObject => ({ id: p.id, type: p.type, z: 0, ...(p.fields as { x: number; y: number; w: number; h: number }) })
  for (const patch of renderLinks(facts, [...nodes, ...frames].map(asObject))) {
    const p = [...nodes, ...frames].find((n) => n.id === patch.id)!
    Object.assign(p.fields, patch.set)
  }
  for (const p of [...nodes, ...frames]) {
    const checked = ctx.registry.objectSchema(p.type).safeParse({ ...p.fields, z: 0 })
    if (!checked.success) throw new Error(`${def.title}: ${p.type} ${z.prettifyError(checked.error)}`)
  }
  const person = personOf(ctx)
  return { nodes, frames, ...(person && { person }), ...(facts.area && { area: facts.area }) }
}

/** Right of everything on the board, top-aligned with it: where a set goes when no place is given. */
function besideBoard(objects: AnyObject[]) {
  if (!objects.length) return { x: 0, y: 0 }
  return { x: Math.max(...objects.map((o) => o.x + o.w)) + 4 * GAP, y: Math.min(...objects.map((o) => o.y)) }
}
