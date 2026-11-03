import { useSyncExternalStore } from 'react'
import { ArrowsOutSimpleIcon, FileTextIcon } from '@phosphor-icons/react'
import type { AgentReply, Chat, OplogEntry, Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import type { Board } from '../board/board'
import { usePluginsOff } from '../board/plugins'
import { addToReport, boardReports } from '../reports/reports'
import type { PanelInfo } from './registry'

/** What the board knows of an object's history: when anyone last changed it, and the request that made it. */
function useObjectHistory(runtime: Runtime, chat: Chat, id: string) {
  const length = useSyncExternalStore(
    (onChange) => {
      runtime.oplog.observe(onChange)
      return () => runtime.oplog.unobserve(onChange)
    },
    () => runtime.oplog.length,
  )
  const entries = useSyncExternalStore(chat.subscribe, chat.list)
  void length
  let updated: number | undefined
  const log = runtime.oplog.toArray() as OplogEntry[]
  for (let i = log.length - 1; i >= 0 && updated === undefined; i--) {
    const e = log[i]!
    if (e.kind === 'invocation' && e.status === 'applied' && ((e.target.kind === 'objects' && e.target.ids.includes(id)) || e.created?.includes(id))) updated = e.at
  }
  // An object the agent made has the request in the chat; one made by hand has none.
  const reply = entries.find((e): e is AgentReply => e.kind === 'agent' && !!e.undo?.created.includes(id))
  const prompt = reply && entries.find((e) => e.kind === 'user' && e.id === reply.replyTo)
  return { updated, prompt: prompt && prompt.kind === 'user' ? prompt.text : undefined }
}

/**
 * The Object Panel of the Figma file: what is known about the one object selected, in the right column under the user
 * menu. Its type says the title, description and metadata (ObjectUI.panel); the type's name, when it was last changed,
 * the request that made it (if the agent did) and the Open button are the same for every type.
 */
export function ObjectPanel({
  runtime,
  chat,
  object,
  info,
  onOpen,
  onSelect,
  notify,
}: {
  runtime: Runtime
  chat: Chat
  object: BoardObject
  info: PanelInfo
  /** Open it in focus mode. Absent for a type without one. */
  onOpen?: () => void
  /** Select objects, e.g. the new report Add to report made. */
  onSelect(ids: string[]): void
  /** Say what an action did, or why it did nothing, in the canvas's notice. */
  notify(text: string): void
}) {
  const { updated, prompt } = useObjectHistory(runtime, chat, object.id)
  const reportsOn = !usePluginsOff(runtime).has('reports')
  const rows = [...info.metadata, ...(updated ? ([['Updated', new Date(updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })]] as [string, string][]) : [])]
  return (
    <aside
      className="ttx-ui ttx-shell fixed top-[72px] right-2 z-[1000001] flex max-h-[calc(100vh-10rem)] w-[360px] max-w-[calc(100%-1rem)] flex-col overflow-y-auto rounded-xl border bg-card font-sans shadow-sm"
      aria-label={`${object.name || info.title}, properties`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg leading-7 font-semibold">{object.name || info.title}</h2>
          <Badge variant="secondary" className="font-normal">
            {runtime.registry.objectType(object.type)?.title ?? object.type}
          </Badge>
        </div>
        {info.description && <p className="text-sm text-muted-foreground">{info.description}</p>}
      </div>
      <Separator />
      <div className="flex flex-col gap-3 p-4">
        <p className="text-sm leading-[14px] font-medium">Metadata</p>
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 text-sm leading-5">
            <span className="text-muted-foreground">{label}</span>
            <span className="text-right font-medium">{value}</span>
          </div>
        ))}
      </div>
      {prompt && (
        <>
          <Separator />
          <div className="flex flex-col gap-3 p-4">
            <p className="text-sm leading-[14px] font-medium">Prompt</p>
            <p className="rounded-lg bg-muted p-3 text-sm leading-5 font-medium">{prompt}</p>
          </div>
        </>
      )}
      <Separator />
      <div className="flex gap-2 p-4">
        <Button variant="secondary" className="flex-1" disabled={!onOpen} onClick={onOpen}>
          <ArrowsOutSimpleIcon />
          Open
        </Button>
        {reportsOn && object.type !== 'report' && <AddToReport runtime={runtime} id={object.id} onSelect={onSelect} notify={notify} />}
      </div>
    </aside>
  )
}

/** Add the object to one of the board's reports, or to a new one (agent-docs/tasks/reports.md §4). */
function AddToReport({ runtime, id, onSelect, notify }: { runtime: Runtime; id: string; onSelect(ids: string[]): void; notify(text: string): void }) {
  const add = async (reportId?: string) => {
    const r = await addToReport(runtime, [id], reportId)
    notify(r.status === 'applied' ? (r.summary ?? 'Added to the report') : (r.error ?? 'Could not add to the report'))
    if (!reportId && r.created?.length) onSelect(r.created)
  }
  const reports = boardReports(runtime.board as Board, [id])
  if (!reports.length) {
    return (
      <Button variant="secondary" className="flex-1" onClick={() => void add()}>
        <FileTextIcon />
        Add to new report
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" className="flex-1">
          <FileTextIcon />
          Add to report
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {/* A check: the object is in that report already. */}
        {reports.map((r) => (
          <DropdownMenuCheckboxItem key={r.id} checked={r.added} onSelect={() => void add(r.id)}>
            {r.title}
          </DropdownMenuCheckboxItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void add()}>New report</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
