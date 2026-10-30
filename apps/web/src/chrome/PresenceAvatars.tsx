import { SparkleIcon } from '@phosphor-icons/react'
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar'
import { Hint } from '@/components/Hint'
import { isAgent, onColor } from '../board/collaborators'
import { usePeers, type Awareness, type Peer } from '../board/presence'

/** How many avatars show before the rest are counted. */
const SHOWN = 4

/** Everyone else on the board, once each: a person with two tabs open is one, and the agent comes last. */
function people(peers: Peer[]): Peer['user'][] {
  const byId = new Map<string, Peer['user']>()
  for (const p of peers) if (!byId.has(p.user.id)) byId.set(p.user.id, p.user)
  return [...byId.values()].sort((a, b) => Number(isAgent(a)) - Number(isAgent(b)) || a.name.localeCompare(b.name))
}

/**
 * The others on the board as a stack of avatars in their own colors (collaborators.ts), as in Figma and Miro: the
 * initial of a person on their color, the agent as a violet square with a sparkle. Hover for the name. Needs a
 * TooltipProvider around it.
 */
export function PresenceAvatars({ awareness }: { awareness: Awareness }) {
  const others = people(usePeers(awareness))
  if (!others.length) return null
  const shown = others.length > SHOWN ? others.slice(0, SHOWN - 1) : others
  const rest = others.slice(shown.length)
  return (
    <AvatarGroup aria-label="Others on this board">
      {shown.map((u) => {
        const agent = isAgent(u)
        return (
          <Hint key={u.id} label={u.name}>
            <Avatar className={agent ? 'rounded-md' : undefined}>
              <AvatarFallback
                className={agent ? 'rounded-md text-sm font-medium' : 'text-sm font-medium'}
                style={agent ? { background: 'var(--agent)', color: 'var(--agent-foreground)' } : { background: u.color, color: onColor(u.color!) }}
              >
                {agent ? <SparkleIcon className="size-4" weight="fill" /> : u.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </Hint>
        )
      })}
      {rest.length > 0 && (
        <Hint label={rest.map((u) => u.name).join(', ')}>
          <AvatarGroupCount>+{rest.length}</AvatarGroupCount>
        </Hint>
      )}
    </AvatarGroup>
  )
}
