import { createContext, useContext, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** The label row above an object on the canvas (ObjectView.tsx), where its views put their name and actions. */
export const ObjectLabelSlot = createContext<HTMLElement | null>(null)

/**
 * What a widget shows about itself, drawn in the label row above it on the canvas, as Figma does for a frame:
 * its icon and name on the left, which is also where it is grabbed and identified, and its actions (focus, links,
 * refresh) on the right, shown while it is hovered or selected. Renders nothing in the widget itself.
 */
export function ObjectHeader({ icon, title, children }: { icon?: ReactNode; title: ReactNode; children?: ReactNode }) {
  const slot = useContext(ObjectLabelSlot)
  if (!slot) return null
  return createPortal(
    <>
      <span className="ttx-obj__name">
        {icon}
        <span>{title}</span>
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
