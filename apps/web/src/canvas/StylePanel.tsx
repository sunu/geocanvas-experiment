import { MinusIcon, PlusIcon, TextAaIcon } from '@phosphor-icons/react'
import type { Board, BoardObject } from '../board/board'
import { objectType } from '../objects/registry'
import { requestFit } from '../objects/text'
import { ICON } from './Toolbar'
import { COLORS, DEFAULT_FONT_SIZE, PALETTE, stepFontSize, type ColorName } from './style'

/** The fields this panel edits, on any type that has them (ObjectTypeDef.defaultColor, .textSize). */
type Styleable = BoardObject & { color?: ColorName; fontSize?: number }

const colorOf = (o: BoardObject): ColorName => (o as Styleable).color ?? objectType(o.type)!.defaultColor!
const sizeOf = (o: BoardObject) => (o as Styleable).fontSize ?? DEFAULT_FONT_SIZE

/** Color and text size for the selected objects whose type has them. Hidden when there are none. */
export function StylePanel({ board, selected }: { board: Board; selected: BoardObject[] }) {
  const colored = selected.filter((o) => objectType(o.type)?.defaultColor)
  const sized = selected.filter((o) => objectType(o.type)?.textSize)
  if (!colored.length && !sized.length) return null
  const colors = new Set(colored.map(colorOf))
  const sizes = new Set(sized.map(sizeOf))

  // Each press is its own undo step.
  const setColor = (color: ColorName) => {
    board.undo.stopCapturing()
    board.update(Object.fromEntries(colored.map((o) => [o.id, { color }])))
  }
  const stepSize = (dir: 1 | -1) => {
    board.undo.stopCapturing()
    for (const o of sized) requestFit(o.id)
    board.update(Object.fromEntries(sized.map((o) => [o.id, { fontSize: stepFontSize(sizeOf(o), dir) }])))
  }

  return (
    <div className="ttx-style" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {colored.length > 0 &&
        COLORS.map((c) => (
          <button
            key={c}
            className={`ttx-swatch ${colors.size === 1 && colors.has(c) ? 'is-on' : ''}`}
            style={{ background: PALETTE[c].ink }}
            title={c}
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
          />
        ))}
      {sized.length > 0 && (
        <>
          {colored.length > 0 && <span className="ttx-style__sep" />}
          <TextAaIcon size={ICON} className="ttx-style__label" aria-hidden />
          <button title="Larger text" aria-label="Larger text" onClick={() => stepSize(1)}>
            <PlusIcon size={ICON - 2} />
          </button>
          <span className="ttx-style__size" title="Text size">{sizes.size === 1 ? [...sizes][0] : '–'}</span>
          <button title="Smaller text" aria-label="Smaller text" onClick={() => stepSize(-1)}>
            <MinusIcon size={ICON - 2} />
          </button>
        </>
      )}
    </div>
  )
}
