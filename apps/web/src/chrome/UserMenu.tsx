import { FolderOpenIcon } from '@phosphor-icons/react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'

/** The User Menu of the Figma file: who you are on this board. There are no accounts yet, so it is the name this browser picked. */
export function UserMenu({ name, onUploads }: { name: string; onUploads: () => void }) {
  return (
    <div className="ttx-ui fixed top-4 right-4 z-[1000002] flex items-center gap-2 rounded-xl border bg-card p-3 font-sans shadow-sm">
      <Button variant="ghost" size="icon-sm" title="Files uploaded to this board, to put back or share" aria-label="Uploads" onClick={onUploads}>
        <FolderOpenIcon className="size-4" />
      </Button>
      <Avatar>
        <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">{name.charAt(0).toUpperCase()}</AvatarFallback>
      </Avatar>
      <span className="text-sm font-medium text-foreground">{name}</span>
    </div>
  )
}
