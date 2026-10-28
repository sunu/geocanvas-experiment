import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Board, BoardObject } from '../board/board'
import type { WebsocketProvider } from 'y-websocket'
import { useObjects, type ConnectionStatus } from '../board/connect'
import { cursorSender, usePeers } from '../board/presence'
import { objectType, objectTypes } from '../objects/registry'
import { requestFit } from '../objects/text'
import { intersects, rectFrom, toScreen, toWorld, zoomAt, type Camera, type Rect } from './camera'
import { ObjectView } from './ObjectView'
import { Peers } from './Peers'
import { StylePanel } from './StylePanel'
import { Toolbar, type Tool } from './Toolbar'

const MIN_SIZE = 16
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const
const TOOL_KEYS: Record<string, Tool> = { v: 'select', ...Object.fromEntries(objectTypes.map((d) => [d.key, d.type])) }
const GRID = 24

/** Follow a press until release. onMove gets the screen distance from the press once it passes the threshold. */
function trackDrag(
  e: ReactPointerEvent,
  onMove: (dx: number, dy: number) => void,
  onUp?: (moved: boolean) => void,
) {
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  const move = (me: PointerEvent) => {
    if (!moved && Math.hypot(me.clientX - sx, me.clientY - sy) < DRAG_THRESHOLD) return
    moved = true
    onMove(me.clientX - sx, me.clientY - sy)
  }
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onUp?.(moved)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

interface Props {
  board: Board
  status: ConnectionStatus
  /** Presence: who else is here, their cursors and selections (board/presence.ts). */
  awareness: WebsocketProvider['awareness']
}

export function Canvas({ board, status, awareness }: Props) {
  const objects = useObjects(board)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null) // screen
  const [draft, setDraft] = useState<Rect | null>(null) // world, while drawing a new object
  const [spaceHeld, setSpaceHeld] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef(camera)
  cameraRef.current = camera

  // Someone else may delete what we have selected or are editing.
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects])
  const selected = useMemo(() => new Set([...selection].filter((id) => byId.has(id))), [selection, byId])
  const editingId = editing && byId.has(editing) ? editing : null

  const peers = usePeers(awareness)
  const sendCursor = useMemo(() => cursorSender(awareness), [awareness])
  // Share what this person has selected. Keyed by the ids, so other board changes send nothing.
  const selectionKey = [...selected].sort().join(',')
  useEffect(() => {
    awareness.setLocalStateField('selection', selectionKey ? selectionKey.split(',') : [])
  }, [awareness, selectionKey])

  // An object left empty when editing ends (e.g. a text with nothing typed) is removed.
  const lastEditing = useRef<string | null>(null)
  useEffect(() => {
    const prev = lastEditing.current && board.get(lastEditing.current)
    if (prev && prev.id !== editingId && objectType(prev.type)?.isEmpty?.(prev)) board.remove([prev.id])
    lastEditing.current = editingId
  }, [board, editingId])

  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button === 2) return
    const target = e.target as HTMLElement
    const id = target.closest<HTMLElement>('[data-id]')?.dataset.id
    if (editingId && id === editingId) return // the text box or live map has the pointer
    if (editingId) setEditing(null)
    board.undo.stopCapturing()

    if (e.button === 1 || spaceHeld) {
      const start = cameraRef.current
      trackDrag(e, (dx, dy) => setCamera({ ...start, x: start.x + dx, y: start.y + dy }))
      return
    }

    if (tool !== 'select') {
      const def = objectType(tool)!
      const p = screenPoint(e)
      const p0 = toWorld(cameraRef.current, p.x, p.y)
      let drawn: Rect | null = null
      trackDrag(
        e,
        (dx, dy) => {
          const z = cameraRef.current.z
          drawn = rectFrom(p0, { x: p0.x + dx / z, y: p0.y + dy / z })
          setDraft(drawn)
        },
        () => {
          setDraft(null)
          const d = def.size
          const r = drawn && drawn.w >= MIN_SIZE && drawn.h >= MIN_SIZE ? drawn : { x: p0.x - d.w / 2, y: p0.y - d.h / 2, ...d }
          const newId = board.add(def.create(r), def.layer)
          setTool('select')
          setSelection(new Set([newId]))
          // E.g. a new text opens for typing; a new event opens its search.
          if (def.editOnCreate) setEditing(newId)
        },
      )
      return
    }

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle
    if (handle && selected.size === 1) {
      const o = byId.get([...selected][0]!)!
      trackDrag(e, (dx, dy) => {
        const z = cameraRef.current.z
        const r = resized(o, handle, dx / z, dy / z)
        if (objectType(o.type)?.widthOnly) {
          // Its height follows its content (a text): resizing changes only its width.
          requestFit(o.id)
          board.update({ [o.id]: { x: r.x, w: r.w } })
        } else {
          board.update({ [o.id]: r })
        }
      })
      return
    }

    if (id) {
      if (e.shiftKey) {
        // Shift: a click toggles this object; a drag draws a selection box from here, so a large
        // map or box underneath does not get in the way of selecting what is on it.
        boxSelect(e, selected, () => {
          const next = new Set(selected)
          if (!next.delete(id)) next.add(id)
          setSelection(next)
        })
        return
      }
      const moving = selected.has(id) ? selected : new Set([id])
      setSelection(moving)
      const starts = objects.filter((o) => moving.has(o.id))
      trackDrag(e, (dx, dy) => {
        const z = cameraRef.current.z
        board.update(Object.fromEntries(starts.map((o) => [o.id, { x: o.x + dx / z, y: o.y + dy / z }])))
      })
      return
    }

    // Empty canvas: drag a selection box (shift adds to the selection).
    if (!e.shiftKey) setSelection(new Set())
    boxSelect(e, e.shiftKey ? selected : new Set())
  }

  /** Drag a selection box that adds to `base`. A press without a drag calls onClick instead. */
  function boxSelect(e: ReactPointerEvent, base: Set<string>, onClick?: () => void) {
    const p0 = screenPoint(e)
    trackDrag(
      e,
      (dx, dy) => {
        const box = rectFrom(p0, { x: p0.x + dx, y: p0.y + dy })
        setMarquee(box)
        const a = toWorld(cameraRef.current, box.x, box.y)
        const b = toWorld(cameraRef.current, box.x + box.w, box.y + box.h)
        const world = rectFrom(a, b)
        setSelection(new Set([...base, ...objects.filter((o) => intersects(o, world)).map((o) => o.id)]))
      },
      (moved) => {
        setMarquee(null)
        if (!moved) onClick?.()
      },
    )
  }

  function onDoubleClick(e: ReactMouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
    const o = id && byId.get(id)
    if (!o || !objectType(o.type)?.editable) return
    setSelection(new Set([o.id]))
    setEditing(o.id)
  }

  // Trackpad scroll pans; pinch (ctrl+wheel) or ⌘+wheel zooms toward the pointer.
  useEffect(() => {
    const root = rootRef.current!
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = root.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        setCamera((c) => zoomAt(c, Math.exp(-e.deltaY * 0.01), e.clientX - r.left, e.clientY - r.top))
      } else {
        setCamera((c) => ({ ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
      }
    }
    root.addEventListener('wheel', onWheel, { passive: false })
    return () => root.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) setEditing(null)
        else {
          setSelection(new Set())
          setTool('select')
        }
        return
      }
      if ((e.target as HTMLElement).closest?.('textarea, input, select, [contenteditable="true"]')) return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceHeld(true)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) board.undo.redo()
        else board.undo.undo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault()
        board.undo.stopCapturing()
        board.remove(selected)
      } else if ((e.code === 'BracketRight' || e.code === 'BracketLeft') && selected.size) {
        // ] / [ = to front / to back; with ⌘ or Ctrl, one step.
        e.preventDefault()
        board.undo.stopCapturing()
        const up = e.code === 'BracketRight'
        if (mod) board.step(selected, up ? 1 : -1)
        else if (up) board.bringToFront(selected)
        else board.sendToBack(selected)
      } else if (!mod && !e.altKey && TOOL_KEYS[e.key.toLowerCase()]) {
        setTool(TOOL_KEYS[e.key.toLowerCase()]!)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceHeld(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [board, editingId, selected])

  const single = selected.size === 1 && !editingId ? byId.get([...selected][0]!) : undefined
  const grid = GRID * camera.z

  return (
    <div
      ref={rootRef}
      className={`ttx-canvas ${spaceHeld ? 'is-panning' : ''} ${tool !== 'select' ? 'is-drawing' : ''}`}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerMove={(e) => {
        const p = screenPoint(e)
        sendCursor(toWorld(cameraRef.current, p.x, p.y))
      }}
      onPointerLeave={() => sendCursor(null)}
    >
      <div className="ttx-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
        {objects.map((o, i) => (
          <ObjectView key={o.id} board={board} object={o} layer={i} editing={o.id === editingId} onDone={() => setEditing(null)} />
        ))}
        {draft && <div className="ttx-draft" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} />}
      </div>

      {/* Selection chrome in screen space, so outlines and handles keep their size at any zoom. */}
      <div className="ttx-chrome">
        <Peers peers={peers} camera={camera} byId={byId} />
        {[...selected].map((id) => {
          const r = toScreen(camera, byId.get(id)!)
          return <div key={id} className="ttx-selection" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
        })}
        {single &&
          HANDLES.map((h) => {
            const r = toScreen(camera, single)
            const x = h.includes('w') ? r.x : r.x + r.w
            const y = h.includes('n') ? r.y : r.y + r.h
            return <div key={h} data-handle={h} className={`ttx-handle ttx-handle--${h}`} style={{ left: x, top: y }} />
          })}
        {marquee && <div className="ttx-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
      </div>

      <StylePanel board={board} selected={objects.filter((o) => selected.has(o.id))} />

      <Toolbar
        board={board}
        tool={tool}
        onTool={setTool}
        selection={selected}
        zoom={camera.z}
        onResetZoom={() => {
          const r = rootRef.current!.getBoundingClientRect()
          setCamera((c) => zoomAt(c, 1 / c.z, r.width / 2, r.height / 2))
        }}
        status={status}
      />
    </div>
  )
}

/** The rectangle of `o` after dragging corner `handle` by (dx, dy) world units, kept at least MIN_SIZE. */
function resized(o: BoardObject, handle: string, dx: number, dy: number): Rect {
  let { x, y, w, h } = o
  if (handle.includes('e')) w = Math.max(MIN_SIZE, o.w + dx)
  if (handle.includes('s')) h = Math.max(MIN_SIZE, o.h + dy)
  if (handle.includes('w')) {
    w = Math.max(MIN_SIZE, o.w - dx)
    x = o.x + o.w - w
  }
  if (handle.includes('n')) {
    h = Math.max(MIN_SIZE, o.h - dy)
    y = o.y + o.h - h
  }
  return { x, y, w, h }
}
