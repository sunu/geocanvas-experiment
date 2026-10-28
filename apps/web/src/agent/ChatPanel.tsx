import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
import { ArrowCounterClockwiseIcon, CheckIcon, PaperPlaneRightIcon, RobotIcon, WarningIcon, XIcon } from '@phosphor-icons/react'
import type { AgentReply, Chat, OplogEntry, Runtime, UserMessage } from '@ttx/core'
import { useOwnSelection, usePeers, type Awareness } from '../board/presence'

/**
 * The board's chat with its agent (plans/plan-008.md). One shared thread: everyone in the room sees each
 * request and what the agent did. A message carries what its sender had selected; the agent acts on that.
 */
export function ChatPanel({ runtime, chat, awareness, onClose }: { runtime: Runtime; chat: Chat; awareness: Awareness; onClose: () => void }) {
  const entries = useSyncExternalStore(chat.subscribe, chat.list)
  const selection = useOwnSelection(awareness)
  const thinking = usePeers(awareness).some((p) => p.user?.kind === 'agent' && p.status === 'thinking')
  const undone = useUndoneReplies(runtime)
  const [text, setText] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight })
  }, [entries.length, thinking])

  function send(e?: FormEvent) {
    e?.preventDefault()
    const message = text.trim()
    if (!message) return
    chat.send({ actor: runtime.actor, text: message, selection: [...selection] })
    setText('')
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter is a new line.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) send(e)
  }

  return (
    <aside className="ttx-chat" aria-label="Agent chat">
      <header className="ttx-chat__head">
        <RobotIcon size={18} />
        <span>Agent</span>
        <button className="ttx-chat__close" title="Close the agent chat" aria-label="Close the agent chat" onClick={onClose}>
          <XIcon size={16} />
        </button>
      </header>
      <div className="ttx-chat__list" ref={listRef}>
        {!entries.length && <p className="ttx-chat__empty">Select objects on the board, then ask the agent, e.g. "duplicate these" or "delete this".</p>}
        {entries.map((e) =>
          e.kind === 'user' ? (
            <UserEntry key={e.id} message={e} />
          ) : (
            <AgentEntry key={e.id} reply={e} runtime={runtime} undone={undone.has(e.id)} />
          ),
        )}
        {thinking && <p className="ttx-chat__thinking">Agent is thinking…</p>}
      </div>
      <form className="ttx-chat__form" onSubmit={send}>
        <div className="ttx-chat__selection">{selection.length ? `${selection.length} selected` : 'Nothing selected'}</div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} placeholder="Ask the agent…" rows={2} aria-label="Message to the agent" />
        <button type="submit" disabled={!text.trim()} title="Send" aria-label="Send">
          <PaperPlaneRightIcon size={16} />
        </button>
      </form>
    </aside>
  )
}

function UserEntry({ message }: { message: UserMessage }) {
  return (
    <div className="ttx-chat__entry">
      <div className="ttx-chat__who" style={{ color: message.actor.color }}>
        {message.actor.name ?? 'Someone'}
        {message.selection.length > 0 && <span className="ttx-chat__chip">{message.selection.length} selected</span>}
      </div>
      <div className="ttx-chat__text">{message.text}</div>
    </div>
  )
}

function AgentEntry({ reply, runtime, undone }: { reply: AgentReply; runtime: Runtime; undone: boolean }) {
  return (
    <div className="ttx-chat__entry ttx-chat__entry--agent">
      <div className="ttx-chat__who">Agent</div>
      <div className="ttx-chat__text">{reply.text}</div>
      {reply.calls.length > 0 && (
        <ul className="ttx-chat__calls">
          {reply.calls.map((c, i) => (
            <li key={i} className={c.status === 'failed' ? 'is-failed' : ''} title={c.error}>
              {c.status === 'applied' ? <CheckIcon size={12} /> : <WarningIcon size={12} />}
              {runtime.registry.op(c.tool)?.title ?? c.tool}
              {c.ids?.length ? ` (${c.ids.length})` : ''}
            </li>
          ))}
        </ul>
      )}
      {reply.undo &&
        (undone ? (
          <div className="ttx-chat__undone">Undone</div>
        ) : (
          <button className="ttx-chat__undo" onClick={() => void runtime.invoke('agent.undoTurn', { kind: 'canvas' }, { replyId: reply.id })}>
            <ArrowCounterClockwiseIcon size={14} />
            Undo
          </button>
        ))}
    </div>
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
