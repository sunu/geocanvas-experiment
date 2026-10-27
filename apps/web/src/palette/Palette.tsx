import { useEffect, useMemo, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { z } from 'zod'
import type { OpDef, TargetRef } from '@geo-canvas/core'
import { useRegistry, useSession } from '../ui/context'
import { getEditor, placeNew, revealCreated, selectionTarget, viewportCenter } from '../canvas/editorRef'
import { palette, usePalette } from './store'
import { AUTO_FIELDS, SchemaForm, type FieldMark } from './SchemaForm'
import { askNl, logNl, warmNl } from './nl'
import type { Proposal } from '@geo-canvas/nl'

export function Palette() {
  const state = usePalette()
  if (!state.open) return null
  return (
    <div className="gc-palette-backdrop" onPointerDown={() => palette.close()}>
      <div className="gc-palette" onPointerDown={(e) => e.stopPropagation()}>
        {state.ask ? <AskStep /> : state.opId ? <ArgsStep key={state.opId + JSON.stringify(state.target)} /> : <PickStep />}
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
  const [query, setQuery] = useState(() => palette.get().query ?? '')
  // Selection, then enclosing groups, then canvas. Each section runs its ops on its own target.
  const scopes = useMemo(() => runtime.scopes(target), [runtime, target, registry])
  useEffect(() => warmNl(runtime, target), [runtime, target, registry])

  const choose = (op: OpDef, scopeTarget: TargetRef) =>
    palette.set({ ...palette.get(), open: true, opId: op.id, target: scopeTarget })

  return (
    <Command label="Commands" loop>
      <div className="gc-palette__context">{scopes.map((s) => s.label).join(' › ')}</div>
      <Command.Input autoFocus value={query} onValueChange={setQuery} placeholder="Type a command…" onKeyDown={(e) => e.key === 'Escape' && palette.close()} />
      <Command.List>
        {query.trim().length >= 3 && (
          <Command.Group heading="Ask in plain words" forceMount>
            <Command.Item
              forceMount
              value={query}
              onSelect={() => palette.set({ ...palette.get(), open: true, ask: query.replace(/^\?\s*/, ''), target })}
            >
              <div className="gc-op">
                <span className="gc-op__title">✨ Ask: “{query.replace(/^\?\s*/, '')}”</span>
                <span className="gc-op__desc">A small model picks the command and fills its form. You review it before it runs.</span>
              </div>
            </Command.Item>
          </Command.Group>
        )}
        {!query.startsWith('?') && <Command.Empty>No command matches. Press Enter to ask in plain words.</Command.Empty>}
        {!query.startsWith('?') && scopes.map((scope) =>
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

function AskStep() {
  const { runtime } = useSession()
  const state = usePalette()
  const [step, setStep] = useState('Starting')
  const [error, setError] = useState<string>()
  const [none, setNone] = useState<Proposal>()
  const target = state.target ?? { kind: 'canvas' as const }

  useEffect(() => {
    let live = true
    askNl(runtime, target, state.ask!, (s) => live && setStep(s))
      .then((p) => {
        if (!live) return
        if (p.opId === 'none') {
          setNone(p)
          logNl({ proposal: p, accepted: false })
          return
        }
        palette.set({ open: true, opId: p.opId, target: p.target, args: p.args, nl: p, note: `“${p.utterance}”` })
      })
      .catch((e) => live && setError(String(e?.message ?? e)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const back = () => palette.set({ open: true, target: state.target, query: state.ask })
  return (
    <div className="gc-palette__body" onKeyDown={(e) => e.key === 'Escape' && palette.close()}>
      <div className="gc-palette__head">
        <button type="button" className="gc-btn gc-btn--ghost" onClick={back}>←</button>
        <div>
          <div className="gc-op__title">✨ “{state.ask}”</div>
          {!error && !none && (
            <div className="gc-op__desc">
              <span className="gc-spinner gc-spinner--inline" /> {step}…
            </div>
          )}
        </div>
      </div>
      {error && (
        <div className="gc-error">
          {error}
          {/fetch|NetworkError|Failed|502|503/i.test(error) && '\nIs the NL gateway running? Start it with: npm run nl'}
        </div>
      )}
      {none && (
        <>
          <div className="gc-note">No command matches this request.</div>
          {none.alternatives.length > 0 && (
            <div className="gc-alts">
              Did you mean:
              {none.alternatives.slice(0, 3).map((a) => (
                <button key={a.key} type="button" className="gc-btn" onClick={() => palette.set({ open: true, opId: a.opId, target: a.target })}>
                  {a.title}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function WhyPanel({ p }: { p: Proposal }) {
  const state = usePalette()
  return (
    <details className="gc-why">
      <summary>Why this command? ({Math.round(p.opConfidence * 100)}% sure)</summary>
      {p.alternatives.length > 0 && (
        <div className="gc-alts">
          Other options:
          {p.alternatives.slice(0, 3).map((a) => (
            <button key={a.key} type="button" className="gc-btn" onClick={() => palette.set({ open: true, opId: a.opId, target: a.target, note: state.note })}>
              {a.title} · {Math.round(a.p * 100)}%
            </button>
          ))}
        </div>
      )}
      <table className="gc-trace">
        <tbody>
          {p.trace.map((t, i) => (
            <tr key={i}>
              <td>{t.step}</td>
              <td className="gc-muted">{t.backend}</td>
              <td className="gc-muted">{t.ms} ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
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
    const c = state.at ?? viewportCenter()
    if ('origin' in props && base.origin === undefined) base.origin = { x: Math.round(c.x - 600), y: Math.round(c.y - 300) }
    // '<type>.add' ops: center the new node on the viewport (or the double-click point).
    const nodeType = runtime.registry.nodeType(op.id.replace(/\.add$/, ''))
    if ('x' in props && base.x === undefined) {
      const w = (base.w as number | undefined) ?? nodeType?.defaultSize.w ?? 200
      const h = (base.h as number | undefined) ?? nodeType?.defaultSize.h ?? 120
      Object.assign(base, placeNew(w, h, c))
    }
    return base
  })
  const [summary, setSummary] = useState<string>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  // NL proposals: log the outcome once, as a labeled sample.
  const nl = state.nl && state.nl.opId === op?.id ? state.nl : undefined
  const logged = useRef(false)
  useEffect(
    () => () => {
      if (nl && !logged.current) logNl({ proposal: nl, accepted: false })
    },
    [nl],
  )
  const marks = useMemo(() => (nl ? (nl.fields as Record<string, FieldMark>) : undefined), [nl])

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
    if (nl) {
      logged.current = true
      logNl({ proposal: nl, accepted: true, final: { opId: op.id, target, args } })
    }
    palette.close()
    // A new template fills the canvas: show all of it. Other new nodes: select them.
    if (runtime.registry.template(op.id.replace(/\.create$/, ''))) getEditor()?.zoomToFit({ animation: { duration: 300 } })
    else revealCreated(rec.created)
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
      {nl && <WhyPanel p={nl} />}
      <SchemaForm schema={schema} value={args} onChange={setArgs} marks={marks} />
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
