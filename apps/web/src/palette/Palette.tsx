import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Command } from 'cmdk'
import { ArrowLeftIcon } from '@phosphor-icons/react'
import { z } from 'zod'
import type { InvocationRecord, OpDef, Runtime, TargetRef } from '@ttx/core'
import { TEMPLATE_OP_PREFIX, type EventBoardObject } from '@ttx/plugins'
import { mainFields, SchemaForm } from './SchemaForm'

interface Props {
  runtime: Runtime
  /** Ids of the selected objects. */
  selection: string[]
  /** World point at the middle of the view: where new objects go. */
  center(): { x: number; y: number }
  /** Run an op; the canvas selects what it added. */
  run(opId: string, target: TargetRef, args: unknown): Promise<InvocationRecord>
  onClose(): void
  /** Show only the templates (the toolbar's Templates button). */
  templates?: boolean
}

const canvas: TargetRef = { kind: 'canvas' }

const isTemplate = (op: OpDef) => op.id.startsWith(TEMPLATE_OP_PREFIX)

const argsSchema = (op: OpDef) => z.toJSONSchema(op.args, { io: 'input', unrepresentable: 'any' }) as Record<string, any>

/**
 * The command palette (⌘K): every op that applies to the selection or to the canvas, from every
 * plugin. Ops with fields open a form made from their args schema. It runs ops through the same
 * runtime as the canvas and tool calls, so a new op in a plugin shows up here with no palette code.
 */
export function Palette(props: Props) {
  const [chosen, setChosen] = useState<{ op: OpDef; target: TargetRef }>()
  // Templates only: from the toolbar's Templates button, or "Insert template…". Kept for Back from a template's form.
  const [templates, setTemplates] = useState(!!props.templates)
  const onKeyDown = (e: KeyboardEvent) => {
    // The canvas listens on window: keep its keys (Delete, Escape, tools) out of the palette.
    e.stopPropagation()
    if (e.key === 'Escape') props.onClose()
  }
  return createPortal(
    <div className="ttx-palette-backdrop" onPointerDown={props.onClose}>
      <div className="ttx-palette" role="dialog" aria-label="Commands" onPointerDown={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        {chosen ? (
          <ArgsStep {...props} op={chosen.op} target={chosen.target} onBack={() => setChosen(undefined)} />
        ) : (
          <PickStep {...props} templates={templates} onBrowseTemplates={() => setTemplates(true)} onChoose={(op, target) => setChosen({ op, target })} />
        )}
      </div>
    </div>,
    document.body,
  )
}

function PickStep({
  runtime,
  selection,
  onChoose,
  onBrowseTemplates,
  run,
  templates,
  center,
}: Props & { onChoose(op: OpDef, target: TargetRef): void; onBrowseTemplates(): void }) {
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState('')
  const { groups, templateOps } = useMemo(() => {
    const selected: TargetRef = { kind: 'objects', ids: selection }
    const onCanvas = runtime.availableOps(canvas)
    const templateOps = onCanvas.filter(isTemplate)
    if (templates) return { groups: [{ heading: 'Templates', target: canvas, ops: templateOps }], templateOps }
    const groups = [
      ...(selection.length ? [{ heading: `Selection (${selection.length})`, target: selected, ops: runtime.availableOps(selected) }] : []),
      { heading: 'Canvas', target: canvas, ops: onCanvas.filter((op) => !isTemplate(op)) },
    ]
    return { groups, templateOps }
  }, [runtime, selection, templates])

  const choose = async (op: OpDef, target: TargetRef) => {
    // Nothing to fill in: run it now.
    if (mainFields(argsSchema(op)).length) return onChoose(op, target)
    const r = await run(op.id, target, startArgs({ runtime, op, target, center, selection }))
    if (r.status === 'failed') setError(r.error)
  }

  return (
    <Command label="Commands" loop>
      <Command.Input autoFocus value={search} onValueChange={setSearch} placeholder={templates ? 'Type a template…' : 'Type a command…'} />
      {error && <div className="ttx-palette__error">{error}</div>}
      <Command.List>
        <Command.Empty>No command matches.</Command.Empty>
        {!templates && templateOps.length > 0 && (
          <Command.Group heading="Templates">
            <Command.Item
              value="Insert template"
              keywords={['template', ...templateOps.map((op) => op.title)]}
              onSelect={() => {
                setSearch('')
                onBrowseTemplates()
              }}
            >
              <span className="ttx-op__title">Insert template…</span>
              <span className="ttx-op__desc">A set of objects for a task: {templateOps.map((op) => op.title.toLowerCase()).join(', ')}</span>
            </Command.Item>
            {/* The templates themselves only while searching, so a growing list does not crowd the commands. */}
            {search.trim() && templateOps.map((op) => <OpItem key={op.id} op={op} group="Templates" onSelect={() => void choose(op, canvas)} />)}
          </Command.Group>
        )}
        {groups.map((g) =>
          g.ops.length ? (
            <Command.Group key={g.heading} heading={g.heading}>
              {g.ops.map((op) => (
                <OpItem key={op.id} op={op} group={g.heading} onSelect={() => void choose(op, g.target)} />
              ))}
            </Command.Group>
          ) : null,
        )}
      </Command.List>
    </Command>
  )
}

function OpItem({ op, group, onSelect }: { op: OpDef; group: string; onSelect(): void }) {
  return (
    <Command.Item value={`${group} ${op.id}`} keywords={[op.title, op.description, ...(op.nl?.aliases ?? []), ...(isTemplate(op) ? ['template'] : [])]} onSelect={onSelect}>
      <span className="ttx-op__title">{op.title}</span>
      <span className="ttx-op__desc">{op.description}</span>
    </Command.Item>
  )
}

/**
 * An op's args before anyone fills them in: its defaults, and where a new object goes. Used by the form and by an
 * op with nothing to fill in, which runs at once.
 */
function startArgs({ runtime, op, target, center, selection }: Pick<Props, 'runtime' | 'center' | 'selection'> & { op: OpDef; target: TargetRef }) {
  const base = runtime.defaultsFor(op.id, target)
  // '<type>.add': put the new object in the middle of the view.
  const type = runtime.registry.objectTypes().find((t) => op.id === `${t.type}.add`)
  if (type) {
    const c = center()
    Object.assign(base, { x: Math.round(c.x - type.defaultSize.w / 2), y: Math.round(c.y - type.defaultSize.h / 2) })
  }
  // A template: its set goes in the middle of the view, and a selected event is its event seed.
  if (isTemplate(op)) {
    const c = center()
    Object.assign(base, { x: Math.round(c.x), y: Math.round(c.y) })
    const event = selection.map((id) => runtime.board.get(id)).find((o): o is EventBoardObject => o?.type === 'event' && !!(o as EventBoardObject).eventId)
    if (event && 'event' in (argsSchema(op).properties ?? {})) base.event = event.eventId
  }
  return base
}

function ArgsStep({ runtime, op, target, center, run, onBack, selection }: Props & { op: OpDef; target: TargetRef; onBack(): void }) {
  const schema = useMemo(() => argsSchema(op), [op])
  const [args, setArgs] = useState<Record<string, unknown>>(() => startArgs({ runtime, op, target, center, selection }))
  const [summary, setSummary] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const formRef = useRef<HTMLFormElement>(null)

  // Keep the keyboard in the palette: focus the first field (Enter in it runs the op), else Run.
  useEffect(() => {
    const form = formRef.current!
    const first = form.querySelector<HTMLElement>('.ttx-form input, .ttx-form select, .ttx-form textarea') ?? form.querySelector<HTMLElement>('button[type=submit]')
    first?.focus()
  }, [])

  const change = (next: Record<string, unknown>) => {
    setArgs(next)
    setSummary(undefined)
    setError(undefined)
  }

  const preview = async () => {
    try {
      setSummary((await runtime.preview(op.id, target, args)).summary)
    } catch (e) {
      setError(e instanceof z.ZodError ? z.prettifyError(e) : String((e as Error)?.message ?? e))
    }
  }

  return (
    <form
      ref={formRef}
      className="ttx-palette__body"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const r = await run(op.id, target, args)
        setBusy(false)
        if (r.status === 'failed') setError(r.error)
      }}
    >
      <div className="ttx-palette__head">
        <button type="button" className="ttx-palette__back" title="Back to commands" aria-label="Back to commands" onClick={onBack}>
          <ArrowLeftIcon size={16} />
        </button>
        <div>
          <div className="ttx-op__title">{op.title}</div>
          <div className="ttx-op__desc">{op.description}</div>
        </div>
      </div>
      <SchemaForm schema={schema} value={args} onChange={change} />
      {summary && <div className="ttx-palette__summary">{summary}</div>}
      {error && <div className="ttx-palette__error">{error}</div>}
      <div className="ttx-palette__foot">
        <span className="ttx-op__id">{op.id}</span>
        {op.describePlan && (
          <button type="button" disabled={busy} onClick={() => void preview()}>
            Preview
          </button>
        )}
        <button type="submit" className="is-primary" disabled={busy}>
          {busy ? (isTemplate(op) ? 'Building…' : 'Running…') : 'Run ↵'}
        </button>
      </div>
    </form>
  )
}
