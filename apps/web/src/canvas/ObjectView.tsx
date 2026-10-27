import { useLayoutEffect, useRef } from 'react'
import type { Board, BoardObject } from '../board/board'
import { MapObject } from '../map/MapObject'
import { DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_TEXT_COLOR, PALETTE } from './style'

type TextObject = Extract<BoardObject, { type: 'text' }>

/**
 * Texts whose height should be fitted to their content after the next render. Only the person
 * who changed a text (typing, size, width) fits it: if everyone did, people whose fonts measure
 * differently would keep overwriting each other's height.
 */
const needsFit = new Set<string>()
export const requestFit = (id: string) => needsFit.add(id)

/** One object on the canvas, in world coordinates. `layer` is its place in the stacking order. */
export function ObjectView({ board, object: o, layer, editing }: { board: Board; object: BoardObject; layer: number; editing: boolean }) {
  const color = o.type === 'box' ? PALETTE[o.color ?? DEFAULT_BOX_COLOR] : undefined
  return (
    <div
      data-id={o.id}
      className={`ttx-obj ttx-obj--${o.type} ${editing ? 'is-editing' : ''}`}
      style={{
        left: o.x,
        top: o.y,
        width: o.w,
        height: o.h,
        zIndex: layer,
        ...(color && { background: color.fill, borderColor: color.stroke }),
      }}
    >
      {o.type === 'text' && <TextContent board={board} object={o} editing={editing} />}
      {o.type === 'map' && <MapObject board={board} object={o} editing={editing} />}
    </div>
  )
}

function TextContent({ board, object: o, editing }: { board: Board; object: TextObject; editing: boolean }) {
  const measureRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!needsFit.delete(o.id)) return
    // offsetHeight is in world units: layout ignores the canvas transform.
    const h = measureRef.current!.offsetHeight
    if (Math.abs(h - o.h) > 1) board.update({ [o.id]: { h } })
  })

  // A trailing newline needs a character after it to take up a line; an empty text keeps one line.
  const shown = o.text.endsWith('\n') ? `${o.text}​` : o.text || ' '
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
            board.update({ [o.id]: { text: e.target.value } })
          }}
        />
      )}
    </div>
  )
}
