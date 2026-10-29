import { FileTextIcon } from '@phosphor-icons/react'
import type { Board } from '../board/board'
import { registerObjectUI, registerWidget } from '../canvas/registry'
import { ReportObject } from './ReportObject'
import { ReportOptions } from './ReportOptions'
import { boardReports } from './reports'

/**
 * Reports (agent-docs/tasks/reports.md): the widget on the canvas, and report mode in focus. Report mode is live (no
 * private draft: the agent edits reports too) and keeps the agent chat open on the left.
 */
registerObjectUI('report', {
  View: ReportObject,
  Options: ReportOptions,
  live: true,
  keepChat: true,
  tool: { key: 'P', label: 'Add report', Icon: FileTextIcon },
  panel: (o) => {
    const items = o.blocks.filter((b) => b.kind === 'item').length
    return {
      title: 'Report',
      description: 'A document made from the board. Add objects to it with Add to report.',
      metadata: [
        ['Paper', `${o.paper === 'a4' ? 'A4' : 'Letter'}, ${o.orientation}`],
        ['Items', String(items)],
      ],
    }
  },
})

/** Pick a report of the board in a form, e.g. for 'report.addItems': its reports by title, and "New report" (no value), which makes one. */
registerWidget('report', ({ runtime, value, onChange }) => (
  <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
    <option value="">New report</option>
    {boardReports(runtime.board as Board).map((r) => (
      <option key={r.id} value={r.id}>
        {r.title}
      </option>
    ))}
  </select>
))
