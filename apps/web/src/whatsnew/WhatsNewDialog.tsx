import { useEffect, useState } from 'react'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { BUILD, formatBuild } from '../build'
import { NEWS, SECTIONS } from './entries'
import { markNewsSeen } from './seen'

/** `2026-11-03` as `3 November 2026`, in UTC like the build's time. */
const day = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/**
 * What's new, from the megaphone in the user menu: what changed on the board, by date, and the build this tab runs
 * (src/build.ts) with a button to copy it for a bug report. Opening it marks the news seen (seen.ts).
 */
export function WhatsNewDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (open) markNewsSeen()
  }, [open])
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  const build = formatBuild(BUILD)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(build)
      setCopied(true)
    } catch {
      // No clipboard permission: the build is on screen to read out.
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(640px,85vh)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>What’s new</DialogTitle>
          <DialogDescription className="sr-only">What changed on the board, newest first, and the build you are on.</DialogDescription>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span>You are on</span>
            <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-foreground" data-testid="build">{build}</code>
            <Button variant="ghost" size="icon-sm" title="Copy the build for a bug report" aria-label="Copy the build for a bug report" onClick={copy}>
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </Button>
          </div>
        </DialogHeader>
        <div className="min-h-0 min-w-0 overflow-y-auto pr-1">
          {NEWS.map((entry) => (
            <section key={entry.date} className="mb-6 grid gap-3">
              <h3 className="m-0 text-base font-medium">{day(entry.date)}</h3>
              {SECTIONS.map(([key, label]) =>
                entry[key]?.length ? (
                  <div key={key} className="grid gap-1.5">
                    <h4 className="m-0 text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h4>
                    <ul className="m-0 grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground">
                      {entry[key].map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
