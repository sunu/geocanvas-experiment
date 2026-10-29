import { ArrowClockwiseIcon, ArrowCounterClockwiseIcon, CaretDownIcon, PlugsConnectedIcon, PlugsIcon } from '@phosphor-icons/react'
import type { Actor, Runtime } from '@ttx/core'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Hint } from '@/components/Hint'
import { TooltipProvider } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { NameButton } from '../board/NameButton'
import type { ConnectionStatus } from '../board/connect'
import { usePersonName } from '../board/person'
import type { Awareness } from '../board/presence'
import { useViewState } from '../canvas/viewState'
import type { useBridgeStatus } from '../mcp/bridge'

const BRIDGE_LABEL = { connecting: 'Connecting to the MCP companion…', connected: 'An external agent can work on this board', disconnected: 'The MCP companion is not running' }

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

interface Props {
  runtime: Runtime
  status: ConnectionStatus
  actor: Actor
  awareness: Awareness
  bridge: ReturnType<typeof useBridgeStatus>
}

/**
 * The User Menu of the Figma file: the board's own controls (undo and redo, zoom, the sync light) and who you are on it. There are
 * no accounts yet, so the person is the name this browser picked, which can be changed. While an object is open in focus mode, undo and zoom belong to its draft and the
 * canvas, so they wait.
 */
export function UserMenu({ runtime, status, actor, awareness, bridge }: Props) {
  const name = usePersonName(actor, awareness)
  const { zoom, focused } = useViewState()
  const view = (opId: string) => runtime.dispatch(opId, { kind: 'canvas' }, {})
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
    <div className="ttx-ui ttx-shell fixed top-2 right-2 z-[1000002] flex items-center gap-2 rounded-xl border bg-card p-3 font-sans shadow-sm">
      {bridge !== 'off' && (
        <span
          className={bridge === 'connected' ? 'text-teal-700' : 'text-muted-foreground'}
          title={BRIDGE_LABEL[bridge]}
          aria-label={BRIDGE_LABEL[bridge]}
        >
          {bridge === 'connected' ? <PlugsConnectedIcon className="size-4" /> : <PlugsIcon className="size-4" />}
        </span>
      )}
      <Hint label="Undo" keys={`${MOD}Z`}>
        <Button variant="ghost" size="icon-sm" aria-label="Undo" disabled={focused} onClick={() => runtime.undo()}>
          <ArrowCounterClockwiseIcon className="size-4" />
        </Button>
      </Hint>
      <Hint label="Redo" keys={`⇧${MOD}Z`}>
        <Button variant="ghost" size="icon-sm" aria-label="Redo" disabled={focused} onClick={() => runtime.redo()}>
          <ArrowClockwiseIcon className="size-4" />
        </Button>
      </Hint>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-0.5 px-2" title="Zoom" aria-label="Zoom" disabled={focused}>
            {Math.round(zoom * 100)}%
            <CaretDownIcon className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => view('core.view.fitAll')}>Zoom to fit</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => view('core.view.resetZoom')}>Reset zoom (100%)</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Avatar>
        <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <NameButton actor={actor} awareness={awareness} />
      <span
        className={cn('size-2 shrink-0 rounded-full', status === 'connected' ? 'bg-green-500' : status === 'disconnected' ? 'bg-red-500' : 'bg-amber-500')}
        title={`Sync: ${status}`}
        aria-label={`Sync: ${status}`}
        role="status"
      />
    </div>
    </TooltipProvider>
  )
}
