import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type * as Y from 'yjs'
import { Draft, Nav, type Chat, type ChatEntry, type Runtime, type TargetRef } from '@ttx/core'
import type { ReportBoardObject } from '@ttx/plugins'
import type { Board, BoardObject } from '../board/board'
import { useObjects } from '../board/connect'
import { templatesOn, typeOn, usePluginsOff } from '../board/plugins'
import { objectFromHash, withoutObject } from '../board/room'
import { cursorSender, presenterOf, publishSelection, useAgentActivities, usePeers, type Awareness } from '../board/presence'
import { Palette } from '../palette/Palette'
import { bounds, fitRect, fitView, intersects, rectFrom, toScreen, toWorld, zoomAt, withFramed, type Camera, type Rect } from './camera'
import { requestFit } from './coreUI'
import { animateCamera, fillCamera, focusArea, focusedLayout } from './focus'
import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu'
import { ObjectMenu } from './ObjectMenu'
import { ObjectPanel } from './ObjectPanel'
import { ObjectView } from './ObjectView'
import { ExitDialog, OptionsPanel } from './OptionsPanel'
import { useAgentTouched } from '../board/agentActivity'
import { Links } from './Links'
import { AgentCursorLayer, FocusCursor, Peers } from './Peers'
import { useAgentCursors, type Point } from './agentCursor'
import { isFocusable, objectUI } from './registry'
import { placeFiles } from '../uploads/drop'
import { DropConfirm } from '../reports/DropConfirm'
import { dropQuestion, idsAt, reportUnder } from '../reports/drop'
import { titleOf } from '../reports/reports'
import { DropOverlay, PendingUploads } from '../uploads/PendingUploads'
import { StylePanel } from './StylePanel'
import { publishViewState } from './viewState'
import { publishViewport } from './viewport'
import { liveMap } from '../map/live'
import { bindPresence, presentation, presentView, setFollowed, unfollow, usePresentation } from './presentation'
import { tools, Toolbar, type Tool } from './Toolbar'

const MIN_SIZE = 16
/** Pointer travel (screen px) before a press becomes a drag. */
const DRAG_THRESHOLD = 3
/** How far inside the canvas edge (px) what the agent works on must be for the asker's camera to stay where it is. */
const FOLLOW_MARGIN = 48
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
/** Objects dropped on a report, waiting for Add or Cancel (reports/DropConfirm.tsx). */
interface PendingDrop {
  reportId: string
  /** What was dragged: the selection. A frame brings its contents through report.addItems. */
  ids: string[]
  /** Where everything that moved was before the drag, to put it back on Add. */
  starts: { id: string; x: number; y: number }[]
  /** The drop's screen point, in the canvas. */
  at: { x: number; y: number }
  question: string
}

/** The drop zone: the report under dragged objects, outlined, with where they will go. In screen space. */
function DropZone({ rect: r, title }: { rect: Rect; title: string }) {
  return (
    <div className="ttx-dropzone" style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
      <span className="ttx-dropzone__label">Drop to add to {title}</span>
    </div>
  )
}

interface Focus {
  id: string
  /** The camera to go back to. */
  saved: Camera
  /** This person's private copy of the board; none for a live type (a report), which edits the board itself. */
  draft: Draft | null
  /** The type keeps the agent chat open on the left (canvas/registry.ts FocusableObjectUI). */
  keepChat: boolean
  /** The type fills the screen to its edges (canvas/registry.ts FocusableObjectUI). */
  fullScreen: boolean
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
  onMove: (dx: number, dy: number, e: PointerEvent) => void,
  onUp?: (moved: boolean, e: PointerEvent) => void,
) {
  const sx = e.clientX
  const sy = e.clientY
  let moved = false
  const move = (me: PointerEvent) => {
    if (!moved && Math.hypot(me.clientX - sx, me.clientY - sy) < DRAG_THRESHOLD) return
    moved = true
    onMove(me.clientX - sx, me.clientY - sy, me)
  }
  const up = (ue: PointerEvent) => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    onUp?.(moved, ue)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

/**
 * The canvas. It reads the board and writes only by dispatching ops on the runtime: one gesture
 * (a press, a key, a button) is one runtime.beginGesture(), so one undo step.
 */
export function Canvas({ runtime, chat, awareness, synced, onUploads }: {
  runtime: Runtime
  chat: Chat
  awareness: Awareness
  /** Resolves once the room's doc has synced, so a linked object is on the board. */
  synced: Promise<void>
  onUploads(): void
}) {
  const board = runtime.board as Board
  const objects = useObjects(board)
  const pluginsOff = usePluginsOff(runtime)
  const peers = usePeers(awareness)
  const agentTouched = useAgentTouched(runtime)
  const me = (awareness.getLocalState() as { user?: { id?: string } } | null)?.user?.id
  const agentCursors = useAgentCursors(runtime, chat, me)
  const agentActivities = useAgentActivities(awareness)
  // What an agent added is outlined once its cursor gets there, when the object appears.
  const agentMarked = useMemo(
    () => (agentCursors.arriving.size ? new Set([...agentTouched].filter((id) => !agentCursors.arriving.has(id))) : agentTouched),
    [agentTouched, agentCursors.arriving],
  )
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, z: 1 })
  const [tool, setTool] = useState<Tool>('select')
  const [selection, setSelection] = useState<Set<string>>(() => new Set())
  const [editing, setEditing] = useState<string | null>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null) // screen
  const [draft, setDraft] = useState<Rect | null>(null) // world, while drawing a new object
  const [spaceHeld, setSpaceHeld] = useState(false)
  /** 'templates': the palette shows only templates (the toolbar's Templates button). */
  const [paletteOpen, setPaletteOpen] = useState<false | 'all' | 'templates'>(false)
  const [focus, setFocus] = useState<Focus | null>(null)
  /** Leaving focus with unshared changes: the Share / Discard / Keep editing dialog is open. */
  const [asking, setAsking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Reports (agent-docs/tasks/reports.md §4): the report under objects being dragged, and a drop waiting for Add or Cancel. */
  const [dropOn, setDropOn] = useState<{ report: string; dragged: Set<string> } | null>(null)
  const [pendingDrop, setPendingDrop] = useState<PendingDrop | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const focusRef = useRef(focus)
  focusRef.current = focus
  const stopAnimation = useRef<() => void>(undefined)

  // The focused object as the draft has it: this person's changes, and everyone else's as they arrive.
  const draftBoard = focus?.draft?.runtime.board as Board | undefined
  const draftObjects = useSyncExternalStore(draftBoard?.subscribe ?? noSubscribe, draftBoard?.snapshot ?? noObjects)
  const focused = focus ? (focus.draft ? draftObjects : objects).find((o) => o.id === focus.id) : undefined
  /** What focus edits: the draft, or the board itself for a live type. */
  const focusRuntime = focus?.draft?.runtime ?? runtime
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

  // What this person sees, for views that ration something by it (a live map for only some maps: map/budget.ts).
  const [size, setSize] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = rootRef.current!
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const focusId = focus?.id ?? null
  useEffect(
    () => publishViewport({ camera, width: size.w, height: size.h, objects, selected, editing: editingId, focused: focusId }),
    [camera, size, objects, selected, editingId, focusId],
  )

  // This person's camera, for view ops (zoom to fit, zoom to selection) from the palette or tools.
  useEffect(() => {
    const show = (r: Rect | undefined) => {
      const el = rootRef.current
      if (!r || !el) return
      unfollow()
      setCamera(fitRect(r, el.clientWidth, el.clientHeight))
    }
    runtime.view = {
      fitAll: () => show(bounds(board.list())),
      zoomTo: (ids) => show(bounds(ids.map((id) => board.get(id)).filter((o) => !!o))),
      resetZoom: () => {
        const el = rootRef.current
        unfollow()
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
    // A press anywhere else answers a pending drop with Cancel: the objects stay where they were dropped.
    if (pendingDrop) setPendingDrop(null)
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
      following.current = false
      unfollow()
      trackDrag(e, (dx, dy) => setCamera({ ...start, x: start.x + dx, y: start.y + dy }))
      return
    }

    if (tool !== 'select') {
      // 'box:ellipse' is the box tool drawing an ellipse (canvas/Toolbar.tsx).
      const [type, shape] = tool.split(':') as [string, string | undefined]
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
          const newId = runtime.dispatch(`${type}.add`, { kind: 'canvas' }, shape ? { ...r, shape } : r).created?.[0]
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
      // A frame takes what is inside it along.
      const starts = withFramed(objects, moving)
      // Dropping on a report asks to add what was dragged, unless it is all reports.
      const dragged = new Set(starts.map((o) => o.id))
      const droppable = [...moving].some((m) => board.get(m)?.type !== 'report')
      const reportAt = (pe: PointerEvent) => (droppable ? reportUnder(idsAt(pe.clientX, pe.clientY), board, dragged) : undefined)
      trackDrag(
        e,
        (dx, dy, me) => {
          const z = cameraRef.current.z
          const alive = starts.filter((o) => board.get(o.id)) // someone else may delete one mid-drag
          if (!alive.length) return
          const rects = Object.fromEntries(alive.map((o) => [o.id, { x: o.x + dx / z, y: o.y + dy / z }]))
          runtime.dispatch('core.object.setRect', objectsTarget(Object.keys(rects)), { rects })
          const over = reportAt(me)
          setDropOn((d) => (over ? (d?.report === over.id ? d : { report: over.id, dragged }) : null))
        },
        (moved, ue) => {
          setDropOn(null)
          const report = moved ? reportAt(ue) : undefined
          if (!report) return
          setPendingDrop({
            reportId: report.id,
            ids: [...moving],
            starts: starts.map(({ id, x, y }) => ({ id, x, y })),
            at: screenPoint(ue),
            question: dropQuestion(board, [...moving], titleOf(board, report)),
          })
        },
      )
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
      following.current = false
      unfollow()
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
        // In focus only Esc (leave) and undo, on what focus edits. The exit dialog handles its own Esc. An Esc that
        // closed something else first (a select or menu in the Options panel: Radix prevents its default), or that was
        // typed in a field (the chat a report keeps open, a name in the Options), does not leave.
        const typing = !!(e.target as HTMLElement).closest?.('textarea, input, select, [contenteditable="true"]')
        if (e.key === 'Escape') {
          if (!e.defaultPrevented && !typing) requestExit()
        }
        else if (mod && e.key.toLowerCase() === 'z' && !typing) {
          e.preventDefault()
          if (e.shiftKey) focusRuntime.redo()
          else focusRuntime.undo()
        }
        return
      }
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((open) => (open ? false : 'all'))
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
          unfollow()
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
        // ⇧ with a key picks the tool listed as '⇧<key>' (the arrow is ⇧L), else the plain one.
        const k = e.key.toUpperCase()
        const t = (e.shiftKey && tools().find((t) => t.key === `⇧${k}`)) || tools().find((t) => t.key.toUpperCase() === k)
        if (t && typeOn(runtime, runtime.disabledPlugins(), t.tool)) setTool(t.tool)
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

  // The camera follows the agent working for this person when what it works on goes out of view, at the same zoom,
  // until they move the view themselves; their next request starts it again. Others' agents never move it.
  const following = useRef(true)
  useEffect(() => {
    if (!me) return
    const onChat = (event: Y.YArrayEvent<ChatEntry>) => {
      const asked = event.changes.delta.some((d) => ((d.insert ?? []) as ChatEntry[]).some((e) => e.kind === 'user' && e.actor.id === me))
      if (asked) following.current = true
    }
    chat.entries.observe(onChat)
    return () => chat.entries.unobserve(onChat)
  }, [chat, me])
  useEffect(() => {
    const r = agentCursors.target
    const el = rootRef.current
    if (!r || !el || !following.current || focusRef.current || presentation().following !== null) return
    const s = toScreen(cameraRef.current, r)
    const m = FOLLOW_MARGIN
    if (s.x >= m && s.y >= m && s.x + s.w <= el.clientWidth - m && s.y + s.h <= el.clientHeight - m) return
    goToPoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentCursors.target])

  /** Move the camera so world point `p` is in the middle, at the same zoom (an off-screen agent's marker). */
  function goToPoint(p: Point) {
    unfollow()
    const el = rootRef.current!
    const from = cameraRef.current
    stopAnimation.current?.()
    stopAnimation.current = animateCamera(from, { x: el.clientWidth / 2 - p.x * from.z, y: el.clientHeight / 2 - p.y * from.z, z: from.z }, setCamera)
  }

  // Presentation mode (canvas/presentation.ts). The presenter shares the world rectangle they see; in focus, the
  // focused object's rectangle on the board, since followers cannot see the presenter's draft.
  const { presenting, following: followingId } = usePresentation()
  useEffect(() => bindPresence(awareness), [awareness])
  const focusedRect = focus ? byId.get(focus.id) : undefined
  useEffect(() => {
    if (presenting === null || !size.w || !size.h) return
    const tl = toWorld(camera, 0, 0)
    const view = focusedRect
      ? { x: focusedRect.x, y: focusedRect.y, w: focusedRect.w, h: focusedRect.h }
      : { x: tl.x, y: tl.y, w: size.w / camera.z, h: size.h / camera.z }
    presentView(view, focusedRect?.id)
  }, [presenting, camera, size, focusedRect])

  // A follower's camera shows all of the presenter's view. Following ends when the presenter stops or leaves, and
  // when this person moves the view themselves (unfollow above).
  const presenter = presenterOf(peers)
  const followed = followingId !== null && presenter?.clientId === followingId ? presenter : undefined
  const followedView = followed?.presenting.view
  const followedKey = followedView && `${followedView.x},${followedView.y},${followedView.w},${followedView.h}`
  useEffect(() => {
    if (followingId !== null && !followed) unfollow()
    setFollowed(followed?.presenting)
  }, [followingId, followed])
  useEffect(() => {
    const el = rootRef.current
    if (!followedView || !el || focusRef.current) return
    stopAnimation.current?.()
    stopAnimation.current = animateCamera(cameraRef.current, fitView(followedView, el.clientWidth, el.clientHeight), setCamera)
    // On leaving focus too: the camera goes to the presenter's view, not back to where this person was.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedKey, size, focusId])

  // A follower opens what the presenter has in focus, on their own draft, and leaves focus with them. One with
  // unshared changes stays in focus and stops following, so nothing is lost.
  const followedFocus = followed?.presenting.focus
  const isFollowing = !!followed
  useEffect(() => {
    if (!isFollowing) return
    const enter = (id: string) => {
      try {
        enterFocus(id, { following: true })
      } catch {
        // Not on this board yet, or a type this tab cannot focus: follow the canvas only.
      }
    }
    const f = focusRef.current
    if (f?.id === followedFocus) return
    if (!f) return void (followedFocus && enter(followedFocus))
    if (f.draft?.hasUnshared()) return void unfollow()
    leaveFocus(false, followedFocus ? () => enter(followedFocus) : undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [followedFocus, isFollowing])

  /** Open an object in focus mode: zoom until it fills the screen, then lay it out at that size, on a draft unless its type is live. */
  function enterFocus(id: string, { following = false } = {}) {
    if (focusRef.current) return
    const o = board.get(id)
    const ui = o && objectUI(o.type)
    if (!o || !isFocusable(ui)) throw new Error(`${o ? runtime.registry.objectType(o.type)?.title : 'This object'} has no focus mode`)
    const el = rootRef.current!
    const keepChat = !!ui.keepChat
    const fullScreen = !!ui.fullScreen
    const area = focusArea(el.clientWidth, el.clientHeight, { full: fullScreen })
    const saved = cameraRef.current
    // Opening something themselves ends following; opening what the presenter opened is following.
    if (!following) unfollow()
    setEditing(null)
    setPaletteOpen(false)
    setSelection(new Set([id]))
    setFocus({ id, saved, draft: ui.live ? null : new Draft(runtime), keepChat, fullScreen, area, rect: null })
    stopAnimation.current?.()
    stopAnimation.current = animateCamera(saved, fillCamera(o, area), setCamera, () => {
      const layout = focusedLayout(o, area)
      setFocus((f) => (f?.id === id ? { ...f, rect: layout.rect } : f))
      setCamera(layout.camera)
    })
  }
  const enterFocusRef = useRef(enterFocus)
  enterFocusRef.current = enterFocus

  /**
   * Add a drop to its report: the objects go back where they were, then are added, in the drag's own gesture, so
   * one undo takes back both. Nothing calls beginGesture between the drag and this (DropConfirm keeps presses).
   */
  function addDrop(d: PendingDrop) {
    setPendingDrop(null)
    const alive = d.starts.filter((o) => board.get(o.id))
    if (alive.length) runtime.dispatch('core.object.setRect', objectsTarget(alive.map((o) => o.id)), { rects: Object.fromEntries(alive.map(({ id, x, y }) => [id, { x, y }])) })
    const r = runtime.dispatch('report.addItems', objectsTarget(d.ids.filter((id) => board.get(id))), { reportId: d.reportId })
    setNotice(r.status === 'applied' ? (r.summary ?? 'Added to the report') : (r.error ?? 'Could not add to the report'))
  }

  /** Send the draft's changes to everyone; the type may add its own first (a map shares its view). */
  function share(f: Focus) {
    if (!f.draft) return
    const o = f.draft.runtime.board.get(f.id) as BoardObject | undefined
    const ui = o && objectUI(o.type)
    if (o && isFocusable(ui)) ui.beforeShare?.(f.draft.runtime, o)
    f.draft.share()
  }

  /** Esc, the leave button or a press outside: ask first if there is anything unshared. */
  function requestExit() {
    const f = focusRef.current
    if (!f) return
    unfollow()
    if (f.draft?.hasUnshared()) setAsking(true)
    else leaveFocus(false)
  }

  /** Leave focus, sharing the draft's changes or dropping them, and zoom back out to where this person was; then `then`. */
  function leaveFocus(shareChanges: boolean, then?: () => void) {
    const f = focusRef.current
    if (!f) return
    if (shareChanges) share(f)
    stopAnimation.current?.()
    setAsking(false)
    setFocus(null)
    // `then` may run before the next render (the object is gone) and open focus again (a follower).
    focusRef.current = null
    const o = board.get(f.id)
    if (!o) {
      setCamera(f.saved)
      return then?.()
    }
    const from = fillCamera(o, f.area)
    setCamera(from)
    stopAnimation.current = animateCamera(from, f.saved, setCamera, then)
  }

  /** From focus, show another object on the canvas: leave focus, select it, and zoom to it (a report item's source). */
  function goTo(id: string) {
    leaveFocus(false, () => {
      if (!board.get(id)) return
      setSelection(new Set([id]))
      runtime.view?.zoomTo([id])
    })
  }

  /** Show one object in the middle of the view, selected (a board link's object). */
  function show(id: string) {
    const f = focusRef.current
    if (f?.draft?.hasUnshared()) return setNotice('Share or discard your changes in focus to see the linked object.')
    if (!board.get(id)) return setNotice('The linked object is no longer on the board.')
    if (f) return goTo(id)
    setSelection(new Set([id]))
    runtime.view?.zoomTo([id])
  }
  const showRef = useRef(show)
  showRef.current = show

  // A link to an object (#room=<id>&obj=<object id>): show it once the board has synced, and again for each link
  // pasted into this tab. The object is then taken out of the URL, so the same link pasted again shows it again.
  useEffect(() => {
    let live = true
    const onHash = () => {
      const id = objectFromHash(location.hash)
      if (!id || !live) return
      history.replaceState(null, '', withoutObject(location.hash))
      showRef.current(id)
    }
    void synced.then(onHash)
    window.addEventListener('hashchange', onHash)
    return () => {
      live = false
      window.removeEventListener('hashchange', onHash)
    }
  }, [synced])

  // An agent asked to show this person an object (core.view.show). Listened to from the sync on, so the request
  // the doc already had is not shown again on load. Not by time: the Worker's clock and this browser's differ.
  useEffect(() => {
    let stop: (() => void) | undefined
    let live = true
    void synced.then(() => {
      if (live) stop = new Nav(board.doc).subscribe(runtime.actor.id, (r) => showRef.current(r.id))
    })
    return () => {
      live = false
      stop?.()
    }
  }, [board, runtime, synced])

  // The draft lives as long as its focus. Closed after the object's view has let go of it.
  useEffect(() => {
    const draft = focus?.draft
    if (!draft) return
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
      const area = focusArea(el.clientWidth, el.clientHeight, { full: f.fullScreen })
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

  /**
   * This person's cursor for presence (board/presence.ts `PeerCursor`). In focus, anchored to the focused object: its
   * share of the box, the place under it on a map, and that share of the object's stored rectangle as the world point.
   * Off the object (over the Options panel), none.
   */
  function cursorAt(e: ReactPointerEvent) {
    const p = screenPoint(e)
    const f = focusRef.current
    if (!f) return toWorld(cameraRef.current, p.x, p.y)
    const stored = board.get(f.id)
    if (!f.rect || !stored) return null
    const box = toScreen(cameraRef.current, f.rect)
    const u = (p.x - box.x) / box.w
    const v = (p.y - box.y) / box.h
    if (u < 0 || u > 1 || v < 0 || v > 1) return null
    const map = liveMap(f.id)
    let lngLat: [number, number] | undefined
    if (map) {
      const r = map.getCanvas().getBoundingClientRect()
      const at = map.unproject([e.clientX - r.left, e.clientY - r.top])
      lngLat = [at.lng, at.lat]
    }
    return { x: stored.x + u * stored.w, y: stored.y + v * stored.h, in: { id: f.id, u, v, ...(lngLat && { lngLat }) } }
  }

  const viewCenter = () => {
    const el = rootRef.current!
    return toWorld(cameraRef.current, el.clientWidth / 2, el.clientHeight / 2)
  }

  const single = selected.size === 1 && !editingId && !focus ? byId.get([...selected][0]!) : undefined
  useEffect(() => publishViewState({ zoom: camera.z, focused: !!focus }), [camera.z, focus])
  const grid = GRID * camera.z
  // The dots' radius follows the zoom like their spacing does, but not below half a pixel, so they stay drawn while they fade.
  const dotRadius = Math.max(0.5, camera.z)
  const dots = Math.min(1, Math.max(0, (camera.z - DOTS_GONE) / (DOTS_FULL - DOTS_GONE)))

  /** A right click on an object opens its menu, on the selection; on anything else the menu stays shut. */
  function onContextMenuCapture(e: ReactMouseEvent) {
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')?.dataset.id
    if (!id || !byId.has(id) || focus || editingId) {
      e.preventDefault()
      e.stopPropagation()
    } else if (!selected.has(id)) {
      setSelection(new Set([id]))
    }
  }

  return (
    <ContextMenu>
    <ContextMenuTrigger asChild>
    <div
      ref={rootRef}
      onContextMenuCapture={onContextMenuCapture}
      className={`ttx-canvas ${followed ? 'is-following' : ''} ${spaceHeld || tool === 'hand' ? 'is-panning' : ''} ${tool !== 'select' && tool !== 'hand' ? 'is-drawing' : ''} ${focus ? 'is-focus' : ''} ${focus?.keepChat ? 'keeps-chat' : ''}`}
      // The type in focus, for its own look of the whole view (canvas/focus.css: report mode has no dotted canvas).
      data-focus={focused?.type}
      style={{ backgroundSize: `${grid}px ${grid}px`, backgroundPosition: `${camera.x}px ${camera.y}px`, '--ttx-dots': dots, '--ttx-dot-r': dotRadius, '--ttx-presenter': followed?.user.color } as CSSProperties}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onPointerMove={(e) => sendCursor(cursorAt(e))}
      onPointerLeave={() => sendCursor(null)}
    >
      <div className="ttx-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, '--ttx-zoom': camera.z } as CSSProperties}>
        {objects.map((o, i) =>
          o.id === focus?.id ? (
            // Same key and place as when not focused, so the view is not remounted (a map keeps its WebGL contexts).
            <ObjectView
              key={o.id}
              runtime={focusRuntime}
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
              // Dragged over a report: above everything, the report included.
              layer={dropOn?.dragged.has(o.id) ? objects.length + 1 : i}
              dropping={!!dropOn?.dragged.has(o.id)}
              editing={o.id === editingId}
              selected={selected.has(o.id)}
              arriving={agentCursors.arriving.has(o.id)}
              busy={agentCursors.busy.get(o.id)}
              onDone={() => setEditing(null)}
              onFocus={isFocusable(objectUI(o.type)) ? () => enterFocus(o.id) : undefined}
            />
          ),
        )}
        {/* After the objects, at the top frame's place: above frames, under everything else (-1: under all). */}
        {!focus && (
          <Links objects={objects} byId={byId} selected={selected} style={{ zIndex: objects.reduce((top, o, i) => (o.type === 'frame' ? i : top), -1) }} />
        )}
        {draft && <div className="ttx-draft" style={{ left: draft.x, top: draft.y, width: draft.w, height: draft.h }} />}
        {!focus && <PendingUploads />}
      </div>

      {/* Selection chrome in screen space, so outlines and handles keep their size at any zoom. */}
      <div className="ttx-chrome">
        {/* Others' cursors and outlines are at stored positions and sizes, which the focused layout does not match. */}
        {!focus && <Peers peers={peers} camera={camera} byId={byId} agentTouched={agentMarked} />}
        {/* In focus, only the presenter's cursor, on this person's layout of the object (presentation mode). */}
        {focus?.rect && presenter && <FocusCursor peer={presenter} objectId={focus.id} box={toScreen(camera, focus.rect)} rootRef={rootRef} />}
        {!focus && <AgentCursorLayer {...agentCursors} activities={agentActivities} camera={camera} rootRef={rootRef} onGoTo={goToPoint} />}
        {/* Not around objects dragged over a report: they are drawn smaller there (ObjectView `dropping`). */}
        {!focus && [...selected].filter((id) => !dropOn?.dragged.has(id)).map((id) => {
          const r = toScreen(camera, byId.get(id)!)
          return <div key={id} className="ttx-selection" style={{ left: r.x, top: r.y, width: r.w, height: r.h }} />
        })}
        {single &&
          !dropOn &&
          HANDLES.map((h) => {
            const r = toScreen(camera, single)
            const x = h.includes('w') ? r.x : r.x + r.w
            const y = h.includes('n') ? r.y : r.y + r.h
            return <div key={h} data-handle={h} className={`ttx-handle ttx-handle--${h}`} style={{ left: x, top: y }} />
          })}
        {marquee && <div className="ttx-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
        {dropOn && byId.get(dropOn.report) && (
          <DropZone rect={toScreen(camera, byId.get(dropOn.report)!)} title={titleOf(board, byId.get(dropOn.report) as ReportBoardObject)} />
        )}
      </div>
      {pendingDrop && (
        <DropConfirm at={pendingDrop.at} question={pendingDrop.question} onAdd={() => addDrop(pendingDrop)} onCancel={() => setPendingDrop(null)} />
      )}

      {focus && focused && isFocusable(focusedUI) && (
        <OptionsPanel
          runtime={focusRuntime}
          draft={focus.draft ?? undefined}
          object={focused}
          ui={focusedUI}
          // The object's own title: its name, else what its type's panel calls it (a report's frame title), else its type.
          title={focused.name || focusedUI.panel?.(focused, board).title || (runtime.registry.objectType(focused.type)?.title ?? focused.type)}
          onShare={() => share(focus)}
          onExit={requestExit}
          onGoTo={goTo}
        />
      )}
      {asking && <ExitDialog onShare={() => leaveFocus(true)} onDiscard={() => leaveFocus(false)} onStay={() => setAsking(false)} />}
      {dragging && <DropOverlay />}
      {notice && (
        <div className="ttx-notice" role="status">
          {notice}
        </div>
      )}

      {single && objectUI(single.type)?.panel && (
        <ObjectPanel
          runtime={runtime}
          chat={chat}
          object={single}
          info={objectUI(single.type)!.panel!(single, board)}
          onOpen={isFocusable(objectUI(single.type)) ? () => enterFocus(single.id) : undefined}
          onSelect={(ids) => setSelection(new Set(ids))}
          notify={setNotice}
        />
      )}

      {!focus && <StylePanel runtime={runtime} selected={objects.filter((o) => selected.has(o.id))} camera={camera} />}

      {!focus && <Toolbar
        tool={tool}
        onTool={setTool}
        onFiles={(files) => placeFiles(runtime, files, viewCenter())}
        onUploads={onUploads}
        onTemplates={() => setPaletteOpen('templates')}
        on={(t) => typeOn(runtime, pluginsOff, t)}
        templates={templatesOn(runtime, pluginsOff)}
      />}

      {paletteOpen && (
        <Palette
          runtime={runtime}
          selection={[...selected]}
          center={viewCenter}
          run={runFromPalette}
          onClose={() => setPaletteOpen(false)}
          templates={paletteOpen === 'templates'}
        />
      )}
    </div>
    </ContextMenuTrigger>
    <ObjectMenu runtime={runtime} ids={[...selected]} onSelect={(ids) => setSelection(new Set(ids))} notify={setNotice} />
    </ContextMenu>
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
