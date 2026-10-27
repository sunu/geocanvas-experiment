import { useEffect, useRef, useState } from 'react'
import { useSession, useRegistry } from '../ui/context'
import { registerNodeUI, registerWidget, type NodeViewProps } from '../ui/registry'
import { catalog } from '../plugins'
import { MapView, MapActions } from './MapView'
import { ChartView } from './ChartView'

/**
 * Local draft text for inline editing. The draft is committed as one op when edit mode ends.
 * (tldraw ends edit mode by unmounting the textarea, so onBlur does not fire.)
 */
function useInlineText(node: NodeViewProps['node'], editing: boolean) {
  const { runtime } = useSession()
  const saved = String(node.props.text ?? '')
  const [text, setText] = useState(saved)
  const latest = useRef(text)
  latest.current = text
  useEffect(() => {
    if (!editing) setText(saved)
  }, [saved, editing])
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing && latest.current !== saved) {
      void runtime.dispatch('core.text.setContent', { kind: 'nodes', ids: [node.id] }, { text: latest.current })
    }
    wasEditing.current = editing
  }, [editing, saved, runtime, node.id])
  return [text, setText] as const
}

function StickyView({ node, editing }: NodeViewProps) {
  const [text, setText] = useInlineText(node, editing)
  return (
    <div className={`gc-sticky gc-sticky--${node.props.color}`}>
      {editing ? (
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      ) : (
        <div className="gc-sticky__text">{text || <span className="gc-muted">Double-click to write</span>}</div>
      )}
    </div>
  )
}

/** Very small Markdown subset: headings, bold, italic, line breaks. */
export function MiniMarkdown({ text }: { text: string }) {
  const html = escapeHtml(text)
    .replace(/^### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^## (.*)$/gm, '<h3>$1</h3>')
    .replace(/^# (.*)$/gm, '<h2>$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|\W)_(.+?)_(?=\W|$)/g, '$1<em>$2</em>')
    .replace(/\n(?!<h)/g, '<br/>')
  return <div className="gc-md" dangerouslySetInnerHTML={{ __html: html }} />
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Shows the rendered text. In edit mode (double-click) it shows the raw text with {{bindings}}. */
function TextView({ node, derived, editing }: NodeViewProps) {
  const [text, setText] = useInlineText(node, editing)
  const rendered = (derived?.result?.data as { rendered?: string } | undefined)?.rendered ?? String(node.props.text ?? '')
  if (editing) {
    return (
      <textarea
        className="gc-text gc-text--edit"
        autoFocus
        value={text}
        placeholder="Markdown. Use {{port.field}} for values from linked nodes."
        onChange={(e) => setText(e.target.value)}
      />
    )
  }
  return (
    <div className="gc-text">
      {rendered ? <MiniMarkdown text={rendered} /> : <span className="gc-muted">Empty. Double-click to write.</span>}
    </div>
  )
}

registerNodeUI('core.sticky', { View: StickyView, bare: true, icon: '🟨', editOnCreate: true })
registerNodeUI('core.text', { View: TextView, icon: '¶', editOnCreate: true })
registerNodeUI('core.map', { View: MapView, Actions: MapActions, icon: '🗺', focusOnDoubleClick: true })
registerNodeUI('core.chart', { View: ChartView, icon: '📊' })

registerWidget('textarea', ({ value, onChange }) => (
  <textarea rows={8} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
))

registerWidget('nodeType', ({ value, onChange }) => {
  const registry = useRegistry()
  return (
    <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a node type</option>
      {registry.allNodeTypes().filter((t) => !t.group).map((t) => (
        <option key={t.type} value={t.type}>{t.title} ({t.type})</option>
      ))}
    </select>
  )
})

registerWidget('pluginId', ({ value, onChange }) => (
  <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
    <option value="">Choose a plugin</option>
    {catalog.list().filter((p) => !catalog.alwaysOn.includes(p.id)).map((p) => (
      <option key={p.id} value={p.id}>{p.title} ({p.id})</option>
    ))}
  </select>
))

registerWidget('dataFunction', ({ value, onChange }) => {
  const registry = useRegistry()
  return (
    <select value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
      <option value="">Choose a data function</option>
      {registry.allDataFunctions().map((f) => (
        <option key={f.id} value={f.id}>{f.title} ({f.id})</option>
      ))}
    </select>
  )
})

registerWidget('aoi', ({ value, onChange }) => (
  <div>
    <p className="gc-muted">Tip: use “Draw AOI” in the map header. Or paste a GeoJSON polygon feature.</p>
    <textarea
      rows={5}
      defaultValue={value ? JSON.stringify(value) : ''}
      onChange={(e) => {
        try {
          onChange(JSON.parse(e.target.value))
        } catch {}
      }}
    />
  </div>
))
