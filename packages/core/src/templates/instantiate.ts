import { z } from 'zod'
import { ulid } from 'ulid'
import type { DocTx } from '../doc/tx.js'
import type { NodeId } from '../doc/schema.js'
import { defineOp, type OpContext, type OpDef } from '../ops/types.js'
import type { TemplateDef, TemplateGraph } from '../plugins/types.js'

export interface TemplatePlan {
  templateId: string
  inputs: unknown
  graph: TemplateGraph
  /** Node id for each template key, made in prepare so that the plan is final. */
  ids: Record<string, NodeId>
  origin: { x: number; y: number }
}

async function buildPlan(
  ctx: OpContext,
  template: TemplateDef,
  rawInputs: unknown,
  origin: { x: number; y: number },
): Promise<TemplatePlan> {
  const inputs = template.inputs.parse(rawInputs ?? {})
  const graph = await template.build(inputs, { reader: ctx.reader, provider: ctx.provider })
  const ids: Record<string, NodeId> = { ...(graph.existing ?? {}) }
  for (const n of graph.nodes) ids[n.key] = ulid()
  return { templateId: template.id, inputs, graph, ids, origin }
}

function applyPlan(tx: DocTx, plan: TemplatePlan): void {
  const { graph, ids, origin } = plan
  // Parents first, so that children can refer to them.
  const ordered = [...graph.nodes].sort((a, b) => Number(!!a.parentKey) - Number(!!b.parentKey))
  for (const n of ordered) {
    tx.createNode({
      id: ids[n.key],
      type: n.type,
      props: n.props,
      layout: { ...n.layout, x: origin.x + n.layout.x, y: origin.y + n.layout.y },
      parentId: n.parentKey ? ids[n.parentKey] : undefined,
    })
  }
  for (const l of graph.links) {
    const from = ids[l.from.key]
    const to = ids[l.to.key]
    if (!from || !to) throw new Error(`Template link refers to unknown key`)
    tx.createLink({
      from: { nodeId: from, port: l.from.port },
      to: { nodeId: to, port: l.to.port },
      kind: l.kind ?? 'data',
    })
  }
  tx.setMeta('templateRef', { id: plan.templateId, inputs: plan.inputs })
}

const originSchema = z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 })

/** Generic op: instantiate any template by id. */
export const instantiateTemplateOp = defineOp<
  { templateId: string; inputs?: unknown; origin: { x: number; y: number } },
  TemplatePlan
>({
  id: 'core.template.instantiate',
  title: 'Create from template',
  description: 'Add the nodes and links of a template to the canvas.',
  target: { kind: 'canvas' },
  args: z.object({
    templateId: z.string().describe('Template id'),
    inputs: z.unknown().optional(),
    origin: originSchema,
  }),
  hidden: true,
  async prepare(ctx, args) {
    const t = ctx.registry.template(args.templateId)
    if (!t) throw new Error(`Unknown template: ${args.templateId}`)
    return buildPlan(ctx, t, args.inputs, args.origin)
  },
  apply: (tx, plan) => applyPlan(tx, plan),
  describePlan: (plan) => `Adds ${plan.graph.nodes.length} nodes and ${plan.graph.links.length} links`,
})

/** A palette op for one template. Its args are the template inputs. */
export function templateOp(t: TemplateDef): OpDef<any, TemplatePlan> {
  const inputs = t.inputs instanceof z.ZodObject ? t.inputs : z.object({ inputs: t.inputs })
  return {
    id: `${t.id}.create`,
    title: `New: ${t.title}`,
    description: t.description,
    target: { kind: 'canvas' },
    args: (inputs as z.ZodObject<any>).extend({ origin: originSchema }),
    async prepare(ctx, args) {
      const { origin, ...rest } = args as { origin: { x: number; y: number } }
      return buildPlan(ctx, t, rest, origin)
    },
    apply: (tx, plan) => applyPlan(tx, plan),
    describePlan: (plan) => `Adds ${plan.graph.nodes.length} nodes and ${plan.graph.links.length} links`,
  }
}
