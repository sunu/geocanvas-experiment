import { useState } from 'react'
import { MegaphoneIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { WhatsNewDialog } from './WhatsNewDialog'
import { useNewsUnseen } from './seen'

/** The megaphone that opens What's new, with a dot while there is news this browser has not opened. In the user menu and the phone's bar. */
export function WhatsNewButton({ phone }: { phone?: boolean }) {
  const [open, setOpen] = useState(false)
  const unseen = useNewsUnseen()
  return (
    <>
      <Button
        variant="ghost"
        size={phone ? 'icon' : 'icon-sm'}
        title="What’s new, and which build you are on"
        aria-label="What’s new"
        className="relative"
        onClick={() => setOpen(true)}
      >
        <MegaphoneIcon className={phone ? 'size-5' : 'size-4'} />
        {unseen && <span className="absolute top-1 right-1 size-2 rounded-full bg-teal-600" aria-label="New" />}
      </Button>
      <WhatsNewDialog open={open} onOpenChange={setOpen} />
    </>
  )
}
