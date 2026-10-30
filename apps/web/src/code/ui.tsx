import { TerminalWindowIcon } from '@phosphor-icons/react'
import { registerObjectUI } from '../canvas/registry'
import { CodeObject } from './CodeObject'

registerObjectUI('code', {
  View: CodeObject,
  tool: { key: 'C', label: 'Code', Icon: TerminalWindowIcon },
  editable: true,
  editOnCreate: true,
  panel: (cell) => ({
    title: cell.title,
    description: cell.output ? `Output: ${cell.output.summary}` : 'Not run yet',
    metadata: [
      ['Language', 'Python'],
      ...(cell.run ? ([['Last run', `${cell.run.status === 'ok' ? 'ok' : 'failed'} by ${cell.run.by}`]] as [string, string][]) : []),
    ],
  }),
})
