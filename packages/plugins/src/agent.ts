import { z } from 'zod'
import { Chat, defineOp, definePlugin, type TurnUndo } from '@ttx/core'

/**
 * Ops for the board's agent. The agent itself runs in the room Durable Object (apps/worker/src/agent/).
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
    return reply.undo
  },
  apply(tx, { created, before }) {
    tx.remove(created)
    // Replace each object whole, so fields the turn added go too. This overwrites later changes by others.
    for (const [id, { id: _id, type, ...fields }] of Object.entries(before)) {
      tx.remove([id])
      tx.add(type, fields, id)
    }
  },
})

export const agentPlugin = definePlugin({
  id: 'agent',
  title: 'Agent',
  dependsOn: ['core'],
  ops: [undoTurn],
})
