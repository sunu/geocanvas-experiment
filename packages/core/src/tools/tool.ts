import type { z } from 'zod'

/** What a tool gets when it runs. */
export interface ToolContext {
  /** Run another tool. Validated and cached like any tool call. */
  tool<O = unknown>(id: string, input: unknown): Promise<O>
  signal: AbortSignal
}

/**
 * A typed, read-only, async capability (plans/plan-006.md on feat/tools-registry): find a place,
 * get population for an area. Tools never write the board; ops do. People reach them through widgets
 * (a map's place search, its data layers), and the board's agent calls them (exportToolDefs). Each
 * environment lists the tools it can run: the browser in apps/web/src/tools/registry.ts, the room's
 * agent in apps/worker/src/worker.ts (boardGet and eventsSearch are in @ttx/plugins).
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
  /** The plugin it belongs to, if any: agents do not get it while that plugin is turned off on the board. */
  plugin?: string
  /** Default true: results are cached per browser by (id, parsed input). */
  cache?: boolean
}

export function defineTool<I, O>(def: ToolDef<I, O>): ToolDef<I, O> {
  return def
}
