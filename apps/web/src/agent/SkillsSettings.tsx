import { useMemo, useState, useSyncExternalStore } from 'react'
import { ArrowLeftIcon, LockSimpleIcon, PlusIcon, XIcon } from '@phosphor-icons/react'
import { BoardSkills, MAX_BOARD_SKILLS, skillSchema, type BoardSkill, type Runtime, type Skill } from '@ttx/core'
import { SKILLS } from '@ttx/plugins'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { usePluginsOff } from '../board/plugins'
import { tools } from '../tools/registry'

/**
 * The Skills tab of Settings (plans/plan-026.md): the agent's built-in skills, read only, and this board's own,
 * which people write here for everyone on the board (agent.setSkill, a hidden op: never an agent).
 */
export function SkillsSettings({ runtime }: { runtime: Runtime }) {
  const board = useBoardSkills(runtime)
  const choices = useToolChoices(runtime)
  const [open, setOpen] = useState<{ builtIn: string } | { id: string } | 'new' | null>(null)

  if (open === 'new') return <SkillForm runtime={runtime} choices={choices} onDone={() => setOpen(null)} />
  if (open && 'id' in open) {
    const skill = board.find((s) => s.id === open.id)
    // Someone else deleted it meanwhile.
    if (skill) return <SkillForm key={skill.id} runtime={runtime} choices={choices} skill={skill} onDone={() => setOpen(null)} />
  }
  if (open && 'builtIn' in open) {
    const skill = SKILLS.find((s) => s.name === open.builtIn)
    if (skill) return <BuiltInSkill skill={skill} choices={choices} onBack={() => setOpen(null)} />
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        The agent reads a skill when a request matches its "use when". A skill is offered only when the agent has its tools.
      </p>
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="m-0 text-sm font-medium">This board</h3>
          <Button size="xs" variant="outline" disabled={board.length >= MAX_BOARD_SKILLS} onClick={() => setOpen('new')}>
            <PlusIcon /> New skill
          </Button>
        </div>
        <p className="m-0 text-sm text-muted-foreground">For everyone on this board. Only people can write them.</p>
        {board.length ? (
          <SkillList skills={board} choices={choices} onOpen={(s) => setOpen({ id: s.id })} />
        ) : (
          <p className="m-0 rounded-md border border-dashed p-3 text-sm text-muted-foreground">No skills on this board yet.</p>
        )}
      </section>
      <section className="grid gap-2">
        <h3 className="m-0 flex items-center gap-1.5 text-sm font-medium">
          Built-in <LockSimpleIcon className="size-3.5 text-muted-foreground" aria-label="Read only" />
        </h3>
        <SkillList skills={SKILLS} choices={choices} onOpen={(s) => setOpen({ builtIn: s.name })} />
      </section>
    </div>
  )
}

/** The board's skills, by name; re-renders when anyone changes them. */
function useBoardSkills(runtime: Runtime): BoardSkill[] {
  const skills = useMemo(() => new BoardSkills(runtime.board.doc), [runtime])
  return useSyncExternalStore(skills.subscribe, skills.list)
}

/** The ops and tools a skill can name, with their titles, and which of them are on this board. */
interface ToolChoices {
  all: { id: string; title: string }[]
  title(id: string): string
  on: ReadonlySet<string>
}

function useToolChoices(runtime: Runtime): ToolChoices {
  const off = usePluginsOff(runtime)
  return useMemo(() => {
    const ops = runtime.registry.ops().filter((op) => !op.hidden && !op.applyView)
    const reads = tools.list()
    const all = [{ id: 'board.get', title: 'Read the board' }, ...ops.map((op) => ({ id: op.id, title: op.title })), ...reads.map((t) => ({ id: t.id, title: t.title }))]
    const titles = new Map(all.map((c) => [c.id, c.title]))
    const on = new Set([
      'board.get',
      ...ops.filter((op) => runtime.registry.opEnabled(op, off)).map((op) => op.id),
      ...reads.filter((t) => !t.plugin || !off.has(t.plugin)).map((t) => t.id),
    ])
    return { all: all.sort((a, b) => a.id.localeCompare(b.id)), title: (id) => titles.get(id) ?? id, on }
  }, [runtime, off])
}

function SkillList<S extends Skill>({ skills, choices, onOpen }: { skills: S[]; choices: ToolChoices; onOpen(skill: S): void }) {
  return (
    <ul className="m-0 grid list-none gap-1 p-0">
      {skills.map((s) => {
        const missing = s.requires.filter((id) => !choices.on.has(id))
        return (
          <li key={s.name}>
            <button type="button" className="grid w-full gap-0.5 rounded-md p-2 text-left hover:bg-muted" onClick={() => onOpen(s)}>
              <span className="text-sm font-medium">{s.name}</span>
              <span className="text-sm text-muted-foreground">{s.description}</span>
              {missing.length > 0 && <span className="text-sm text-muted-foreground">Not offered: needs {missing.map(choices.title).join(', ')}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function BackButton({ onClick }: { onClick(): void }) {
  return (
    <Button size="xs" variant="ghost" className="justify-self-start" onClick={onClick}>
      <ArrowLeftIcon /> Skills
    </Button>
  )
}

function ToolBadges({ ids, choices }: { ids: string[]; choices: ToolChoices }) {
  if (!ids.length) return <span className="text-sm text-muted-foreground">None</span>
  return (
    <span className="flex flex-wrap gap-1">
      {ids.map((id) => (
        <Badge key={id} variant="outline" title={id}>
          {choices.title(id)}
        </Badge>
      ))}
    </span>
  )
}

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <div className="grid gap-1">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  )
}

function BuiltInSkill({ skill, choices, onBack }: { skill: Skill; choices: ToolChoices; onBack(): void }) {
  return (
    <div className="grid gap-3">
      <BackButton onClick={onBack} />
      <h3 className="m-0 flex items-center gap-1.5 text-base font-medium">
        {skill.name} <Badge variant="secondary">Built-in, read only</Badge>
      </h3>
      <Field label="Description">
        <span className="text-sm">{skill.description}</span>
      </Field>
      <Field label="Use when">
        <span className="text-sm">{skill.whenToUse}</span>
      </Field>
      <Field label="Needs">
        <ToolBadges ids={skill.requires} choices={choices} />
      </Field>
      <Field label="Also loads">
        <ToolBadges ids={skill.optional} choices={choices} />
      </Field>
      <Field label="Steps">
        <pre className="m-0 max-h-80 overflow-auto rounded-md bg-muted p-3 font-sans text-sm whitespace-pre-wrap">{skill.body}</pre>
      </Field>
    </div>
  )
}

type Draft = Pick<Skill, 'name' | 'description' | 'whenToUse' | 'requires' | 'optional' | 'body'>
const EMPTY: Draft = { name: '', description: '', whenToUse: '', requires: [], optional: [], body: '' }
const BODY_MAX = skillSchema.shape.body.maxLength ?? 8000

/** A new board skill, or one to change or delete. */
function SkillForm({ runtime, choices, skill, onDone }: { runtime: Runtime; choices: ToolChoices; skill?: BoardSkill; onDone(): void }) {
  const [draft, setDraft] = useState<Draft>(() => (skill ? { name: skill.name, description: skill.description, whenToUse: skill.whenToUse, requires: skill.requires, optional: skill.optional, body: skill.body } : EMPTY))
  const [errors, setErrors] = useState<Partial<Record<keyof Draft | 'form', string>>>({})
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  async function run(opId: string, args: unknown) {
    setBusy(true)
    runtime.beginGesture()
    const r = await runtime.invoke(opId, { kind: 'canvas' }, args)
    setBusy(false)
    if (r.status === 'applied') onDone()
    else setErrors({ form: r.error ?? 'Not saved' })
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    const parsed = skillSchema.safeParse(draft)
    if (!parsed.success) {
      const byField: typeof errors = {}
      for (const issue of parsed.error.issues) byField[issue.path[0] as keyof Draft] ??= issue.message
      return setErrors(byField)
    }
    setErrors({})
    void run('agent.setSkill', { ...(skill && { id: skill.id }), skill: parsed.data })
  }

  return (
    <form className="grid gap-3" onSubmit={save}>
      <BackButton onClick={onDone} />
      <h3 className="m-0 text-base font-medium">{skill ? `Edit ${skill.name}` : 'New board skill'}</h3>
      <Field label="Name" error={errors.name}>
        <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="sitrep-style" aria-label="Name" autoFocus={!skill} />
      </Field>
      <Field label="Description" error={errors.description}>
        <Input value={draft.description} onChange={(e) => set('description', e.target.value)} placeholder="What the skill does, in one line" aria-label="Description" />
      </Field>
      <Field label="Use when" error={errors.whenToUse}>
        <Input value={draft.whenToUse} onChange={(e) => set('whenToUse', e.target.value)} placeholder="The person asks for a situation report" aria-label="Use when" />
      </Field>
      <Field label="Needs (offered only when the agent has all of them)" error={errors.requires}>
        <ToolPicker ids={draft.requires} choices={choices} onChange={(ids) => set('requires', ids)} />
      </Field>
      <Field label="Also loads (when the agent has them)" error={errors.optional}>
        <ToolPicker ids={draft.optional} choices={choices} onChange={(ids) => set('optional', ids)} />
      </Field>
      <Field label="Steps" error={errors.body}>
        <Textarea
          value={draft.body}
          onChange={(e) => set('body', e.target.value)}
          rows={10}
          className="max-h-80 font-mono text-sm"
          placeholder="What the agent does, step by step. Name tools as the agent sees them, e.g. data__geocode."
          aria-label="Steps"
        />
        <span className="justify-self-end text-xs text-muted-foreground">
          {draft.body.length} / {BODY_MAX}
        </span>
      </Field>
      {errors.form && <p className="m-0 text-sm text-destructive">{errors.form}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {skill && (
          <Button
            type="button"
            size="sm"
            variant={confirmDelete ? 'destructive' : 'outline'}
            className="ml-auto"
            disabled={busy}
            onClick={() => (confirmDelete ? void run('agent.removeSkill', { id: skill.id }) : setConfirmDelete(true))}
          >
            {confirmDelete ? 'Delete for everyone' : 'Delete'}
          </Button>
        )}
      </div>
    </form>
  )
}

/** Chosen op and tool ids as removable badges, and a searchable list to add more. */
function ToolPicker({ ids, choices, onChange }: { ids: string[]; choices: ToolChoices; onChange(ids: string[]): void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ids.map((id) => (
        <Badge key={id} variant="outline" title={id} className="gap-1 pr-1">
          {choices.title(id)}
          <button type="button" className="rounded-sm hover:bg-muted" title={`Remove ${choices.title(id)}`} aria-label={`Remove ${choices.title(id)}`} onClick={() => onChange(ids.filter((i) => i !== id))}>
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" size="xs" variant="ghost">
            <PlusIcon /> Add tool
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 p-0">
          <Command>
            <CommandInput placeholder="Search tools…" />
            <CommandList>
              <CommandEmpty>No tool found.</CommandEmpty>
              {choices.all
                .filter((c) => !ids.includes(c.id))
                .map((c) => (
                  <CommandItem
                    key={c.id}
                    value={`${c.id} ${c.title}`}
                    onSelect={() => {
                      onChange([...ids, c.id])
                      setOpen(false)
                    }}
                  >
                    <span className="grid">
                      <span>{c.title}</span>
                      <span className="text-xs text-muted-foreground">{c.id}</span>
                    </span>
                  </CommandItem>
                ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  )
}
