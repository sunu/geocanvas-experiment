import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { CaretLeftIcon, CheckIcon, DotsThreeIcon, PencilSimpleIcon, ShareNetworkIcon, SlidersHorizontalIcon, SparkleIcon } from '@phosphor-icons/react'
import type { Draft, Runtime } from '@ttx/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Board, BoardObject } from '../board/board'
import { useObjects } from '../board/connect'
import { ObjectView } from '../canvas/ObjectView'
import { ExitDialog, useUnshared } from '../canvas/OptionsPanel'
import { isFocusable, objectName, objectUI } from '../canvas/registry'
import { SHEET_ENTRY } from './history'
import { ScaledObject } from './ScaledObject'

/** A widget without a focus mode is drawn at its own size, up to this much larger, to fill the screen's width. */
const MAX_SCALE = 2

interface Props {
  runtime: Runtime
  id: string
  /** This person's draft of the board, for a type with a focus mode (MobileApp makes it on opening). */
  draft?: Draft
  editing: boolean
  onEditing(editing: boolean): void
  /** Set here: what the browser's back does, after it took away the full screen's history entry. */
  back: MutableRefObject<(() => void) | undefined>
  onClose(): void
  /** Ask the agent about it: it is the selection already. None while the agent is turned off on the board. */
  onAsk?: () => void
  /** The palette, on it. */
  onMore(): void
}

/**
 * One widget full screen. A type with a focus mode is in focus mode, as on the canvas (canvas/focus.ts): laid out at the
 * screen's size, with its Options below, on a draft that others see only once it is shared; leaving with unshared
 * changes asks to share them. Any other type is edited live, as on the canvas, drawn at its own size and scaled to the
 * screen's width, so a text measures its height as on the canvas when it is edited here.
 */
export function ObjectSheet({ runtime, id, draft, editing, onEditing, back, onClose, onAsk, onMore }: Props) {
  // In focus, the object as the draft has it: this person's changes, and everyone else's as they arrive.
  const shown = draft?.runtime ?? runtime
  const o = useObjects(shown.board as Board).find((o) => o.id === id)
  const ui = o && objectUI(o.type)
  const [options, setOptions] = useState(false)
  /** Leaving with unshared changes: where to, once the Share / Discard / Keep editing dialog is answered. */
  const [leaving, setLeaving] = useState<() => void>()
  const body = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>()

  useLayoutEffect(() => {
    const el = body.current!
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    measure()
    return () => observer.disconnect()
  }, [])

  const leave = (then: () => void) => (draft?.hasUnshared() ? setLeaving(() => then) : then())
  useEffect(() => {
    back.current = () => {
      // Keep editing must leave it as it was, with an entry for the next back.
      if (draft?.hasUnshared()) history.pushState(SHEET_ENTRY, '')
      leave(onClose)
    }
    return () => void (back.current = undefined)
  })

  if (!o) return null
  const title = objectName(runtime, o)
  return (
    <div className="ttx-ui ttx-m-sheet font-sans" role="dialog" aria-modal="true" aria-label={title}>
      <header className="ttx-m__bar flex items-center gap-1 border-b bg-card px-2">
        <Button variant="ghost" size="icon" title="Back" aria-label="Back" onClick={() => leave(onClose)}>
          <CaretLeftIcon className="size-5" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        {draft && <ShareButton draft={draft} object={o} />}
        {ui?.editable && !draft && (
          <Button variant="ghost" size="icon" title={editing ? 'Done' : 'Edit'} aria-label={editing ? 'Done' : 'Edit'} aria-pressed={editing} onClick={() => onEditing(!editing)}>
            {editing ? <CheckIcon className="size-5" /> : <PencilSimpleIcon className="size-5" />}
          </Button>
        )}
        {draft && (
          <Button variant="ghost" size="icon" className={cn(options && 'bg-accent')} title="Options" aria-label="Options" aria-pressed={options} onClick={() => setOptions(!options)}>
            <SlidersHorizontalIcon className="size-5" />
          </Button>
        )}
        {onAsk && (
          <Button variant="ghost" size="icon" title="Ask the agent about this" aria-label="Ask the agent about this" onClick={() => leave(onAsk)}>
            <SparkleIcon className="size-5" />
          </Button>
        )}
        <Button variant="ghost" size="icon" title="Commands" aria-label="Commands" onClick={onMore}>
          <DotsThreeIcon className="size-5" weight="bold" />
        </Button>
      </header>
      {draft && <DraftNote draft={draft} />}
      <div className="ttx-m-sheet__body" ref={body}>
        {size &&
          (draft ? (
            // Editing, as in focus on the canvas: it has the pointer (a map pans, a notebook scrolls).
            <ObjectView runtime={draft.runtime} object={o} layer={0} editing selected onDone={() => {}} focused={{ rect: { x: 0, y: 0, w: size.w, h: size.h } }} />
          ) : (
            <div className="ttx-m-sheet__scroll">
              <ScaledObject runtime={runtime} object={o} scale={Math.min(MAX_SCALE, (size.w - 32) / o.w)} editing={editing} selected onDone={() => onEditing(false)} />
            </div>
          ))}
      </div>
      {draft && isFocusable(ui) && options && (
        <section className="ttx-m-sheet__options border-t bg-card" aria-label={`${title} options`}>
          <ui.Options runtime={draft.runtime} object={o} editing onDone={() => setOptions(false)} focused />
        </section>
      )}
      {draft && leaving && (
        <ExitDialog
          onStay={() => setLeaving(undefined)}
          onDiscard={leaving}
          onShare={() => {
            share(draft, o)
            leaving()
          }}
        />
      )}
    </div>
  )
}

/** Send the draft's changes to everyone; the type may add its own first (a map shares its view), as the canvas does. */
function share(draft: Draft, o: BoardObject) {
  const ui = objectUI(o.type)
  if (isFocusable(ui)) ui.beforeShare?.(draft.runtime, o)
  draft.share()
}

function ShareButton({ draft, object }: { draft: Draft; object: BoardObject }) {
  const unshared = useUnshared(draft)
  return (
    <Button
      variant={unshared ? 'default' : 'ghost'}
      size="sm"
      className="gap-1.5"
      title={unshared ? 'Show your changes to everyone on this board' : 'Nothing to share: others see what you see'}
      disabled={!unshared}
      onClick={() => share(draft, object)}
    >
      <ShareNetworkIcon className="size-4" />
      Share
    </Button>
  )
}

function DraftNote({ draft }: { draft: Draft }) {
  const unshared = useUnshared(draft)
  if (!unshared) return null
  return <p className="shrink-0 border-b bg-accent px-4 py-1.5 text-xs text-muted-foreground">Only you see your changes until you share them.</p>
}
