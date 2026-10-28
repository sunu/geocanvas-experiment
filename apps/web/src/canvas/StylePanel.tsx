import { MinusIcon, PlusIcon, TextAaIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { requestFit } from './coreUI'
import { objectUI } from './registry'
import { ICON } from './Toolbar'
import { COLORS, DEFAULT_FONT_SIZE, PALETTE, type ColorName } from './style'

/** The fields this panel edits, on any type that has them (ObjectTypeDef.defaultColor, .textSize). */
type Styleable = BoardObject & { color?: ColorName; fontSize?: number }

const sizeOf = (o: BoardObject) => (o as Styleable).fontSize ?? DEFAULT_FONT_SIZE

/** Color and text size for the selected objects whose type has them. Hidden when there are none. */
export function StylePanel({ runtime, selected }: { runtime: Runtime; selected: BoardObject[] }) {
  const type = (o: BoardObject) => runtime.registry.objectType(o.type)
  const colored = selected.filter((o) => type(o)?.defaultColor)
  const sized = selected.filter((o) => type(o)?.textSize)
  if (!colored.length && !sized.length) return null
  const colors = new Set(colored.map((o) => (o as Styleable).color ?? type(o)!.defaultColor!))
  const sizes = new Set(sized.map(sizeOf))

  // Each press is its own undo step.
  const setColor = (color: ColorName) => {
    runtime.beginGesture()
    runtime.dispatch('core.object.setColor', { kind: 'objects', ids: colored.map((o) => o.id) }, { color })
  }
  const stepSize = (dir: 1 | -1) => {
    runtime.beginGesture()
    // Only types whose height follows their content (texts) refit; a sticky note keeps its size.
    for (const o of sized) if (objectUI(o.type)?.widthOnly) requestFit(o.id)
    runtime.dispatch(dir === 1 ? 'text.larger' : 'text.smaller', { kind: 'objects', ids: sized.map((o) => o.id) }, {})
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
