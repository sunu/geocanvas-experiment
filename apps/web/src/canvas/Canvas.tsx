import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Draft, type Runtime, type TargetRef } from '@ttx/core'
import type { Board, BoardObject } from '../board/board'
import { useObjects, type ConnectionStatus } from '../board/connect'
import { cursorSender, publishSelection, usePeers, type Awareness } from '../board/presence'
import { Palette } from '../palette/Palette'
import { bounds, fitRect, intersects, rectFrom, toScreen, toWorld, zoomAt, type Camera, type Rect } from './camera'
import { requestFit } from './coreUI'
import { animateCamera, fillCamera, focusArea, focusedLayout } from './focus'
import { ObjectView } from './ObjectView'
import { ExitDialog, OptionsPanel } from './OptionsPanel'
import { useAgentTouched } from '../board/agentActivity'
import { Peers } from './Peers'
import { isFocusable, objectUI } from './registry'
import { placeFiles } from '../uploads/drop'
import { DropOverlay, PendingUploads } from '../uploads/PendingUploads'
import { StylePanel } from './StylePanel'
import { tools, Toolbar, type Tool } from './Toolbar'

const MIN_SIZE = 16
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
const HANDLES = ['nw', 'ne', 'sw', 'se'] as const
const GRID = 24
/** The dots are fully visible from this zoom up, fade out below it, and are gone at DOTS_GONE. */
const DOTS_FULL = 0.4
const DOTS_GONE = 0.15

const objectsTarget = (ids: Iterable<string>): TargetRef => ({ kind: 'objects', ids: [...ids] })

/**
 * In-focus mode (canvas/focus.ts): one object fills the screen, drawn from this person's draft of the
 * board, so what they change there reaches others only when they share it. Local, like the camera.
 */
interface Focus {
  id: string
  /** The camera to go back to. */
  saved: Camera
  draft: Draft
  /** The screen area the object fills. */
  area: Rect
  /** The object's local rectangle once the zoom-in ends; null while it animates. */
  rect: Rect | null
}

const NO_OBJECTS: BoardObject[] = []
const noSubscribe = () => () => {}
const noObjects = () => NO_OBJECTS

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

/**
 * The canvas. It reads the board and writes only by dispatching ops on the runtime: one gesture
 * (a press, a key, a button) is one runtime.beginGesture(), so one undo step.
 */
export function Canvas({ runtime, status, awareness }: { runtime: Runtime; status: ConnectionStatus; awareness: Awareness }) {
  const board = runtime.board as Board
  const objects = useObjects(board)
  const peers = usePeers(awareness)
  const agentTouched = useAgentTouched(runtime)
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null) // screen
  const [draft, setDraft] = useState<Rect | null>(null) // world, while drawing a new object
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [focus, setFocus] = useState<Focus | null>(null)
  /** Leaving focus with unshared changes: the Share / Discard / Keep editing dialog is open. */
  const [asking, setAsking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const focusRef = useRef(focus)
  focusRef.current = focus
  const stopAnimation = useRef<() => void>(undefined)

  // The focused object as the draft has it: this person's changes, and everyone else's as they arrive.
  const draftBoard = focus?.draft.runtime.board as Board | undefined
  const draftObjects = useSyncExternalStore(draftBoard?.subscribe ?? noSubscribe, draftBoard?.snapshot ?? noObjects)
  const focused = focus ? draftObjects.find((o) => o.id === focus.id) : undefined
  const focusedUI = focused && objectUI(focused.type)

  // Someone else may delete what we have selected or are editing.
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects])
  const selected = useMemo(() => new Set([...selection].filter((id) => byId.has(id))), [selection, byId])
  const editingId = editing && byId.has(editing) ? editing : null

  // Others see what this person selected, and the agent chat sends it with each message. Keyed by
  // the ids, so other board changes send nothing.
  const selectionKey = [...selected].sort().join(',')
  useEffect(() => publishSelection(awareness, selectionKey ? selectionKey.split(',') : []), [awareness, selectionKey])
  const sendCursor = useMemo(() => cursorSender(awareness), [awareness])

  // An object left empty when editing ends (e.g. a text with nothing typed) is removed.
  const lastEditing = useRef<string | null>(null)
  useEffect(() => {
    const prev = lastEditing.current && board.get(lastEditing.current)
    if (prev && prev.id !== editingId && objectUI(prev.type)?.isEmpty?.(prev)) {
      runtime.dispatch('core.object.delete', objectsTarget([prev.id]), {})
    }
    lastEditing.current = editingId
  }, [board, runtime, editingId])

  // This person's camera, for view ops (zoom to fit, zoom to selection) from the palette or tools.
  useEffect(() => {
    const show = (r: Rect | undefined) => {
      const el = rootRef.current
      if (r && el) setCamera(fitRect(r, el.clientWidth, el.clientHeight))
    }
    runtime.view = {
      fitAll: () => show(bounds(board.list())),
      zoomTo: (ids) => show(bounds(ids.map((id) => board.get(id)).filter((o) => !!o))),
      resetZoom: () => {
        const el = rootRef.current
        if (el) setCamera((c) => zoomAt(c, 1 / c.z, el.clientWidth / 2, el.clientHeight / 2))
      },
      focus: (id) => enterFocusRef.current(id),
      center: () => viewCenter(),
    }
    return () => {
      runtime.view = undefined
    }
  }, [board, runtime])

  const screenPoint = (e: { clientX: number; clientY: number }) => {
    const r = rootRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  function onPointerDown(e: ReactPointerEvent) {
    if (e.button === 2) return
    const target = e.target as HTMLElement
    const id = target.closest<HTMLElement>('[data-id]')?.dataset.id
    if (focusRef.current) {
      // The focused object has the pointer; a press anywhere else leaves focus.
      if (id !== focusRef.current.id) requestExit()
      return
    }
    if (editingId && id === editingId) return // the text box or live map has the pointer
    if (editingId) setEditing(null)
    runtime.beginGesture()

    if (e.button === 1 || spaceHeld || tool === 'hand') {
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
          const d = runtime.registry.objectType(type)!.defaultSize
          const r = drawn && drawn.w >= MIN_SIZE && drawn.h >= MIN_SIZE ? drawn : { x: p0.x - d.w / 2, y: p0.y - d.h / 2, ...d }
          const newId = runtime.dispatch(`${type}.add`, { kind: 'canvas' }, r).created?.[0]
          setTool('select')
          if (!newId) return
          setSelection(new Set([newId]))
          // E.g. a new text opens for typing; a new event opens its search.
          if (objectUI(type)?.editOnCreate) setEditing(newId)
        },
      )
      return
    }

    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle
    if (handle && selected.size === 1) {
      const o = byId.get([...selected][0]!)!
      trackDrag(e, (dx, dy) => {
        if (!board.get(o.id)) return // someone else deleted it
        const z = cameraRef.current.z
        const r = resized(o, handle, dx / z, dy / z)
        if (objectUI(o.type)?.widthOnly) {
          // Its height follows its content (a text): resizing changes only its width.
          requestFit(o.id)
          runtime.dispatch('core.object.setRect', objectsTarget([o.id]), { rects: { [o.id]: { x: r.x, w: r.w } } })
        } else {
          runtime.dispatch('core.object.setRect', objectsTarget([o.id]), { rects: { [o.id]: r } })
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
        const alive = starts.filter((o) => board.get(o.id)) // someone else may delete one mid-drag
        if (!alive.length) return
        const rects = Object.fromEntries(alive.map((o) => [o.id, { x: o.x + dx / z, y: o.y + dy / z }]))
        runtime.dispatch('core.object.setRect', objectsTarget(Object.keys(rects)), { rects })
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

  /**
   * Files dragged over the window dim the board, with a drop target, and a drop places them where they land
   * (uploads/drop.ts). Listened for on the window, so a drop on a panel or the toolbar places the file too,
   * instead of the browser opening it and leaving the board. An image object takes a picture dropped on
   * it first (it prevents the default). Enter and leave fire for every element crossed, so they are counted.
   */
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0
    const isFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files') && !focusRef.current
    const onEnter = (e: DragEvent) => {
      if (!isFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!isFiles(e) || --depth > 0) return
      depth = 0
      setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (isFiles(e)) e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      const files = [...(e.dataTransfer?.files ?? [])]
      if (!files.length || !isFiles(e)) return
      const handled = e.defaultPrevented
      e.preventDefault()
      if (handled) return
      const p = screenPoint(e)
      placeFiles(runtime, files, toWorld(cameraRef.current, p.x, p.y))
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [runtime])

  function onDoubleClick(e: ReactMouseEvent) {
    if (focusRef.current) return
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
    const o = id && byId.get(id)
    if (!o || !objectUI(o.type)?.editable) return
    setSelection(new Set([o.id]))
    setEditing(o.id)
  }

  // Trackpad scroll pans; pinch (ctrl+wheel) or ⌘+wheel zooms toward the pointer.
  useEffect(() => {
    const root = rootRef.current!
    const onWheel = (e: WheelEvent) => {
      // In focus the canvas stays still: the focused object scrolls or zooms itself.
      if (focusRef.current) return
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
      const mod = e.metaKey || e.ctrlKey
      if (focus) {
        // In focus only Esc (leave) and undo, on the draft. The exit dialog handles its own Esc.
        if (e.key === 'Escape') requestExit()
        else if (mod && e.key.toLowerCase() === 'z' && !(e.target as HTMLElement).closest?.('textarea, input, select, [contenteditable="true"]')) {
          e.preventDefault()
          if (e.shiftKey) focus.draft.runtime.redo()
          else focus.draft.runtime.undo()
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => !open)
        return
      }
      if (paletteOpen) {
        // The palette has the keyboard; Escape closes it even when focus is outside it.
        if (e.key === 'Escape') setPaletteOpen(false)
        return
      }
      if (e.key === 'Escape') {
        if (editingId) setEditing(null)
        else {
          setSelection(new Set())
          setTool('select')
        }
        return
      }
      if ((e.target as HTMLElement).closest?.('textarea, input, select, [contenteditable="true"]')) return
      if (e.code === 'Space') {
        e.preventDefault()
        setSpaceHeld(true)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) runtime.redo()
        else runtime.undo()
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected.size) {
        e.preventDefault()
        runtime.beginGesture()
        runtime.dispatch('core.object.delete', objectsTarget(selected), {})
      } else if ((e.code === 'BracketRight' || e.code === 'BracketLeft') && selected.size) {
        // ] / [ = to front / to back; with ⌘ or Ctrl, one step.
        e.preventDefault()
        runtime.beginGesture()
        const up = e.code === 'BracketRight'
        const opId = mod ? (up ? 'core.object.bringForward' : 'core.object.sendBackward') : up ? 'core.object.bringToFront' : 'core.object.sendToBack'
        runtime.dispatch(opId, objectsTarget(selected), {})
      } else if (!mod && !e.altKey && e.key.toLowerCase() === 'f' && selected.size === 1) {
        const o = byId.get([...selected][0]!)
        if (o && isFocusable(objectUI(o.type))) enterFocus(o.id)
      } else if (!mod && !e.altKey) {
        const t = tools().find((t) => t.key.toLowerCase() === e.key.toLowerCase())
        if (t) setTool(t.tool)
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
  }, [runtime, editingId, selected, paletteOpen, focus])

  /** Open an object in focus mode: zoom until it fills the screen, then lay it out at that size, on a draft. */
  function enterFocus(id: string) {
    if (focusRef.current) return
    const o = board.get(id)
    if (!o || !isFocusable(objectUI(o.type))) throw new Error(`${o ? runtime.registry.objectType(o.type)?.title : 'This object'} has no focus mode`)
    const el = rootRef.current!
    const area = focusArea(el.clientWidth, el.clientHeight)
    const saved = cameraRef.current
    setEditing(null)
    setPaletteOpen(false)
    setSelection(new Set([id]))
    setFocus({ id, saved, draft: new Draft(runtime), area, rect: null })
    stopAnimation.current?.()
    stopAnimation.current = animateCamera(saved, fillCamera(o, area), setCamera, () => {
      const layout = focusedLayout(o, area)
      setFocus((f) => (f?.id === id ? { ...f, rect: layout.rect } : f))
      setCamera(layout.camera)
    })
  }
  const enterFocusRef = useRef(enterFocus)
  enterFocusRef.current = enterFocus

  /** Send the draft's changes to everyone; the type may add its own first (a map shares its view). */
  function share(f: Focus) {
    const o = f.draft.runtime.board.get(f.id) as BoardObject | undefined
    const ui = o && objectUI(o.type)
    if (o && isFocusable(ui)) ui.beforeShare?.(f.draft.runtime, o)
    f.draft.share()
  }

  /** Esc, the leave button or a press outside: ask first if there is anything unshared. */
  function requestExit() {
    const f = focusRef.current
    if (!f) return
    if (f.draft.hasUnshared()) setAsking(true)
    else leaveFocus(false)
  }

  /** Leave focus, sharing the draft's changes or dropping them, and zoom back out to where this person was. */
  function leaveFocus(shareChanges: boolean) {
    const f = focusRef.current
    if (!f) return
    if (shareChanges) share(f)
    stopAnimation.current?.()
    setAsking(false)
    setFocus(null)
    const o = board.get(f.id)
    if (!o) return setCamera(f.saved)
    const from = fillCamera(o, f.area)
    setCamera(from)
    stopAnimation.current = animateCamera(from, f.saved, setCamera)
  }

  // The draft lives as long as its focus. Closed after the object's view has let go of it.
  useEffect(() => {
    if (!focus) return
    const draft = focus.draft
    return () => draft.close()
  }, [focus?.draft])

  // Someone else deleted the focused object: there is nothing left to show or share.
  useEffect(() => {
    if (!focus || focused) return
    leaveFocus(false)
    setNotice('Someone deleted the object you were focused on.')
  })

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  // The window resized in focus: fill the new area.
  useEffect(() => {
    if (!focus) return
    const onResize = () => {
      const el = rootRef.current
      const f = focusRef.current
      if (!el || !f?.rect) return
      const area = focusArea(el.clientWidth, el.clientHeight)
      const layout = focusedLayout(f.rect, area)
      setFocus({ ...f, area, rect: layout.rect })
      setCamera(layout.camera)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [focus?.id])

  /** Run an op from the palette as its own undo step, then show what it added. */
  async function runFromPalette(opId: string, target: TargetRef, args: unknown) {
    // Ops on texts can change their size or content: their height follows.
    if (target.kind === 'objects') for (const id of target.ids) requestFit(id)
    const r = await runtime.invoke(opId, target, args)
    if (r.status !== 'applied') return r
    setPaletteOpen(false)
    for (const id of r.created ?? []) requestFit(id)
    if (r.created?.length) setSelection(new Set(r.created))
    return r
  }

  const viewCenter = () => {
    const el = rootRef.current!
    return toWorld(cameraRef.current, el.clientWidth / 2, el.clientHeight / 2)
  }

  const single = selected.size === 1 && !editingId && !focus ? byId.get([...selected][0]!) : undefined
  const grid = GRID * camera.z
  // The dots' radius follows the zoom like their spacing does, but not below half a pixel, so they stay drawn while they fade.
  const dotRadius = Math.max(0.5, camera.z)
  const dots = Math.min(1, Math.max(0, (camera.z - DOTS_GONE) / (DOTS_FULL - DOTS_GONE)))

  return (
    <div
      ref={rootRef}
      className={`ttx-canvas ${spaceHeld || tool === 'hand' ? 'is-panning' : ''} ${tool !== 'select' && tool !== 'hand' ? 'is-drawing' : ''} ${focus ? 'is-focus' : ''}`}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${camera.x}px ${camera.y}px`, '--ttx-dots': dots, '--ttx-dot-r': dotRadius } as CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerMove={(e) => {
        const p = screenPoint(e)
        sendCursor(toWorld(cameraRef.current, p.x, p.y))
      }}
      onPointerLeave={() => sendCursor(null)}
    >
      <div className="ttx-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, '--ttx-zoom': camera.z } as CSSProperties}>
        {objects.map((o, i) =>
          o.id === focus?.id ? (
            // Same key and place as when not focused, so the view is not remounted (a map keeps its WebGL contexts).
            <ObjectView
              key={o.id}
              runtime={focus.draft.runtime}
              object={focused ?? o}
              layer={objects.length}
              editing
              onDone={() => {}}
              focused={{ rect: focus.rect }}
            />
          ) : (
            <ObjectView
              key={o.id}
              runtime={runtime}
              object={o}
              layer={i}
              editing={o.id === editingId}
              selected={selected.has(o.id)}
              onDone={() => setEditing(null)}
              onFocus={isFocusable(objectUI(o.type)) ? () => enterFocus(o.id) : undefined}
            />
          ),
        )}
        {draft && <div className="ttx-draft" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} />}
        {!focus && <PendingUploads />}
      </div>

      {/* Selection chrome in screen space, so outlines and handles keep their size at any zoom. */}
      <div className="ttx-chrome">
        {/* Others' cursors and outlines are at stored positions and sizes, which the focused layout does not match. */}
        {!focus && <Peers peers={peers} camera={camera} byId={byId} agentTouched={agentTouched} />}
        {!focus && [...selected].map((id) => {
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

      {focus && focused && isFocusable(focusedUI) && (
        <OptionsPanel
          draft={focus.draft}
          object={focused}
          ui={focusedUI}
          title={runtime.registry.objectType(focused.type)?.title ?? focused.type}
          onShare={() => share(focus)}
          onExit={requestExit}
        />
      )}
      {asking && <ExitDialog onShare={() => leaveFocus(true)} onDiscard={() => leaveFocus(false)} onStay={() => setAsking(false)} />}
      {dragging && <DropOverlay />}
      {notice && (
        <div className="ttx-notice" role="status">
          {notice}
        </div>
      )}

      {!focus && <StylePanel runtime={runtime} selected={objects.filter((o) => selected.has(o.id))} camera={camera} />}

      {!focus && <Toolbar
        runtime={runtime}
        tool={tool}
        onTool={setTool}
        zoom={camera.z}
        onResetZoom={() => {
          const r = rootRef.current!.getBoundingClientRect()
          setCamera((c) => zoomAt(c, 1 / c.z, r.width / 2, r.height / 2))
        }}
        status={status}
      />}

      {paletteOpen && (
        <Palette runtime={runtime} selection={[...selected]} center={viewCenter} run={runFromPalette} onClose={() => setPaletteOpen(false)} />
      )}
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
