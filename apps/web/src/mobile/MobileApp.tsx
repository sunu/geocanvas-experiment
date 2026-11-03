import { useEffect, useRef, useState } from 'react'
import { ArrowArcLeftIcon, ArrowArcRightIcon, CaretLeftIcon, DesktopIcon, FileTextIcon, SparkleIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { Draft, type InvocationRecord, type TargetRef } from '@ttx/core'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useConnectionStatus, useObjects } from '../board/connect'
import { usePluginsOff } from '../board/plugins'
import { publishSelection, useOwnSelection } from '../board/presence'
import { board, chat, provider, runtime } from '../board/session'
import { isFocusable, objectUI } from '../canvas/registry'
import { publishViewport } from '../canvas/viewport'
import { BoardTitle } from '../chrome/TitleBar'
import { switchLayout } from '../layout'
import { Palette } from '../palette/Palette'
import { AskPage } from './AskPage'
import { BoardCanvas } from './BoardCanvas'
import { BoardList } from './BoardList'
import { isSheetEntry, SHEET_ENTRY } from './history'
import { ObjectSheet } from './ObjectSheet'
import { ReportsPage } from './ReportsPage'
import { phoneCenter, placed } from './placement'
import { followVisualViewport } from './viewport'
import './mobile.css'

type Tab = 'ask' | 'board' | 'reports'
/** The Board tab as a list of widgets, or as the canvas lays them out (read-only). Kept per browser. */
type BoardView = 'list' | 'canvas'
const BOARD_VIEW_KEY = 'ttx/boardView'

function loadBoardView(): BoardView {
  try {
    return localStorage.getItem(BOARD_VIEW_KEY) === 'canvas' ? 'canvas' : 'list'
  } catch {
    return 'list'
  }
}

function saveBoardView(view: BoardView) {
  try {
    localStorage.setItem(BOARD_VIEW_KEY, view)
  } catch {
    // Blocked storage: the choice lasts this page.
  }
}
const awareness = provider.awareness

/**
 * The board on a phone (plans/plan-018.md): the agent's chat (Ask) and the board as a list of its widgets (Board),
 * on the same doc, runtime and ops as the canvas. The person's selection is the card they chose: others see it as on
 * the canvas, the agent acts on it, and adds go next to it. A card opens full screen, where it can be edited.
 */
export function MobileApp() {
  const objects = useObjects(board)
  const selection = useOwnSelection(awareness)
  const status = useConnectionStatus(provider)
  const [chosenTab, setTab] = useState<Tab>('ask')
  // Ask is the agent's chat: none while the agent is turned off on the board, so the board shows instead.
  const agentOn = !usePluginsOff(runtime).has('agent')
  const tab = chosenTab === 'ask' && !agentOn ? 'board' : chosenTab
  const [sheet, setSheet] = useState<{ id: string; editing: boolean; draft?: Draft } | null>(null)
  const [palette, setPalette] = useState(false)
  /** Shows an object on the Board tab: the list scrolls to it, the canvas fits it. None: the whole board. */
  const reveal = useRef<(id: string | undefined) => void>(() => {})
  const [boardView, setBoardView] = useState<BoardView>(loadBoardView)
  /** The browser's back (a swipe on iOS, the back button on Android) while a widget is full screen: ObjectSheet leaves it. */
  const back = useRef<() => void>(undefined)

  const choose = (id: string | undefined) => publishSelection(awareness, id ? [id] : [])
  const open = (id: string, editing = false) => {
    const o = board.get(id)
    if (!o) return
    choose(id)
    if (!isSheetEntry()) history.pushState(SHEET_ENTRY, '')
    // A type with a focus mode opens in it, on a draft, as on the canvas.
    setSheet({ id, editing, draft: isFocusable(objectUI(o.type)) ? new Draft(runtime) : undefined })
  }

  const closeSheet = () => {
    setSheet(null)
    if (isSheetEntry()) history.back()
  }

  useEffect(followVisualViewport, [])

  useEffect(() => {
    const onPop = () => back.current?.()
    addEventListener('popstate', onPop)
    return () => removeEventListener('popstate', onPop)
  }, [])

  // The draft lives as long as its full screen. Closed after the object's view has let go of it.
  useEffect(() => {
    const draft = sheet?.draft
    return () => draft?.close()
  }, [sheet?.draft])

  // View ops and tools (zoom to, focus) and the agent's placement, without a canvas.
  useEffect(() => {
    const chosen = () => {
      const id = (awareness.getLocalState() as { selection?: string[] } | null)?.selection?.[0]
      return id ? board.get(id) : undefined
    }
    runtime.view = {
      fitAll: () => reveal.current(undefined),
      zoomTo: (ids) => {
        setTab('board')
        reveal.current(ids[0])
      },
      resetZoom: () => {},
      focus: (id) => open(id),
      center: () => phoneCenter(board.list(), chosen()),
    }
    return () => {
      runtime.view = undefined
    }
  }, [])

  // Only the map open full screen is live; the list's maps are snapshots (map/budget.ts).
  useEffect(() => {
    publishViewport({
      camera: { x: 0, y: 0, z: 1 },
      width: innerWidth,
      height: innerHeight,
      objects: [],
      selected: new Set(selection),
      editing: sheet?.editing ? sheet.id : null,
      focused: sheet?.id ?? null,
    })
  }, [sheet, selection])

  // Someone deleted the open object.
  useEffect(() => {
    if (sheet && !objects.some((o) => o.id === sheet.id)) closeSheet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, sheet])

  /** Run an op from the palette as one undo step. A new object goes off what is there, then opens. */
  async function run(opId: string, target: TargetRef, args: unknown): Promise<InvocationRecord> {
    const type = runtime.registry.objectTypes().find((t) => opId === `${t.type}.add`)
    const a = args as { x?: number; y?: number; w?: number; h?: number }
    if (type && typeof a.x === 'number' && typeof a.y === 'number') {
      Object.assign(a, placed(board.list(), { x: a.x, y: a.y }, { w: a.w ?? type.defaultSize.w, h: a.h ?? type.defaultSize.h }))
    }
    runtime.beginGesture()
    const r = await runtime.invoke(opId, target, args)
    if (r.status !== 'applied') return r
    setPalette(false)
    const [first] = r.created ?? []
    if (first && r.created!.length === 1) open(first, !!objectUI(board.get(first)?.type ?? '')?.editOnCreate)
    else if (first) {
      setTab('board')
      reveal.current(first)
    }
    return r
  }

  return (
    <div className="ttx-ui ttx-m font-sans">
      <header className="ttx-m__bar flex items-center gap-1 border-b bg-card px-2">
        <Button variant="ghost" size="icon" title="Boards" aria-label="Boards" onClick={() => (location.hash = '')}>
          <CaretLeftIcon className="size-5" />
        </Button>
        <span
          className={cn('size-2 shrink-0 rounded-full', status === 'connected' ? 'bg-green-500' : status === 'disconnected' ? 'bg-red-500' : 'bg-amber-500')}
          title={status === 'connected' ? 'Connected' : status === 'disconnected' ? 'Offline' : 'Connecting'}
          aria-label={status}
          role="status"
        />
        <div className="flex min-w-0 flex-1">
          <BoardTitle runtime={runtime} />
        </div>
        <Button variant="ghost" size="icon" title="Undo" aria-label="Undo" onClick={() => runtime.undo()}>
          <ArrowArcLeftIcon className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" title="Redo" aria-label="Redo" onClick={() => runtime.redo()}>
          <ArrowArcRightIcon className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" title="Open the full board" aria-label="Open the full board" onClick={() => switchLayout('desktop')}>
          <DesktopIcon className="size-5" />
        </Button>
      </header>

      <main className="ttx-m__main">
        {tab === 'ask' ? (
          <AskPage runtime={runtime} chat={chat} awareness={awareness} selection={selection} onClear={() => choose(undefined)} onOpen={open} />
        ) : tab === 'reports' ? (
          <ReportsPage runtime={runtime} objects={objects} onOpen={open} />
        ) : (
          <>
            {boardView === 'canvas' ? (
              <BoardCanvas runtime={runtime} objects={objects} selection={selection} open={sheet?.id} onOpen={open} reveal={reveal} />
            ) : (
              <BoardList runtime={runtime} objects={objects} selection={selection} open={sheet?.id} onOpen={open} onSelect={(id) => choose(selection.includes(id) ? undefined : id)} onAdd={() => setPalette(true)} reveal={reveal} />
            )}
            <BoardViewSwitch
              view={boardView}
              onView={(view) => {
                setBoardView(view)
                saveBoardView(view)
              }}
            />
          </>
        )}
      </main>

      <nav className="ttx-m__tabs flex border-t bg-card" aria-label="Views">
        {agentOn && <TabButton active={tab === 'ask'} onClick={() => setTab('ask')} icon={<SparkleIcon className="size-5" />} label="Ask" />}
        <TabButton active={tab === 'board'} onClick={() => setTab('board')} icon={<SquaresFourIcon className="size-5" />} label={`Board · ${objects.length}`} />
        <TabButton active={tab === 'reports'} onClick={() => setTab('reports')} icon={<FileTextIcon className="size-5" />} label="Reports" />
      </nav>

      {sheet && (
        <ObjectSheet
          runtime={runtime}
          id={sheet.id}
          draft={sheet.draft}
          editing={sheet.editing}
          onEditing={(editing) => setSheet({ ...sheet, editing })}
          back={back}
          onClose={closeSheet}
          onAsk={
            agentOn
              ? () => {
                  closeSheet()
                  setTab('ask')
                }
              : undefined
          }
          onMore={() => setPalette(true)}
        />
      )}
      {palette && <Palette runtime={runtime} selection={selection} center={() => runtime.view!.center()} run={run} onClose={() => setPalette(false)} />}
    </div>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick(): void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      className={cn('flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium', active ? 'text-foreground' : 'text-muted-foreground')}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}

/** List or Canvas, over the top of the Board tab. */
function BoardViewSwitch({ view, onView }: { view: BoardView; onView(view: BoardView): void }) {
  const option = (value: BoardView, label: string) => (
    <button
      type="button"
      aria-pressed={view === value}
      className={cn('rounded-md px-3 py-1 text-sm font-medium', view === value ? 'bg-accent text-foreground' : 'text-muted-foreground')}
      onClick={() => onView(value)}
    >
      {label}
    </button>
  )
  return (
    <div className="ttx-m-switch flex gap-1 rounded-lg border bg-card p-1 shadow-md" role="group" aria-label="Show the board as">
      {option('list', 'List')}
      {option('canvas', 'Canvas')}
    </div>
  )
}
