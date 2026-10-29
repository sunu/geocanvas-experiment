import { FolderOpenIcon, PlugsConnectedIcon, PlugsIcon } from '@phosphor-icons/react'
import type { Actor } from '@ttx/core'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { NameButton } from '../board/NameButton'
import { usePersonName } from '../board/person'
import type { Awareness } from '../board/presence'
import type { useBridgeStatus } from '../mcp/bridge'

const BRIDGE_LABEL = { connecting: 'Connecting to the MCP companion…', connected: 'An external agent can work on this board', disconnected: 'The MCP companion is not running' }

/** The User Menu of the Figma file: who you are on this board. There are no accounts yet, so it is the name this browser picked, which can be changed. */
export function UserMenu({ actor, awareness, bridge, onUploads }: { actor: Actor; awareness: Awareness; bridge: ReturnType<typeof useBridgeStatus>; onUploads: () => void }) {
  const name = usePersonName(actor, awareness)
  return (
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
      <Button variant="ghost" size="icon-sm" title="Files uploaded to this board, to put back or share" aria-label="Uploads" onClick={onUploads}>
        <FolderOpenIcon className="size-4" />
      </Button>
      <Avatar>
        <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <NameButton actor={actor} awareness={awareness} />
    </div>
  )
}
