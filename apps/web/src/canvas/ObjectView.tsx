import type { Board, BoardObject } from '../board/board'
import { MapObject } from '../map/MapObject'

/** One object on the canvas, in world coordinates. `layer` is its place in the stacking order. */
export function ObjectView({ board, object: o, layer, editing }: { board: Board; object: BoardObject; layer: number; editing: boolean }) {
  return (
    <div
      data-id={o.id}
      className={`ttx-obj ttx-obj--${o.type} ${editing ? 'is-editing' : ''}`}
      style={{ left: o.x, top: o.y, width: o.w, height: o.h, zIndex: layer }}
    >
      {o.type === 'text' && <TextContent board={board} id={o.id} text={o.text} h={o.h} editing={editing} />}
      {o.type === 'map' && <MapObject board={board} object={o} editing={editing} />}
    </div>
  )
}

function TextContent({ board, id, text, h, editing }: { board: Board; id: string; text: string; h: number; editing: boolean }) {
  if (!editing) return <div className="ttx-text">{text}</div>
  return (
    <textarea
      className="ttx-text ttx-text--edit"
      autoFocus
      value={text}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => {
        // Grow the box to fit the text. scrollHeight is in world units: it ignores the canvas transform.
        board.update({ [id]: { text: e.target.value, h: Math.max(h, e.target.scrollHeight) } })
      }}
    />
  )
}
