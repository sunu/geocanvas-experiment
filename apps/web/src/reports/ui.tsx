import { reportTitle, type ReportBoardObject } from '@ttx/plugins'
import { registerWidget } from '../canvas/registry'

/**
 * Pick a report of the board in a form, e.g. for 'report.addItems': its reports by title, and "New report" (no
 * value), which makes one. The report widget and report mode come in later steps (agent-docs/tasks/reports.md).
 */
registerWidget('report', ({ runtime, value, onChange }) => {
  const board = runtime.board
  const reports = board.list().filter((o): o is ReportBoardObject => o.type === 'report')
  const titled = reports
    .map((r) => ({ id: r.id, title: reportTitle(r, r.titleFrom ? board.get(r.titleFrom) : undefined) }))
    .sort((a, b) => a.title.localeCompare(b.title))
  return (
    <select value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">New report</option>
      {titled.map((r) => (
        <option key={r.id} value={r.id}>
          {r.title}
        </option>
      ))}
    </select>
  )
})
