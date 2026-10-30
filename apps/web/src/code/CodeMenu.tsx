import { useEffect } from 'react'
import { PlayIcon, ShareFatIcon } from '@phosphor-icons/react'
import type { Runtime } from '@ttx/core'
import { accepts, followersOf, KIND_NAMES, NEW_FOLLOWER, type CodeBoardObject } from '@ttx/plugins'
import { ContextMenuCheckboxItem, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubContent, ContextMenuSubTrigger } from '@/components/ui/context-menu'
import { clearEmphasis, emphasize } from '../canvas/emphasis'
import { useRunCell } from './cell'

const NEW_LABEL: Record<string, string> = { map: 'New map', image: 'New image', sticky: 'New sticky note' }

/**
 * A code cell's entries in the right-click menu (canvas/ObjectMenu.tsx, plan-019): Run, and "Show output on" with
 * the board's objects that can show the output and a new one. Hovering an object's entry points it out on the
 * canvas, since several maps may share a name.
 */
export function CodeMenu({ runtime, cell, notify, onSelect }: { runtime: Runtime; cell: CodeBoardObject; notify(text: string): void; onSelect(ids: string[]): void }) {
  const { run, canRun, why } = useRunCell(runtime, cell.id)
  useEffect(() => () => void clearEmphasis('menu'), [])
  const kind = cell.output?.kind
  const shown = new Set(followersOf(runtime.board.list(), cell.id).map((o) => o.id))
  const candidates = runtime.board.list().filter((o) => o.id !== cell.id && accepts(o.type, kind))
  // Names as people see them; repeated ones numbered, in board order ("Map", "Map 2").
  const seen = new Map<string, number>()
  const named = candidates.map((o) => {
    const base = o.name || runtime.registry.objectType(o.type)?.title || o.type
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return { o, label: n > 1 ? `${base} ${n}` : base }
  })
  const newType = kind && NEW_FOLLOWER[kind]
  const show = async (args: { on: string } | { new: true }, label: string) => {
    clearEmphasis('menu')
    runtime.beginGesture()
    const r = await runtime.invoke('code.show', { kind: 'objects', ids: [cell.id] }, args)
    notify(r.status === 'applied' ? `Shown on ${label}` : (r.error ?? 'Could not show the output'))
    if ('new' in args && r.created?.length) onSelect(r.created)
  }
  const disabled = !kind ? 'Run it first' : !newType ? `${KIND_NAMES[kind].replace(/^./, (c) => c.toUpperCase())} shows only in its cell` : undefined
  return (
    <>
      <ContextMenuItem disabled={!canRun} title={why} onSelect={() => void run()}>
        <PlayIcon />
        Run
      </ContextMenuItem>
      {disabled ? (
        <ContextMenuItem disabled>
          <ShareFatIcon />
          Show output on: {disabled.toLowerCase()}
        </ContextMenuItem>
      ) : (
        <ContextMenuSub onOpenChange={(open) => !open && clearEmphasis('menu')}>
          <ContextMenuSubTrigger>
            <ShareFatIcon />
            Show output on
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-56" onPointerLeave={() => clearEmphasis('menu')}>
            {named.map(({ o, label }) => (
              <ContextMenuCheckboxItem
                key={o.id}
                checked={shown.has(o.id)}
                disabled={shown.has(o.id)}
                onPointerEnter={() => emphasize('menu', [o.id])}
                onFocus={() => emphasize('menu', [o.id])}
                onSelect={() => void show({ on: o.id }, label)}
              >
                {label}
              </ContextMenuCheckboxItem>
            ))}
            {named.length > 0 && <ContextMenuSeparator />}
            <ContextMenuItem onPointerEnter={() => clearEmphasis('menu')} onSelect={() => void show({ new: true }, NEW_LABEL[newType!]!.replace(/^New /, 'a new '))}>
              {NEW_LABEL[newType!]}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
    </>
  )
}
