import { useSyncExternalStore } from 'react'
import { PencilSimpleIcon } from '@phosphor-icons/react'
import type { AgentReply, Chat, OplogEntry, Runtime } from '@ttx/core'
import type { BoardObject } from '../board/board'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
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
 * the request that made it (if the agent did) and the Edit button are the same for every type.
 */
export function ObjectPanel({
  runtime,
  chat,
  object,
  info,
  onEdit,
}: {
  runtime: Runtime
  chat: Chat
  object: BoardObject
  info: PanelInfo
  /** Open it in focus mode. Absent for a type without one. */
  onEdit?: () => void
}) {
  const { updated, prompt } = useObjectHistory(runtime, chat, object.id)
  const rows = [...info.metadata, ...(updated ? ([['Updated', new Date(updated).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })]] as [string, string][]) : [])]
  return (
    <aside
      className="ttx-ui ttx-shell fixed top-[72px] right-2 z-[1000001] flex max-h-[calc(100vh-10rem)] w-[360px] max-w-[calc(100%-1rem)] flex-col overflow-y-auto rounded-xl border bg-card font-sans shadow-sm"
      aria-label={`${info.title}, properties`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg leading-7 font-semibold">{info.title}</h2>
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
      <div className="p-4">
        <Button variant="secondary" className="w-full" disabled={!onEdit} onClick={onEdit}>
          <PencilSimpleIcon />
          Edit
        </Button>
      </div>
    </aside>
  )
}
