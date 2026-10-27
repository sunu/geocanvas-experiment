import { useEffect, useMemo, useState } from 'react'
import { Command } from 'cmdk'
import { z } from 'zod'
import type { OpDef, TargetRef } from '@geo-canvas/core'
import { useRegistry, useSession } from '../ui/context'
import { getEditor, selectionTarget, viewportCenter } from '../canvas/editorRef'
import { palette, usePalette } from './store'
import { AUTO_FIELDS, SchemaForm } from './SchemaForm'

export function Palette() {
  const state = usePalette()
  if (!state.open) return null
  return (
    <div className="gc-palette-backdrop" onPointerDown={() => palette.close()}>
      <div className="gc-palette" onPointerDown={(e) => e.stopPropagation()}>
        {state.opId ? <ArgsStep /> : <PickStep />}
      </div>
    </div>
  )
}

function useTarget(): TargetRef {
  const state = usePalette()
  return state.target ?? selectionTarget()
}

function PickStep() {
  const { runtime } = useSession()
  const registry = useRegistry()
  const target = useTarget()
  const [query, setQuery] = useState('')
  // Selection, then enclosing groups, then canvas. Each section runs its ops on its own target.
  const scopes = useMemo(() => runtime.scopes(target), [runtime, target, registry])

  const choose = (op: OpDef, scopeTarget: TargetRef) =>
    palette.set({ ...palette.get(), open: true, opId: op.id, target: scopeTarget })

  return (
    <Command label="Commands" loop>
      <div className="gc-palette__context">{scopes.map((s) => s.label).join(' › ')}</div>
      <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Type a command…" onKeyDown={(e) => e.key === 'Escape' && palette.close()} />
      <Command.List>
        <Command.Empty>No command matches.</Command.Empty>
        {scopes.map((scope) =>
          scope.ops.length ? (
            <Command.Group key={scope.kind + scope.label} heading={scope.kind === 'canvas' ? 'Canvas' : `${scope.kind === 'group' ? 'Group' : 'Selection'}: ${scope.label}`}>
              {scope.ops.map((op) => (
                <OpItem key={op.id} scopeKey={scope.kind + scope.label} op={op} onSelect={() => choose(op, scope.target)} />
              ))}
            </Command.Group>
          ) : null,
        )}
      </Command.List>
    </Command>
  )
}

function OpItem({ op, scopeKey, onSelect }: { op: OpDef; scopeKey: string; onSelect(): void }) {
  return (
    <Command.Item value={`${op.title} ${op.id} ${op.description} ${scopeKey}`} onSelect={onSelect}>
      <div className="gc-op">
        <span className="gc-op__title">{op.title}</span>
        <span className="gc-op__desc">{op.description}</span>
      </div>
      <span className="gc-op__id">{op.id}</span>
    </Command.Item>
  )
}

function ArgsStep() {
  const { runtime } = useSession()
  const state = usePalette()
  const target = useTarget()
  const op = runtime.registry.op(state.opId!)
  const schema = useMemo(
    () => (op ? (z.toJSONSchema(op.args, { io: 'input', unrepresentable: 'any' }) as Record<string, any>) : {}),
    [op],
  )
  const [args, setArgs] = useState<Record<string, unknown>>(() => {
    if (!op) return {}
    const base: Record<string, unknown> = { ...runtime.defaultsFor(op.id, target), ...(state.args ?? {}) }
    const props = schema.properties ?? {}
    const c = viewportCenter()
    if ('origin' in props && base.origin === undefined) base.origin = { x: Math.round(c.x - 600), y: Math.round(c.y - 300) }
    if ('x' in props && base.x === undefined) base.x = Math.round(c.x - 100)
    if ('y' in props && base.y === undefined) base.y = Math.round(c.y - 60)
    return base
  })
  const [summary, setSummary] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSummary(undefined)
    setError(undefined)
  }, [args])

  if (!op) return <div className="gc-palette__body">Unknown op {state.opId}</div>
  const visibleFields = Object.keys(schema.properties ?? {}).filter((k) => !AUTO_FIELDS.has(k))

  const preview = async () => {
    setBusy(true)
    try {
      const r = await runtime.preview(op.id, target, args)
      setSummary(r.summary ?? 'Ready to run.')
      setError(undefined)
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  const run = async () => {
    setBusy(true)
    const rec = state.proposalId
      ? await runtime.approve(state.proposalId, args)
      : await runtime.dispatch(op.id, target, args)
    setBusy(false)
    if (rec.status === 'failed') {
      setError(rec.error)
      return
    }
    palette.close()
    // A new template fills the canvas: show all of it.
    if (runtime.registry.template(op.id.replace(/\.create$/, ''))) getEditor()?.zoomToFit({ animation: { duration: 300 } })
  }

  return (
    <form
      className="gc-palette__body"
      onSubmit={(e) => {
        e.preventDefault()
        void run()
      }}
      onKeyDown={(e) => e.key === 'Escape' && palette.close()}
    >
      <div className="gc-palette__head">
        <button type="button" className="gc-btn gc-btn--ghost" onClick={() => palette.set({ open: true, target: state.target })}>
          ←
        </button>
        <div>
          <div className="gc-op__title">{op.title}</div>
          <div className="gc-op__desc">{op.description}</div>
        </div>
      </div>
      {state.note && <div className="gc-note">{state.note}</div>}
      <SchemaForm schema={schema} value={args} onChange={setArgs} />
      {summary && <div className="gc-summary">{summary}</div>}
      {error && <div className="gc-error">{error}</div>}
      <div className="gc-palette__foot">
        <span className="gc-op__id">{op.id}</span>
        {op.prepare && (
          <button type="button" className="gc-btn" disabled={busy} onClick={() => void preview()}>
            Preview
          </button>
        )}
        <button type="submit" className="gc-btn gc-btn--primary" disabled={busy} autoFocus={visibleFields.length === 0}>
          {state.proposalId ? 'Approve and run' : 'Run'} ↵
        </button>
      </div>
    </form>
  )
}

function formatError(e: unknown): string {
  if (e instanceof z.ZodError) return e.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`).join('\n')
  return String((e as Error)?.message ?? e)
}
