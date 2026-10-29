import { z } from 'zod'
import type { Board } from '../doc/board.js'
import type { Registry } from '../plugins/registry.js'
import type { ToolDef } from '../tools/tool.js'
import type { OpDef } from './types.js'

export interface ToolDefinition {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

/** Tool names allow only [a-zA-Z0-9_-]. Op ids use dots. */
export const toolNameOf = (opId: string) => opId.replace(/\./g, '__')
export const opIdOf = (toolName: string) => toolName.replace(/__/g, '.')

/**
 * Ops as JSON Schema tool definitions for an LLM. The input is { ids, args }: `ids` (for ops on
 * objects) is the target, `args` the op's own args. `Runtime.callTool` runs such a call.
 */
export function exportTools(ops: OpDef<any, any>[]): ToolDefinition[] {
  return ops.map((op) => {
    const args = z.toJSONSchema(op.args, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
    delete args.$schema
    const properties: Record<string, unknown> = { args }
    const required = ['args']
    if (op.target.kind === 'objects') {
      properties.ids = {
        type: 'array',
        items: { type: 'string' },
        minItems: op.target.min ?? 1,
        ...(op.target.max !== undefined && { maxItems: op.target.max }),
        description: `Ids of the objects to act on${op.target.types ? ` (types: ${op.target.types.join(', ')})` : ''}`,
      }
      required.unshift('ids')
    }
    return {
      name: toolNameOf(op.id),
      description: `${op.title}. ${op.description}`,
      input_schema: { type: 'object', properties, required, additionalProperties: false },
    }
  })
}

/**
 * Read-only tools (ToolDef) as JSON Schema tool definitions for an LLM, beside the ops. The input is the
 * tool's own input, with no `ids` or `args`: a tool has no target. `ToolRunner.run` runs such a call.
 */
export function exportToolDefs(tools: ToolDef[]): ToolDefinition[] {
  return tools.map((t) => {
    const input = z.toJSONSchema(t.input, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
    delete input.$schema
    return { name: toolNameOf(t.id), description: `${t.title}. ${t.description}`, input_schema: input }
  })
}

/** Short text about the board for an LLM: one line per object, bottom to top. */
export function summarizeBoard(board: Board, registry: Registry): string {
  return board
    .list()
    .map((o) => {
      const extra = registry.objectType(o.type)?.summarize?.(o)
      const at = `at (${Math.round(o.x)}, ${Math.round(o.y)}) size ${Math.round(o.w)}×${Math.round(o.h)}`
      const link = o.link ? `; linked to ${o.link.from} (${o.link.recipe})` : ''
      return `- ${o.type} ${o.id} ${at}${extra ? `: ${extra}` : ''}${link}`
    })
    .join('\n')
}
