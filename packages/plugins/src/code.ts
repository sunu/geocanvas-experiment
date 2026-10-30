import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject, type BoardTx, type OpContext } from '@ttx/core'
import {
  accepts,
  ACCEPTS,
  codeOutput,
  codeRun,
  errorText,
  hashSource,
  KIND_NAMES,
  MAX_STDOUT,
  NEW_FOLLOWER,
  stripAnsi,
  tail,
  type CodeOutput,
  type CodeRun,
  type ExecResult,
} from './codeOutput.js'
import { applyLinks, personOf, planLinks, renderLinks, type LinkPlan } from './links/propagate.js'
import { factsOf } from './links/roots.js'
import type { MapBoardObject } from './map.js'
import { UPLOAD_FEATURES_TOOL } from './map.js'
import { newLayerId, type MapLayer } from './mapLayers.js'

/**
 * Code cells (plans/plan-021.md): a short Python snippet, run on the person's own JupyterHub by their browser
 * (apps/web/src/code/), and its output. No React and no Jupyter here. The cell always shows its own output;
 * other objects can show it too: a map as a layer (the layer's `from` is the cell), an input, an image, a text
 * or a sticky note through a link (links/recipes.ts). Each follower takes some kinds of output (ACCEPTS); a run
 * that gives another kind, or fails, leaves it as it was, and the UI says so (codeOutput.ts, followerState).
 */

/** The browser tool that runs code (apps/web/src/code/execute.ts). Environments without a hub login lack it. */
export const CODE_EXECUTE_TOOL = 'code.execute'

/**
 * code.execute as the model sees it, without its `run`: the browser's tool (apps/web/src/code/execute.ts) runs it
 * on the person's hub, and the room's agent gets a tool that asks the asker's tab to run it (agent/relay.ts).
 */
export const codeExecuteSpec = {
  id: CODE_EXECUTE_TOOL,
  title: 'Run Python code',
  description:
    "Run Python code on the person's JupyterHub and get its output (features, a table, an image, text, a number) or its error, without changing the board. " +
    'Use it to test code before code.add or code.run. The last expression is the output, or call ttx.show(value).',
  input: z.object({
    source: z.string().max(20_000),
    /** Run again even if the same code ran a moment ago (a person's Run). */
    fresh: z.boolean().optional(),
  }),
  output: 'code.result',
  cache: false,
} as const

export type CodeBoardObject = AnyObject & { type: 'code'; title: string; language: 'python'; source: string; output?: CodeOutput; run?: CodeRun }

const oneCell = { kind: 'objects', types: ['code'], min: 1, max: 1 } as const
const onlyId = (ctx: { target: { kind: string; ids?: string[] } }) => (ctx.target.kind === 'objects' ? ctx.target.ids![0]! : '')
const who = (ctx: OpContext) => ctx.actor.name ?? (ctx.actor.kind === 'agent' ? 'Agent' : ctx.actor.id)
const NO_HUB = 'Running code needs a JupyterHub login in this browser: connect one in the user menu.'

const source = z.string().max(20_000).describe('Python code. The last expression is the output, or call ttx.show(value). See the run-code skill.')

/** Run the code with this environment's tools. Throws only when it cannot run at all (no hub login). */
async function execute(ctx: OpContext, code: string): Promise<ExecResult> {
  if (!ctx.tools?.tool(CODE_EXECUTE_TOOL)) throw new Error(NO_HUB)
  // A person's Run always runs; an agent's code.add may reuse the test run it made a moment ago.
  return ctx.tools.run<ExecResult>(CODE_EXECUTE_TOOL, { source: code, fresh: ctx.actor.kind === 'user' }, { signal: ctx.signal })
}

/** What a run writes: always the run; the output only when it worked and gave one. */
function record(ctx: OpContext, code: string, result: ExecResult): { run: CodeRun; output?: CodeOutput } {
  const at = Date.now()
  const by = who(ctx)
  const sourceHash = hashSource(code)
  const stdout = result.stdout ? tail(stripAnsi(result.stdout), MAX_STDOUT) : undefined
  const run: CodeRun = { status: result.ok ? 'ok' : 'error', at, by, ms: Math.round(result.ms), sourceHash, ...(stdout && { stdout }), ...(!result.ok && { error: result.error }) }
  return { run, ...(result.ok && result.output && { output: { ...result.output, at, by, sourceHash } }) }
}

/** An agent's failed run is not written: it gets the error and fixes the code. A person's is kept on the cell. */
function refuseForAgent(ctx: OpContext, result: ExecResult) {
  if (!result.ok && ctx.actor.kind !== 'user') throw new Error(`The code failed:\n${errorText(result.error)}${result.stdout ? `\nstdout:\n${tail(result.stdout, 500)}` : ''}`)
}

/** Why `follower` cannot show this output, or undefined when it can. */
function mismatch(follower: AnyObject, output: CodeOutput | undefined): string | undefined {
  const kinds = ACCEPTS[follower.type]
  if (!kinds) return `A ${follower.type} cannot show code output; ${Object.keys(ACCEPTS).join(', ')} can.`
  if (!output) return 'The cell has no output yet: run it first.'
  if (!kinds.includes(output.kind)) return `A ${follower.type} shows ${kinds.map((k) => KIND_NAMES[k]).join(' or ')}; the code gives ${KIND_NAMES[output.kind]}.`
  return undefined
}

/** The layer a map gets for a cell's features. */
const codeLayer = (cell: { id: string; title: string }, output: CodeOutput): MapLayer => ({
  id: newLayerId(),
  tool: UPLOAD_FEATURES_TOOL,
  input: { fileId: output.uploadId },
  title: cell.title,
  from: cell.id,
})

/** The patches that show `output` on everything that follows the cell: its map layers and its linked objects. */
async function planFollowers(ctx: OpContext, cell: CodeBoardObject): Promise<{ layers: Record<string, MapLayer[]>; links: LinkPlan }> {
  const layers: Record<string, MapLayer[]> = {}
  const output = cell.output
  if (output && accepts('map', output.kind)) {
    for (const map of ctx.board.list().filter((o): o is MapBoardObject => o.type === 'map')) {
      if (!map.layers?.some((l) => l.from === cell.id)) continue
      layers[map.id] = map.layers.map((l) => (l.from === cell.id ? { ...l, input: { ...l.input, fileId: output.uploadId } } : l))
    }
  }
  return { layers, links: await planLinks(ctx, cell) }
}

function applyFollowers(tx: BoardTx, { layers, links }: Awaited<ReturnType<typeof planFollowers>>) {
  for (const [id, l] of Object.entries(layers)) if (tx.get(id)) tx.update({ [id]: { layers: l } })
  applyLinks(tx, links)
}

/**
 * What makes `follower` show the cell (as it will be): a layer on a map, else a link rendered at once. As a link
 * plan, so a map's view fits the features for the person who asked, as links do.
 */
async function planShow(ctx: OpContext, cell: CodeBoardObject, follower: AnyObject): Promise<LinkPlan> {
  const person = personOf(ctx)
  const output = cell.output!
  if (follower.type === 'map') {
    const [west, south, east, north] = output.bbox ?? []
    const view = west === undefined ? undefined : { west, south: south!, east: east!, north: north! }
    const layers = [...((follower as MapBoardObject).layers ?? []), codeLayer(cell, output)]
    return { patches: [{ id: follower.id, set: { layers }, ...(view && { view }) }], ...(person && { person }) }
  }
  const linked = { ...follower, link: { from: cell.id, recipe: `code.${follower.type}` } }
  const [patch] = renderLinks(await factsOf(ctx, cell), [linked])
  return { patches: [{ ...patch!, set: { link: linked.link, ...patch!.set } }], ...(person && { person }) }
}

/** The summary an op gives the agent: what the code gave, and what it means for the followers. */
function outcome(title: string, run: CodeRun, output: CodeOutput | undefined, followers: AnyObject[]): string {
  if (run.status === 'error') return `"${title}" failed: ${run.error ? errorText(run.error) : 'unknown error'}`
  const gave = output ? `"${title}" gave ${output.summary}` : `"${title}" ran and gave no output`
  const kept = followers.filter((f) => output && !accepts(f.type, output.kind))
  return kept.length ? `${gave}. ${kept.map((f) => f.name ?? f.type).join(', ')} still show the earlier result: they take other kinds.` : gave
}

/** Objects that show this cell: maps with a layer from it, and objects linked to it. */
export const followersOf = (objects: AnyObject[], cellId: string) =>
  objects.filter((o) => o.link?.from === cellId || (o.type === 'map' && (o as MapBoardObject).layers?.some((l) => l.from === cellId)))

interface AddPlan {
  args: z.infer<typeof addArgs>
  id: string
  run?: CodeRun
  output?: CodeOutput
  follower?: AnyObject
  showPlan?: LinkPlan
}

/** code.add with source: run it, then plan the cell and what shows it. */
async function runNew(ctx: OpContext, args: AddPlan['args'], id: string): Promise<AddPlan> {
  const follower = args.showOn ? ctx.board.get(args.showOn) : undefined
  if (args.showOn && !follower) throw new Error(`There is no object ${args.showOn}`)
  const result = await execute(ctx, args.source)
  refuseForAgent(ctx, result)
  const ran = record(ctx, args.source, result)
  const why = follower && mismatch(follower, ran.output)
  if (why && ctx.actor.kind !== 'user') throw new Error(`${why} Change the code, or leave out showOn.`)
  const cell = { id, type: 'code', title: args.title, language: 'python', source: args.source, ...ran } as CodeBoardObject
  return { args, id, ...ran, follower, showPlan: follower && !why ? await planShow(ctx, cell, follower) : undefined }
}

const placement = {
  x: z.number().default(0).meta({ advanced: true }),
  y: z.number().default(0).meta({ advanced: true }),
  w: z.number().positive().optional().meta({ advanced: true }),
  h: z.number().positive().optional().meta({ advanced: true }),
}
const SIZE = { w: 420, h: 320 }

const addArgs = z.object({
  title: z.string().min(1).max(80).default('Code').describe('What the code makes, e.g. "Kathmandu 10 km buffer"'),
  source: source.default(''),
  showOn: z.string().optional().describe('Id of a map (or input, image, text, sticky) to show the output on'),
  ...placement,
})

export const codePlugin = definePlugin({
  id: 'code',
  title: 'Code',
  dependsOn: ['map', 'links'],
  objectTypes: [
    {
      type: 'code',
      title: 'Code',
      description: 'A Python snippet run on JupyterHub, and its output (features, a table, an image, text). Maps and other objects can show the output.',
      // Its own code.add below runs the code first.
      addable: false,
      fields: z.object({
        title: z.string().min(1).max(80),
        language: z.literal('python').default('python'),
        source: z.string(),
        output: codeOutput.optional(),
        run: codeRun.optional(),
      }),
      defaultSize: SIZE,
      layer: 'top',
      summarize: (o) => {
        const c = o as CodeBoardObject
        const state = c.run?.status === 'error' ? `latest run failed (${c.run.error?.ename}); ` : ''
        return `code "${c.title}": ${state}${c.output ? `output ${c.output.summary}` : 'no output yet'}\n${tail(c.source, 600)}`
      },
    },
  ],
  ops: [
    defineOp({
      id: 'code.add',
      tools: [CODE_EXECUTE_TOOL],
      title: 'Add code',
      description:
        'Add a Python code cell, run it on JupyterHub and show its output, for what no other op does: geometry (a buffer, an intersection), ' +
        'a STAC query, a computation. With showOn, the output is also shown on that object: features as a layer on a map or as an input area, ' +
        'an image on an image object, text on a text or sticky note. If the code fails nothing is added and you get the error: fix the code and call again. ' +
        'Read the run-code skill first.',
      target: { kind: 'canvas' },
      args: addArgs,
      nl: { examples: ['add a code cell', 'write python to buffer this point by 10 km'] },
      // Sync without source, so the canvas's tool can draw an empty cell with dispatch.
      prepare(ctx, args): AddPlan | Promise<AddPlan> {
        // The id is made here, so a follower's link can name the cell before it exists.
        const id = crypto.randomUUID()
        if (!args.source.trim()) {
          if (args.showOn) throw new Error('Give source to show its output on an object')
          return { args, id }
        }
        return runNew(ctx, args, id)
      },
      apply(tx, { args, id, run, output, showPlan }) {
        const { showOn: _showOn, w, h, ...fields } = args
        tx.add('code', { ...fields, language: 'python', ...(run && { run }), ...(output && { output }), w: w ?? SIZE.w, h: h ?? SIZE.h }, id)
        if (showPlan) applyLinks(tx, showPlan)
      },
      describePlan: ({ args, run, output, follower, showPlan }) =>
        run
          ? outcome(args.title, run, output, follower && !showPlan ? [follower] : []) + (showPlan ? `; shown on ${follower!.name ?? follower!.type} ${follower!.id}` : '')
          : `Add the code cell "${args.title}"`,
    }),
    defineOp({
      id: 'code.run',
      tools: [CODE_EXECUTE_TOOL],
      title: 'Run code',
      description:
        'Run the selected code cell on JupyterHub, with new source if given, and show the new output on the objects that follow it. ' +
        'If it fails nothing changes and you get the error: fix the code and call again.',
      target: oneCell,
      args: z.object({ source: source.optional() }),
      async prepare(ctx, args) {
        const cell = ctx.board.get(onlyId(ctx)) as CodeBoardObject
        const code = args.source ?? cell.source
        const result = await execute(ctx, code)
        refuseForAgent(ctx, result)
        const ran = record(ctx, code, result)
        const next = { ...cell, source: code, ...ran } as CodeBoardObject
        const followers = followersOf(ctx.board.list(), cell.id)
        return { id: cell.id, title: cell.title, source: code, ...ran, followers, propagate: ran.output ? await planFollowers(ctx, next) : undefined }
      },
      apply(tx, { id, source, run, output, propagate }) {
        tx.update({ [id]: { source, run, ...(output && { output }) } })
        if (propagate) applyFollowers(tx, propagate)
      },
      describePlan: ({ title, run, output, followers }) => outcome(title, run, output, followers),
    }),
    defineOp({
      id: 'code.setSource',
      title: 'Edit code',
      description: 'Change the code of a cell without running it.',
      hidden: true,
      gesture: true,
      target: oneCell,
      args: z.object({ source: z.string().max(20_000) }),
      apply: (tx, { source }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { source } }),
    }),
    defineOp({
      id: 'code.show',
      title: 'Show code output on',
      description:
        "Show the selected code cell's output on another object: features on a map (a layer) or an input, an image on an image object, text on a text or sticky note. " +
        'Give `on` for an object on the board, or `new: true` for a new one beside the cell (a map, an image or a sticky note, by the kind of output).',
      target: oneCell,
      args: z
        .object({
          on: z.string().optional().describe('Id of the object to show the output on'),
          new: z.boolean().optional().describe('Add a new object for it beside the cell instead'),
        })
        .refine((a) => !!a.on !== !!a.new, 'Give either on or new'),
      async prepare(ctx, args) {
        const cell = ctx.board.get(onlyId(ctx)) as CodeBoardObject
        if (args.new) {
          if (!cell.output) throw new Error('The cell has no output yet: run it first.')
          const type = NEW_FOLLOWER[cell.output.kind]
          if (!type) throw new Error(`${KIND_NAMES[cell.output.kind].replace(/^./, (c) => c.toUpperCase())} shows only in its cell.`)
          // Made here, so the show plan can name it; apply adds it first, in the same step.
          const size = ctx.registry.objectType(type)!.defaultSize
          const added = { id: crypto.randomUUID(), type, x: cell.x + cell.w + 24, y: cell.y, ...size }
          return { added, links: await planShow(ctx, cell, added as AnyObject) }
        }
        const follower = ctx.board.get(args.on!)
        if (!follower) throw new Error(`There is no object ${args.on}`)
        const why = mismatch(follower, cell.output)
        if (why) throw new Error(why)
        if (followersOf([follower], cell.id).length) throw new Error(`${follower.name ?? follower.type} already shows this cell`)
        return { links: await planShow(ctx, cell, follower) }
      },
      apply(tx, { added, links }) {
        if (added) {
          const { id, type, ...rect } = added
          tx.add(type, rect, id)
        }
        applyLinks(tx, links)
      },
    }),
  ],
})
