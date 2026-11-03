import {
  ArrowDownIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUpIcon,
  ArrowsClockwiseIcon,
  CopyIcon,
  FileTextIcon,
  LinkBreakIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import type { Runtime, TargetRef } from '@ttx/core'
import {
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@/components/ui/context-menu'
import type { Board } from '../board/board'
import { CodeMenu } from '../code/CodeMenu'
import { usePluginsOff } from '../board/plugins'
import { addToReport, boardReports } from '../reports/reports'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

interface Props {
  runtime: Runtime
  /** The objects the menu acts on: the selection, which a right click on an unselected object first replaces. */
  ids: string[]
  onSelect(ids: string[]): void
  /** Say what an action did, or why it did nothing, in the canvas's notice. */
  notify(text: string): void
}

/**
 * The menu of a right click on a canvas object. Every entry is a core op on the selection, the same ones the
 * keys (], [, Delete) and the palette run, so undo covers each as one step.
 */
export function ObjectMenu({ runtime, ids, onSelect, notify }: Props) {
  const target: TargetRef = { kind: 'objects', ids }
  const run = (opId: string, args: Record<string, unknown> = {}) => {
    runtime.beginGesture()
    return runtime.dispatch(opId, target, args)
  }
  // Links (plans/plan-013.md): the same ops as the palette, offered only where they apply.
  const available = new Set(runtime.availableOps(target).map((op) => op.id))
  const unlink = available.has('link.remove')
  const refresh = available.has('link.refresh')
  // Reports (agent-docs/tasks/reports.md §4): not for a selection of reports only, nor when reports are turned off.
  const board = runtime.board as Board
  const canReport = !usePluginsOff(runtime).has('reports') && ids.some((id) => board.get(id)?.type !== 'report')
  const reports = canReport ? boardReports(board, ids) : []
  const report = async (reportId?: string) => {
    const r = await addToReport(runtime, ids, reportId)
    notify(r.status === 'applied' ? (r.summary ?? 'Added to the report') : (r.error ?? 'Could not add to the report'))
    // A new report: select it, so it is easy to find.
    if (!reportId && r.created?.length) onSelect(r.created)
  }
  // A code cell's own entries (plan-022): Run, and Show output on.
  const cell = ids.length === 1 && board.get(ids[0]!)?.type === 'code' ? board.get(ids[0]!) : undefined
  const layer = (label: string, Icon: typeof ArrowUpIcon, opId: string, keys: string) => (
    <ContextMenuItem onSelect={() => run(opId)}>
      <Icon />
      {label}
      <ContextMenuShortcut>{keys}</ContextMenuShortcut>
    </ContextMenuItem>
  )
  return (
    <ContextMenuContent className="w-52">
      {cell?.type === 'code' && (
        <>
          <CodeMenu runtime={runtime} cell={cell} notify={notify} onSelect={onSelect} />
          <ContextMenuSeparator />
        </>
      )}
      <ContextMenuItem
        onSelect={() => {
          const created = run('core.object.duplicate').created
          if (created?.length) onSelect(created)
        }}
      >
        <CopyIcon />
        Duplicate
      </ContextMenuItem>
      {canReport &&
        (reports.length ? (
          <ContextMenuSub>
            <ContextMenuSubTrigger>
              <FileTextIcon />
              Add to report
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-56">
              {/* A check: the selection is in that report already. */}
              {reports.map((r) => (
                <ContextMenuCheckboxItem key={r.id} checked={r.added} onSelect={() => void report(r.id)}>
                  {r.title}
                </ContextMenuCheckboxItem>
              ))}
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => void report()}>New report</ContextMenuItem>
            </ContextMenuSubContent>
          </ContextMenuSub>
        ) : (
          <ContextMenuItem onSelect={() => void report()}>
            <FileTextIcon />
            Add to new report
          </ContextMenuItem>
        ))}
      <ContextMenuSeparator />
      {layer('Bring to front', ArrowLineUpIcon, 'core.object.bringToFront', ']')}
      {layer('Bring forward', ArrowUpIcon, 'core.object.bringForward', `${MOD}]`)}
      {layer('Send backward', ArrowDownIcon, 'core.object.sendBackward', `${MOD}[`)}
      {layer('Send to back', ArrowLineDownIcon, 'core.object.sendToBack', '[')}
      {(unlink || refresh) && <ContextMenuSeparator />}
      {refresh && (
        <ContextMenuItem onSelect={() => void runtime.invoke('link.refresh', target, {})}>
          <ArrowsClockwiseIcon />
          Refresh linked objects
        </ContextMenuItem>
      )}
      {unlink && (
        <ContextMenuItem onSelect={() => run('link.remove')}>
          <LinkBreakIcon />
          Unlink
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => run('core.object.delete')}>
        <TrashIcon />
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
