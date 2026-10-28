import { NoteIcon } from '@phosphor-icons/react'
import { DEFAULT_FONT_SIZE, PALETTE, type ColorName } from '../canvas/style'
import type { ObjectTypeDef, ObjectViewProps } from './types'

declare module '../board/board' {
  interface ObjectFields {
    /** color and fontSize are optional: their defaults are read where the note is drawn. */
    sticky: { text: string; color?: ColorName; fontSize?: number }
  }
}

const DEFAULT_COLOR: ColorName = 'yellow'
/** The note's text: dark on every fill, so it stays readable whatever the note's color. */
const INK = PALETTE.ink.ink

export const sticky: ObjectTypeDef<'sticky'> = {
  type: 'sticky',
  label: 'Sticky note',
  key: 's',
  Icon: NoteIcon,
  size: { w: 200, h: 200 },
  layer: 'top',
  create: (r) => ({ type: 'sticky', ...r, text: '' }),
  View: StickyView,
  editable: true,
  editOnCreate: true,
  defaultColor: DEFAULT_COLOR,
  textSize: true,
  // No isEmpty: an empty note is still a visible note on the board, unlike an empty text.
}

/** A colored square with text. Its size is set by hand; text that does not fit is cut off at the bottom. */
function StickyView({ board, object: o, editing }: ObjectViewProps<'sticky'>) {
  const color = PALETTE[o.color ?? DEFAULT_COLOR]
  return (
    <div className="ttx-sticky" style={{ background: color.fill, borderColor: color.stroke, fontSize: o.fontSize ?? DEFAULT_FONT_SIZE, color: INK }}>
      {editing ? (
        <textarea
          className="ttx-sticky__text ttx-sticky__text--edit"
          autoFocus
          aria-label="Sticky note text"
          value={o.text}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => board.update({ [o.id]: { text: e.target.value } })}
        />
      ) : (
        <div className="ttx-sticky__text">{o.text}</div>
      )}
    </div>
  )
}
