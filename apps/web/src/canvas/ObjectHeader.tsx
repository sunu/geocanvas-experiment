import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The label row above an object on the canvas (ObjectView.tsx), where its views put their name and actions. */
export const ObjectLabelSlot = createContext<HTMLElement | null>(null)

/** The width of `text` as `el` draws it, to size the name field to its name. */
const textWidth = (text: string, el: HTMLElement) => {
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.font = getComputedStyle(el).font
  return ctx.measureText(text).width
}

/** The widget's own name, set by double-clicking its label (ObjectView.tsx gives it): '' while it has none. */
export const ObjectNameContext = createContext<{ name: string; rename(name: string): void } | null>(null)

/**
 * What a widget shows about itself, drawn in the label row above it on the canvas, as Figma does for a frame:
 * its icon and name on the left, which is also where it is grabbed and identified, and its actions (focus, links,
 * refresh) on the right, shown while it is hovered or selected. Renders nothing in the widget itself.
 */
export function ObjectHeader({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  const slot = useContext(ObjectLabelSlot)
  const named = useContext(ObjectNameContext)
  const [renaming, setRenaming] = useState(false)
  const [draft, setDraft] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const [fieldWidth, setFieldWidth] = useState<number>()
  useLayoutEffect(() => {
    // The text, the field's padding and border, and a little room for the caret.
    if (renaming && field.current) setFieldWidth(Math.ceil(textWidth(draft || ' ', field.current)) + 12 + 4 + 4)
  }, [renaming, draft])
  if (!slot) return null
  const shown = named?.name || title
  // Empty, or the same as the default, is no name of its own.
  const commit = (value: string) => {
    setRenaming(false)
    const next = value.trim() === String(title) ? '' : value.trim()
    if (named && next !== named.name) named.rename(next)
  }
  return createPortal(
    <>
      <span className="ttx-obj__name" onDoubleClick={named ? (e) => { e.stopPropagation(); setDraft(String(shown)); setRenaming(true) } : undefined}>
        {icon}
        {renaming ? (
          <input
            autoFocus
            value={draft}
            ref={field}
            // As wide as the name: the browser's own sizing (field-sizing) is not everywhere.
            style={{ width: fieldWidth }}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={80}
            aria-label="Name"
            onFocus={(e) => e.currentTarget.select()}
            onPointerDown={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => {
              e.stopPropagation() // the canvas must not take Escape, Delete or the tool keys
              if (e.key === 'Enter') commit(e.currentTarget.value)
              else if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span>{shown}</span>
        )}
      </span>
      {/* The actions take the pointer without a double-click: pressing one must not start a drag. */}
      <span className="ttx-obj__actions" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {children}
      </span>
    </>,
    slot,
  )
}

export const useLabelSlot = () => useContext(ObjectLabelSlot)
