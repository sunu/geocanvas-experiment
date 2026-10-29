import { useState } from 'react'
import { CaretDownIcon, PlusIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import logo from '../assets/logo.svg'

/**
 * The Title Bar of the Figma file: the app mark, the board's title with a menu, and Share. A board has no
 * title of its own yet, so the title is fixed; the menu starts a new board, and Share copies the board's link
 * (the URL, with its #room, is the link).
 */
export function TitleBar({ onNewBoard }: { onNewBoard: () => void }) {
  const [copied, setCopied] = useState(false)
  function share() {
    void navigator.clipboard.writeText(location.href).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <div className="ttx-ui ttx-shell fixed top-2 left-2 z-[1000002] flex w-[360px] max-w-[calc(100%-1rem)] items-center justify-between rounded-xl border bg-card p-3 font-sans shadow-sm">
      <div className="flex items-center gap-1">
        <img src={logo} alt="" className="size-8" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-auto gap-1.5 px-2 py-1.5 text-muted-foreground" title="Board menu">
              Humanitarian TTX
              <CaretDownIcon className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem title="Start a new, empty board with its own link" onSelect={onNewBoard}>
              <PlusIcon />
              New board
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button variant="secondary" size="sm" title="Copy this board's link" onClick={share}>
        {copied ? 'Copied' : 'Share'}
      </Button>
    </div>
  )
}
