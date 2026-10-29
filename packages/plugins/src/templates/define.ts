import { z } from 'zod'
import { defineOp, type AnyObject, type OpContext, type OpDef } from '@ttx/core'
import { MAP_HEADER_PX, viewOfArea } from '../mapView.js'
import { complete, type Facts, type SeedKind } from './seeds.js'

/**
 * Templates (plans/plan-012.md): a set of nodes put on the canvas from a few seeds. Each template is one op,
 * `template.<id>`, so the palette, the agent and the MCP companion list it, and one undo step takes it back.
 * Nodes are filled once from the seeds; they are not linked to them.
 */

export interface TemplateNode {
  type: string
  /** The facts this node is made from. Without them, it is left out (e.g. no GLIDE numbers: no ReliefWeb feed). */
  needs?: (keyof Facts)[]
  fields(facts: Facts): Record<string, unknown>
  /** Its column: nodes of one column stack top to bottom, in order. */
  col: number
  /** Default: the type's default size. */
  size?: { w: number; h: number }
}

export interface TemplateDef {
  /** The op is `template.<id>`. */
  id: string
  title: string
  /** Palette help, and the tool description an agent sees. */
  description: string
  /** Seeds by arg name. When two give the same fact, the first one wins. */
  seeds: Record<string, { kind: SeedKind; label: string }>
  /** A title text above the nodes. */
  heading(facts: Facts): string
  nodes: TemplateNode[]
}

/** Space between nodes, and around them inside the frame, in canvas units. */
export const GAP = 24
const HEADING = { h: 48, fontSize: 32 }

/** A node to add, placed relative to the set's top-left corner. */
interface Planned {
  type: string
  fields: Record<string, unknown>
}

interface Plan {
  nodes: Planned[]
  frame: { x: number; y: number; w: number; h: number }
  /** The person whose view of each new map is set to the area. */
  person?: string
  area?: Facts['area']
  summary: string
}

/** A fact a node can be made from: an empty list (an event with no GLIDE numbers) is not one. */
const known = (v: unknown) => v !== undefined && !(Array.isArray(v) && !v.length)

/** Op ids of templates start with this. */
export const TEMPLATE_OP_PREFIX = 'template.'

export function defineTemplate(def: TemplateDef): OpDef<any, Plan> {
  const seeds = Object.fromEntries(Object.entries(def.seeds).map(([k, s]) => [k, s.kind.schema.describe(s.label)]))
  return defineOp({
    id: `${TEMPLATE_OP_PREFIX}${def.id}`,
    title: def.title,
    description: `${def.description} Each seed takes text to look up (best match), e.g. { "text": "…" }.`,
    target: { kind: 'canvas' },
    args: z.object({
      ...seeds,
      x: z.number().optional().meta({ advanced: true }).describe('Middle of the set, in canvas units. Default: right of everything on the board'),
      y: z.number().optional().meta({ advanced: true }).describe('Middle of the set, in canvas units'),
    }),
    async prepare(ctx, args) {
      let facts: Facts = {}
      const labels: string[] = []
      // Facts already known win: the first seed's.
      for (const key of Object.keys(def.seeds)) {
        const r = await def.seeds[key]!.kind.resolve(ctx, (args as Record<string, unknown>)[key])
        facts = { ...r.facts, ...facts }
        labels.push(r.label)
      }
      facts = await complete(ctx, facts)
      const nodes = def.nodes.filter((n) => (n.needs ?? []).every((k) => known(facts[k])))
      return { ...layout(ctx, def, facts, nodes, args), summary: `${def.title} for ${labels.join(', ')}` }
    },
    apply(tx, plan) {
      const ids = plan.nodes.map((n) => tx.add(n.type, n.fields))
      // The frame goes under every node, maps included (they go to the bottom too).
      const lowest = Math.min(...ids.map((id) => tx.get(id)!.z))
      tx.add('box', { ...plan.frame, color: 'gray', z: lowest - 1 })
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
 * The heading on top, then columns left to right; nodes of a column stack top to bottom. Each node is checked
 * against its type before any write.
 */
function layout(ctx: OpContext, def: TemplateDef, facts: Facts, nodes: TemplateNode[], at: { x?: number; y?: number }) {
  const sized = nodes.map((n) => {
    const type = ctx.registry.objectType(n.type)
    if (!type) throw new Error(`Unknown object type: ${n.type}`)
    return { n, ...(n.size ?? type.defaultSize) }
  })
  const cols = [...new Set(sized.map((s) => s.n.col))].sort((a, b) => a - b)
  const placed: { type: string; fields: Record<string, unknown>; x: number; y: number; w: number; h: number }[] = []
  let x = GAP
  let bottom = 0
  for (const col of cols) {
    const inCol = sized.filter((s) => s.n.col === col)
    let y = GAP + HEADING.h + GAP
    for (const s of inCol) {
      placed.push({ type: s.n.type, fields: s.n.fields(facts), x, y, w: s.w, h: s.h })
      y += s.h + GAP
    }
    bottom = Math.max(bottom, y)
    x += Math.max(...inCol.map((s) => s.w)) + GAP
  }
  const w = Math.max(x, 600)
  const h = bottom
  const heading = { type: 'text', fields: { text: def.heading(facts), fontSize: HEADING.fontSize }, x: GAP, y: GAP, w: w - 2 * GAP, h: HEADING.h }
  const origin = at.x !== undefined && at.y !== undefined ? { x: at.x - w / 2, y: at.y - h / 2 } : besideBoard(ctx.board.list())
  const out = [heading, ...placed].map((p) => ({
    type: p.type,
    fields: { ...p.fields, x: Math.round(origin.x + p.x), y: Math.round(origin.y + p.y), w: p.w, h: p.h },
  }))
  for (const p of out) {
    const checked = ctx.registry.objectSchema(p.type).safeParse({ ...p.fields, z: 0 })
    if (!checked.success) throw new Error(`${def.title}: ${p.type} ${z.prettifyError(checked.error)}`)
  }
  const me = ctx.actor.kind === 'user' ? ctx.actor.id : ctx.actor.onBehalfOf
  return {
    nodes: out,
    frame: { x: Math.round(origin.x), y: Math.round(origin.y), w, h },
    ...(me && { person: me }),
    ...(facts.area && { area: facts.area }),
  }
}

/** Right of everything on the board, top-aligned with it: where a set goes when no place is given. */
function besideBoard(objects: AnyObject[]) {
  if (!objects.length) return { x: 0, y: 0 }
  return { x: Math.max(...objects.map((o) => o.x + o.w)) + 4 * GAP, y: Math.min(...objects.map((o) => o.y)) }
}
