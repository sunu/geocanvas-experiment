import { useEffect, useRef, useState } from 'react'
import { CursorIcon, XIcon } from '@phosphor-icons/react'
import type { Chat, Runtime } from '@ttx/core'
import { ChatComposer, ChatEntries, sendMessage, useChatThread } from '../agent/ChatPanel'
import type { Awareness } from '../board/presence'
import { keyIsUsable, loadKey, loadMode } from '../agent/keys'
import { objectName } from '../canvas/registry'

/** Prompts to start from, before anyone has asked anything. They fill the box; nothing is sent until Send. */
const STARTERS = ['Summarize this board', 'What are the latest updates on this event?', 'Add a map of the affected area', 'Draft a situation report']

interface Props {
  runtime: Runtime
  chat: Chat
  awareness: Awareness
  selection: string[]
  onClear(): void
  onOpen(id: string): void
}

/**
 * The board's chat with its agent, full screen: the same thread as the canvas's Ask panel. Each reply lists what it
 * added and changed, to open, since there is no canvas to show it. A message acts on the chosen card.
 */
export function AskPage({ runtime, chat, awareness, selection, onClear, onOpen }: Props) {
  const thread = useChatThread(runtime, chat, awareness)
  const [text, setText] = useState('')
  const list = useRef<HTMLDivElement>(null)
  const chosen = selection.map((id) => runtime.board.get(id)).find((o) => !!o)

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight })
  }, [thread.entries.length, thread.thinking])

  function send() {
    // "My key" with no key set would go to a tab that cannot answer: the room's agent answers then.
    const mode = loadMode() === 'own' && keyIsUsable(loadKey()) ? 'own' : 'room'
    if (sendMessage(runtime, chat, text, selection, mode)) setText('')
  }

  return (
    <div className="ttx-m-ask">
      <div className="ttx-m-ask__list ttx-chat__list" ref={list}>
        {thread.entries.length === 0 && !thread.thinking ? (
          <div className="flex flex-col gap-3 py-6">
            <p className="text-sm text-muted-foreground">Ask the agent to find events, add maps and data, or explain what is on the board.</p>
            <div className="flex flex-wrap gap-2">
              {STARTERS.map((s) => (
                <button key={s} type="button" className="rounded-md border bg-card px-3 py-2 text-left text-sm" onClick={() => setText(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ChatEntries runtime={runtime} thread={thread} onOpen={onOpen} />
        )}
      </div>
      <div className="ttx-m-ask__compose flex flex-col gap-2 border-t bg-card px-3 pt-2">
        {chosen && (
          <span className="inline-flex max-w-full items-center gap-1.5 self-start rounded-md bg-accent px-2 py-1 text-sm">
            <CursorIcon className="size-3.5 shrink-0" />
            <span className="truncate">{objectName(runtime, chosen)}</span>
            <button type="button" className="rounded-sm p-0.5" title="Ask about the whole board" aria-label="Clear the selection" onClick={onClear}>
              <XIcon className="size-3.5" />
            </button>
          </span>
        )}
        <ChatComposer text={text} onText={setText} onSend={send} placeholder="Ask the agent…" className="min-h-[96px] p-3" />
      </div>
    </div>
  )
}
