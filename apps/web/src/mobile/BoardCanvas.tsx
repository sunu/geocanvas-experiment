import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type MutableRefObject } from 'react'
import { ArrowsInIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import { Button } from '@/components/ui/button'
import type { BoardObject } from '../board/board'
import { bounds, contains, fitRect, toWorld, zoomAt, type Camera, type Rect } from '../canvas/camera'
import { Links } from '../canvas/Links'
import { ObjectView } from '../canvas/ObjectView'
import { pan, pinch, type Point } from './gestures'

/** Moving a finger further than this (px) makes the press a pan, not a tap. */
const TAP_SLOP = 10
const noop = () => {}

interface Props {
  runtime: Runtime
  objects: BoardObject[]
  selection: string[]
  /** The object open full screen: only the full screen draws it (one live map, not two). */
  open?: string
  onOpen(id: string): void
  /** Set here: fits the view to an object, or to the whole board. */
  reveal: MutableRefObject<(id: string | undefined) => void>
}

/**
 * The board as it is laid out on the canvas, to look at on a phone: one finger pans, two fingers zoom, a tap on a
 * widget opens it full screen and a tap on a frame zooms to it. Nothing here moves or changes an object; editing is
 * the list's and the full screen's. The camera is this view's own, as on the canvas, and maps show snapshots.
 */
export function BoardCanvas({ runtime, objects, selection, open, onOpen, reveal }: Props) {
  const root = useRef<HTMLDivElement>(null)
  const [camera, setCamera] = useState<Camera>()
  const byId = useMemo(() => new Map(objects.map((o) => [o.id, o])), [objects])
  const selected = useMemo(() => new Set(selection), [selection])
  /** The fingers on the screen, and the camera and fingers when the current gesture (or its last change of fingers) began. */
  const touch = useRef<{ points: Map<number, Point>; start?: { camera: Camera; points: Point[] }; moved: boolean }>({ points: new Map(), moved: false })

  const fit = (r: Rect | undefined) => {
    const el = root.current
    if (el) setCamera(r ? fitRect(r, el.clientWidth, el.clientHeight, 24) : { x: el.clientWidth / 2, y: el.clientHeight / 2, z: 1 })
  }
  useLayoutEffect(() => fit(bounds(objects)), [])
  useEffect(() => {
    reveal.current = (id) => fit(id ? byId.get(id) : bounds(objects))
  })

  const point = (e: { clientX: number; clientY: number }): Point => {
    const r = root.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  /** A gesture starts again whenever a finger comes or goes, so lifting one of two fingers does not jump. */
  const restart = (cam: Camera) => {
    const t = touch.current
    t.start = t.points.size ? { camera: cam, points: [...t.points.values()] } : undefined
  }

  /** A tap: the widget under it opens; a frame (with nothing on it there) zooms the view to it. */
  function tap(at: Point, cam: Camera) {
    const w = toWorld(cam, at.x, at.y)
    const hit = [...objects].reverse().filter((o) => o.id !== open && contains(o, { x: w.x, y: w.y, w: 0, h: 0 }))
    const widget = hit.find((o) => o.type !== 'frame')
    if (widget) onOpen(widget.id)
    else if (hit[0]) fit(hit[0])
  }

  if (!camera) return <div ref={root} className="ttx-m-canvas" />
  return (
    <div
      ref={root}
      className="ttx-m-canvas"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        const t = touch.current
        if (!t.points.size) t.moved = false
        t.points.set(e.pointerId, point(e))
        restart(camera)
      }}
      onPointerMove={(e) => {
        const t = touch.current
        if (!t.points.has(e.pointerId) || !t.start) return
        t.points.set(e.pointerId, point(e))
        const now = [...t.points.values()]
        const { camera: from, points: was } = t.start
        if (now.length === 1 && Math.hypot(now[0]!.x - was[0]!.x, now[0]!.y - was[0]!.y) <= TAP_SLOP && !t.moved) return
        t.moved = true
        setCamera(now.length >= 2 ? pinch(from, [was[0]!, was[1]!], [now[0]!, now[1]!]) : pan(from, was[0]!, now[0]!))
      }}
      onPointerUp={(e) => {
        const t = touch.current
        const at = t.points.get(e.pointerId)
        t.points.delete(e.pointerId)
        if (at && !t.moved && !t.points.size) tap(at, camera)
        restart(camera)
      }}
      onPointerCancel={(e) => {
        touch.current.points.delete(e.pointerId)
        restart(camera)
      }}
      // A mouse or trackpad, when the phone layout is opened on a computer: scroll pans, pinch or ⌘+scroll zooms.
      onWheel={(e) => {
        const p = point(e)
        setCamera((c) => c && (e.ctrlKey || e.metaKey ? zoomAt(c, Math.exp(-e.deltaY / 200), p.x, p.y) : { ...c, x: c.x - e.deltaX, y: c.y - e.deltaY }))
      }}
    >
      <div className="ttx-world" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.z})`, '--ttx-zoom': camera.z } as CSSProperties}>
        {objects.map((o, i) =>
          o.id === open ? null : <ObjectView key={o.id} runtime={runtime} object={o} layer={i} editing={false} selected={selected.has(o.id)} onDone={noop} />,
        )}
        {/* Above frames, under everything else, as on the canvas. */}
        <Links objects={objects} byId={byId} selected={selected} style={{ zIndex: objects.reduce((top, o, i) => (o.type === 'frame' ? i : top), -1) }} />
      </div>
      <Button variant="outline" size="icon" className="ttx-m-canvas__fit bg-card shadow-md" title="Show the whole board" aria-label="Show the whole board" onPointerDown={(e) => e.stopPropagation()} onClick={() => fit(bounds(objects))}>
        <ArrowsInIcon className="size-5" />
      </Button>
    </div>
  )
}
