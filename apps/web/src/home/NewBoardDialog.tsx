import { useState } from 'react'
import { ArrowLeftIcon, FileIcon, LayoutIcon } from '@phosphor-icons/react'
import { TEMPLATES, type TemplateId } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { newRoomId, roomHash } from '../board/room'
import { EventPicker } from '../events/EventObject'
import { savePending } from './pending'
import { recordBoard } from './recents'
import { resolveSetup } from './resolve'

const MAX_TITLE = 80

/** A choice card: a large button with a title and a line about it. */
function Choice({ on, title, detail, icon, onClick }: { on: boolean; title: string; detail: string; icon?: React.ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors hover:bg-accent', on && 'border-foreground ring-1 ring-foreground')}
    >
      {icon}
      <span className="font-medium">{title}</span>
      <span className="text-sm text-muted-foreground">{detail}</span>
    </button>
  )
}

/** A sketch of the SitRep layout, for its card. */
function SitrepSketch() {
  const cell = 'rounded-sm border bg-background'
  return (
    <div aria-hidden className="grid h-24 grid-cols-[1fr_2fr_1fr_1fr] grid-rows-[1fr_1fr_0.6fr] gap-1 rounded-md bg-muted p-2">
      <div className={cell} />
      <div className={cn(cell, 'row-span-2')} />
      <div className={cell} />
      <div className={cell} />
      <div className={cell} />
      <div className={cell} />
      <div className="col-span-4 grid grid-cols-5 gap-1">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="rounded-sm bg-amber-100" />
        ))}
      </div>
    </div>
  )
}

/**
 * New board: a name, then a blank board or a template. A template's context (an event, a place) is optional;
 * widgets without one come empty, to be picked on the board. Create works out the setup first (resolve.ts), so
 * errors show here, then opens the new board, which sets itself up (pending.ts, App.tsx).
 */
export function NewBoardDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [step, setStep] = useState<'start' | 'template'>('start')
  const [kind, setKind] = useState<'blank' | 'template'>('blank')
  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState<TemplateId>('sitrep')
  const [eventId, setEventId] = useState<string>()
  const [place, setPlace] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  async function create() {
    setBusy(true)
    setError(undefined)
    try {
      const setup = await resolveSetup({ title: title.trim() || undefined, template: kind === 'template' ? template : undefined, eventId, place })
      const room = newRoomId()
      savePending(room, setup)
      recordBoard({ room, title: setup.title, template: setup.template, eventName: setup.eventName })
      location.hash = roomHash(room) // reloads into the new board
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const next = () => (kind === 'blank' ? void create() : setStep('template'))

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return
        onOpenChange(o)
        if (!o) setStep('start')
      }}
    >
      <DialogContent className={step === 'template' ? 'sm:max-w-3xl' : 'sm:max-w-xl'}>
        {step === 'start' ? (
          <form
            className="grid gap-5"
            onSubmit={(e) => {
              e.preventDefault()
              next()
            }}
          >
            <DialogHeader>
              <DialogTitle>New board</DialogTitle>
              <DialogDescription>Everyone with the board's link can open and edit it.</DialogDescription>
            </DialogHeader>
            <label className="grid gap-1.5 text-sm font-medium">
              Name
              <Input autoFocus placeholder="Untitled board" maxLength={MAX_TITLE} value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            <div className="grid grid-cols-2 gap-3" role="group" aria-label="Start from">
              <Choice on={kind === 'blank'} title="Blank board" detail="Start from an empty canvas" icon={<FileIcon className="size-5" />} onClick={() => setKind('blank')} />
              <Choice on={kind === 'template'} title="From a template" detail="Widgets set up for one job, such as a SitRep" icon={<LayoutIcon className="size-5" />} onClick={() => setKind('template')} />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {kind === 'blank' ? (busy ? 'Creating…' : 'Create') : 'Next'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          // Not a form: Enter in the event search would create the board.
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>New board from a template</DialogTitle>
              <DialogDescription>The event and place are optional: you can pick them on the board later.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="Template">
              {(Object.keys(TEMPLATES) as TemplateId[]).map((id) => (
                <Choice key={id} on={template === id} title={TEMPLATES[id].title} detail={TEMPLATES[id].description} icon={<SitrepSketch />} onClick={() => setTemplate(id)} />
              ))}
            </div>
            <fieldset className="grid gap-3 border-0 p-0">
              <legend className="mb-3 font-medium">Set context</legend>
              <div className="grid gap-1.5">
                <div className="flex items-center justify-between text-sm font-medium">
                  <span id="new-board-event">Event</span>
                  <Button type="button" variant="ghost" size="xs" disabled={!eventId} onClick={() => setEventId(undefined)}>
                    {eventId ? 'Clear: choose later' : 'Choose later'}
                  </Button>
                </div>
                <div aria-labelledby="new-board-event" className="flex h-56 flex-col rounded-md border text-sm">
                  <EventPicker selected={eventId} onPick={setEventId} />
                </div>
              </div>
              <label className="grid gap-1.5 text-sm font-medium">
                Place or area
                <Input placeholder="e.g. Gorkha, Nepal. Leave empty to use the event's area" value={place} onChange={(e) => setPlace(e.target.value)} />
              </label>
            </fieldset>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter className="justify-between">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep('start')}>
                <ArrowLeftIcon />
                Back
              </Button>
              <Button type="button" disabled={busy} onClick={() => void create()}>
                {busy ? 'Creating…' : 'Create board'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
