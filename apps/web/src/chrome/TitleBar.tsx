import { useState } from 'react'
import { CaretDownIcon, PlusIcon, SquaresFourIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import logo from '../assets/logo.svg'
import { useBoardTitle } from '../board/connect'

const MAX_TITLE = 80

/** The board's name, for everyone. Click to rename it (board.setTitle). */
function BoardTitle({ runtime }: { runtime: Runtime }) {
  const title = useBoardTitle(runtime.board)
  const [editing, setEditing] = useState(false)
  if (!editing) {
    return (
      <button
        type="button"
        className="min-w-0 truncate rounded-md px-2 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
        title="The board's name, for everyone. Click to rename it"
        onClick={() => setEditing(true)}
      >
        {title ?? <span className="text-muted-foreground">Untitled board</span>}
      </button>
    )
  }
  return (
    <Input
      aria-label="Board name"
      defaultValue={title}
      placeholder="Untitled board"
      maxLength={MAX_TITLE}
      autoFocus
      className="h-8 min-w-0 flex-1 text-sm font-medium"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => {
        const next = e.currentTarget.value.trim()
        if (next !== (title ?? '')) {
          runtime.beginGesture()
          runtime.dispatch('board.setTitle', { kind: 'canvas' }, { title: next })
        }
        setEditing(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          // Keep the canvas from also clearing the selection.
          e.stopPropagation()
          e.currentTarget.value = title ?? ''
          e.currentTarget.blur()
        }
      }}
    />
  )
}

/**
 * The Title Bar of the Figma file: the app mark with the boards menu, the board's name, and Share. The menu goes
 * back to the boards (the landing page) or starts a new board there; Share copies the board's link (the URL, with
 * its #room, is the link).
 */
export function TitleBar({ runtime }: { runtime: Runtime }) {
  const [copied, setCopied] = useState(false)
  function share() {
    void navigator.clipboard.writeText(location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="ttx-ui ttx-shell fixed top-2 left-2 z-[1000002] flex w-[360px] max-w-[calc(100%-1rem)] items-center justify-between gap-2 rounded-xl border bg-card p-3 font-sans shadow-sm">
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto shrink-0 gap-1 px-1 py-1" title="Boards" aria-label="Boards menu">
              <img src={logo} alt="" className="size-7" />
              <CaretDownIcon className="size-3.5 text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem title="The boards this browser has opened" onSelect={() => (location.hash = '')}>
              <SquaresFourIcon />
              All boards
            </DropdownMenuItem>
            <DropdownMenuItem title="Start a new board, blank or from a template, with its own link" onSelect={() => (location.hash = 'new')}>
              <PlusIcon />
              New board…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <BoardTitle runtime={runtime} />
      </div>
      <Button variant="secondary" size="sm" className="shrink-0" title="Copy this board's link" onClick={share}>
        {copied ? 'Copied' : 'Share'}
      </Button>
    </div>
  )
}
