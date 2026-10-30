import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { PlusIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BoardObject } from '../board/board'
import { phoneRows } from './order'
import { LABEL_H, ScaledObject } from './ScaledObject'
import { isFocusable, objectName, objectUI } from '../canvas/registry'

/** A card is drawn no larger than on the canvas, so a small text does not fill the screen. */
const MAX_SCALE = 1

interface Props {
  runtime: Runtime
  objects: BoardObject[]
  selection: string[]
  /** The object open full screen: its card keeps its place, but only the full screen draws it (one live map, not two). */
  open?: string
  onOpen(id: string): void
  /** A long press: choose the card, or let it go, without opening it. */
  onSelect(id: string): void
  onAdd(): void
  /** Set here: scrolls the list to an object, or to the top. */
  reveal: MutableRefObject<(id: string | undefined) => void>
}

/**
 * The board as a list of its widgets (order.ts), each drawn as on the canvas, scaled to the screen's width: the same
 * views, so every widget type shows with no phone code of its own. Cards only show; a tap opens one full screen.
 */
export function BoardList({ runtime, objects, selection, open, onOpen, onSelect, onAdd, reveal }: Props) {
  const rows = useMemo(() => phoneRows(objects), [objects])
  const list = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = list.current!
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    reveal.current = (id) => {
      if (!id) return list.current?.scrollTo({ top: 0, behavior: 'smooth' })
      list.current?.querySelector(`[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [reveal])

  return (
    <div className="ttx-m-list" ref={list}>
      {!rows.length && (
        <p className="px-6 py-12 text-center text-sm text-muted-foreground">
          Nothing on this board yet. Add a widget, or ask the agent to set up the board.
        </p>
      )}
      {width > 0 &&
        rows.map((row) =>
          row.kind === 'section' ? (
            <h2 key={row.object.id} data-row={row.object.id} className="ttx-m-section" style={{ '--depth': row.depth } as CSSProperties}>
              <button type="button" onClick={() => onOpen(row.object.id)}>
                {row.object.name || (row.object as { title?: string }).title || 'Frame'}
              </button>
            </h2>
          ) : (
            <Card key={row.object.id} runtime={runtime} object={row.object} width={width - 32} selected={selection.includes(row.object.id)} open={row.object.id === open} onOpen={onOpen} onSelect={onSelect} />
          ),
        )}
      <Button size="icon" className="ttx-m-fab size-14 rounded-xl shadow-md" title="Add a widget or run a command" aria-label="Add" onClick={onAdd}>
        <PlusIcon className="size-6" />
      </Button>
    </div>
  )
}

interface CardProps {
  runtime: Runtime
  object: BoardObject
  width: number
  selected: boolean
  open: boolean
  onOpen(id: string): void
  onSelect(id: string): void
}

function Card({ runtime, object: o, width, selected, open, onOpen, onSelect }: CardProps) {
  const scale = Math.min(MAX_SCALE, width / o.w)
  const press = useLongPress(() => onSelect(o.id))
  if (open) return <div data-row={o.id} className="ttx-m-card" style={{ width: o.w * scale, height: o.h * scale + LABEL_H }} />
  return (
    // Not a <button>: widgets have buttons and links of their own. They take no presses here (mobile.css).
    <div
      role="button"
      tabIndex={0}
      data-row={o.id}
      className={cn('ttx-m-card', selected && 'is-selected')}
      aria-label={`Open ${objectName(runtime, o)}`}
      onClick={() => !press.fired() && onOpen(o.id)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(o.id)}
      {...press.handlers}
    >
      {/* With onFocus, a new map says "Choose a location"; the tap opens it, as any tap on a card does. */}
      <ScaledObject runtime={runtime} object={o} scale={scale} selected={selected} onFocus={isFocusable(objectUI(o.type)) ? () => onOpen(o.id) : undefined} />
    </div>
  )
}

/** Held this long (ms) without moving, a press is a long press. */
const LONG_PRESS_MS = 500
/** Moving further than this (px) is a scroll, not a press. */
const PRESS_SLOP = 10

/** A long press on an element: `onLong` runs once it is held, and the click that ends it is not a tap. */
function useLongPress(onLong: () => void) {
  const state = useRef<{ timer?: number; x: number; y: number; fired: boolean }>({ x: 0, y: 0, fired: false })
  const cancel = () => clearTimeout(state.current.timer)
  return {
    /** The press that ends now was a long press: its click does nothing. */
    fired: () => state.current.fired,
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        cancel()
        state.current = {
          x: e.clientX,
          y: e.clientY,
          fired: false,
          timer: window.setTimeout(() => {
            state.current.fired = true
            navigator.vibrate?.(10)
            onLong()
          }, LONG_PRESS_MS),
        }
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (Math.hypot(e.clientX - state.current.x, e.clientY - state.current.y) > PRESS_SLOP) cancel()
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
      // The browser's own long-press menu (copy, share the image) would open over it.
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  }
}
