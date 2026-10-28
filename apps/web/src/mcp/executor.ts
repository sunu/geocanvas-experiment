import type * as Y from 'yjs'
import {
  exportToolDefs,
  exportTools,
  Runtime,
  stableJson,
  ToolRunner,
  toolNameOf,
  Views,
  type Actor,
  type Plugin,
  type ToolDef,
  type ToolDefinition,
  type TurnUndo,
  type ViewController,
} from '@ttx/core'
import { areaOfView, callOp, MAP_HEADER_PX, TurnLog } from '@ttx/plugins'

/**
 * What an external agent (Claude, Codex) does on this tab's board, through the local MCP companion (apps/mcp,
 * plans/plan-010.md). It runs no model: the agent's own app does. It has its own runtime on the tab's doc, as the
 * browser agent has, so its writes stay out of the person's ⌘Z, and it follows the same rules as the board's agent
 * (callOp in @ttx/plugins). Its tools are the app's: every op an agent may run and this browser's read-only tools,
 * so a new op or tool reaches the agent with no change to the companion.
 */

/** The external agent. Not the board agent's id ('agent'): the op log tells them apart. */
export const EXTERNAL_AGENT: Actor = { kind: 'agent', id: 'mcp', name: 'External agent', color: '#0f766e' }

/** A read tool's result longer than this (characters of JSON) is cut, and says so. */
export const MAX_RESULT_CHARS = 20_000

/** Objects in a snapshot, unless the agent asks for others. */
export const SNAPSHOT_LIMIT = 200

/** An add without x and y goes to the right of the agent's last add if that was this recent, else in the middle of the view. */
const NEXT_TO_MS = 60_000

/**
 * The tools this tab offers, and a hash of them: tabs with another hash run another version of the app. Read-only
 * tools say so (MCP's readOnlyHint); every other tool is an op, which writes.
 */
export interface Manifest {
  fingerprint: string
  tools: (ToolDefinition & { annotations?: { readOnlyHint: true } })[]
}

export interface ExecutorOptions {
  doc: Y.Doc
  plugins: Plugin[]
  /** This tab's person: the agent acts for them (map.showArea changes their view). */
  person: Actor
  /** This person's camera, while the canvas is shown. */
  view: () => ViewController | undefined
  /** What this person has selected. */
  selection: () => string[]
  /** The read-only tools this browser runs. */
  tools: ToolDef[]
}

export class Executor {
  readonly runtime: Runtime
  /** This page load. A snapshot's revision counts from it. */
  readonly generation = crypto.randomUUID()
  private revision = 0
  private opts: ExecutorOptions
  private tools: ToolRunner
  /** What undoing each of the agent's changes needs, oldest first. Lost on reload. */
  private undos: TurnUndo[] = []
  private lastAdd: { id: string; at: number } | undefined

  constructor(opts: ExecutorOptions) {
    this.opts = opts
    this.runtime = new Runtime({ doc: opts.doc, plugins: opts.plugins, actor: EXTERNAL_AGENT })
    this.tools = new ToolRunner(opts.tools)
    opts.doc.on('update', () => this.revision++)
  }

  /** Every op an agent may run (not hidden, not only for people) and every read-only tool. */
  manifest(): Manifest {
    const ops = this.runtime.registry.ops().filter((op) => !op.hidden && op.risk !== 'high')
    const reads = exportToolDefs(this.tools.list()).map((t) => ({ ...t, annotations: { readOnlyHint: true as const } }))
    const tools = [...exportTools(ops), ...reads]
    return { fingerprint: hash(stableJson(tools)), tools }
  }

  /** The board as data: objects with all their stored fields, the person's selection, view and map views. */
  snapshot({ ids, limit = SNAPSHOT_LIMIT }: { ids?: string[]; limit?: number } = {}) {
    const all = this.runtime.board.list()
    const wanted = ids ? all.filter((o) => ids.includes(o.id)) : all
    const objects = wanted.slice(0, limit)
    const person = this.opts.person
    const views = new Views(this.opts.doc)
    const maps = objects.flatMap((o) => {
      if (o.type !== 'map') return []
      const view = views.get(person.id, o.id)
      return [{ id: o.id, view: view ?? null, area: view ? areaOfView(view, o.w, o.h - MAP_HEADER_PX) : null }]
    })
    const missing = ids?.filter((id) => !this.runtime.board.get(id))
    return {
      generation: this.generation,
      revision: this.revision,
      person: { id: person.id, name: person.name },
      coordinates: "Canvas units: x grows to the right, y grows down; x and y are an object's top-left corner. Objects are bottom to top.",
      view: { center: this.opts.view()?.center() ?? null },
      selection: this.opts.selection(),
      objects,
      maps,
      total: wanted.length,
      ...(objects.length < wanted.length && { truncated: true }),
      ...(missing?.length && { missing }),
    }
  }

  /** Run one tool of the manifest by name: a read-only tool, or an op as the agent for this tab's person. */
  async call(name: string, input: unknown, client?: string) {
    const read = this.tools.list().find((t) => toolNameOf(t.id) === name)
    if (read) return bounded(await this.tools.run(read.id, input))
    this.runtime.view = this.opts.view()
    const recent = this.lastAdd && Date.now() - this.lastAdd.at < NEXT_TO_MS ? this.runtime.board.get(this.lastAdd.id) : undefined
    const turn = new TurnLog()
    const record = await callOp(this.runtime, name, (input ?? {}) as { ids?: unknown; args?: unknown }, {
      actor: this.actor(client),
      turn,
      center: this.runtime.view?.center(),
      nextTo: recent,
    })
    const undo = record.status === 'applied' && turn.undo(this.runtime)
    if (undo) this.undos.push(undo)
    const added = record.created?.at(-1)
    if (added) this.lastAdd = { id: added, at: Date.now() }
    return { status: record.status, ...(record.error && { error: record.error }), ...(record.created && { created: record.created }), revision: this.revision }
  }

  /** Undo the agent's last change in this tab. Refused, and kept, when someone has changed its objects since. */
  async undo(client?: string) {
    const undo = this.undos.at(-1)
    if (!undo) return { status: 'failed', error: 'Nothing to undo: no change by an external agent since this tab loaded.' }
    const record = await this.runtime.invoke('agent.revert', { kind: 'canvas' }, undo, { actor: this.actor(client) })
    if (record.status === 'applied') this.undos.pop()
    return { status: record.status, ...(record.error && { error: record.error }), revision: this.revision }
  }

  private actor(client: string | undefined): Actor {
    return { ...EXTERNAL_AGENT, ...(client && { name: client }), onBehalfOf: this.opts.person.id }
  }
}

/**
 * A result small enough to send to a model: building footprints or a country's outline can be megabytes. Map
 * layers fetch their own data, so the agent needs only what is there.
 */
export function bounded(out: unknown): unknown {
  const json = JSON.stringify(out) ?? 'null'
  if (json.length <= MAX_RESULT_CHARS) return out
  const fc = out as { type?: unknown; features?: { properties?: unknown }[] }
  if (fc?.type === 'FeatureCollection' && Array.isArray(fc.features)) {
    return {
      type: 'FeatureCollection',
      truncated: true,
      count: fc.features.length,
      sample: fc.features.slice(0, 5).map((f) => f.properties ?? null),
      note: 'Too large to send whole: the number of features and the properties of the first 5. To show them, add the layer to a map.',
    }
  }
  return { truncated: true, chars: json.length, preview: json.slice(0, MAX_RESULT_CHARS) }
}

/** FNV-1a, as hex: tells manifests apart, not a secret. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16).padStart(8, '0')
}
