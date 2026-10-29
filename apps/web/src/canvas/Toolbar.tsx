import {
  ArrowUpRightIcon,
  CaretDownIcon,
  CircleIcon,
  CodeIcon,
  CursorIcon,
  FilePdfIcon,
  FlowArrowIcon,
  HandIcon,
  ImageIcon,
  LineSegmentIcon,
  MapTrifoldIcon,
  NoteIcon,
  ScribbleLoopIcon,
  SquareIcon,
  TextTIcon,
  UploadSimpleIcon,
  WarningIcon,
  type Icon,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuShortcut, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Separator } from '@/components/ui/separator'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Hint } from '@/components/Hint'
import { toolTypes } from './registry'
import { CONFLICT_FACE, COUNTRY_FACE, PRESENCE_FACE, RELIEFWEB_FACE } from './widgetFaces'

/** 'select', or the object type to draw. */
export type Tool = string

/** Select, move (pan), then a tool for each object type whose UI has one (canvas/registry.ts). */
export const tools = (): { tool: Tool; label: string; key: string; Icon: Icon }[] => [
  { tool: 'select', label: 'Select', key: 'V', Icon: CursorIcon },
  { tool: 'hand', label: 'Move', key: 'H', Icon: HandIcon },
  ...toolTypes().map((t) => ({ tool: t.type, label: t.label, key: t.key, Icon: t.Icon })),
  ...SHAPES.filter((s) => s.tool !== 'box').map((s) => ({ tool: s.tool, label: s.label, key: s.key!, Icon: s.Icon })),
]

/** A toolbar button, or a menu of them: `tool` is a tool, or an object type to draw (see tools()). */
interface Item {
  /** The tooltip. */
  label: string
  /** The short name drawn under the icon, one word; `label` when left out. */
  text?: string
  Icon: Icon
  tool: Tool
  key?: string
}

/** The toolbar's groups, in order, between separators. The country widgets and the ReliefWeb feed are named and drawn as on the canvas (widgetFaces.ts).*/
const SELECT: Item[] = [
  { label: 'Select', Icon: CursorIcon, tool: 'select', key: 'V' },
  { label: 'Move', Icon: HandIcon, tool: 'hand', key: 'H' },
]
const EVENT: Item = { label: 'Add event', text: 'Event', Icon: WarningIcon, tool: 'event', key: 'E' }
const EVENT_CONTEXT: Item[] = [
  { ...COUNTRY_FACE, tool: 'country' },
  { ...PRESENCE_FACE, tool: 'presence' },
  { ...CONFLICT_FACE, tool: 'conflict' },
  { ...RELIEFWEB_FACE, tool: 'reliefweb' },
]
const MAP_AND_REPORT: Item[] = [
  { label: 'Add map', text: 'Map', Icon: MapTrifoldIcon, tool: 'map', key: 'M' },
  { label: 'Add Jupyter notebook', text: 'Notebook', Icon: CodeIcon, tool: 'notebook', key: 'N' },
]
/** What you draw on the board yourself. Draw and connector are not built yet. */
const BOARD_TOOLS: Item[] = [
  { label: 'Add text', text: 'Text', Icon: TextTIcon, tool: 'text', key: 'T' },
  { label: 'Add sticky note', text: 'Sticky', Icon: NoteIcon, tool: 'sticky', key: 'S' },
]
/** The shapes, as in Figma: 'box:line' is the box tool drawing a line, and so on (Canvas.tsx). The rectangle is the box tool itself. */
const SHAPES: Item[] = [
  { label: 'Add rectangle', text: 'Rectangle', Icon: SquareIcon, tool: 'box', key: 'R' },
  { label: 'Add line', text: 'Line', Icon: LineSegmentIcon, tool: 'box:line', key: 'L' },
  { label: 'Add arrow', text: 'Arrow', Icon: ArrowUpRightIcon, tool: 'box:arrow', key: '⇧L' },
  { label: 'Add ellipse', text: 'Ellipse', Icon: CircleIcon, tool: 'box:ellipse', key: 'O' },
]
const IMAGE: Item = { label: 'Add image', text: 'Image', Icon: ImageIcon, tool: 'image', key: 'I' }
const COMING_SOON = [
  { label: 'Draw', Icon: ScribbleLoopIcon },
  { label: 'Connector', Icon: FlowArrowIcon },
]

interface Props {
  tool: Tool
  onTool(tool: Tool): void
  /** PDFs chosen with the PDF button, to put in the middle of the view. */
  onFiles(files: File[]): void
}

/** A category of the toolbar, named for screen readers: its buttons in a row. */
function Section({ name, children }: { name: string; children: ReactNode }) {
  return (
    <section role="group" aria-label={name} className="flex items-center gap-1">
      {children}
    </section>
  )
}

/** A tool's icon with its one-word name under it: a name you can read beats a tooltip you have to find. */
function Face({ Icon, text }: { Icon: Icon; text: string }) {
  return (
    <>
      <Icon className="size-5" />
      <span className="text-[10px] leading-3 font-normal opacity-60 [[aria-pressed=true]_&]:opacity-100">{text}</span>
    </>
  )
}

const BTN = 'h-12 min-w-12 flex-col gap-0.5 rounded-md px-1.5 has-[>svg]:px-1.5'

interface GroupProps {
  /** The tooltip of the arrow that opens the list. */
  name: string
  items: Item[]
  tool: Tool
  onTool(tool: Tool): void
}

/**
 * Tools that belong together, as in Figma: one button for the tool you used last in the group, and an arrow beside it
 * that lists them all. Choosing from the list picks that tool and makes it the group's button, so its tools are never
 * more than one click away and the bar stays short. Tools picked from the keys or the palette take the button too.
 */
function ToolGroup({ name, items, tool, onTool }: GroupProps) {
  const [current, setCurrent] = useState(items[0]!)
  useEffect(() => {
    const picked = items.find((i) => i.tool === tool)
    if (picked) setCurrent(picked)
  }, [tool, items])
  const { label, text, Icon, key } = current
  return (
    <div className="flex items-stretch">
      <Hint label={label} keys={key}>
        <Button variant={tool === current.tool ? 'default' : 'ghost'} size="sm" className={BTN} aria-label={label} aria-pressed={tool === current.tool} onClick={() => onTool(current.tool)}>
          <Face Icon={Icon} text={text ?? label} />
        </Button>
      </Hint>
      <DropdownMenu>
        <Hint label={name}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-12 w-4 rounded-md px-0 has-[>svg]:px-0" aria-label={name}>
              <CaretDownIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="center" side="top" sideOffset={8}>
          {items.map((item) => (
            <DropdownMenuItem
              key={item.label}
              onSelect={() => {
                setCurrent(item)
                onTool(item.tool)
              }}
            >
              <item.Icon />
              {item.text ?? item.label}
              {item.key && <DropdownMenuShortcut>{item.key}</DropdownMenuShortcut>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * The Canvas Toolbar of the Figma file: a rounded-lg bar of rounded-md buttons with Phosphor icons at the regular
 * weight and a one-word name under each, the selected tool filled, each with a tooltip for its key. Arrange, delete and the command palette have no
 * button here: they are on the keys (], [, Delete, ⌘K).
 */
export function Toolbar({ tool, onTool, onFiles }: Props) {
  const pdfInput = useRef<HTMLInputElement>(null)
  const separator = <Separator orientation="vertical" className="data-[orientation=vertical]:h-8" />
  const button = ({ label, text, Icon, tool: type, key }: Item) => (
    <Hint key={label} label={label} keys={key}>
      <Button variant={tool === type ? 'default' : 'ghost'} size="sm" className={BTN} aria-label={label} aria-pressed={tool === type} onClick={() => onTool(type)}>
        <Face Icon={Icon} text={text ?? label} />
      </Button>
    </Hint>
  )
  // A disabled button gets no pointer events, so its tooltip hangs on a wrapper.
  const comingSoon = (label: string, Icon: Icon) => (
    <Hint key={label} label={`${label} (coming soon)`}>
      <span tabIndex={0} className="rounded-md">
        <Button variant="ghost" size="sm" className={BTN} aria-label={label} disabled>
          <Face Icon={Icon} text={label} />
        </Button>
      </span>
    </Hint>
  )
  return (
    <TooltipProvider delayDuration={300} skipDelayDuration={100}>
      <div
        className="ttx-ui absolute bottom-2 left-1/2 z-[1000002] flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-lg border bg-card p-1.5 font-sans shadow-[0_2px_2px_rgb(0_0_0/0.1),0_4px_3px_rgb(0_0_0/0.1)]"
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <Section name="Navigate">
          <ToolGroup name="Select and move" items={SELECT} tool={tool} onTool={onTool} />
        </Section>
        {separator}
        <Section name="Explore">
          {button(EVENT)}
          {EVENT_CONTEXT.map(button)}
          {MAP_AND_REPORT.map(button)}
        </Section>
        {separator}
        <Section name="Board">
          {BOARD_TOOLS.map(button)}
          <ToolGroup name="Shapes" items={SHAPES} tool={tool} onTool={onTool} />
          {COMING_SOON.map(({ label, Icon }) => comingSoon(label, Icon))}
        </Section>
        {separator}
        <Section name="Upload">
          <DropdownMenu>
            <Hint label="Upload">
              <DropdownMenuTrigger asChild>
                <Button variant={tool === IMAGE.tool ? 'default' : 'ghost'} size="sm" className={BTN} aria-label="Upload" aria-pressed={tool === IMAGE.tool}>
                  <Face Icon={UploadSimpleIcon} text="Upload" />
                </Button>
              </DropdownMenuTrigger>
            </Hint>
            <DropdownMenuContent align="center" side="top" sideOffset={8}>
              <DropdownMenuItem onSelect={() => onTool(IMAGE.tool)}>
                <IMAGE.Icon />
                Image
                <DropdownMenuShortcut>{IMAGE.key}</DropdownMenuShortcut>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => pdfInput.current?.click()}>
                <FilePdfIcon />
                PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Section>
        <input
          ref={pdfInput}
          type="file"
          accept="application/pdf"
          multiple
          hidden
          onChange={(e) => {
            onFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />
      </div>
    </TooltipProvider>
  )
}
