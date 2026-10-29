import { useState } from 'react'
import { ArrowLeftIcon, FileIcon, LayoutIcon } from '@phosphor-icons/react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { newRoomId, roomHash } from '../board/room'
import { EventPicker } from '../events/EventObject'
import { AreaPicker } from '../inputs/AreaPicker'
import { savePending } from './pending'
import { recordBoard } from './recents'
import { TEMPLATE_CHOICES } from './templates'

const MAX_TITLE = 80

/** A choice card: a large button with a title and a line about it. */
function Choice({ on, title, detail, icon, onClick }: { on: boolean; title: string; detail: string; icon: React.ReactNode; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('flex flex-col gap-1.5 rounded-lg border p-4 text-left transition-colors hover:bg-accent', on && 'border-foreground ring-1 ring-foreground')}
    >
      {icon}
      <span className="font-medium">{title}</span>
      <span className="line-clamp-3 text-sm text-muted-foreground">{detail}</span>
    </button>
  )
}

/** A seed's picker, by its form widget: the same pickers as the palette's template forms. */
function SeedPicker({ widget, value, onChange }: { widget: string; value: unknown; onChange(v: unknown): void }) {
  if (widget === 'event') return <EventPicker selected={typeof value === 'string' ? value : undefined} onPick={onChange} />
  // No "my view": the board does not exist yet.
  if (widget === 'area') return <AreaPicker value={value} onChange={onChange} myView={false} />
  return <p className="p-2 text-muted-foreground">This seed is set on the board.</p>
}

/** Typed text not picked from a list: the template would look it up later, on the board, where a miss shows nowhere. */
const unpicked = (v: unknown) => !!v && typeof v === 'object' && 'text' in v

/**
 * New board: a name, then a blank board or a template (the template.* ops). Each seed of a template is optional:
 * left out, its widgets come empty, to be picked on the board. Create opens the new board, which sets itself up
 * (pending.ts, App.tsx).
 */
export function NewBoardDialog({ open, onOpenChange }: { open: boolean; onOpenChange(open: boolean): void }) {
  const [step, setStep] = useState<'start' | 'template'>('start')
  const [kind, setKind] = useState<'blank' | 'template'>('blank')
  const [title, setTitle] = useState('')
  const [templateId, setTemplateId] = useState(TEMPLATE_CHOICES[0]?.id)
  const [seeds, setSeeds] = useState<Record<string, unknown>>({})
  const [busy, setBusy] = useState(false)

  const template = TEMPLATE_CHOICES.find((t) => t.id === templateId)
  const picked = Object.fromEntries(Object.entries(seeds).filter(([k, v]) => v !== undefined && template?.seeds.some((s) => s.key === k)))
  const waiting = Object.values(picked).some(unpicked)

  function create() {
    setBusy(true)
    const room = newRoomId()
    const name = title.trim() || undefined
    const chosen = kind === 'template' ? template?.id : undefined
    savePending(room, { title: name, template: chosen, ...(chosen && { seeds: picked }) })
    recordBoard({ room, title: name, template: chosen })
    location.hash = roomHash(room) // reloads into the new board
  }

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
              if (kind === 'blank') create()
              else setStep('template')
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
              <Choice
                on={kind === 'template'}
                title="From a template"
                detail={`Widgets set up for one job: ${TEMPLATE_CHOICES.map((t) => t.title.toLowerCase()).join(', ')}`}
                icon={<LayoutIcon className="size-5" />}
                onClick={() => setKind('template')}
              />
            </div>
            <DialogFooter>
              <Button type="submit" disabled={busy}>
                {kind === 'blank' ? (busy ? 'Creating…' : 'Create') : 'Next'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          // Not a form: Enter in a picker's search would create the board.
          <div className="grid gap-5">
            <DialogHeader>
              <DialogTitle>New board from a template</DialogTitle>
              <DialogDescription>Each choice below is optional: what you leave out comes empty, to pick on the board.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-3" role="group" aria-label="Template">
              {TEMPLATE_CHOICES.map((t) => (
                <Choice key={t.id} on={templateId === t.id} title={t.title} detail={t.description} icon={<LayoutIcon className="size-5" />} onClick={() => setTemplateId(t.id)} />
              ))}
            </div>
            {template && template.seeds.length > 0 && (
              <fieldset className="grid gap-3 border-0 p-0">
                <legend className="mb-3 font-medium">Set context</legend>
                {template.seeds.map((s) => (
                  <div key={`${template.id}/${s.key}`} className="grid gap-1.5">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span id={`seed-${s.key}`}>{s.label}</span>
                      <Button type="button" variant="ghost" size="xs" disabled={picked[s.key] === undefined} onClick={() => setSeeds({ ...seeds, [s.key]: undefined })}>
                        {picked[s.key] === undefined ? 'Choose later' : 'Clear: choose later'}
                      </Button>
                    </div>
                    <div aria-labelledby={`seed-${s.key}`} className="flex h-56 flex-col rounded-md border text-sm">
                      <SeedPicker widget={s.widget} value={picked[s.key]} onChange={(v) => setSeeds({ ...seeds, [s.key]: v })} />
                    </div>
                  </div>
                ))}
              </fieldset>
            )}
            {waiting && <p className="text-sm text-muted-foreground">Pick a match from the list, or choose later.</p>}
            <DialogFooter className="justify-between">
              <Button type="button" variant="ghost" disabled={busy} onClick={() => setStep('start')}>
                <ArrowLeftIcon />
                Back
              </Button>
              <Button type="button" disabled={busy || waiting || !template} onClick={create}>
                {busy ? 'Creating…' : 'Create board'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
