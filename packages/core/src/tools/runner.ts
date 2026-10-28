import { z } from 'zod'
import type { ToolContext, ToolDef } from './tool.js'

export interface ToolRunOptions {
  /** Stops waiting for the result. A shared (cached) run goes on for other callers and the cache. */
  signal?: AbortSignal
}

/** About how many results one browser keeps. */
const MAX_ENTRIES = 200

/**
 * Runs tools: looks a tool up by id, validates the input, and runs it. Results of cached tools are
 * kept in an LRU keyed by (id, parsed input). Why: every person's map runs its layers' tools, maps
 * re-render often, and remote services are slow or rate limited (OpenCage's free tier allows one
 * request per second). Concurrent calls share one run. Failed runs are not kept.
 */
export class ToolRunner {
  private tools: Map<string, ToolDef>
  /** Insertion order is the LRU order: oldest first. Holds in-flight and resolved runs. */
  private cache = new Map<string, Promise<unknown>>()
  /** Signal of shared runs: they outlive any one caller, and stop when the runner is disposed. */
  private lifetime = new AbortController()

  constructor(tools: ToolDef[]) {
    this.tools = new Map()
    for (const t of tools) {
      if (this.tools.has(t.id)) throw new Error(`Duplicate tool id ${t.id}`)
      this.tools.set(t.id, t)
    }
  }

  tool(id: string): ToolDef | undefined {
    return this.tools.get(id)
  }

  /** Every tool, in the order given. */
  list(): ToolDef[] {
    return [...this.tools.values()]
  }

  run<O = unknown>(id: string, input: unknown, opts: ToolRunOptions = {}): Promise<O> {
    const tool = this.tools.get(id)
    if (!tool) return Promise.reject(new Error(`Unknown tool: ${id}`))
    const parsed = tool.input.safeParse(input)
    if (!parsed.success) {
      return Promise.reject(new Error(`Invalid input for tool ${id}: ${z.prettifyError(parsed.error)}`))
    }
    if (tool.cache === false) {
      return this.exec(tool, parsed.data, opts.signal ?? this.lifetime.signal) as Promise<O>
    }
    const key = `${id}:${stableJson(parsed.data)}`
    let p = this.cache.get(key)
    if (p) {
      this.cache.delete(key)
      this.cache.set(key, p)
    } else {
      const run = this.exec(tool, parsed.data, this.lifetime.signal)
      p = run
      this.cache.set(key, run)
      run.catch(() => {
        if (this.cache.get(key) === run) this.cache.delete(key)
      })
      while (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value!)
    }
    return untilAborted(p, opts.signal) as Promise<O>
  }

  dispose(): void {
    this.lifetime.abort()
    this.cache.clear()
  }

  private exec(tool: ToolDef, input: unknown, signal: AbortSignal): Promise<unknown> {
    const ctx: ToolContext = {
      tool: (tid, tinput) => this.run(tid, tinput, { signal }),
      signal,
    }
    // A tool may throw synchronously: turn that into a rejection.
    return Promise.resolve().then(() => tool.run(input, ctx))
  }
}

/** JSON with object keys sorted, so the same input in any key order gives the same cache key. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  )
}

function untilAborted<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return p
  const reason = () => signal.reason ?? new Error('Cancelled')
  if (signal.aborted) return Promise.reject(reason())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(reason())
    signal.addEventListener('abort', onAbort, { once: true })
    p.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
