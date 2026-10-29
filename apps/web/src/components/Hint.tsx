import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** A button with its shadcn tooltip: the name, and its key. Needs a TooltipProvider around it. */
export function Hint({ label, keys, children }: { label: string; keys?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <kbd className="ml-2 font-sans opacity-70">{keys}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
