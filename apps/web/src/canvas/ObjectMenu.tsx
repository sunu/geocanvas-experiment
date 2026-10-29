import {
  ArrowDownIcon,
  ArrowLineDownIcon,
  ArrowLineUpIcon,
  ArrowUpIcon,
  CopyIcon,
  TrashIcon,
} from '@phosphor-icons/react'
import type { Runtime, TargetRef } from '@ttx/core'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
} from '@/components/ui/context-menu'

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

interface Props {
  runtime: Runtime
  /** The objects the menu acts on: the selection, which a right click on an unselected object first replaces. */
  ids: string[]
  onSelect(ids: string[]): void
}

/**
 * The menu of a right click on a canvas object. Every entry is a core op on the selection, the same ones the
 * keys (], [, Delete) and the palette run, so undo covers each as one step.
 */
export function ObjectMenu({ runtime, ids, onSelect }: Props) {
  const target: TargetRef = { kind: 'objects', ids }
  const run = (opId: string, args: Record<string, unknown> = {}) => {
    runtime.beginGesture()
    return runtime.dispatch(opId, target, args)
  }
  const layer = (label: string, Icon: typeof ArrowUpIcon, opId: string, keys: string) => (
    <ContextMenuItem onSelect={() => run(opId)}>
      <Icon />
      {label}
      <ContextMenuShortcut>{keys}</ContextMenuShortcut>
    </ContextMenuItem>
  )
  return (
    <ContextMenuContent className="w-52">
      <ContextMenuItem
        onSelect={() => {
          const created = run('core.object.duplicate').created
          if (created?.length) onSelect(created)
        }}
      >
        <CopyIcon />
        Duplicate
      </ContextMenuItem>
      <ContextMenuSeparator />
      {layer('Bring to front', ArrowLineUpIcon, 'core.object.bringToFront', ']')}
      {layer('Bring forward', ArrowUpIcon, 'core.object.bringForward', `${MOD}]`)}
      {layer('Send backward', ArrowDownIcon, 'core.object.sendBackward', `${MOD}[`)}
      {layer('Send to back', ArrowLineDownIcon, 'core.object.sendToBack', '[')}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => run('core.object.delete')}>
        <TrashIcon />
        Delete
        <ContextMenuShortcut>⌫</ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
