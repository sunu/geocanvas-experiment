import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { FrameCornersIcon, NoteIcon, SquareIcon, TextTIcon } from '@phosphor-icons/react'
import type { BoxObject, FrameObject, StickyObject, TextObject } from '@ttx/core'
import { ObjectHeader } from './ObjectHeader'
import { registerObjectUI, registerWidget, type ObjectViewProps } from './registry'
import { COLORS, DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_STICKY_COLOR, DEFAULT_TEXT_COLOR, PALETTE } from './style'

/**
 * Texts whose height should be fitted to their content after the next render. Only the person
 * who changed a text (typing, size, width) fits it: if everyone did, people whose fonts measure
 * differently would keep overwriting each other's height.
 */
const needsFit = new Set<string>()
export const requestFit = (id: string) => needsFit.add(id)

registerObjectUI('box', {
  View: BoxView,
  frameStyle: (o) => {
    const color = PALETTE[o.color ?? DEFAULT_BOX_COLOR]
    // A line and an arrow are only a stroke (BoxView). The ellipse is the one exception to square corners on the canvas: it is its shape.
    if (o.shape === 'line' || o.shape === 'arrow') return {}
    return { background: color.fill, borderColor: color.stroke, ...(o.shape === 'ellipse' ? { borderRadius: '50%' } : {}) }
  },
  tool: { key: 'R', label: 'Rectangle', Icon: SquareIcon },
})

/** A line or an arrow runs corner to corner of the box, top left to bottom right, so the box's handles drag its ends. */
function BoxView({ object: o }: ObjectViewProps<BoxObject>) {
  if (o.shape !== 'line' && o.shape !== 'arrow') return null
  const ink = PALETTE[o.color ?? DEFAULT_BOX_COLOR].ink
  const head = `ttx-arrowhead-${o.id}`
  return (
    <svg className="ttx-box-stroke" aria-hidden>
      {o.shape === 'arrow' && (
        <defs>
          <marker id={head} markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto">
            <path d="M0,0 L5,2.5 L0,5 z" fill={ink} />
          </marker>
        </defs>
      )}
      <line x1="0" y1="0" x2="100%" y2="100%" stroke={ink} strokeWidth="3" strokeLinecap="round" markerEnd={o.shape === 'arrow' ? `url(#${head})` : undefined} />
    </svg>
  )
}

// A frame is drawn under what it holds (its type's layer is 'bottom'); its title is in the label row above it.
registerObjectUI('frame', {
  View: FrameView,
  frameStyle: () => ({ background: 'var(--ttx-frame-fill)', borderColor: 'var(--ttx-border)' }),
  tool: { key: 'A', label: 'Frame', Icon: FrameCornersIcon },
})

function FrameView({ object: o }: ObjectViewProps<FrameObject>) {
  return <ObjectHeader icon={<FrameCornersIcon size={14} aria-hidden />} title={o.title || 'Frame'} />
}

registerObjectUI('text', {
  View: TextView,
  tool: { key: 'T', label: 'Text', Icon: TextTIcon },
  editable: true,
  editOnCreate: true,
  widthOnly: true,
  isEmpty: (o) => !o.text.trim(),
})

// No isEmpty: an empty note is still a visible note on the board, unlike an empty text.
registerObjectUI('sticky', {
  View: StickyView,
  tool: { key: 'S', label: 'Sticky note', Icon: NoteIcon },
  editable: true,
  editOnCreate: true,
})

/** A color in a form: the same swatches as the style panel. */
registerWidget('color', ({ value, onChange }) => (
  <div className="ttx-field__swatches">
    {COLORS.map((c) => (
      <button
        key={c}
        type="button"
        className={`ttx-swatch ${value === c ? 'is-on' : ''}`}
        style={{ background: PALETTE[c].ink }}
        title={c}
        aria-label={`Color ${c}`}
        aria-pressed={value === c}
        onClick={() => onChange(c)}
      />
    ))}
  </div>
))

function TextView({ runtime, object: o, editing }: ObjectViewProps<TextObject>) {
  const measureRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!needsFit.delete(o.id)) return
    // offsetHeight is in world units: layout ignores the canvas transform.
    const h = measureRef.current!.offsetHeight
    if (Math.abs(h - o.h) > 1) runtime.dispatch('core.object.setRect', { kind: 'objects', ids: [o.id] }, { rects: { [o.id]: { h } } })
  })

  // A trailing newline needs a character after it to take up a line; an empty text keeps one line.
  const shown = o.text.endsWith('\n') ? `${o.text}​` : o.text || ' '
  return (
    <div className="ttx-text-wrap" style={{ fontSize: o.fontSize ?? DEFAULT_FONT_SIZE, color: PALETTE[o.color ?? DEFAULT_TEXT_COLOR].ink }}>
      {/* Sets the height; hidden under the editor while editing. */}
      <div ref={measureRef} className="ttx-text" style={editing ? { visibility: 'hidden' } : undefined}>
        {shown}
      </div>
      {editing && (
        <textarea
          className="ttx-text ttx-text--edit"
          autoFocus
          value={o.text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => {
            requestFit(o.id)
            runtime.dispatch('text.setText', { kind: 'objects', ids: [o.id] }, { text: e.target.value })
          }}
        />
      )}
    </div>
  )
}

/** The note's text: dark on every fill, so it stays readable whatever the note's color. */
const STICKY_INK = PALETTE.ink.ink

/** A colored square with text. Its size is set by hand; text that does not fit is cut off at the bottom. */
function StickyView({ runtime, object: o, editing }: ObjectViewProps<StickyObject>) {
  const color = PALETTE[o.color ?? DEFAULT_STICKY_COLOR]
  return (
    <div
      className="ttx-sticky"
      style={{ background: `color-mix(in srgb, ${color.fill} 60%, ${color.stroke})`, fontSize: o.fontSize ?? DEFAULT_FONT_SIZE, color: STICKY_INK }}
    >
      {editing ? (
        <textarea
          className="ttx-sticky__text ttx-sticky__text--edit"
          autoFocus
          aria-label="Sticky note text"
          value={o.text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => runtime.dispatch('text.setText', { kind: 'objects', ids: [o.id] }, { text: e.target.value })}
        />
      ) : (
        <div className="ttx-sticky__text">{o.text}</div>
      )}
    </div>
  )
}
