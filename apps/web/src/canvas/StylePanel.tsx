import { useLayoutEffect, useRef, useState } from 'react'
import { MinusIcon, PlusIcon, TextAaIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { bounds, toScreen, type Camera } from './camera'
import { requestFit } from './coreUI'
import { objectUI } from './registry'
import { COLORS, DEFAULT_FONT_SIZE, PALETTE, type ColorName } from './style'

/** The fields this panel edits, on any type that has them (ObjectTypeDef.defaultColor, .textSize). */
type Styleable = BoardObject & { color?: ColorName; fontSize?: number }

const sizeOf = (o: BoardObject) => (o as Styleable).fontSize ?? DEFAULT_FONT_SIZE

/** Space between the selection and the panel, and the least space kept to the window's edge (px). */
const GAP = 12
const MARGIN = 16

/**
 * Color and text size for the selected objects whose type has them: a pill floating above the selection (below it
 * when there is no room above), kept inside the window. Hidden when no selected object has either.
 */
export function StylePanel({ runtime, selected, camera }: { runtime: Runtime; selected: BoardObject[]; camera: Camera }) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  // Measured after each render, to center on the selection and to know whether it fits above it.
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (r && (r.width !== size.w || r.height !== size.h)) setSize({ w: r.width, h: r.height })
  })

  const type = (o: BoardObject) => runtime.registry.objectType(o.type)
  const colored = selected.filter((o) => type(o)?.defaultColor)
  const sized = selected.filter((o) => type(o)?.textSize)
  const area = bounds(selected)
  if ((!colored.length && !sized.length) || !area) return null
  const colors = new Set(colored.map((o) => (o as Styleable).color ?? type(o)!.defaultColor!))
  const sizes = new Set(sized.map(sizeOf))

  const at = toScreen(camera, area)
  const above = at.y - GAP - size.h
  const top = above >= MARGIN ? above : Math.min(at.y + at.h + GAP, innerHeight - size.h - MARGIN)
  const left = Math.max(MARGIN, Math.min(at.x + at.w / 2 - size.w / 2, innerWidth - size.w - MARGIN))

  // Each press is its own undo step.
  const setColor = (color: ColorName) => {
    runtime.beginGesture()
    runtime.dispatch('core.object.setColor', { kind: 'objects', ids: colored.map((o) => o.id) }, { color })
  }
  const stepSize = (dir: 1 | -1) => {
    runtime.beginGesture()
    // Only types whose height follows their content (texts) refit; a sticky note keeps its size.
    for (const o of sized) if (objectUI(o.type)?.widthOnly) requestFit(o.id)
    runtime.dispatch(dir === 1 ? 'text.larger' : 'text.smaller', { kind: 'objects', ids: sized.map((o) => o.id) }, {})
  }

  return (
    <div
      ref={ref}
      className="ttx-ui absolute z-[1000003] flex items-center gap-1 rounded-full border bg-card p-1.5 font-sans shadow-[0_2px_2px_rgb(0_0_0/0.1),0_4px_3px_rgb(0_0_0/0.1)]"
      // Hidden until measured, so it does not flash at the wrong place.
      style={{ left, top, visibility: size.w ? 'visible' : 'hidden' }}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {colored.length > 0 &&
        COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={cn('mx-0.5 size-5 shrink-0 rounded-full', colors.size === 1 && colors.has(c) && 'ring-2 ring-primary ring-offset-2 ring-offset-card')}
            style={{ background: PALETTE[c].ink }}
            title={c}
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
          />
        ))}
      {sized.length > 0 && (
        <>
          {colored.length > 0 && <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-5" />}
          <TextAaIcon className="mx-1 size-5 text-muted-foreground" aria-hidden />
          <Button variant="ghost" size="icon-sm" className="rounded-full" title="Smaller text" aria-label="Smaller text" onClick={() => stepSize(-1)}>
            <MinusIcon className="size-4" />
          </Button>
          <span className="w-6 text-center text-sm text-muted-foreground tabular-nums" title="Text size">
            {sizes.size === 1 ? [...sizes][0] : '–'}
          </span>
          <Button variant="ghost" size="icon-sm" className="rounded-full" title="Larger text" aria-label="Larger text" onClick={() => stepSize(1)}>
            <PlusIcon className="size-4" />
          </Button>
        </>
      )}
    </div>
  )
}
