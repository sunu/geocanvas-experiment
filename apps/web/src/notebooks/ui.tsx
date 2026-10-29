import { NotebookIcon } from '@phosphor-icons/react'
import { registerObjectUI, registerWidget } from '../canvas/registry'
import { NotebookObject, RunPicker } from './NotebookObject'
import { NotebookOptions } from './NotebookOptions'

registerObjectUI('notebook', {
  View: NotebookObject,
  Options: NotebookOptions,
  tool: { key: 'N', label: 'Notebook', Icon: NotebookIcon },
  editable: true,
  editOnCreate: true,
})

/** Pick a run in a form, e.g. for 'notebook.setRun' in the palette: the same picker as the notebook object. */
registerWidget('notebookRun', ({ value, onChange }) => (
  <div className="ttx-field__notebook">
    <RunPicker selected={typeof value === 'string' ? value : undefined} onPick={onChange} />
  </div>
))
