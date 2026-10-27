import { useState } from 'react'
import { widgets } from '../ui/registry'

type Schema = Record<string, any>

/** Fields that the palette fills itself. They show only under "Advanced". */
export const AUTO_FIELDS = new Set(['origin', 'x', 'y', 'w', 'h'])

/** Raw JSON fields (records, unknown values) are for power users. */
function isAdvanced(key: string, s: Schema) {
  if (s.advanced || AUTO_FIELDS.has(key)) return true
  if (s.widget || s.enum) return false
  return !s.type || (s.type === 'object' && !s.properties)
}

/**
 * A form made from a JSON Schema (from zod). Plugin widgets render fields with a `widget` hint.
 * Fields marked `ask` come first. Advanced fields fold away.
 */
export interface FieldMark {
  source: 'decider' | 'extractor' | 'entity' | 'default'
  confidence: number
  span?: string
}

export function SchemaForm({
  schema,
  value,
  onChange,
  marks,
}: {
  schema: Schema
  value: Record<string, unknown>
  onChange(v: Record<string, unknown>): void
  /** NL fill info per field: shows where a value came from and how sure it is. */
  marks?: Record<string, FieldMark>
}) {
  const props: Record<string, Schema> = schema.properties ?? {}
  const required = new Set<string>(schema.required ?? [])
  const all = Object.entries(props)
  const main = all.filter(([k, s]) => !isAdvanced(k, s)).sort(([, a], [, b]) => Number(!!b.ask) - Number(!!a.ask))
  const advanced = all.filter(([k, s]) => isAdvanced(k, s))
  const field = ([key, s]: [string, Schema]) => (
    <label key={key} className="gc-field">
      <span className="gc-field__label">
        {s.title ?? humanize(key)}
        {required.has(key) && s.default === undefined && <em> *</em>}
        {marks?.[key] && <Mark m={marks[key]!} />}
      </span>
      <Field schema={s} value={value[key]} onChange={(v) => onChange({ ...value, [key]: v })} />
      {s.description && <span className="gc-field__help">{s.description}</span>}
    </label>
  )
  if (!all.length) return <p className="gc-muted">This command has no arguments.</p>
  return (
    <div className="gc-form">
      {main.map(field)}
      {advanced.length > 0 && (
        <details className="gc-advanced">
          <summary>Advanced ({advanced.map(([k]) => k).join(', ')})</summary>
          <div className="gc-form">{advanced.map(field)}</div>
        </details>
      )}
    </div>
  )
}

function Mark({ m }: { m: FieldMark }) {
  if (m.source === 'default') return <span className="gc-mark gc-mark--default">default</span>
  const low = m.confidence < 0.6
  return (
    <span className={`gc-mark ${low ? 'gc-mark--low' : ''}`} title={m.span ? `From “${m.span}”` : undefined}>
      {low ? 'check · ' : 'from request · '}
      {Math.round(m.confidence * 100)}%
    </span>
  )
}

function Field({ schema, value, onChange }: { schema: Schema; value: unknown; onChange(v: unknown): void }) {
  const Widget = schema.widget ? widgets.get(schema.widget) : undefined
  if (Widget) return <Widget schema={schema} value={value} onChange={onChange} />
  if (schema.enum) {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">—</option>
        {schema.enum.map((o: string) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    )
  }
  switch (schema.type) {
    case 'boolean':
      return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
    case 'integer':
    case 'number':
      return (
        <input
          type="number"
          value={value === undefined ? '' : String(value)}
          min={schema.minimum}
          max={schema.maximum > 1e15 ? undefined : schema.maximum}
          step={schema.type === 'integer' ? 1 : 'any'}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'string':
      return <input type="text" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'object':
      if (schema.properties) {
        return (
          <SchemaForm schema={schema} value={(value as Record<string, unknown>) ?? {}} onChange={onChange} />
        )
      }
      return <JsonField value={value} onChange={onChange} />
    default:
      return <JsonField value={value} onChange={onChange} />
  }
}

function JsonField({ value, onChange }: { value: unknown; onChange(v: unknown): void }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [bad, setBad] = useState(false)
  return (
    <textarea
      className={bad ? 'gc-bad' : ''}
      rows={4}
      value={text}
      placeholder="JSON"
      onChange={(e) => {
        setText(e.target.value)
        try {
          onChange(e.target.value.trim() ? JSON.parse(e.target.value) : undefined)
          setBad(false)
        } catch {
          setBad(true)
        }
      }}
    />
  )
}

function humanize(key: string) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}
