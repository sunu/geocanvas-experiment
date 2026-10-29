import { useState } from 'react'
import type { Runtime } from '@ttx/core'
import { widget } from '../canvas/registry'

type Schema = Record<string, any>

/** Placement fields (x, y, w, h) and fields marked `advanced` fold away under "Advanced". */
export function isAdvanced(s: Schema) {
  if (s.advanced) return true
  if (s.widget || s.enum) return false
  return !s.type || (s.type === 'object' && !s.properties)
}

/** The fields worth showing first, without the advanced ones. Empty: the op can run without a form. */
export const mainFields = (schema: Schema) => Object.entries<Schema>(schema.properties ?? {}).filter(([, s]) => !isAdvanced(s))

/** A form made from an op's args as JSON Schema (from zod). Plugin widgets render fields with a `widget` hint. */
export function SchemaForm({ runtime, schema, value, onChange }: { runtime: Runtime; schema: Schema; value: Record<string, unknown>; onChange(v: Record<string, unknown>): void }) {
  const all = Object.entries<Schema>(schema.properties ?? {})
  const required = new Set<string>(schema.required ?? [])
  const advanced = all.filter(([, s]) => isAdvanced(s))
  const field = ([key, s]: [string, Schema]) => (
    <label key={key} className="ttx-field">
      <span className="ttx-field__label">
        {s.description ?? humanize(key)}
        {required.has(key) && s.default === undefined && <em> *</em>}
      </span>
      <Field runtime={runtime} schema={s} value={value[key]} onChange={(v) => onChange({ ...value, [key]: v })} />
    </label>
  )
  if (!all.length) return null
  return (
    <div className="ttx-form">
      {mainFields(schema).map(field)}
      {advanced.length > 0 && (
        <details className="ttx-form__advanced">
          <summary>Advanced ({advanced.map(([k]) => k).join(', ')})</summary>
          <div className="ttx-form">{advanced.map(field)}</div>
        </details>
      )}
    </div>
  )
}

function Field({ runtime, schema, value, onChange }: { runtime: Runtime; schema: Schema; value: unknown; onChange(v: unknown): void }) {
  const Widget = schema.widget ? widget(schema.widget) : undefined
  if (Widget) return <Widget runtime={runtime} schema={schema} value={value} onChange={onChange} />
  if (schema.enum) {
    return (
      <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value || undefined)}>
        <option value="">—</option>
        {schema.enum.map((o: string) => (
          <option key={o} value={o}>
            {o}
          </option>
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
    default:
      return <JsonField value={value} onChange={onChange} />
  }
}

/** Raw JSON, for values with no simpler field (records, unknown values). */
function JsonField({ value, onChange }: { value: unknown; onChange(v: unknown): void }) {
  const [text, setText] = useState(() => (value === undefined ? '' : JSON.stringify(value, null, 2)))
  const [bad, setBad] = useState(false)
  return (
    <textarea
      className={bad ? 'is-bad' : ''}
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

const humanize = (key: string) => key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
