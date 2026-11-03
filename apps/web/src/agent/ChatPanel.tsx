import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowCounterClockwiseIcon, ArrowUpIcon, BroomIcon, CaretDownIcon, CaretUpIcon, CursorIcon, MicrophoneIcon, SparkleIcon, UserIcon, WarningIcon } from '@phosphor-icons/react'
import { exchanges, failedCalls, lastCompaction, queuePosition, type Actor, type AgentReply, type Chat, type ChatEntry, type OplogEntry, type Runtime, type TurnUndo, type UserMessage } from '@ttx/core'
import { Button } from '@/components/ui/button'
import { ModelPicker } from './ModelPicker'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { AGENT } from '@ttx/plugins'
import { agentKey, useAgentActivities, useOwnSelection, usePeers, type Awareness } from '../board/presence'
import { objectName } from '../canvas/registry'
import { TAB_ID } from './browserAgent'
import { forgetKey, keyIsUsable, loadCollapsed, loadKey, loadMode, loadOnlyMine, saveCollapsed, saveKey, saveMode, saveOnlyMine, type AgentMode, type KeyConfig } from './keys'

/** A message for a browser agent with no reply after this long, and nobody thinking: its tab has closed. */
const LOST_AFTER_MS = 120_000

/**
 * The board's chat with its agent (plans/plan-008.md). One shared thread: everyone in the room sees each
 * request and what the agent did. A message carries what its sender had selected; the agent acts on that.
 * Laid out as the Ask Panel of the Figma file. The room's agent answers on the server's key; "My key" sends the message to this tab's agent (browserAgent.ts).
 */
export function ChatPanel({ runtime, chat, awareness }: { runtime: Runtime; chat: Chat; awareness: Awareness }) {
  const thread = useChatThread(runtime, chat, awareness)
  const { entries, thinking, working } = thread
  const selection = useOwnSelection(awareness)
  const [text, setText] = useState('')
  const [mode, setMode] = useState<AgentMode>(loadMode)
  const [key, setKey] = useState(loadKey)
  const hasKey = keyIsUsable(key)
  // Collapsed: only the header. The draft and mode stay in this state.
  const [collapsed, setCollapsed] = useState(loadCollapsed)
  const ownWithoutKey = mode === 'own' && !hasKey

  function pickModel(next: AgentMode, config?: KeyConfig) {
    if (config) {
      saveKey(config)
      setKey(loadKey())
    }
    setMode(next)
    saveMode(next)
  }
  function forget() {
    forgetKey()
    setKey(null)
    pickModel('room')
  }
  const listRef = useRef<HTMLDivElement>(null)

  const [forMe, setForMe] = useRepliesForMe(entries, runtime.actor.id, !collapsed)
  // The exchange to show when the panel opens: the first reply to this person that came while it was collapsed.
  const target = useRef<string>(undefined)

  // On new entries, and on opening the panel: show the latest, or the reply to this person.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const exchange = target.current && list.querySelector(`[data-exchange="${CSS.escape(target.current)}"]`)
    if (exchange) exchange.scrollIntoView({ block: 'start' })
    else list.scrollTo({ top: list.scrollHeight })
    target.current = undefined
  }, [entries.length, thinking, collapsed])

  function toggle() {
    const next = !collapsed
    setCollapsed(next)
    saveCollapsed(next)
    if (!next && forMe.length) {
      target.current = forMe[0]
      setForMe([])
    }
  }
  const indicator = collapsed && (forMe.length > 0 || !!working[0])
  // Something to compact (a message since the last compaction), and no compaction on its way.
  const since = entries.slice(lastCompaction(entries).index + 1)
  const canCompact = since.some((e) => e.kind === 'user' && !e.compact) && !since.some((e) => e.kind === 'user' && e.compact && thread.pending.has(e.id))
  const [onlyMine, setOnlyMine] = useState(loadOnlyMine)
  function toggleMine() {
    setOnlyMine(!onlyMine)
    saveOnlyMine(!onlyMine)
  }

  function send() {
    if (ownWithoutKey || !sendMessage(runtime, chat, text, selection, mode)) return
    setText('')
  }

  return (
    <aside
      className="ttx-ui ttx-shell ttx-chatpanel fixed top-[74px] left-2 z-[1000002] flex max-h-[calc(100%-82px)] w-[360px] max-w-[calc(100%-1rem)] flex-col rounded-xl border bg-card font-sans shadow-sm"
      aria-label="Agent chat"
    >
      <header className={cn('flex shrink-0 items-center gap-1 px-4 pt-4', collapsed ? 'pb-4' : 'pb-1.5')}>
        <h2 className="font-heading text-lg font-[550] tracking-tight text-foreground">
          <button type="button" className="rounded-md" aria-expanded={!collapsed} onClick={toggle}>
            Describe
          </button>
        </h2>
        {collapsed && forMe.length > 0 && (
          <button type="button" className="ml-auto inline-flex items-center gap-1.5 rounded-md px-1 text-xs font-medium text-foreground" onClick={toggle}>
            <span className="size-2 shrink-0 rounded-full bg-[var(--agent)]" aria-hidden />
            {forMe.length > 1 ? `${forMe.length} replies for you` : 'Reply for you'}
          </button>
        )}
        {collapsed && !forMe.length && working[0] && (
          <span className="ml-auto inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground" role="status">
            <span className="size-2 shrink-0 rounded-full bg-[var(--agent)]" aria-hidden />
            <span className="truncate">
              For {working[0].actor.name ?? 'someone'}: {thread.status(working[0]).activity}…
            </span>
          </span>
        )}
        {!collapsed && canCompact && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            title="Compact chat: the agent summarizes it, and the earlier messages are hidden for everyone"
            aria-label="Compact chat"
            onClick={() => compactChat(runtime, chat, ownWithoutKey ? 'room' : mode)}
          >
            <BroomIcon className="size-4" />
          </Button>
        )}
        {!collapsed && (
          <Button
            variant="ghost"
            size="icon-sm"
            className={cn(!canCompact && 'ml-auto', onlyMine && 'bg-accent')}
            title={onlyMine ? 'Show everyone’s requests' : 'Show only my requests'}
            aria-label="Show only my requests"
            aria-pressed={onlyMine}
            onClick={toggleMine}
          >
            <UserIcon className="size-4" weight={onlyMine ? 'fill' : 'regular'} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className={cn(collapsed && !indicator && 'ml-auto')}
          title={collapsed ? 'Open chat' : 'Collapse chat'}
          aria-label={collapsed ? 'Open chat' : 'Collapse chat'}
          aria-expanded={!collapsed}
          onClick={toggle}
        >
          {collapsed ? <CaretDownIcon className="size-4" /> : <CaretUpIcon className="size-4" />}
        </Button>
      </header>
      {!collapsed && (
        <>
          {(entries.length > 0 || thinking) && (
            <div className="ttx-chat__list" ref={listRef}>
              <ChatEntries runtime={runtime} thread={thread} onlyOf={onlyMine ? runtime.actor.id : undefined} />
            </div>
          )}
          <div className="flex shrink-0 flex-col gap-3 px-4 pt-0 pb-4">
            <ChatComposer
              text={text}
              onText={setText}
              onSend={send}
              disabled={ownWithoutKey}
              placeholder="Describe the disaster, map or chart you want to add to the canvas…"
              className="h-[184px] p-4"
            />
            {(ownWithoutKey || selection.length > 0) && (
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                {ownWithoutKey ? (
                  <span className="text-xs text-muted-foreground">Add your key first: open the model menu below</span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1.5">
                    <CursorIcon className="size-3.5" />
                    {selection.length} selected
                  </span>
                )}
              </div>
            )}
          </div>
          <Separator />
          <footer className="shrink-0 rounded-b-xl bg-panel-footer px-3 py-1">
            <ModelPicker mode={mode} config={key} onUse={pickModel} onForget={forget} />
          </footer>
        </>
      )}
    </aside>
  )
}

/** What the chat shows, read from the doc and presence: its entries, and what the agents are doing now and for whom. */
export function useChatThread(runtime: Runtime, chat: Chat, awareness: Awareness) {
  const entries = useSyncExternalStore(chat.subscribe, chat.list)
  // The room's agent, or a person whose browser agent works; or this tab's own.
  const peerThinking = usePeers(awareness).some((p) => p.status === 'thinking')
  const thinking = useOwnStatus(awareness) === 'thinking' || peerThinking
  // What an agent does now (thinking, a search) for each person, as its cursor's tag says.
  const activities = useAgentActivities(awareness)
  const undone = useUndoneReplies(runtime)
  const queue = chat.pending()
  const pending = new Set(queue.map((m) => m.id))
  /** Where a message is: answered now (with what the agent does), queued behind others, or neither (-1). */
  const status = (m: UserMessage) => ({ ahead: queuePosition(queue, m), activity: activities.get(agentKey(AGENT.id, m.actor.id)) })
  // The messages answered now, for the collapsed panel's header.
  const working = queue.filter((m) => queuePosition(queue, m) === 0 && activities.has(agentKey(AGENT.id, m.actor.id)))
  return { entries, thinking, undone, pending, status, working }
}

export type ChatThread = ReturnType<typeof useChatThread>

/**
 * Send `text` to the agent, acting on `selection`: the room's agent, or this tab's on the person's own key. The view
 * center tells the agent where to put new objects. False when there is nothing to send.
 */
export function sendMessage(runtime: Runtime, chat: Chat, text: string, selection: Iterable<string>, mode: AgentMode): boolean {
  const message = text.trim()
  if (!message) return false
  const center = runtime.view?.center()
  chat.send({ actor: runtime.actor, text: message, selection: [...selection], center, ...(mode === 'own' && { browserTab: TAB_ID }) })
  return true
}

/**
 * Ask the agent to compact the chat: it summarizes the chat for its later requests, and the exchanges before are hidden
 * for everyone (they stay in the doc, with their Undo buttons, behind "Show earlier").
 */
function compactChat(runtime: Runtime, chat: Chat, mode: AgentMode) {
  chat.send({ actor: runtime.actor, text: 'Compact the chat', selection: [], compact: true, ...(mode === 'own' && { browserTab: TAB_ID }) })
}

/**
 * The thread's exchanges, each reply under the message it answers, and each unanswered message's place in its queue. The exchanges before
 * the last compaction are hidden until "Show earlier". With `onlyOf`, only that person's. With `onOpen`, each reply also lists the objects it added and
 * changed, to open them: where the canvas is not there to show them (the phone's layout).
 */
export function ChatEntries({ runtime, thread, onOpen, onlyOf }: { runtime: Runtime; thread: ChatThread; onOpen?(id: string): void; onlyOf?: string }) {
  const { entries, thinking, undone, pending, status } = thread
  const [showEarlier, setShowEarlier] = useState(false)
  // With `onlyOf`, that person's exchanges and the compactions.
  const all = useMemo(
    () => exchanges(entries).filter((x) => !onlyOf || x.reply?.compacted || x.message?.actor.id === onlyOf),
    [entries, onlyOf],
  )
  const compaction = lastCompaction(entries).reply
  const start = compaction ? all.findIndex((x) => x.reply === compaction) : 0
  const shown = showEarlier ? all : all.slice(start)
  return (
    <>
      {!showEarlier && start > 0 && (
        <button type="button" className="ttx-chat__earlier" onClick={() => setShowEarlier(true)}>
          Show {start} earlier
        </button>
      )}
      {shown.map(({ message, reply }) =>
        reply?.compacted ? (
          <CompactionEntry key={reply.id} reply={reply} by={message?.actor ?? askerOf(entries, reply)} />
        ) : (
          <div key={(message ?? reply)!.id} className="ttx-chat__exchange" data-exchange={message?.id}>
            {message && <UserEntry message={message} lost={isLost(message, pending, thinking)} status={reply ? undefined : status(message)} />}
            {reply && <AgentEntry reply={reply} asker={message?.actor} runtime={runtime} undone={undone.has(reply.id)} onOpen={onOpen} />}
          </div>
        ),
      )}
    </>
  )
}

/** Who sent the message a reply answers, when it is in the chat. */
const askerOf = (entries: ChatEntry[], reply: AgentReply): Actor | undefined =>
  entries.find((e): e is UserMessage => e.kind === 'user' && e.id === reply.replyTo)?.actor

/** Where the chat was compacted: who did it, and the agent's summary of the chat before, to read. */
function CompactionEntry({ reply, by }: { reply: AgentReply; by?: Actor }) {
  return (
    <div className="ttx-chat__compaction">
      <div className="ttx-chat__compaction-line">Chat compacted{by ? ` by ${by.name ?? 'someone'}` : ''}</div>
      {reply.compacted?.summary && (
        <details>
          <summary>Summary</summary>
          <div className="ttx-chat__text">{reply.compacted.summary}</div>
        </details>
      )}
    </div>
  )
}

/** The prompt box: a text area, dictation and Send. Enter sends; Shift+Enter is a new line. */
export function ChatComposer({
  text,
  onText,
  onSend,
  disabled,
  placeholder,
  className,
}: {
  text: string
  onText(update: (text: string) => string): void
  onSend(): void
  disabled?: boolean
  placeholder: string
  className?: string
}) {
  const dictation = useDictation((spoken) => onText((t) => (t && !/\s$/.test(t) ? `${t} ${spoken}` : t + spoken)))
  function submit(e: FormEvent) {
    e.preventDefault()
    if (dictation.listening) dictation.toggle()
    onSend()
  }
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) submit(e)
  }
  return (
    <form className={cn('flex flex-col justify-between rounded-lg border border-input bg-background', className)} onSubmit={submit}>
      <Textarea
        value={text}
        onChange={(e) => onText(() => e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Message to the agent"
        className="min-h-0 flex-1 resize-none border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 md:text-base"
      />
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn('size-9', dictation.listening && 'bg-accent')}
          disabled={!dictation.supported}
          title={dictation.supported ? (dictation.listening ? 'Stop dictating' : 'Dictate') : "This browser can't dictate"}
          aria-label="Dictate"
          aria-pressed={dictation.listening}
          onClick={dictation.toggle}
        >
          <MicrophoneIcon className="size-[18px]" weight={dictation.listening ? 'fill' : 'regular'} />
        </Button>
        <Button type="submit" size="icon" className="size-9 rounded-full" disabled={!text.trim() || disabled} title="Send" aria-label="Send">
          <ArrowUpIcon className="size-[18px]" />
        </Button>
      </div>
    </form>
  )
}

/** A browser agent's message that no tab will answer: not this tab's, old, unanswered, and nobody is working on it. */
function isLost(message: UserMessage, pending: Set<string>, thinking: boolean): boolean {
  return !!message.browserTab && message.browserTab !== TAB_ID && pending.has(message.id) && !thinking && Date.now() - message.at > LOST_AFTER_MS
}

function UserEntry({ message, lost, status }: { message: UserMessage; lost: boolean; status?: { ahead: number; activity?: string } }) {
  return (
    <div className="ttx-chat__entry">
      <div className="ttx-chat__who" style={{ color: message.actor.color }}>
        {message.actor.name ?? 'Someone'}
        {message.selection.length > 0 && <span className="ttx-chat__chip">{message.selection.length} selected</span>}
        {message.browserTab && <span className="ttx-chat__chip" title="Answered by an agent in the sender's browser, on their own key">own key</span>}
      </div>
      <div className="ttx-chat__text">{message.text}</div>
      {lost ? (
        <div className="ttx-chat__undone">No answer: the sender's tab closed.</div>
      ) : (
        status &&
        status.ahead >= 0 && (
          <div className="ttx-chat__status" role="status">
            {status.ahead > 0 ? (
              `Queued · ${status.ahead} ahead`
            ) : (
              <>
                <span className="ttx-chat__dot" aria-hidden />
                {status.activity ?? 'Waiting for the agent'}…
              </>
            )}
          </div>
        )
      )}
    </div>
  )
}

function AgentEntry({ reply, asker, runtime, undone, onOpen }: { reply: AgentReply; asker?: Actor; runtime: Runtime; undone: boolean; onOpen?(id: string): void }) {
  // Undo refuses when someone changed the turn's objects since (agent.undoTurn); say why.
  const [undoError, setUndoError] = useState<string>()
  const undo = async () => {
    const record = await runtime.invoke('agent.undoTurn', { kind: 'canvas' }, { replyId: reply.id })
    setUndoError(record.error)
  }
  const failed = failedCalls(reply.calls)
  return (
    <div className="ttx-chat__entry ttx-chat__entry--agent">
      <div className="ttx-chat__who">
        <SparkleIcon size={12} weight="fill" />
        Agent
        {asker && (
          <span className="ttx-chat__to" style={{ color: asker.color }}>
            → {asker.name ?? 'Someone'}
          </span>
        )}
      </div>
      <div className="ttx-chat__text">{reply.text}</div>
      {/* What went well shows on the canvas, on the agent's cursor and the objects it worked on; what failed has nowhere else to go. */}
      {failed.length > 0 && (
        <ul className="ttx-chat__calls">
          {failed.map((c, i) => (
            <li key={i} className="is-failed" title={c.error}>
              <WarningIcon size={12} />
              {c.title ?? runtime.registry.op(c.tool)?.title ?? c.tool}
              {c.ids?.length ? ` (${c.ids.length})` : ''}
            </li>
          ))}
        </ul>
      )}
      {onOpen && reply.undo && !undone && <TurnObjects runtime={runtime} undo={reply.undo} onOpen={onOpen} />}
      {reply.undo &&
        (undone ? (
          <div className="ttx-chat__undone">Undone</div>
        ) : (
          <button className="ttx-chat__undo" onClick={() => void undo()}>
            <ArrowCounterClockwiseIcon size={14} />
            Undo
          </button>
        ))}
      {undoError && !undone && <div className="ttx-chat__undo-error">{undoError}</div>}
    </div>
  )
}

/** The objects a turn added, then those it changed, that are still on the board: a button for each. */
function TurnObjects({ runtime, undo, onOpen }: { runtime: Runtime; undo: TurnUndo; onOpen(id: string): void }) {
  const objects = [...new Set([...undo.created, ...Object.keys(undo.before)])].flatMap((id) => {
    const o = runtime.board.get(id)
    return o ? [{ o, added: undo.created.includes(id) }] : []
  })
  if (!objects.length) return null
  return (
    <ul className="ttx-chat__objects">
      {objects.map(({ o, added }) => (
        <li key={o.id}>
          <button type="button" onClick={() => onOpen(o.id)}>
            {added ? 'Added' : 'Changed'} · {objectName(runtime, o)}
          </button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The messages of person `me` that got their reply while the chat was not open, oldest first, and a setter to clear
 * them. Replies already there when the panel mounts do not count.
 */
function useRepliesForMe(entries: ChatEntry[], me: string, open: boolean) {
  const known = useRef<Set<string>>(null)
  const [unseen, setUnseen] = useState<string[]>([])
  useEffect(() => {
    const replies = entries.filter((e): e is AgentReply => e.kind === 'agent')
    if (!known.current) {
      known.current = new Set(replies.map((r) => r.id))
      return
    }
    const fresh = replies.filter((r) => !known.current!.has(r.id))
    for (const r of fresh) known.current.add(r.id)
    if (open) return
    const mine = new Set(entries.flatMap((e) => (e.kind === 'user' && e.actor.id === me ? [e.id] : [])))
    const forMe = fresh.filter((r) => mine.has(r.replyTo)).map((r) => r.replyTo)
    if (forMe.length) setUnseen((u) => [...u, ...forMe])
  }, [entries, me, open])
  return [unseen, setUnseen] as const
}

/** This tab's presence status: 'thinking' while its browser agent works. */
function useOwnStatus(awareness: Awareness): string | undefined {
  return useSyncExternalStore(
    (onChange) => {
      awareness.on('change', onChange)
      return () => awareness.off('change', onChange)
    },
    () => (awareness.getLocalState() as { status?: string } | null)?.status,
  )
}

/** Agent replies someone has undone, from the shared op log, so everyone sees it. */
function useUndoneReplies(runtime: Runtime): Set<string> {
  const length = useSyncExternalStore(
    (onChange) => {
      runtime.oplog.observe(onChange)
      return () => runtime.oplog.unobserve(onChange)
    },
    () => runtime.oplog.length,
  )
  return useMemo(() => {
    const ids = new Set<string>()
    for (const e of runtime.oplog.toArray() as OplogEntry[]) {
      if (e.kind === 'invocation' && e.opId === 'agent.undoTurn' && e.status === 'applied') ids.add((e.args as { replyId: string }).replyId)
    }
    return ids
  }, [runtime, length])
}

/** The browser's speech recognition (Chrome and Safari; Firefox has none), not in TypeScript's DOM types. */
interface Recognition {
  lang: string
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start(): void
  stop(): void
}
const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition

/** Dictation into the prompt: one phrase per press, passed to `onText` when it is recognized. */
function useDictation(onText: (spoken: string) => void) {
  const [listening, setListening] = useState(false)
  const active = useRef<Recognition>(null)
  const latest = useRef(onText)
  latest.current = onText
  useEffect(() => () => active.current?.stop(), [])
  function toggle() {
    if (!Recognizer) return
    if (active.current) return active.current.stop()
    const r = new Recognizer()
    r.lang = navigator.language
    r.onresult = (e) => latest.current(Array.from(e.results, (alt) => alt[0]?.transcript ?? '').join(' ').trim())
    r.onend = r.onerror = () => {
      active.current = null
      setListening(false)
    }
    active.current = r
    setListening(true)
    r.start()
  }
  return { supported: !!Recognizer, listening, toggle }
}
