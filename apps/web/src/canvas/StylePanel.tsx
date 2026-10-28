import { MinusIcon, PlusIcon, TextAaIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { requestFit } from './coreUI'
import { ICON } from './Toolbar'
import { COLORS, DEFAULT_BOX_COLOR, DEFAULT_FONT_SIZE, DEFAULT_TEXT_COLOR, PALETTE, type ColorName } from './style'

type Styled = Extract<BoardObject, { type: 'box' | 'text' }>
type Text = Extract<BoardObject, { type: 'text' }>

const colorOf = (o: Styled): ColorName => o.color ?? (o.type === 'box' ? DEFAULT_BOX_COLOR : DEFAULT_TEXT_COLOR)
const sizeOf = (t: Text) => t.fontSize ?? DEFAULT_FONT_SIZE

/** Color and text size for the selected boxes and texts. Hidden when none are selected. */
export function StylePanel({ runtime, selected }: { runtime: Runtime; selected: BoardObject[] }) {
  const styled = selected.filter((o): o is Styled => o.type === 'box' || o.type === 'text')
  if (!styled.length) return null
  const texts = styled.filter((o): o is Text => o.type === 'text')
  const colors = new Set(styled.map(colorOf))
  const sizes = new Set(texts.map(sizeOf))

  // Each press is its own undo step.
  const setColor = (color: ColorName) => {
    runtime.beginGesture()
    runtime.dispatch('core.object.setColor', { kind: 'objects', ids: styled.map((o) => o.id) }, { color })
  }
  const stepSize = (dir: 1 | -1) => {
    runtime.beginGesture()
    for (const t of texts) requestFit(t.id)
    runtime.dispatch(dir === 1 ? 'text.larger' : 'text.smaller', { kind: 'objects', ids: texts.map((t) => t.id) }, {})
  }

  return (
    <div className="ttx-style" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      {COLORS.map((c) => (
        <button
          key={c}
          className={`ttx-swatch ${colors.size === 1 && colors.has(c) ? 'is-on' : ''}`}
          style={{ background: PALETTE[c].ink }}
          title={c}
          aria-label={`Color ${c}`}
          onClick={() => setColor(c)}
        />
      ))}
      {texts.length > 0 && (
        <>
          <span className="ttx-style__sep" />
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
