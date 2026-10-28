import type { Board, BoardObject } from '../board/board'
import { objectType } from '../objects/registry'

interface Props {
  board: Board
  object: BoardObject
  layer: number
  editing: boolean
  /** The object is done editing, e.g. an event was picked. */
  onDone(): void
}

/** One object on the canvas, in world coordinates. `layer` is its place in the stacking order. */
export function ObjectView({ board, object: o, layer, editing, onDone }: Props) {
  const def = objectType(o.type)
  return (
    <div
      data-id={o.id}
      className={`ttx-obj ttx-obj--${o.type} ${editing ? 'is-editing' : ''}`}
      style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer }}
    >
      {def ? (
        <def.View board={board} object={o} editing={editing} onDone={onDone} />
      ) : (
        <div className="ttx-unknown">This object needs a newer version of the app. Reload to see it.</div>
      )}
    </div>
  )
}
