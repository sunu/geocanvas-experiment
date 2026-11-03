# Plan 028: a board chat that many people share

## Context

The board has one agent chat for everyone (`packages/core/src/chat.ts`, plans/plan-008.md). When several people ask
at about the same time, the chat is confusing:
- The chat showed entries in time order. Their messages came first, then the replies. A reply said "Agent" only, so
  people could not tell which question it answered.
- A queued message showed nothing. One line, "Agent is thinking…", did not say for whom.
- The model got the last 10 entries of the hour, and each reply in that list was "Agent: …", with no person. Other
  people's requests could push out the asker's own turns. Then "the copy" could name another person's object.
- The chat only grew. Nobody could trim it.

We keep one shared thread per board: in an exercise, everyone must see what the agent did.

## Design

**Exchanges.** `exchanges(entries)` puts each reply with the message it answers (`replyTo`), in the order of the
messages. The chat shows each exchange as one block: the message, then the reply as "Agent → <asker>" in the asker's
color.

**Queue status.** `queuePosition(pending, message)` counts the messages that the same agent answers before this one:
the room's agent answers the messages with no `browserTab`, and a tab's agent the messages with its id. An unanswered
message shows "Queued · N ahead", or what the agent does for it now. That text comes from presence
(`useAgentActivities`, key `agentKey(AGENT.id, person)`), so it works for the room's agent and for a browser agent.
The collapsed panel says for whom the agent works.

**Reply for you.** While the panel is collapsed, a reply to one of the person's messages shows "Reply for you" in the
header. When the person opens the panel, it shows that exchange. This state is local to the tab.

**Only mine.** A toggle in the header shows only the person's own exchanges. Compactions stay. The choice is kept in
localStorage.

**Asker-first context** (`recentChat` in `packages/plugins/src/agent/loop.ts`). The request gives the last 10 entries
of the hour and also the asker's own last 3 exchanges (`ASKER_EXCHANGES`). Each line names its person, and the
asker's lines are marked "(asker)"; a reply is "Agent to <person>". The system prompt tells the model to find a named
object in the asker's exchanges first, and to reply only to the asker.

**Compaction.** The broom in the chat header sends a message with `compact: true`. It goes through the same queue,
routing and turn limit as other messages. The agent makes one model call with no tools (`compactChat`) and replies
with `compacted: { summary }`. That reply is the boundary:
- The chat hides the exchanges before it, behind "Show N earlier" (for this tab only).
- Later turns get the summary and the entries after it, not the entries before it.

When there is no model, the hour's turns are used up or the model fails, the reply has `compacted: {}`: the chat is
cleared with no summary. Nothing is deleted from the doc. Replies keep what their Undo buttons need, and "Show
earlier" shows them again.

All new fields are optional, so old chats stay valid.

## Not done

- The phone layout gets exchanges and queue status (it shares `ChatEntries`), but not the toggle, the badge or the
  broom.
- Compaction does not make the doc smaller. If chats become too large, a later change can delete entries before a
  compaction, and lose their Undo buttons.
- The badge does not show when the panel is open but scrolled up: the panel scrolls to each new entry.
