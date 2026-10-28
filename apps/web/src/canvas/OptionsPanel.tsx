import { useEffect, useSyncExternalStore } from 'react'
import { ArrowsInIcon, ArrowsOutIcon, ShareNetworkIcon } from '@phosphor-icons/react'
import type { Draft } from '@ttx/core'
import type { BoardObject } from '../board/board'
import type { FocusableObjectUI } from './registry'

/** Whether the draft has changes others cannot see yet. */
const useUnshared = (draft: Draft): boolean => useSyncExternalStore(draft.subscribe, () => draft.hasUnshared())

interface PanelProps {
  draft: Draft
  object: BoardObject
  ui: FocusableObjectUI
  title: string
  onShare(): void
  onExit(): void
}

/** The panel beside an object in focus: Share, leave focus, and the type's own Options on the draft. */
export function OptionsPanel({ draft, object, ui, title, onShare, onExit }: PanelProps) {
  const unshared = useUnshared(draft)
  return (
    <aside className="ttx-options" aria-label={`${title} options`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <header className="ttx-options__header">
        <span className="ttx-options__title">{title}</span>
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
        <button type="button" title="Leave focus (Esc)" aria-label="Leave focus" onClick={onExit}>
          <ArrowsInIcon size={16} />
        </button>
      </header>
      <p className="ttx-options__note">{unshared ? 'Only you see your changes until you share them.' : 'Others see this as you do.'}</p>
      <div className="ttx-options__body">
        <ui.Options runtime={draft.runtime} object={object} editing onDone={() => {}} focused />
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
