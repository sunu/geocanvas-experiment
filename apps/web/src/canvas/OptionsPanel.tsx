import { useEffect, useSyncExternalStore } from 'react'
import { ArrowsInIcon, ArrowsOutIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import type { Draft, Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import type { FocusableObjectUI } from './registry'

/** Whether the draft has changes others cannot see yet; never, with no draft. */
const noSubscribe = () => () => {}
const useUnshared = (draft: Draft | undefined): boolean => useSyncExternalStore(draft?.subscribe ?? noSubscribe, () => !!draft?.hasUnshared())

interface PanelProps {
  /** What the Options change: the draft's runtime, or the board's for a live type. */
  runtime: Runtime
  /** The private draft, for a type that is not live: it has Share. */
  draft?: Draft
  object: BoardObject
  ui: FocusableObjectUI
  title: string
  onShare(): void
  onExit(): void
  /** Leave focus and show this object on the canvas, e.g. a report item's source. */
  onGoTo?(id: string): void
}

/** The panel beside an object in focus: Share (with a draft), leave focus, and the type's own Options. */
export function OptionsPanel({ runtime, draft, object, ui, title, onShare, onExit, onGoTo }: PanelProps) {
  const unshared = useUnshared(draft)
  return (
    <aside className="ttx-options" aria-label={`${title} options`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="ttx-options__header">
        <span className="ttx-options__title">{title}</span>
        {draft && (
          <button
            type="button"
            className="ttx-options__share"
            title={unshared ? 'Show your changes to everyone on this board' : 'Nothing to share: others see what you see'}
            disabled={!unshared}
            onClick={onShare}
          >
            <ShareNetworkIcon size={16} />
            Share
          </button>
        )}
        <button type="button" title="Leave focus (Esc)" aria-label="Leave focus" onClick={onExit}>
          <ArrowsInIcon size={16} />
        </button>
      </header>
      <p className="ttx-options__note">
        {!draft ? 'Changes are shared as you make them.' : unshared ? 'Only you see your changes until you share them.' : 'Others see this as you do.'}
      </p>
      <div className="ttx-options__body">
        <ui.Options runtime={runtime} object={object} editing onDone={() => {}} focused onGoTo={onGoTo} />
      </div>
    </aside>
  )
}

/** Leaving focus with unshared changes: share them, drop them, or stay. */
export function ExitDialog({ onShare, onDiscard, onStay }: { onShare(): void; onDiscard(): void; onStay(): void }) {
  // Esc is the canvas's: it opened this dialog, and pressed again it means stay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopImmediatePropagation()
      onStay()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onStay])
  return (
    <div className="ttx-dialog__backdrop" onPointerDown={(e) => e.stopPropagation()}>
      <div className="ttx-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ttx-exit-title">
        <h2 id="ttx-exit-title">Share your changes?</h2>
        <p>You changed this in focus. Others see your changes only if you share them.</p>
        <div className="ttx-dialog__actions">
          <button type="button" onClick={onStay}>
            Keep editing
          </button>
          <button type="button" onClick={onDiscard}>
            Discard
          </button>
          <button type="button" className="is-primary" onClick={onShare} autoFocus>
            Share
          </button>
        </div>
      </div>
    </div>
  )
}

/** The ⤢ button in a focusable object's header. */
export function FocusButton({ onFocus }: { onFocus(): void }) {
  return (
    <button
      type="button"
      className="ttx-focusbtn"
      title="Focus: full screen, with options (F)"
      aria-label="Focus"
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={onFocus}
    >
      <ArrowsOutIcon size={14} />
    </button>
  )
}
