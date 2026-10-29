import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  ChartBarIcon,
  CursorIcon,
  DatabaseIcon,
  FileTextIcon,
  FlowArrowIcon,
  HandIcon,
  MapTrifoldIcon,
  NoteIcon,
  ScribbleLoopIcon,
  ShapesIcon,
  TextTIcon,
  UploadSimpleIcon,
  type Icon,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { Runtime } from '@ttx/core'
import type { ConnectionStatus } from '../board/connect'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { toolTypes } from './registry'

/** 'select', or the object type to draw. */
export type Tool = string

/** Select, move (pan), then a tool for each object type whose UI has one (canvas/registry.ts). */
export const tools = (): { tool: Tool; label: string; key: string; Icon: Icon }[] => [
  { tool: 'select', label: 'Select', key: 'V', Icon: CursorIcon },
  { tool: 'hand', label: 'Move', key: 'H', Icon: HandIcon },
  ...toolTypes().map((t) => ({ tool: t.type, label: t.label, key: t.key, Icon: t.Icon })),
]

const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

interface Item {
  label: string
  Icon: Icon
  /** A tool, or an object type to draw (see tools()); an item with neither is not built yet. */
  tool?: Tool
  key?: string
}

/**
 * The Figma toolbar's buttons, in its order, in three groups. Where the app has no tool of that name yet the
 * button is off: draw, connector and chart. Dataset, report and upload are the event, notebook and image tools.
 */
const GROUPS: Item[][] = [
  [
    { label: 'Select', Icon: CursorIcon, tool: 'select', key: 'V' },
    { label: 'Move', Icon: HandIcon, tool: 'hand', key: 'H' },
    { label: 'Add sticky note', Icon: NoteIcon, tool: 'sticky', key: 'S' },
    { label: 'Add text', Icon: TextTIcon, tool: 'text', key: 'T' },
    { label: 'Draw', Icon: ScribbleLoopIcon },
    { label: 'Add shape', Icon: ShapesIcon, tool: 'box', key: 'R' },
    { label: 'Add connector', Icon: FlowArrowIcon },
  ],
  [
    { label: 'Add map', Icon: MapTrifoldIcon, tool: 'map', key: 'M' },
    { label: 'Add dataset', Icon: DatabaseIcon, tool: 'event', key: 'E' },
    { label: 'Add chart', Icon: ChartBarIcon },
    { label: 'Create report', Icon: FileTextIcon, tool: 'notebook', key: 'N' },
    { label: 'Upload', Icon: UploadSimpleIcon, tool: 'image', key: 'I' },
  ],
]

interface Props {
  runtime: Runtime
  tool: Tool
  onTool(tool: Tool): void
  zoom: number
  onResetZoom(): void
  status: ConnectionStatus
}

/** A button with its shadcn tooltip: the name, and its key. */
function Hint({ label, keys, children }: { label: string; keys?: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>
        {label}
        {keys && <kbd className="ml-2 font-sans opacity-70">{keys}</kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * The Canvas Toolbar of the Figma file: a pill of 36px round buttons with Phosphor icons at the regular
 * weight, the selected tool filled, each with a tooltip. Arrange, delete and the command palette have no
 * button here: they are on the keys (], [, Delete, ⌘K).
 */
export function Toolbar({ runtime, tool, onTool, zoom, onResetZoom, status }: Props) {
  const separator = <Separator orientation="vertical" className="data-[orientation=vertical]:h-5" />
  const button = (item: Item) => {
    const { label, Icon, tool: type, key } = item
    if (!type) {
      // A disabled button gets no pointer events, so its tooltip hangs on a wrapper.
      return (
        <Hint key={label} label={`${label} (coming soon)`}>
          <span tabIndex={0} className="rounded-full">
            <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label={label} disabled>
              <Icon className="size-5" />
            </Button>
          </span>
        </Hint>
      )
    }
    return (
      <Hint key={label} label={label} keys={key}>
        <Button variant={tool === type ? 'default' : 'ghost'} size="icon" className="size-9 rounded-full" aria-label={label} aria-pressed={tool === type} onClick={() => onTool(type)}>
          <Icon className="size-5" />
        </Button>
      </Hint>
    )
  }
  const action = (label: string, Icon: Icon, keys: string, onClick: () => void) => (
    <Hint label={label} keys={keys}>
      <Button variant="ghost" size="icon" className="size-9 rounded-full" aria-label={label} onClick={onClick}>
        <Icon className="size-5" />
      </Button>
    </Hint>
  )
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <div
        className="ttx-ui absolute bottom-2 left-1/2 z-[1000002] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-full border bg-card p-1.5 font-sans shadow-[0_2px_2px_rgb(0_0_0/0.1),0_4px_3px_rgb(0_0_0/0.1)]"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {GROUPS[0]!.map(button)}
        {separator}
        {GROUPS[1]!.map(button)}
        {separator}
        {action('Undo', ArrowCounterClockwiseIcon, `${MOD}Z`, () => runtime.undo())}
        {action('Redo', ArrowClockwiseIcon, `⇧${MOD}Z`, () => runtime.redo())}
        <Hint label="Reset zoom to 100%">
          <Button variant="ghost" size="sm" onClick={onResetZoom}>
            {Math.round(zoom * 100)}%
          </Button>
        </Hint>
        <Hint label={`Sync: ${status}`}>
          <span
            tabIndex={0}
            className={cn('mx-2 size-2 shrink-0 rounded-full', status === 'connected' ? 'bg-green-500' : status === 'disconnected' ? 'bg-red-500' : 'bg-amber-500')}
          />
        </Hint>
      </div>
    </TooltipProvider>
  )
}
