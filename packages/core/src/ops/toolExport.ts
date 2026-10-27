import { z } from 'zod'
import type { DocReader } from '../doc/schema.js'
import type { OpDef } from './types.js'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Tool names allow only [a-zA-Z0-9_-]. Op ids use dots. */
export const toolNameOf = (opId: string) => opId.replace(/\./g, '__')
export const opIdOf = (toolName: string) => toolName.replace(/__/g, '.')

/** Export ops as JSON Schema tool definitions for an LLM. */
export function exportTools(ops: OpDef<any, any>[]): ToolDefinition[] {
  return ops.map((op) => ({
    name: toolNameOf(op.id),
    description: `${op.title}. ${op.description}`,
    input_schema: z.toJSONSchema(op.args, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>,
  }))
}

/** Short text summary of the canvas for an LLM context. */
export function summarizeCanvas(
  reader: DocReader,
  describe: (nodeId: string) => string | undefined = () => undefined,
): string {
  const lines: string[] = []
  for (const n of reader.nodes()) {
    const extra = describe(n.id)
    const label = (n.props.title ?? n.props.label ?? '') as string
    lines.push(`- node ${n.id} type=${n.type}${label ? ` "${label}"` : ''}${n.parentId ? ` parent=${n.parentId}` : ''}${extra ? `: ${extra}` : ''}`)
  }
  for (const l of reader.links()) {
    lines.push(`- link ${l.kind} ${l.from.nodeId}.${l.from.port} -> ${l.to.nodeId}.${l.to.port}`)
  }
  return lines.join('\n')
}
