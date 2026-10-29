import { FileTextIcon } from '@phosphor-icons/react'
import type { Board } from '../board/board'
import { registerObjectUI, registerWidget } from '../canvas/registry'
import { ReportObject } from './ReportObject'
import { boardReports } from './reports'

/** Reports (agent-docs/tasks/reports.md): the widget on the canvas. Report mode (focus) comes in step 5. */
registerObjectUI('report', {
  View: ReportObject,
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
