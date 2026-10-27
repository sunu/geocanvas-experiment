import { z } from 'zod'
import type { OpDef } from '@geo-canvas/core'
import type { ExtractKind, FieldSpec } from './types.js'

/** Args that NL never fills: placement is set by the UI. */
const SKIP = new Set(['x', 'y', 'w', 'h', 'origin'])

type JsonSchema = Record<string, any>

/** Field specs of an op, from its zod schema and the `nl` meta hints. */
export function fieldsOf(op: OpDef<any, any>): FieldSpec[] {
  let schema: JsonSchema
  try {
    schema = z.toJSONSchema(op.args, { io: 'input', unrepresentable: 'any' }) as JsonSchema
  } catch {
    return []
  }
  const required = new Set<string>(schema.required ?? [])
  return Object.entries((schema.properties ?? {}) as Record<string, JsonSchema>)
    .filter(([name, s]) => !SKIP.has(name) && !s.advanced)
    .map(([name, s]) => toField(name, s, required.has(name)))
}

function toField(name: string, s: JsonSchema, required: boolean): FieldSpec {
  const nl = (s.nl ?? {}) as { extract?: ExtractKind; entity?: string; examples?: string[]; labels?: Record<string, string> }
  const type: FieldSpec['type'] = s.enum
    ? 'enum'
    : (['number', 'integer', 'string', 'boolean', 'object', 'array'] as const).find((t) => t === s.type) ?? 'unknown'
  const extract: ExtractKind =
    nl.extract ??
    (type === 'number' || type === 'integer' ? 'number' : type === 'string' ? 'text' : 'none')
  return {
    name,
    type,
    title: s.title ?? humanize(name),
    description: [s.description, nl.labels ? `Options: ${Object.entries(nl.labels).map(([k, v]) => `${k} = ${v}`).join('; ')}` : undefined]
      .filter(Boolean)
      .join('. ') || undefined,
    enum: s.enum,
    minimum: s.minimum,
    maximum: s.maximum > 1e15 ? undefined : s.maximum,
    default: s.default,
    required: required && s.default === undefined,
    extract,
    entity: nl.entity,
    examples: nl.examples,
    labels: nl.labels,
  }
}

export function humanize(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/\bKm\b/, 'km')
}
