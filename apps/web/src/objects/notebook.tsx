import { NotebookIcon } from '@phosphor-icons/react'
import { NotebookObject } from '../notebooks/NotebookObject'
import type { ObjectTypeDef } from './types'

declare module '../board/board' {
  interface ObjectFields {
    /**
     * A Notebook Factory run, by id; each browser fetches it. Absent until someone picks a run.
     * view is shared, like a map's basemap; absent means the summary card.
     */
    notebook: { runId?: string; view?: 'card' | 'notebook' }
  }
}

export const notebook: ObjectTypeDef<'notebook'> = {
  type: 'notebook',
  label: 'Notebook',
  key: 'n',
  Icon: NotebookIcon,
  size: { w: 520, h: 420 },
  layer: 'top',
  create: (r) => ({ type: 'notebook', ...r }),
  View: NotebookObject,
  editable: true,
  editOnCreate: true,
}
