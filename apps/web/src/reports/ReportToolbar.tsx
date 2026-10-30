import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { CheckIcon, ImageIcon, MinusIcon, SquaresFourIcon, StackPlusIcon, TextHIcon, TextTIcon } from '@phosphor-icons/react'
import { Uploads, uploadUrl, type Runtime } from '@ttx/core'
import type { ReportBoardObject } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { Board } from '../board/board'
import { useObjects } from '../board/connect'
import { roomFromHash } from '../board/room'
import { BTN, Face, PANEL } from '../canvas/Toolbar'
import { objectUI } from '../canvas/registry'
import { refusal, typesOf, uploadFile } from '../uploads/upload'
import { runReportOp, useReportEditing } from './editing'
import { holds } from './reports'

/**
 * Report mode's toolbar (agent-docs/tasks/reports.md §5.1b), at the bottom center in the canvas toolbar's place and look:
 * add a heading, text, an image or a divider, or objects from the board. What it adds goes after the selected block, or
 * at the end, and becomes the selected block; a new heading or text opens for typing.
 */
export function ReportToolbar() {
  const ed = useReportEditing()!
  const { report: r, runtime } = ed
  const board = runtime.board as Board
  const [status, setStatus] = useState<string>()
  const file = useRef<HTMLInputElement>(null)
  const at = () => {
    const i = r.blocks.findIndex((b) => b.id === ed.selected)
    return i < 0 ? r.blocks.length : i + 1
  }
  /** Add one block at the insertion point, select it, and open it for typing when it takes text. */
  const add = (block: Record<string, unknown>, type = false) => {
    const index = at()
    const done = runReportOp(runtime, r.id, 'report.addBlock', { block, index })
    if (done.status !== 'applied') return setStatus(done.error)
    const added = (board.get(r.id) as ReportBoardObject | undefined)?.blocks[index]
    if (!added) return
    ed.select(added.id)
    ed.setEditing(type ? added.id : null)
  }
  const upload = async (f: File) => {
    const refused = refusal(f, ['media'])
    if (refused) return setStatus(refused)
    setStatus('Uploading…')
    try {
      const id = await uploadFile(f, roomFromHash(location.hash) ?? '', runtime.actor.id)
      setStatus(undefined)
      add({ kind: 'image', imageId: id })
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'The upload failed')
    }
  }

  return (
    <div className={`ttx-ui absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 font-sans ${PANEL}`} onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" className={BTN} title="Add a heading" aria-label="Add a heading">
            <Face Icon={TextHIcon} text="Heading" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          {([1, 2, 3] as const).map((level) => (
            <DropdownMenuItem key={level} onSelect={() => add({ kind: 'heading', text: '', level }, true)}>
              Heading {level}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="sm" className={BTN} title="Add text" aria-label="Add text" onClick={() => add({ kind: 'text', text: '' }, true)}>
        <Face Icon={TextTIcon} text="Text" />
      </Button>
      <ImageMenu runtime={runtime} onUpload={() => file.current?.click()} onPick={(imageId) => add({ kind: 'image', imageId })} />
      <Button variant="ghost" size="sm" className={BTN} title="Add a divider" aria-label="Add a divider" onClick={() => add({ kind: 'divider' })}>
        <Face Icon={MinusIcon} text="Divider" />
      </Button>
      <AddFromBoard
        report={r}
        board={board}
        onPick={(id) => {
          const index = at()
          runtime.beginGesture()
          const done = runtime.dispatch('report.addItems', { kind: 'objects', ids: [id] }, { reportId: r.id, index })
          if (done.status !== 'applied') return setStatus(done.error)
          setStatus(undefined)
          const added = (board.get(r.id) as ReportBoardObject | undefined)?.blocks[index]
          if (added) ed.select(added.id)
        }}
      />
      <input
        ref={file}
        type="file"
        accept={typesOf('media').join(',')}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) void upload(f)
        }}
      />
      {status && (
        <span className="max-w-48 truncate px-2 text-xs text-muted-foreground" role="status" title={status}>
          {status}
        </span>
      )}
    </div>
  )
}

/** Image: upload one, or pick one already uploaded to the board (its media, newest first). */
function ImageMenu({ runtime, onUpload, onPick }: { runtime: Runtime; onUpload(): void; onPick(imageId: string): void }) {
  const uploads = useMemo(() => new Uploads(runtime.board.doc), [runtime])
  const all = useSyncExternalStore(uploads.subscribe, uploads.list)
  const media = [...all].filter((u) => u.kind === 'media').reverse()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className={BTN} title="Add an image" aria-label="Add an image">
          <Face Icon={ImageIcon} text="Image" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="max-h-80 w-64 overflow-y-auto">
        <DropdownMenuItem onSelect={onUpload}>Upload an image…</DropdownMenuItem>
        {media.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>From the board's uploads</DropdownMenuLabel>
            {media.map((u) => (
              <DropdownMenuItem key={u.id} onSelect={() => onPick(u.id)}>
                <img src={uploadUrl(u.id)} alt="" className="size-8 shrink-0 rounded-sm border object-cover" />
                <span className="truncate">{u.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Add from board: the board's objects (not reports) by name, searchable, checked when already in this report. */
function AddFromBoard({ report, board, onPick }: { report: ReportBoardObject; board: Board; onPick(id: string): void }) {
  const objects = useObjects(board)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const choices = objects
    .filter((o) => o.type !== 'report')
    .map((o) => ({ o, label: o.name || ((o as { title?: string }).title ?? o.type) }))
    .filter(({ label, o }) => !q.trim() || `${label} ${o.type}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => a.label.localeCompare(b.label))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className={BTN} title="Add objects from the board" aria-label="Add objects from the board">
          <Face Icon={StackPlusIcon} text="From board" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" className="flex w-72 flex-col gap-2 p-2">
        <Input autoFocus placeholder="Search the board" aria-label="Search the board" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="flex max-h-72 flex-col overflow-y-auto">
          {choices.length ? (
            choices.map(({ o, label }) => {
              const Icon = objectUI(o.type)?.tool?.Icon ?? SquaresFourIcon
              const added = holds(report, o.id)
              return (
                <button
                  key={o.id}
                  type="button"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    onPick(o.id)
                    setOpen(false)
                  }}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  <span className="flex-1 truncate">{label}</span>
                  {added && <CheckIcon className="size-4 shrink-0" aria-label="Already in the report" />}
                </button>
              )
            })
          ) : (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">Nothing on the board matches.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
