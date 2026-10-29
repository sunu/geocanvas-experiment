import { DotsThreeIcon, LayoutIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { TEMPLATES } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { roomHash } from '../board/room'
import type { RecentBoard } from './recents'

const DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/** One board on the landing page. There are no thumbnails yet, so the preview says what the board was made from. */
export function BoardCard({ board, onForget }: { board: RecentBoard; onForget(): void }) {
  const href = roomHash(board.room)
  const made = board.template ? TEMPLATES[board.template]?.title : undefined
  const about = [made, board.eventName].filter(Boolean).join(' · ')
  return (
    <div className="group flex flex-col gap-2">
      <a href={href} className="flex aspect-[16/9] items-center justify-center rounded-lg border bg-muted text-muted-foreground transition-colors group-hover:border-foreground/30">
        {made ? <LayoutIcon className="size-8" aria-hidden /> : <SquaresFourIcon className="size-8" aria-hidden />}
      </a>
      <div className="flex items-start justify-between gap-2">
        <a href={href} className="min-w-0">
          <div className="truncate font-medium">{board.title || 'Untitled board'}</div>
          <div className="truncate text-sm text-muted-foreground">
            {about ? `${about} · ` : ''}Opened {DAY.format(board.openedAt)}
          </div>
        </a>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" title="Board actions" aria-label="Board actions">
              <DotsThreeIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(new URL(href, location.href).href)}>Copy link</DropdownMenuItem>
            <DropdownMenuItem title="The board stays: anyone with its link can still open it" onSelect={onForget}>
              Remove from this list
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
