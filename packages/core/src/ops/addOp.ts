import { z } from 'zod'
import type { ObjectTypeDef } from '../plugins/types.js'
import type { OpDef } from './types.js'

const placement = {
  x: z.number().default(0).meta({ advanced: true }).describe('Left edge in canvas units'),
  y: z.number().default(0).meta({ advanced: true }).describe('Top edge in canvas units'),
  w: z.number().positive().optional().meta({ advanced: true }).describe('Width'),
  h: z.number().positive().optional().meta({ advanced: true }).describe('Height'),
}

/**
 * The op that adds one object of a type, e.g. 'text.add'. Its args are the type's fields plus
 * placement; the size defaults to the type's. Drawing on the canvas, the palette and tools all use it.
 */
export function addOp(def: ObjectTypeDef): OpDef<any, any> {
  return {
    id: `${def.type}.add`,
    title: `Add ${def.title.toLowerCase()}`,
    description: def.description,
    target: { kind: 'canvas' },
    args: def.fields.extend(placement),
    nl: { examples: [`add a ${def.title.toLowerCase()}`] },
    apply(tx, args: Record<string, unknown>) {
      tx.add(def.type, { ...args, w: args.w ?? def.defaultSize.w, h: args.h ?? def.defaultSize.h })
    },
  }
}
