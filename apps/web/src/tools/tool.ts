import type { z } from 'zod'

/** What a tool gets when it runs. */
export interface ToolContext {
  /** Run another tool. Validated and cached like any tool call. */
  tool<O = unknown>(id: string, input: unknown): Promise<O>
  signal: AbortSignal
}

/**
 * A typed, read-only, async capability (plans/plan-006.md on feat/tools-registry): find a place,
 * get population for an area. Tools never write the board. People reach them through widgets (a map's
 * place search, its data layers); agents will call the same tools.
 */
export interface ToolDef<Input = any, Output = any> {
  /** '<area>.<name>', e.g. 'data.geocode'. */
  id: string
  title: string
  /** Help text, and the description an agent will see. */
  description: string
  input: z.ZodType<Input>
  /** Kind of result, which picks how a map draws it, e.g. 'geo.features'. */
  output: string
  run(input: Input, ctx: ToolContext): Promise<Output> | Output
  /** Default true: results are cached per browser by (id, parsed input). */
  cache?: boolean
}

export function defineTool<I, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def
}
