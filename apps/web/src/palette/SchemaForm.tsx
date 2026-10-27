import { useState } from 'react'
import { widgets } from '../ui/registry'

type Schema = Record<string, any>

/** Fields that the palette fills itself, e.g. the drop position of new nodes. */
export const AUTO_FIELDS = new Set(['origin', 'x', 'y'])

/** A form made from a JSON Schema (from zod). Plugin widgets render fields with a `widget` hint. */
export function SchemaForm({
  schema,
  value,
  onChange,
}: {
  schema: Schema
  value: Record<string, unknown>
  onChange(v: Record<string, unknown>): void
}) {
  const props: Record<string, Schema> = schema.properties ?? {}
  const required = new Set<string>(schema.required ?? [])
  const entries = Object.entries(props).filter(([k]) => !AUTO_FIELDS.has(k))
  if (!entries.length) return <p className="gc-muted">This command has no arguments.</p>
  return (
    <div className="gc-form">
      {entries.map(([key, s]) => (
        <label key={key} className="gc-field">
          <span className="gc-field__label">
            {s.title ?? humanize(key)}
            {required.has(key) && s.default === undefined && <em> *</em>}
          </span>
          <Field schema={s} value={value[key]} onChange={(v) => onChange({ ...value, [key]: v })} />
          {s.description && <span className="gc-field__help">{s.description}</span>}
        </label>
      ))}
    </div>
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
