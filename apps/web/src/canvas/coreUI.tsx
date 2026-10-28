import { useLayoutEffect, useRef } from 'react'
import { NoteIcon, ShapesIcon, TextTIcon } from '@phosphor-icons/react'
import type { StickyObject, TextObject } from '@ttx/core'
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
  frameStyle: (o) => {
    const color = PALETTE[o.color ?? DEFAULT_BOX_COLOR]
    return { background: color.fill, borderColor: color.stroke }
  },
  tool: { key: 'R', label: 'Box', Icon: ShapesIcon },
})

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
