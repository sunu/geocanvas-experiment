import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowCounterClockwiseIcon, ArrowUpIcon, CheckIcon, CursorIcon, MicrophoneIcon, SparkleIcon, WarningIcon } from '@phosphor-icons/react'
import type { AgentReply, Chat, OplogEntry, Runtime, UserMessage } from '@ttx/core'
import { OPENROUTER_URL } from '@ttx/plugins'
import { Button } from '@/components/ui/button'
import { ModelPicker } from './ModelPicker'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'
import { useOwnSelection, usePeers, type Awareness } from '../board/presence'
import { TAB_ID } from './browserAgent'
import { DEFAULT_MODEL, forgetKey, loadKey, loadMode, saveKey, saveMode, type AgentMode, type KeyConfig } from './keys'

/** A message for a browser agent with no reply after this long, and nobody thinking: its tab has closed. */
const LOST_AFTER_MS = 120_000

/**
 * The board's chat with its agent (plans/plan-008.md). One shared thread: everyone in the room sees each
 * request and what the agent did. A message carries what its sender had selected; the agent acts on that.
 * Laid out as the Ask Panel of the Figma file. The room's agent answers on the server's key; "My key" sends the message to this tab's agent (browserAgent.ts).
 */
export function ChatPanel({ runtime, chat, awareness }: { runtime: Runtime; chat: Chat; awareness: Awareness }) {
  const entries = useSyncExternalStore(chat.subscribe, chat.list)
  const selection = useOwnSelection(awareness)
  // The room's agent, or a person whose browser agent works; or this tab's own.
  const peerThinking = usePeers(awareness).some((p) => p.status === 'thinking')
  const thinking = useOwnStatus(awareness) === 'thinking' || peerThinking
  const undone = useUndoneReplies(runtime)
  const [text, setText] = useState('')
  const dictation = useDictation((spoken) => setText((t) => (t && !/\s$/.test(t) ? `${t} ${spoken}` : t + spoken)))
  const [mode, setMode] = useState<AgentMode>(loadMode)
  const [hasKey, setHasKey] = useState(() => loadKey() !== null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const pending = new Set(chat.pending().map((m) => m.id))
  const ownWithoutKey = mode === 'own' && !hasKey

  function chooseMode(next: AgentMode) {
    setMode(next)
    saveMode(next)
    if (next === 'own' && !hasKey) setSettingsOpen(true)
  }
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [entries.length, thinking])

  function send(e?: FormEvent) {
    e?.preventDefault()
    const message = text.trim()
    if (!message || ownWithoutKey) return
    // The view center tells the agent where to put new objects.
    const center = runtime.view?.center()
    chat.send({ actor: runtime.actor, text: message, selection: [...selection], center, ...(mode === 'own' && { browserTab: TAB_ID }) })
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e)
  }

  return (
    <aside
      className="ttx-ui ttx-shell fixed top-[90px] left-4 z-[1000002] flex max-h-[calc(100%-106px)] w-[360px] max-w-[calc(100%-2rem)] flex-col rounded-xl border bg-card font-sans shadow-sm"
      aria-label="Agent chat"
    >
      <header className="flex shrink-0 items-center px-4 pt-4 pb-2">
        <h2 className="font-heading text-lg font-[550] tracking-tight text-foreground">Describe</h2>
      </header>
      {settingsOpen && (
        <KeySettings
          onSave={(config) => {
            saveKey(config)
            setHasKey(true)
            setSettingsOpen(false)
          }}
          onForget={() => {
            forgetKey()
            setHasKey(false)
          }}
        />
      )}
      {(entries.length > 0 || thinking) && (
        <div className="ttx-chat__list" ref={listRef}>
          {entries.map((e) =>
            e.kind === 'user' ? (
              <UserEntry key={e.id} message={e} lost={isLost(e, pending, thinking)} />
            ) : (
              <AgentEntry key={e.id} reply={e} runtime={runtime} undone={undone.has(e.id)} />
            ),
          )}
          {thinking && <p className="ttx-chat__thinking">Agent is thinking…</p>}
        </div>
      )}
      <form className="flex shrink-0 flex-col gap-3 px-4 pt-1 pb-4" onSubmit={send}>
        <div className="flex h-[184px] flex-col justify-between rounded-lg border border-input bg-background p-4">
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Describe the disaster, map or chart you want to add to the canvas…"
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
            <Button type="submit" size="icon" className="size-9 rounded-full" disabled={!text.trim() || ownWithoutKey} title="Send" aria-label="Send">
              <ArrowUpIcon className="size-[18px]" />
            </Button>
          </div>
        </div>
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
      </form>
      <Separator />
      <footer className="shrink-0 rounded-b-xl bg-panel-footer px-4 py-2">
        <ModelPicker />
      </footer>
    </aside>
  )
}

/** A browser agent's message that no tab will answer: not this tab's, old, unanswered, and nobody is working on it. */
function isLost(message: UserMessage, pending: Set<string>, thinking: boolean): boolean {
  return !!message.browserTab && message.browserTab !== TAB_ID && pending.has(message.id) && !thinking && Date.now() - message.at > LOST_AFTER_MS
}

function UserEntry({ message, lost }: { message: UserMessage; lost: boolean }) {
  return (
    <div className="ttx-chat__entry">
      <div className="ttx-chat__who" style={{ color: message.actor.color }}>
        {message.actor.name ?? 'Someone'}
        {message.selection.length > 0 && <span className="ttx-chat__chip">{message.selection.length} selected</span>}
        {message.browserTab && <span className="ttx-chat__chip" title="Answered by an agent in the sender's browser, on their own key">own key</span>}
      </div>
      <div className="ttx-chat__text">{message.text}</div>
      {lost && <div className="ttx-chat__undone">No answer: the sender's tab closed.</div>}
    </div>
  )
}

/** The form for the person's own key. The key is kept in this browser only (keys.ts). */
function KeySettings({ onSave, onForget }: { onSave: (config: KeyConfig) => void; onForget: () => void }) {
  const [config, setConfig] = useState<KeyConfig>(() => loadKey() ?? { provider: 'openrouter', url: OPENROUTER_URL, model: DEFAULT_MODEL, apiKey: '' })
  const set = (fields: Partial<KeyConfig>) => setConfig((c) => ({ ...c, ...fields }))
  const url = config.provider === 'openrouter' ? OPENROUTER_URL : config.url
  const valid = config.model.trim() && (config.provider === 'openrouter' ? config.apiKey.trim() : /^https?:\/\//.test(config.url))

  function submit(e: FormEvent) {
    e.preventDefault()
    if (valid) onSave({ ...config, url, model: config.model.trim(), apiKey: config.apiKey.trim() })
  }

  return (
    <form className="ttx-chat__keys" onSubmit={submit}>
      <label>
        Provider
        <select value={config.provider} onChange={(e) => set({ provider: e.target.value as KeyConfig['provider'] })}>
          <option value="openrouter">OpenRouter</option>
          <option value="openai-compatible">OpenAI-compatible URL</option>
        </select>
      </label>
      {config.provider === 'openai-compatible' && (
        <label>
          Base URL
          <input value={config.url === OPENROUTER_URL ? '' : config.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.openai.com/v1" />
        </label>
      )}
      <label>
        Model
        <input value={config.model} onChange={(e) => set({ model: e.target.value })} placeholder={DEFAULT_MODEL} />
      </label>
      <label>
        API key
        <input type="password" autoComplete="off" value={config.apiKey} onChange={(e) => set({ apiKey: e.target.value })} placeholder={config.provider === 'openrouter' ? 'sk-or-…' : 'Not needed for a local server'} />
      </label>
      <p>Your key stays in this browser. It is sent only to {url || 'the URL above'}, never to this board's server.</p>
      <div className="ttx-chat__keys-actions">
        <button type="button" onClick={onForget}>
          Forget key
        </button>
        <button type="submit" disabled={!valid}>
          Save
        </button>
      </div>
    </form>
  )
}

function AgentEntry({ reply, runtime, undone }: { reply: AgentReply; runtime: Runtime; undone: boolean }) {
  // Undo refuses when someone changed the turn's objects since (agent.undoTurn); say why.
  const [undoError, setUndoError] = useState<string>()
  const undo = async () => {
    const record = await runtime.invoke('agent.undoTurn', { kind: 'canvas' }, { replyId: reply.id })
    setUndoError(record.error)
  }
  return (
    <div className="ttx-chat__entry ttx-chat__entry--agent">
      <div className="ttx-chat__who">
        <SparkleIcon size={12} weight="fill" />
        Agent
      </div>
      <div className="ttx-chat__text">{reply.text}</div>
      {reply.calls.length > 0 && (
        <ul className="ttx-chat__calls">
          {reply.calls.map((c, i) => (
            <li key={i} className={c.status === 'failed' ? 'is-failed' : ''} title={c.error}>
              {c.status === 'applied' ? <CheckIcon size={12} /> : <WarningIcon size={12} />}
              {c.title ?? runtime.registry.op(c.tool)?.title ?? c.tool}
              {c.ids?.length ? ` (${c.ids.length})` : ''}
            </li>
          ))}
        </ul>
      )}
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
