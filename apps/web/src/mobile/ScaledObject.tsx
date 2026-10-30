import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { ObjectView } from '../canvas/ObjectView'
import { objectUI } from '../canvas/registry'

/** The widget's name row above it, as on the canvas (canvas/canvas.css, .ttx-obj__label). */
export const LABEL_H = 24

interface Props {
  runtime: Runtime
  object: BoardObject
  scale: number
  editing?: boolean
  selected?: boolean
  onDone?(): void
  /** For a type with a focus mode: its "Choose a location" and the like open it. */
  onFocus?(): void
}

/**
 * One object drawn as on the canvas, at its own size and `scale`, with its name row above it: a canvas of one object,
 * its world moved so the object sits at the top left. Laid out at its own width, a text measures its height as it does
 * on the canvas when it is edited here.
 */
export function ScaledObject({ runtime, object: o, scale, editing = false, selected, onDone = noop, onFocus }: Props) {
  const height = useContentHeight(o)
  return (
    <div style={{ position: 'relative', width: o.w * scale, height: height.h * scale + LABEL_H }}>
      <div ref={height.ref} className="ttx-world" style={{ transform: `translate(${-o.x * scale}px, ${LABEL_H - o.y * scale}px) scale(${scale})`, '--ttx-zoom': scale } as CSSProperties}>
        <ObjectView runtime={runtime} object={o} layer={0} editing={editing} selected={selected} onDone={onDone} onFocus={onFocus} />
      </div>
    </div>
  )
}

/**
 * The height to show an object at, in world units: its own, or for a type whose height follows its content (a text)
 * that content's, if it is taller. A text's stored height is fitted only by whoever changes it (canvas/coreUI.tsx),
 * so it can be short; on the canvas the rest overflows, here it would be cut off by the card.
 */
function useContentHeight(o: BoardObject) {
  const ref = useRef<HTMLDivElement>(null)
  const fits = !!objectUI(o.type)?.widthOnly
  const [content, setContent] = useState(0)
  useLayoutEffect(() => {
    const obj = ref.current?.querySelector<HTMLElement>('.ttx-obj')
    if (!fits || !obj) return
    const measure = () => setContent(obj.scrollHeight)
    const observer = new ResizeObserver(measure)
    for (const child of obj.children) observer.observe(child)
    measure()
    return () => observer.disconnect()
  }, [fits, o.id])
  return { ref, h: fits ? Math.max(o.h, content) : o.h }
}

const noop = () => {}
