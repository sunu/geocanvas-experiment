import { useEffect, useState } from 'react'
import { useSession, useRegistry } from '../ui/context'
import { registerNodeUI, registerWidget, type NodeViewProps } from '../ui/registry'
import { catalog } from '../plugins'
import { MapView, MapActions } from './MapView'
import { ChartView } from './ChartView'

function StickyView({ node, editing }: NodeViewProps) {
  const { runtime } = useSession()
  const [text, setText] = useState(String(node.props.text ?? ''))
  useEffect(() => setText(String(node.props.text ?? '')), [node.props.text])
  return (
    <div className={`gc-sticky gc-sticky--${node.props.color}`}>
      {editing ? (
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => {
            if (text !== node.props.text) {
              void runtime.dispatch('core.text.setContent', { kind: 'nodes', ids: [node.id] }, { text })
            }
          }}
        />
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

function TextView({ node, derived }: NodeViewProps) {
  const rendered = (derived?.result?.data as { rendered?: string } | undefined)?.rendered ?? String(node.props.text ?? '')
  return (
    <div className="gc-text">
      {rendered ? <MiniMarkdown text={rendered} /> : <span className="gc-muted">Empty. Use ⌘ → Edit text.</span>}
    </div>
  )
}

registerNodeUI('core.sticky', { View: StickyView, bare: true })
registerNodeUI('core.text', { View: TextView, icon: '¶' })
registerNodeUI('core.map', { View: MapView, Actions: MapActions, icon: '🗺' })
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
