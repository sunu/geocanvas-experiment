import { useState } from 'react'
import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import type { Rect } from './camera'
import { ObjectLabelSlot, ObjectNameContext } from './ObjectHeader'
import { objectUI } from './registry'

interface Props {
  runtime: Runtime
  object: BoardObject
  layer: number
  editing: boolean
  /** This person has it selected. */
  selected?: boolean
  /** Added by an agent whose cursor has not got here yet (canvas/agentCursor.ts): not drawn until it does. */
  arriving?: boolean
  /** The object is done editing, e.g. an event was picked. */
  onDone(): void
  /** In focus mode: drawn at `rect`, a local size that is never stored, so it lays out for the whole screen. */
  focused?: { rect: Rect | null }
  onFocus?(): void
}

/** One object on the canvas, in world coordinates. `layer` is its place in the stacking order. Its type's UI fills it. */
export function ObjectView({ runtime, object: o, layer, editing, selected, arriving, onDone, focused, onFocus }: Props) {
  const [label, setLabel] = useState<HTMLElement | null>(null)
  // A board can hold objects of a type this build does not know, made by a newer version (e.g. a tab
  // opened before a deploy).
  const known = !!runtime.registry.objectType(o.type)
  const ui = known ? objectUI(o.type) : undefined
  const r = focused?.rect ?? o
  const rename = (name: string) => {
    runtime.beginGesture()
    runtime.dispatch('core.object.rename', { kind: 'objects', ids: [o.id] }, { name })
  }
  return (
    <div
      data-id={o.id}
      className={`ttx-obj ttx-obj--${o.type} ${editing ? 'is-editing' : ''} ${selected ? 'is-selected' : ''} ${focused ? 'is-focused' : ''} ${arriving ? 'is-arriving' : ''}`}
      style={{ left: r.x, top: r.y, width: r.w, height: r.h, zIndex: layer, ...ui?.frameStyle?.(o) }}
    >
      {/* The name above the object, outside its box; its views fill it through ObjectHeader. */}
      <div ref={setLabel} className="ttx-obj__label" />
      {!known ? (
        <div className="ttx-unknown">This object needs a newer version of the app. Reload to see it.</div>
      ) : (
        ui?.View && (
          <ObjectLabelSlot.Provider value={label}>
            <ObjectNameContext.Provider value={{ name: o.name ?? '', rename }}>
              <ui.View runtime={runtime} object={o} editing={editing} onDone={onDone} focused={!!focused} onFocus={onFocus} />
            </ObjectNameContext.Provider>
          </ObjectLabelSlot.Provider>
        )
      )}
    </div>
  )
}
