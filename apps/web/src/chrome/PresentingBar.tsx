import { XIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { presenterOf, usePeers, type Awareness } from '../board/presence'
import { dismiss, follow, stopPresenting, unfollow, usePresentation } from '../canvas/presentation'

/**
 * Presentation mode's bar, at the top center (canvas/presentation.ts): the presenter's own ("You are presenting"),
 * the prompt to join someone who presents, and, while following, the way out. "Not now" only shrinks the prompt: it
 * stays as long as they present, so a person can join later.
 */
export function PresentingBar({ awareness }: { awareness: Awareness }) {
  const { presenting, following, dismissed } = usePresentation()
  const presenter = presenterOf(usePeers(awareness))
  const small = !!presenter && presenting === null && following !== presenter.clientId && dismissed === presenter.clientId
  if (presenting === null && !presenter) return null
  return (
    <div
      role="status"
      className={cn(
        'ttx-ui ttx-shell fixed top-20 left-1/2 z-[1000002] flex -translate-x-1/2 items-center gap-2 rounded-lg border bg-card font-sans text-sm shadow-sm',
        small ? 'py-1 pr-1 pl-2.5' : 'py-1.5 pr-1.5 pl-3',
      )}
    >
      {presenting !== null ? (
        <>
          <span className="size-2 shrink-0 rounded-full bg-red-500" aria-hidden />
          You are presenting
          <Button size="sm" variant="secondary" onClick={stopPresenting}>
            Stop presenting
          </Button>
        </>
      ) : presenter && (
        <>
          <span className="size-2 shrink-0 rounded-full" style={{ background: presenter.user.color }} aria-hidden />
          {following === presenter.clientId ? (
            <>
              <span>
                Following <strong className="font-medium">{presenter.user.name}</strong>
              </span>
              <Button size="sm" variant="secondary" onClick={unfollow}>
                Stop following
              </Button>
            </>
          ) : (
            <>
              <span>
                <strong className="font-medium">{presenter.user.name}</strong> is presenting{small ? '' : '. Join them?'}
              </span>
              <Button size="sm" onClick={() => follow(presenter.clientId)}>
                Join
              </Button>
              {!small && (
                <Button variant="ghost" size="icon-sm" title="Not now" aria-label="Not now" onClick={() => dismiss(presenter.clientId)}>
                  <XIcon className="size-4" />
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
