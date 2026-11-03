import { z } from 'zod'
import { Chat, defineOp, definePlugin, stableJson, type Board, type BoardTx, type TurnUndo } from '@ttx/core'

/**
 * Ops for the board's agent. The agent itself (src/agent/) runs in the room Durable Object, or in a browser on a person's own key.
 *
 * A person cannot undo the agent's writes with ⌘Z (each runtime undoes only its own), and the agent's
 * undo stack is lost when its room leaves memory. So each agent reply stores what undoing it needs.
 */
const undoTurn = defineOp<{ replyId: string }, TurnUndo>({
  id: 'agent.undoTurn',
  title: 'Undo agent turn',
  description: 'Put back the objects an agent turn changed or deleted, and remove the ones it added.',
  target: { kind: 'canvas' },
  // The chat's Undo button runs it. Not a tool: the agent must not undo people's requests.
  hidden: true,
  args: z.object({ replyId: z.string() }),
  prepare(ctx, { replyId }) {
    const reply = new Chat(ctx.board.doc).list().find((e) => e.kind === 'agent' && e.id === replyId)
    if (reply?.kind !== 'agent' || !reply.undo) throw new Error('Nothing to undo for this reply')
    refuseStale(ctx.board, reply.undo)
    return reply.undo
  },
  apply: revert,
})

const object = z.looseObject({ id: z.string(), type: z.string(), x: z.number(), y: z.number(), w: z.number(), h: z.number(), z: z.number() })

/** Undo one external agent's call (apps/web/src/mcp/), which has no chat reply: the same rule as agent.undoTurn. */
const revertOp = defineOp<TurnUndo>({
  id: 'agent.revert',
  title: 'Undo agent change',
  description: 'Put back the objects an agent changed or deleted, and remove the ones it added.',
  target: { kind: 'canvas' },
  hidden: true,
  args: z.object({
    created: z.array(z.string()),
    before: z.record(z.string(), object),
    after: z.record(z.string(), object.nullable()).optional(),
  }),
  prepare(ctx, undo) {
    refuseStale(ctx.board, undo)
    return undo
  },
  apply: revert,
})

/**
 * Someone changed an object after the turn: undoing would overwrite their change (two agents and people edit
 * one board at once), so refuse it whole. Replies from before `after` was stored are not checked.
 */
function refuseStale(board: Board, { after }: TurnUndo) {
  const changed = Object.entries(after ?? {}).filter(([id, was]) => stableJson(board.get(id) ?? null) !== stableJson(was))
  if (!changed.length) return
  const names = changed.map(([id, was]) => `${(board.get(id) ?? was)?.type ?? 'object'} ${id}`)
  throw new Error(`Changed since: ${names.join(', ')}. Undo would overwrite those changes, so nothing was undone.`)
}

function revert(tx: BoardTx, { created, before }: TurnUndo) {
  tx.remove(created)
  // Replace each object whole, so fields the turn added go too.
  for (const [id, { id: _id, type, ...fields }] of Object.entries(before)) tx.restore(id, type, fields)
}

export const agentPlugin = definePlugin({
  id: 'agent',
  title: 'Agent',
  description: 'The board\'s agent in the chat, on the server or on your own key.',
  optional: true,
  dependsOn: ['core'],
  ops: [undoTurn, revertOp],
})
