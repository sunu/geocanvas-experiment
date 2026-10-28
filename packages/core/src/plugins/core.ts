import { z } from 'zod'
import type { AnyObject } from '../doc/board.js'
import type { BoardTx } from '../doc/tx.js'
import { defineOp, type OpContext, type TargetRef } from '../ops/types.js'
import { COLORS, DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_STICKY_COLOR, DEFAULT_TEXT_COLOR, stepFontSize, type ColorName } from '../style.js'
import { definePlugin, type ObjectTypeDef } from './types.js'

/**
 * The builtin plugin: boxes, texts, and the ops that work on any object (move, delete, layer order)
 * and on this person's view. It uses the same plugin API as every other plugin.
 */

// color and fontSize are optional: objects made before they existed use the defaults in style.ts.
const colorField = z.enum(COLORS).optional()

export const boxType: ObjectTypeDef = {
  type: 'box',
  title: 'Box',
  description: 'A colored rectangle, e.g. a background or a frame for other objects.',
  fields: z.object({ color: colorField }),
  defaultSize: { w: 200, h: 120 },
  layer: 'bottom',
  defaultColor: DEFAULT_BOX_COLOR,
  summarize: (o) => `${(o as BoxObject).color ?? DEFAULT_BOX_COLOR}`,
}

export const textType: ObjectTypeDef = {
  type: 'text',
  title: 'Text',
  description: 'A text on the canvas. Its height follows its content.',
  fields: z.object({
    text: z.string().default('').describe('The text'),
    color: colorField,
    fontSize: z.number().positive().optional(),
  }),
  defaultSize: { w: 240, h: 40 },
  layer: 'top',
  defaultColor: DEFAULT_TEXT_COLOR,
  textSize: true,
  summarize: (o) => JSON.stringify((o as TextObject).text.slice(0, 200)),
}

export const stickyType: ObjectTypeDef = {
  type: 'sticky',
  title: 'Sticky note',
  description: 'A colored square note with text. Its size is set by hand; text that does not fit is cut off.',
  fields: z.object({
    text: z.string().default('').describe('The text'),
    color: colorField,
    fontSize: z.number().positive().optional(),
  }),
  defaultSize: { w: 200, h: 200 },
  layer: 'top',
  defaultColor: DEFAULT_STICKY_COLOR,
  textSize: true,
  summarize: (o) => JSON.stringify((o as StickyObject).text.slice(0, 200)),
}

export type BoxObject = AnyObject & { type: 'box'; color?: ColorName }
export type TextObject = AnyObject & { type: 'text'; text: string; color?: ColorName; fontSize?: number }
export type StickyObject = AnyObject & { type: 'sticky'; text: string; color?: ColorName; fontSize?: number }

const idsOf = (target: TargetRef) => (target.kind === 'objects' ? target.ids : [])
const rect = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).partial()

/** Position and size of objects. The canvas's drag, resize and text fit use it, many times per gesture. */
const setRect = defineOp({
  id: 'core.object.setRect',
  title: 'Set position and size',
  description: 'Set the position and size of objects, in canvas units.',
  target: { kind: 'objects' },
  hidden: true,
  gesture: true,
  args: z.object({ rects: z.record(z.string(), rect) }),
  apply(tx, { rects }, target) {
    const ids = new Set(idsOf(target))
    tx.update(Object.fromEntries(Object.entries(rects).filter(([id]) => ids.has(id))))
  },
})

const move = defineOp({
  id: 'core.object.move',
  title: 'Move',
  description: 'Move the selected objects by an offset in canvas units.',
  target: { kind: 'objects' },
  args: z.object({ dx: z.number().default(0).describe('Right, in canvas units'), dy: z.number().default(0).describe('Down, in canvas units') }),
  prepare: (ctx, { dx, dy }) =>
    Object.fromEntries(idsOf(ctx.target).map((id) => {
      const o = ctx.board.get(id)!
      return [id, { x: o.x + dx, y: o.y + dy }]
    })),
  apply: (tx, rects) => tx.update(rects),
})

const remove = defineOp({
  id: 'core.object.delete',
  title: 'Delete',
  description: 'Delete the selected objects.',
  target: { kind: 'objects' },
  args: z.object({}),
  nl: { aliases: ['remove'] },
  apply: (tx, _args, target) => tx.remove(idsOf(target)),
})

const duplicate = defineOp({
  id: 'core.object.duplicate',
  title: 'Duplicate',
  description: 'Copy the selected objects, next to the originals.',
  target: { kind: 'objects' },
  args: z.object({ offset: z.number().default(24).describe('Offset of the copies, in canvas units') }),
  prepare: (ctx, { offset }) => idsOf(ctx.target).map((id) => ({ source: ctx.board.get(id)!, offset })),
  apply(tx, copies) {
    for (const { source, offset } of copies) {
      const { id: _id, type, z: _z, ...fields } = source
      tx.add(type, { ...fields, x: source.x + offset, y: source.y + offset })
    }
  },
})

const layerOp = (id: string, title: string, description: string, run: (tx: BoardTx, ids: Set<string>) => void) =>
  defineOp({
    id,
    title,
    description,
    target: { kind: 'objects' },
    args: z.object({}),
    apply: (tx, _args, target) => run(tx, new Set(idsOf(target))),
  })

const layerOps = [
  layerOp('core.object.bringToFront', 'Bring to front', 'Draw the selected objects above all others.', (tx, ids) => tx.bringToFront(ids)),
  layerOp('core.object.sendToBack', 'Send to back', 'Draw the selected objects below all others.', (tx, ids) => tx.sendToBack(ids)),
  layerOp('core.object.bringForward', 'Bring forward', 'Draw the selected objects one place higher.', (tx, ids) => tx.step(ids, 1)),
  layerOp('core.object.sendBackward', 'Send backward', 'Draw the selected objects one place lower.', (tx, ids) => tx.step(ids, -1)),
]

/** Objects whose type has a color (`defaultColor`) or a text size (`textSize`). */
const styled = (ctx: OpContext, option: 'defaultColor' | 'textSize') =>
  idsOf(ctx.target).every((id) => {
    const o = ctx.board.get(id)
    return !!o && !!ctx.registry.objectType(o.type)?.[option]
  })
const colorOf = (ctx: OpContext, id: string): ColorName | undefined => {
  const o = ctx.board.get(id) as (AnyObject & { color?: ColorName }) | undefined
  return o && (o.color ?? ctx.registry.objectType(o.type)?.defaultColor)
}
const sizeOf = (o: AnyObject) => (o as AnyObject & { fontSize?: number }).fontSize ?? DEFAULT_FONT_SIZE

/** Ops on any type with a color or text size. They check the types themselves, since a target spec lists fixed types. */
function checkStyled(ctx: OpContext, option: 'defaultColor' | 'textSize') {
  if (!styled(ctx, option)) throw new Error(option === 'defaultColor' ? 'Only objects with a color can be colored' : 'Only objects with text have a text size')
}

const setColor = defineOp({
  id: 'core.object.setColor',
  title: 'Set color',
  description: 'Set the color of the selected objects (boxes and texts).',
  target: { kind: 'objects' },
  when: (ctx) => styled(ctx, 'defaultColor'),
  args: z.object({ color: z.enum(COLORS).meta({ widget: 'color' }).describe('Color') }),
  defaults: (ctx) => {
    const color = colorOf(ctx, idsOf(ctx.target)[0] ?? '')
    return color ? { color } : {}
  },
  prepare: (ctx, args) => (checkStyled(ctx, 'defaultColor'), args),
  apply: (tx, { color }, target) => tx.update(Object.fromEntries(idsOf(target).map((id) => [id, { color }]))),
})

const textTarget = { kind: 'objects', types: ['text'] } as const
const sizedTarget = { kind: 'objects' } as const

/**
 * Typing in a text or a sticky note. One op log entry per editing gesture. The id says text because op ids are
 * stored in the op log: it stays as it was when only texts had text.
 */
const setText = defineOp({
  id: 'text.setText',
  title: 'Set text',
  description: 'Replace the content of a text or a sticky note.',
  target: { kind: 'objects', types: ['text', 'sticky'], max: 1 },
  hidden: true,
  gesture: true,
  args: z.object({ text: z.string() }),
  apply: (tx, { text }, target) => tx.update({ [idsOf(target)[0]!]: { text } }),
})

const setFontSize = defineOp({
  id: 'text.setFontSize',
  title: 'Set text size',
  description: 'Set the font size of the selected texts, in canvas units.',
  target: sizedTarget,
  when: (ctx) => styled(ctx, 'textSize'),
  args: z.object({ fontSize: z.number().int().positive().describe('Font size') }),
  defaults: (ctx) => {
    const first = ctx.board.get(idsOf(ctx.target)[0] ?? '')
    return first ? { fontSize: sizeOf(first) } : {}
  },
  prepare: (ctx, args) => (checkStyled(ctx, 'textSize'), args),
  apply: (tx, { fontSize }, target) => tx.update(Object.fromEntries(idsOf(target).map((id) => [id, { fontSize }]))),
})

const stepSize = (dir: 1 | -1) =>
  defineOp<Record<string, never>, Record<string, { fontSize: number }>>({
    id: dir === 1 ? 'text.larger' : 'text.smaller',
    title: dir === 1 ? 'Larger text' : 'Smaller text',
    description: `Make the selected texts one size ${dir === 1 ? 'larger' : 'smaller'}.`,
    target: sizedTarget,
    when: (ctx) => styled(ctx, 'textSize'),
    args: z.object({}),
    prepare: (ctx) => {
      checkStyled(ctx, 'textSize')
      return Object.fromEntries(idsOf(ctx.target).map((id) => [id, { fontSize: stepFontSize(sizeOf(ctx.board.get(id)!), dir) }]))
    },
    apply: (tx, sizes) => tx.update(sizes),
  })

const viewOps = [
  defineOp({
    id: 'core.view.fitAll',
    title: 'Zoom to fit',
    description: 'Show every object on the board.',
    target: { kind: 'canvas' },
    args: z.object({}),
    applyView: (view) => view.fitAll(),
  }),
  defineOp({
    id: 'core.view.zoomToSelection',
    title: 'Zoom to selection',
    description: 'Show the selected objects.',
    target: { kind: 'objects' },
    args: z.object({}),
    applyView: (view, _args, target) => view.zoomTo(idsOf(target)),
  }),
  defineOp({
    id: 'core.view.resetZoom',
    title: 'Reset zoom',
    description: 'Zoom to 100%.',
    target: { kind: 'canvas' },
    args: z.object({}),
    applyView: (view) => view.resetZoom(),
  }),
]

export const corePlugin = definePlugin({
  id: 'core',
  title: 'Core',
  objectTypes: [boxType, textType, stickyType],
  ops: [setRect, move, remove, duplicate, ...layerOps, setColor, setText, setFontSize, stepSize(1), stepSize(-1), ...viewOps],
})
