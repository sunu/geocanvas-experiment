import type { CanvasRuntime, TargetRef } from '@geo-canvas/core'
import { fieldsOf } from './fields.js'
import type { NlContext, OpCandidate } from './types.js'

/**
 * Builds the NL context from the runtime: one candidate per (op, scope) pair,
 * plus a short text about the selection. Same scopes as the palette.
 */
export function buildContext(runtime: CanvasRuntime, target: TargetRef, utterance: string): NlContext {
  const scopes = runtime.scopes(target)
  const candidates: OpCandidate[] = []
  scopes.forEach((scope, i) => {
    for (const op of scope.ops) {
      if (op.scope === 'view' && scope.kind !== 'canvas' && op.target.kind === 'canvas') continue
      let defaults: Record<string, unknown> = {}
      try {
        defaults = runtime.defaultsFor(op.id, scope.target)
      } catch {}
      candidates.push({
        key: `${op.id}@${i}`,
        opId: op.id,
        title: op.title,
        description: op.description,
        examples: [...(op.nl?.examples ?? []), ...(op.nl?.aliases ?? [])],
        scopeKind: scope.kind,
        scopeLabel: scope.label,
        target: scope.target,
        // A field with a default for this target is optional for NL: keep the default unless the request sets it.
        fields: fieldsOf(op).map((f) => ({ ...f, required: f.required && defaults[f.name] === undefined })),
        defaults,
      })
    }
  })

  const describe = (id: string) => {
    const n = runtime.reader.node(id)
    if (!n) return undefined
    const def = runtime.registry.nodeType(n.type)
    return def?.summarize?.(n, runtime.engine.get(id)?.result?.data) ?? `${def?.title ?? n.type}`
  }
  const lines: string[] = []
  for (const s of scopes) {
    if (s.kind === 'canvas' || s.target.kind !== 'nodes') continue
    lines.push(`${s.kind === 'selection' ? 'Selected' : 'Inside group'}: ${s.target.ids.map(describe).filter(Boolean).join('; ')}`)
  }
  if (!lines.length) lines.push('Nothing is selected.')

  return {
    utterance,
    selectionSummary: lines.join('\n'),
    candidates,
    searchEntities: async (entity, query, limit) => {
      // Built-in: plugins of the app catalog.
      if (entity === 'core.plugin') {
        return runtime.availablePlugins().filter((p) => !p.alwaysOn).slice(0, limit).map((p) => ({ id: p.id, label: `${p.title} plugin (${p.id})` }))
      }
      const def = runtime.registry.entity(entity)
      if (!def) return []
      return def.search(query, limit, { provider: (id) => runtime.registry.provider(id), reader: runtime.reader })
    },
  }
}
