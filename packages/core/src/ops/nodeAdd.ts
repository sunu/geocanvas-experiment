import { z } from 'zod'
import { ulid } from 'ulid'
import type { NodeTypeDef } from '../plugins/types.js'
import type { OpDef } from './types.js'

const placement = {
  x: z.number().meta({ advanced: true }).optional().describe('Left edge in canvas units'),
  y: z.number().meta({ advanced: true }).optional().describe('Top edge in canvas units'),
  w: z.number().positive().meta({ advanced: true }).optional().describe('Width'),
  h: z.number().positive().meta({ advanced: true }).optional().describe('Height'),
  pinTo: z
    .object({ parentId: z.string(), lngLat: z.tuple([z.number(), z.number()]), zoom: z.number().optional() })
    .meta({ advanced: true })
    .optional()
    .describe('Pin the new node to a place in a map'),
}

/**
 * Palette op that adds one node of a type, e.g. 'core.sticky.add'.
 * Its args are the node props plus placement. It writes through DocTx.createNode,
 * like 'core.node.create'. Props with meta { ask: true } are the fields worth asking for.
 */
export function nodeAddOp(def: NodeTypeDef): OpDef<any, any> {
  const props = def.props instanceof z.ZodObject ? (def.props as z.ZodObject<any>) : z.object({})
  return {
    id: `${def.type}.add`,
    title: `Add ${def.title.toLowerCase()}`,
    description: def.description,
    target: { kind: 'canvas' },
    args: props.extend(placement),
    nl: { examples: [`add a ${def.title.toLowerCase()}`] },
    prepare: (_ctx, args: Record<string, unknown>) => {
      const { x, y, w, h, pinTo, ...rest } = args as Record<string, any>
      return {
        id: ulid(),
        props: rest,
        layout: { x: x ?? 0, y: y ?? 0, w: w ?? def.defaultSize.w, h: h ?? def.defaultSize.h },
        pinTo: pinTo as { parentId: string; lngLat: [number, number] } | undefined,
      }
    },
    apply(tx, plan: { id: string; props: Record<string, unknown>; layout: { x: number; y: number; w: number; h: number }; pinTo?: { parentId: string; lngLat: [number, number]; zoom?: number } }) {
      const pin = plan.pinTo
      tx.createNode({
        id: plan.id,
        type: def.type,
        props: plan.props,
        layout: plan.layout,
        ...(pin
          ? { parentId: pin.parentId, anchor: { kind: 'geo' as const, lngLat: pin.lngLat, ...(pin.zoom !== undefined ? { zoom: pin.zoom } : {}) } }
          : {}),
      })
    },
  }
}

/** Fields of a node type that the quick-add UI asks for. Empty means "add in one click". */
export function askFields(def: NodeTypeDef): string[] {
  if (!(def.props instanceof z.ZodObject)) return []
  const schema = z.toJSONSchema(def.props, { io: 'input', unrepresentable: 'any' }) as {
    properties?: Record<string, { ask?: boolean }>
  }
  return Object.entries(schema.properties ?? {})
    .filter(([, s]) => s.ask)
    .map(([k]) => k)
}
