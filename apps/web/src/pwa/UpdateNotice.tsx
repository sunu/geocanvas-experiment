import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { applyUpdate, useUpdateReady } from './register'

/** "A new version is ready": shown on every page once the service worker has one waiting (register.ts). */
export function UpdateNotice() {
  if (!useUpdateReady()) return null
  return (
    <div className="ttx-ui ttx-update fixed left-1/2 z-[1000020] flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-card py-2 pr-2 pl-4 font-sans text-sm shadow-md" role="status">
      A new version of the app is ready.
      <Button size="sm" className="gap-1.5" onClick={applyUpdate}>
        <ArrowClockwiseIcon className="size-4" />
        Reload
      </Button>
    </div>
  )
}
