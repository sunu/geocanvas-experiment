import { useLayoutEffect, useRef } from 'react'
import { TextTIcon } from '@phosphor-icons/react'
import { DEFAULT_FONT_SIZE, PALETTE, type ColorName } from '../canvas/style'
import type { ObjectTypeDef, ObjectViewProps } from './types'

declare module '../board/board' {
  interface ObjectFields {
    /** color and fontSize are optional: texts made before they existed use the defaults. */
    text: { text: string; color?: ColorName; fontSize?: number }
  }
}

const DEFAULT_COLOR: ColorName = 'ink'

export const text: ObjectTypeDef<'text'> = {
  type: 'text',
  label: 'Text',
  key: 't',
  Icon: TextTIcon,
  size: { w: 240, h: 40 },
  layer: 'top',
  create: (r) => ({ type: 'text', ...r, text: '' }),
  View: TextView,
  editable: true,
  editOnCreate: true,
  widthOnly: true,
  defaultColor: DEFAULT_COLOR,
  textSize: true,
  isEmpty: (o) => !o.text.trim(),
}

/**
 * Texts whose height should be fitted to their content after the next render. Only the person
 * who changed a text (typing, size, width) fits it: if everyone did, people whose fonts measure
 * differently would keep overwriting each other's height.
 */
const needsFit = new Set<string>()
export const requestFit = (id: string) => needsFit.add(id)

function TextView({ board, object: o, editing }: ObjectViewProps<'text'>) {
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
    <div className="ttx-text-wrap" style={{ fontSize: o.fontSize ?? DEFAULT_FONT_SIZE, color: PALETTE[o.color ?? DEFAULT_COLOR].ink }}>
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
