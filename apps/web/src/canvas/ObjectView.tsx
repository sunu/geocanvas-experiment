import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { objectUI } from './registry'

interface Props {
  runtime: Runtime
  object: BoardObject
  layer: number
  editing: boolean
  /** The object is done editing, e.g. an event was picked. */
  onDone(): void
}

/** One object on the canvas, in world coordinates. `layer` is its place in the stacking order. Its type's UI fills it. */
export function ObjectView({ runtime, object: o, layer, editing, onDone }: Props) {
  const ui = objectUI(o.type)
  return (
    <div
      data-id={o.id}
      className={`ttx-obj ttx-obj--${o.type} ${editing ? 'is-editing' : ''}`}
      style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer, ...ui?.frameStyle?.(o) }}
    >
      {ui?.View && <ui.View runtime={runtime} object={o} editing={editing} onDone={onDone} />}
    </div>
  )
}
