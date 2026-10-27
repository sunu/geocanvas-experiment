import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { Board, BoardObject, NewObject, ObjectType } from '../board/board'
import { useObjects, type ConnectionStatus } from '../board/connect'
import { intersects, rectFrom, toScreen, toWorld, zoomAt, type Camera, type Rect } from './camera'
import { ObjectView, requestFit } from './ObjectView'
import { StylePanel } from './StylePanel'
import { Toolbar, type Tool } from './Toolbar'

const DEFAULT_SIZE: Record<ObjectType, { w: number; h: number }> = {
  box: { w: 200, h: 120 },
  text: { w: 240, h: 40 },
  map: { w: 520, h: 360 },
}
const MIN_SIZE = 16
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const
const TOOL_KEYS: Record<string, Tool> = { v: 'select', r: 'box', t: 'text', m: 'map' }
const GRID = 24

function newObject(type: ObjectType, r: Rect): NewObject {
  if (type === 'text') return { type, ...r, text: '' }
  if (type === 'map') return { type, ...r, basemap: 'light' }
  return { type, ...r }
}

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

export function Canvas({ board, status }: { board: Board; status: ConnectionStatus }) {
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

  // A text left empty when editing ends is removed.
  const lastEditing = useRef<string | null>(null)
  useEffect(() => {
    const prev = lastEditing.current && board.get(lastEditing.current)
    if (prev && prev.id !== editingId && prev.type === 'text' && !prev.text.trim()) board.remove([prev.id])
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
      const type = tool
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
          const d = DEFAULT_SIZE[type]
          const r = drawn && drawn.w >= MIN_SIZE && drawn.h >= MIN_SIZE ? drawn : { x: p0.x - d.w / 2, y: p0.y - d.h / 2, ...d }
          const newId = board.add(newObject(type, r))
          setTool('select')
          setSelection(new Set([newId]))
          if (type === 'text') setEditing(newId)
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
        if (o.type === 'text') {
          // A text's height follows its content: resizing changes only its width.
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
        const next = new Set(selected)
        if (!next.delete(id)) next.add(id)
        setSelection(next)
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
    const base = e.shiftKey ? selected : new Set<string>()
    if (!e.shiftKey) setSelection(new Set())
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
      () => setMarquee(null),
    )
  }

  function onDoubleClick(e: ReactMouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
    const o = id && byId.get(id)
    if (!o || o.type === 'box') return
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
    >
      <div className="ttx-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})` }}>
        {objects.map((o, i) => (
          <ObjectView key={o.id} board={board} object={o} layer={i} editing={o.id === editingId} />
        ))}
        {draft && <div className="ttx-draft" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} />}
      </div>

      {/* Selection chrome in screen space, so outlines and handles keep their size at any zoom. */}
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
