import { z } from 'zod'
import { contains, defineOp, definePlugin, framedBy, readingOrder, UPLOAD_ID, type AnyObject, type OpContext } from '@ttx/core'

/**
 * Reports (agent-docs/tasks/reports.md): a document made from the board. A report is an object on the canvas
 * with a page size and an ordered list of blocks: headings, rich text, images, dividers, page breaks, and items that show an
 * object of the board, live or frozen. No React here: the widget and report mode are in apps/web/src/reports/.
 *
 * An item keeps its source's id (`sourceId`) and only reads the source; adding it never changes the source, and
 * one object can be in several reports. It is not a plan-013 link, which lives on a follower and rewrites it.
 * `blocks` is replaced as a whole, as a map's `layers` are: two people changing one report at the same moment
 * can lose a change. Report editing mostly happens in focus, where it is private until Share.
 */

export const PAPERS = ['a4', 'letter'] as const
export const ORIENTATIONS = ['portrait', 'landscape'] as const
export type Paper = (typeof PAPERS)[number]
export type Orientation = (typeof ORIENTATIONS)[number]

/** A page's size in CSS px at 96 per inch, portrait; landscape swaps the sides. */
export const PAGE_SIZE: Record<Paper, { w: number; h: number }> = { a4: { w: 794, h: 1123 }, letter: { w: 816, h: 1056 } }

/** A report page's size in CSS px, for its paper and orientation. */
export function pageSize(paper: Paper, orientation: Orientation): { w: number; h: number } {
  const { w, h } = PAGE_SIZE[paper]
  return orientation === 'landscape' ? { w: h, h: w } : { w, h }
}

const span = z.union([z.literal(1), z.literal(2)]).describe('1: one of the two columns; 2: the full width')
const blockId = z.string().min(1).describe("The block's id, from the report's summary")
const imageId = z.string().regex(UPLOAD_ID).describe('Id of an uploaded image: the <id> in its link /uploads/<id>')

/** Rich text: a ProseMirror document (the editor's JSON). Only its top level is checked here. */
const richDoc = z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).loose()

/** What a frozen item keeps of its source, as it was when frozen. Each type fills what it shows (reports.md §3.3). */
const frozen = z.object({
  at: z.number().describe('When it was frozen, in ms since 1970'),
  text: z.string().optional().describe('Text it showed: a text or sticky note, a frame heading, an area of interest'),
  imageId: imageId.optional().describe('A picture of it, e.g. a map'),
  credits: z.string().optional().describe("The picture's credits, printed under it"),
  data: z.record(z.string(), z.unknown()).optional().describe('The data a widget showed'),
})

const content = [
  z.object({ kind: z.literal('heading'), text: z.string().max(200), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1) }),
  z.object({ kind: z.literal('text'), doc: richDoc }),
  z.object({ kind: z.literal('image'), imageId }),
  z.object({ kind: z.literal('divider') }),
  z.object({ kind: z.literal('pageBreak') }),
  z.object({
    kind: z.literal('item'),
    sourceId: z.string().min(1).describe('The object of the board it shows'),
    mode: z.enum(['live', 'frozen']).default('live'),
    frozen: frozen.optional(),
  }),
] as const

const block = z.discriminatedUnion(
  'kind',
  content.map((c) => c.extend({ id: z.string().min(1), span })) as unknown as [
    z.ZodObject<{ id: z.ZodString; span: typeof span; kind: z.ZodLiteral<'heading'> }>,
    ...z.ZodObject<{ id: z.ZodString; span: typeof span }>[],
  ],
)

export type Frozen = z.infer<typeof frozen>
export type Block =
  | { id: string; span: 1 | 2; kind: 'heading'; text: string; level: 1 | 2 | 3 }
  | { id: string; span: 1 | 2; kind: 'text'; doc: RichDoc }
  | { id: string; span: 1 | 2; kind: 'image'; imageId: string }
  | { id: string; span: 1 | 2; kind: 'divider' }
  /** What follows starts a new page. */
  | { id: string; span: 1 | 2; kind: 'pageBreak' }
  | { id: string; span: 1 | 2; kind: 'item'; sourceId: string; mode: 'live' | 'frozen'; frozen?: Frozen }
export type RichDoc = z.infer<typeof richDoc>
export type ReportBoardObject = AnyObject & { type: 'report'; paper: Paper; orientation: Orientation; blocks: Block[]; titleFrom?: string }

/**
 * The report's title, on its page and in pickers: the name someone gave it, else the title of the frame it was
 * made from (`titleFrom`, live: a template frame's title follows its event), else "Untitled report".
 */
export function reportTitle(report: ReportBoardObject, frame?: AnyObject): string {
  const f = frame as (AnyObject & { title?: string }) | undefined
  return report.name || f?.name || f?.title || 'Untitled report'
}

/** Plain text as a rich text document: one paragraph per blank-line-separated part. */
export function textDoc(text: string): RichDoc {
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim())
  return { type: 'doc', content: paragraphs.map((p) => ({ type: 'paragraph', ...(p && { content: [{ type: 'text', text: p }] }) })) }
}

/** The plain text of a rich text document, for summaries. */
export function docText(doc: RichDoc): string {
  const walk = (n: unknown): string => {
    if (!n || typeof n !== 'object') return ''
    const node = n as { text?: unknown; content?: unknown[] }
    return typeof node.text === 'string' ? node.text : (node.content ?? []).map(walk).join(node.content?.length ? ' ' : '')
  }
  return walk(doc).replace(/\s+/g, ' ').trim()
}

/** Headings, dividers, page breaks, frames (they show as a heading) and maps take the full width; the rest one column. */
const FULL_WIDTH_SOURCES = new Set(['frame', 'map'])
const spanFor = (kind: Block['kind'], sourceType?: string): 1 | 2 =>
  kind === 'heading' || kind === 'divider' || kind === 'pageBreak' || (kind === 'item' && FULL_WIDTH_SOURCES.has(sourceType ?? '')) ? 2 : 1

const newId = () => crypto.randomUUID().slice(0, 8)
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

const oneReport = { kind: 'objects', types: ['report'], min: 1, max: 1 } as const

/** Space between objects and the new report made for them, in canvas units. */
const NEW_REPORT_GAP = 48

function reportOf(ctx: OpContext, id?: string): ReportBoardObject {
  const rid = id ?? (ctx.target.kind === 'objects' ? ctx.target.ids[0] : undefined)
  const report = rid ? ctx.board.get(rid) : undefined
  if (report?.type !== 'report') throw new Error(rid ? `Report ${rid} was not found on the board.` : 'Choose a report.')
  return report as ReportBoardObject
}

function blockIn(report: ReportBoardObject, id: string): Block {
  const b = report.blocks.find((b) => b.id === id)
  if (!b) throw new Error(`Block ${id} was not found in the report.`)
  return b
}

const withBlock = (report: ReportBoardObject, id: string, patch: Partial<Block>): Block[] =>
  report.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b))

const insertAt = <T>(list: T[], items: T[], index?: number) => {
  const at = index === undefined ? list.length : Math.max(0, Math.min(list.length, index))
  return [...list.slice(0, at), ...items, ...list.slice(at)]
}

/**
 * The objects to add for a selection, in report order: each object, and for a frame the frame itself (it shows as
 * a heading), then the objects directly in it in reading order, then each frame inside it in the same way. The
 * report stays a flat list: nothing in it is a container. Reports are left out, and so is anything already in the
 * report or met twice.
 */
export function itemsToAdd(selected: AnyObject[], board: AnyObject[], already: Set<string>): AnyObject[] {
  const out: AnyObject[] = []
  const seen = new Set(already)
  const visit = (o: AnyObject) => {
    if (o.type === 'report' || seen.has(o.id)) return
    seen.add(o.id)
    out.push(o)
    if (o.type !== 'frame') return
    const inside = framedBy(o, board)
    for (const c of inside.filter((c) => c.type !== 'frame')) visit(c)
    for (const f of inside.filter((c) => c.type === 'frame')) visit(f)
  }
  for (const o of [...selected].sort(readingOrder)) visit(o)
  return out
}

/** What freezing keeps of an object that needs no browser to draw it; undefined for the others (maps, data widgets). */
export function freezeText(source: AnyObject, at = Date.now()): Frozen | undefined {
  const o = source as AnyObject & { text?: string; title?: string; value?: { name?: string } }
  if (source.type === 'text' || source.type === 'sticky') return { at, text: o.text ?? '' }
  if (source.type === 'frame') return { at, text: o.name || o.title || '' }
  if (source.type === 'input') return { at, text: `Area of interest: ${o.value?.name ?? 'not set'}` }
  return undefined
}

function describeBlock(b: Block): string {
  const width = b.span === 2 ? ', full width' : ''
  switch (b.kind) {
    case 'heading':
      return `${b.id} heading ${JSON.stringify(clip(b.text))}${width}`
    case 'text':
      return `${b.id} text ${JSON.stringify(clip(docText(b.doc)))}${width}`
    case 'image':
      return `${b.id} image ${b.imageId}${width}`
    case 'divider':
      return `${b.id} divider`
    case 'pageBreak':
      return `${b.id} page break`
    case 'item':
      return `${b.id} item: object ${b.sourceId}, ${b.mode}${b.mode === 'frozen' && !b.frozen ? ' (no copy yet)' : ''}${width}`
  }
}

/** A block to add, as an agent or the insert menu gives it: text can be plain or rich. */
const newBlock = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('heading'), text: z.string().max(200), level: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1) }),
  z.object({ kind: z.literal('text'), text: z.string().optional().describe('Plain text; blank lines separate paragraphs'), doc: richDoc.optional() }),
  z.object({ kind: z.literal('image'), imageId }),
  z.object({ kind: z.literal('divider') }),
  z.object({ kind: z.literal('pageBreak').describe('What follows starts a new page') }),
])

export const reportsPlugin = definePlugin({
  id: 'reports',
  title: 'Reports',
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'report',
      title: 'Report',
      description:
        'A report: a document made from the board, with a page size and blocks (headings, text, images, and items that show objects from the board, live or frozen). Name it with core.object.rename.',
      fields: z.object({
        // A new report starts on A4, portrait: forms fold these away, and report mode's Options panel changes them.
        paper: z.enum(PAPERS).default('a4').meta({ advanced: true }).describe('Paper size'),
        orientation: z.enum(ORIENTATIONS).default('portrait').meta({ advanced: true }).describe('Orientation'),
        blocks: z.array(block).default([]).meta({ advanced: true }).describe("The report's content, in reading order"),
        titleFrom: z.string().optional().meta({ advanced: true }).describe("A frame whose title is the report's title, until the report is renamed"),
      }),
      defaultSize: { w: 300, h: 424 },
      layer: 'top',
      summarize: (o) => {
        const { paper, orientation, blocks, titleFrom, name } = o as ReportBoardObject
        const page = `${paper === 'a4' ? 'A4' : 'Letter'} ${orientation}${titleFrom && !name ? `, titled after frame ${titleFrom}` : ''}`
        return blocks.length ? `${page}; ${blocks.length} blocks: ${blocks.map(describeBlock).join('; ')}` : `${page}; empty`
      },
    },
  ],
  ops: [
    defineOp({
      id: 'report.setPage',
      title: 'Report page settings',
      description: "Set the selected report's paper size (A4 or US Letter) and orientation (portrait or landscape).",
      target: oneReport,
      args: z.object({ paper: z.enum(PAPERS).optional().describe('Paper size'), orientation: z.enum(ORIENTATIONS).optional().describe('Orientation') }),
      nl: { aliases: ['page settings', 'paper size', 'orientation', 'landscape', 'portrait', 'A4', 'letter'] },
      // The form starts from the report's own page.
      defaults: (ctx) => {
        const report = reportOf(ctx)
        return { paper: report.paper, orientation: report.orientation }
      },
      prepare: (ctx, args) => ({ id: reportOf(ctx).id, ...args }),
      apply: (tx, { id, paper, orientation }) => tx.update({ [id]: { paper, orientation } }),
    }),
    defineOp({
      id: 'report.addItems',
      title: 'Add to report',
      description:
        'Add the selected objects to the end of a report as live items, or to a new report beside them when no report is given. ' +
        'A frame adds a heading (its title) followed by all its contents. Added to an empty report, a frame becomes the whole report: ' +
        "its title becomes the report's title and no heading is added. The objects remain on the board. Objects already in the report are skipped.",
      target: { kind: 'objects', min: 1 },
      args: z.object({
        reportId: z.string().min(1).optional().meta({ widget: 'report' }).describe('The report to add them to. Leave it out for a new report'),
        // Report mode's toolbar adds after the selected block; forms do not ask (`advanced`).
        index: z.number().int().optional().meta({ advanced: true }).describe('Where in the report. Default: at the end'),
      }),
      // With one report on the board, that one; otherwise a new report unless someone picks one.
      defaults: (ctx) => {
        const reports = ctx.board.list().filter((o) => o.type === 'report')
        return reports.length === 1 ? { reportId: reports[0]!.id } : {}
      },
      prepare(ctx, { reportId, index }) {
        const report = reportId ? reportOf(ctx, reportId) : undefined
        const blocks = report?.blocks ?? []
        const already = new Set(blocks.flatMap((b) => (b.kind === 'item' ? [b.sourceId] : [])))
        const selected = (ctx.target.kind === 'objects' ? ctx.target.ids : []).flatMap((id) => ctx.board.get(id) ?? [])
        let sources = itemsToAdd(selected, ctx.board.list(), already)
        if (!sources.length) throw new Error('Nothing to add. The selected objects are already in this report.')
        // One frame (with all its contents) into an empty report is the report: its title is the report's, not a heading.
        const [first] = sources
        const whole = !blocks.length && first!.type === 'frame' && sources.every((o) => o === first || contains(first!, o))
        if (whole) sources = sources.slice(1)
        const added: Block[] = sources.map((o) => ({ id: newId(), kind: 'item', sourceId: o.id, mode: 'live', span: spanFor('item', o.type) }))
        return {
          id: report?.id,
          // A new report goes to the right of the objects, top-aligned with them.
          at: report
            ? undefined
            : {
                x: Math.round(Math.max(...selected.map((o) => o.x + o.w)) + NEW_REPORT_GAP),
                y: Math.round(Math.min(...selected.map((o) => o.y))),
                ...ctx.registry.objectType('report')!.defaultSize,
              },
          blocks: insertAt(blocks, added, index),
          ...(whole && { titleFrom: first!.id }),
          count: added.length,
          name: report ? report.name || 'the report' : 'a new report',
        }
      },
      apply(tx, { id, at, blocks, titleFrom }) {
        if (id) tx.update({ [id]: { blocks, titleFrom } })
        else tx.add('report', { ...at, blocks, ...(titleFrom && { titleFrom }) })
      },
      describePlan: ({ count, name, titleFrom }) => `Added ${count} item${count === 1 ? '' : 's'} to ${name}${titleFrom ? ', titled after the frame' : ''}`,
    }),
    defineOp({
      id: 'report.addBlock',
      title: 'Add to report page',
      description: 'Add a heading, text, an image, a divider or a page break to the selected report.',
      target: oneReport,
      args: z.object({ block: newBlock.describe('What to add'), index: z.number().int().optional().describe('Where. Default: at the end') }),
      prepare(ctx, { block: b, index }) {
        const report = reportOf(ctx)
        let added: Block
        if (b.kind === 'text') {
          if (!b.doc && b.text === undefined) throw new Error('A text block needs text or a document.')
          added = { id: newId(), kind: 'text', doc: b.doc ?? textDoc(b.text!), span: spanFor('text') }
        } else added = { ...b, id: newId(), span: spanFor(b.kind) } as Block
        return { id: report.id, blocks: insertAt(report.blocks, [added], index) }
      },
      apply: (tx, { id, blocks }) => tx.update({ [id]: { blocks } }),
    }),
    defineOp({
      id: 'report.removeBlock',
      title: 'Remove from report',
      description: 'Remove a block from the selected report. Removing an item leaves its object on the board.',
      target: oneReport,
      args: z.object({ blockId }),
      prepare(ctx, { blockId: b }) {
        const report = reportOf(ctx)
        blockIn(report, b)
        return { id: report.id, blocks: report.blocks.filter((x) => x.id !== b) }
      },
      apply: (tx, { id, blocks }) => tx.update({ [id]: { blocks } }),
    }),
    defineOp({
      id: 'report.moveBlock',
      title: 'Move in report',
      description: 'Move a block of the selected report to another place in its order.',
      target: oneReport,
      args: z.object({ blockId, index: z.number().int().describe('Its new place, from 0') }),
      prepare(ctx, { blockId: b, index }) {
        const report = reportOf(ctx)
        const moved = blockIn(report, b)
        return { id: report.id, blocks: insertAt(report.blocks.filter((x) => x.id !== b), [moved], index) }
      },
      apply: (tx, { id, blocks }) => tx.update({ [id]: { blocks } }),
    }),
    defineOp({
      id: 'report.setSpan',
      title: 'Set block width',
      description: 'Make a block of the selected report one column wide, or the full width.',
      target: oneReport,
      args: z.object({ blockId, span }),
      prepare(ctx, { blockId: b, span: s }) {
        const report = reportOf(ctx)
        blockIn(report, b)
        return { id: report.id, blocks: withBlock(report, b, { span: s }) }
      },
      apply: (tx, { id, blocks }) => tx.update({ [id]: { blocks } }),
    }),
    defineOp({
      id: 'report.setItemMode',
      title: 'Freeze or unfreeze report item',
      description:
        'Set an item of the selected report to live (it shows its object as it is now) or frozen (as it was when frozen). ' +
        'Text, sticky notes, frames and areas of interest can be frozen directly. Maps and data widgets can only be frozen from the browser, which creates their image or data.',
      target: oneReport,
      args: z.object({ blockId, mode: z.enum(['live', 'frozen']), frozen: frozen.optional().meta({ advanced: true }).describe('The frozen copy, made by the browser') }),
      prepare(ctx, { blockId: b, mode, frozen: given }) {
        const report = reportOf(ctx)
        const item = blockIn(report, b)
        if (item.kind !== 'item') throw new Error(`Block ${b} is not an item, so it cannot be frozen.`)
        if (mode === 'live') return { id: report.id, blocks: withBlock(report, b, { mode }) }
        const source = ctx.board.get(item.sourceId)
        const copy = given ?? (source && freezeText(source))
        if (!copy) throw new Error(source ? `A ${ctx.registry.objectType(source.type)?.title.toLowerCase() ?? source.type} can only be frozen from the browser, which creates its image or data.` : 'The source object was removed, so there is nothing to freeze.')
        return { id: report.id, blocks: withBlock(report, b, { mode, frozen: copy } as Partial<Block>) }
      },
      apply: (tx, { id, blocks }) => tx.update({ [id]: { blocks } }),
    }),
    defineOp({
      id: 'report.setText',
      title: 'Edit report text',
      description: 'Replace the text of a heading or text block. Typing, one op log entry per gesture.',
      target: oneReport,
      hidden: true,
      gesture: true,
      args: z.object({ blockId, text: z.string().max(200).optional(), doc: richDoc.optional() }),
      prepare(ctx, { blockId: b, text, doc }) {
        const report = reportOf(ctx)
        const target = blockIn(report, b)
        if (target.kind === 'heading' && text !== undefined) return { id: report.id, blocks: withBlock(report, b, { text } as Partial<Block>) }
        if (target.kind === 'text' && doc) return { id: report.id, blocks: withBlock(report, b, { doc } as Partial<Block>) }
        throw new Error(target.kind === 'heading' ? `Block ${b} is a heading: give it text.` : target.kind === 'text' ? `Block ${b} is a text block: give it a document.` : `Block ${b} has no text to edit.`)
      },
      apply: (tx, { id, blocks }) => tx.update({ [id]: { blocks } }),
    }),
  ],
})
