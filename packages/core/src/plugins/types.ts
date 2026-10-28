import type { z } from 'zod'
import type { AnyObject } from '../doc/board.js'
import type { OpDef } from '../ops/types.js'
import type { ColorName } from '../style.js'

/** A kind of object on the board, e.g. 'text' or 'event'. */
export interface ObjectTypeDef {
  /** Stored in each object's `type` field, so it never changes once boards use it. */
  type: string
  title: string
  description: string
  /** The type's own fields, beside x, y, w, h and z. Every add and update is checked against them. */
  fields: z.ZodObject
  defaultSize: { w: number; h: number }
  /** Where a new object goes: 'top' for content (texts, events), 'bottom' for backgrounds and frames (boxes, maps). */
  layer: 'top' | 'bottom'
  /** False: no '<type>.add' op. */
  addable?: boolean
  /** Its color can be set (a `color` field); objects with none stored use this one. */
  defaultColor?: ColorName
  /** Its text size can be set (a `fontSize` field). */
  textSize?: boolean
  /** Short text about one object, for an LLM's view of the board. */
  summarize?(object: AnyObject): string
}

export interface Plugin {
  id: string
  title: string
  dependsOn?: string[]
  objectTypes?: ObjectTypeDef[]
  ops?: OpDef<any, any>[]
}

export function definePlugin(p: Plugin): Plugin {
  return p
}
