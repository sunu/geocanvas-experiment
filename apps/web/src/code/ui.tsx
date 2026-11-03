import { TerminalWindowIcon } from '@phosphor-icons/react'
import { People } from '@ttx/core'
import { registerDecoration, registerObjectUI } from '../canvas/registry'
import { CodeObject } from './CodeObject'
import { CodeFootnote } from './Footnote'

registerObjectUI('code', {
  View: CodeObject,
  tool: { key: 'C', label: 'Code', Icon: TerminalWindowIcon },
  editable: true,
  editOnCreate: true,
  panel: (cell, board) => ({
    title: cell.title,
    description: cell.output ? `Output: ${cell.output.summary}` : 'Not run yet',
    metadata: [
      ['Language', 'Python'],
      ...(cell.run ? ([['Last run', `${cell.run.status === 'ok' ? 'ok' : 'failed'} by ${new People(board.doc).nameOf(cell.run.byId, cell.run.by)}`]] as [string, string][]) : []),
    ],
  }),
})

registerDecoration(CodeFootnote)
