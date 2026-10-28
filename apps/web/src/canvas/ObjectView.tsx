import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import type { Rect } from './camera'
import { objectUI } from './registry'

interface Props {
  runtime: Runtime
  object: BoardObject
  layer: number
  editing: boolean
  /** The object is done editing, e.g. an event was picked. */
  onDone(): void
  /** In focus mode: drawn at `rect`, a local size that is never stored, so it lays out for the whole screen. */
  focused?: { rect: Rect | null }
  onFocus?(): void
}

/** One object on the canvas, in world coordinates. `layer` is its place in the stacking order. Its type's UI fills it. */
export function ObjectView({ runtime, object: o, layer, editing, onDone, focused, onFocus }: Props) {
  // A board can hold objects of a type this build does not know, made by a newer version (e.g. a tab
  // opened before a deploy).
  const known = !!runtime.registry.objectType(o.type)
  const ui = known ? objectUI(o.type) : undefined
  const r = focused?.rect ?? o
  return (
    <div
      data-id={o.id}
      className={`ttx-obj ttx-obj--${o.type} ${editing ? 'is-editing' : ''} ${focused ? 'is-focused' : ''}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: layer, ...ui?.frameStyle?.(o) }}
    >
      {!known ? (
        <div className="ttx-unknown">This object needs a newer version of the app. Reload to see it.</div>
      ) : (
        ui?.View && <ui.View runtime={runtime} object={o} editing={editing} onDone={onDone} focused={!!focused} onFocus={onFocus} />
      )}
    </div>
  )
}
