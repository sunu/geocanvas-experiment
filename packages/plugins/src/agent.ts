import { z } from 'zod'
import { BoardSkills, Chat, defineOp, definePlugin, MAX_BOARD_SKILLS, skillSchema, stableJson, type Board, type BoardSkill, type BoardTx, type TurnUndo } from '@ttx/core'
import { SKILLS } from './skills/index.js'

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

/**
 * The board's own skills (plans/plan-026.md), written in Settings. Hidden, and refused for any actor but a person: a
 * skill goes into every later turn for everyone, so an agent that wrote one from text it read (a feed item, a PDF)
 * would leave a prompt injection on the board.
 */
const onlyPeople = (kind: string) => {
  if (kind !== 'user') throw new Error('Only people can change board skills')
}

const setSkill = defineOp<{ id?: string; skill: z.infer<typeof skillSchema> }, { id: string; skill: Omit<BoardSkill, 'id'> }>({
  id: 'agent.setSkill',
  title: 'Save board skill',
  description: 'Add a skill for the agent on this board, or replace one, for everyone. Undo does not cover it.',
  target: { kind: 'canvas' },
  hidden: true,
  args: z.object({ id: z.string().optional(), skill: skillSchema }),
  prepare(ctx, { id, skill }) {
    onlyPeople(ctx.actor.kind)
    const others = new BoardSkills(ctx.board.doc).list().filter((s) => s.id !== id)
    if (SKILLS.some((s) => s.name === skill.name)) throw new Error(`${skill.name} is the name of a built-in skill`)
    if (others.some((s) => s.name === skill.name)) throw new Error(`This board has a skill named ${skill.name}`)
    if (!id && others.length >= MAX_BOARD_SKILLS) throw new Error(`A board has at most ${MAX_BOARD_SKILLS} skills`)
    const by = ctx.actor.onBehalfOf ?? ctx.actor.id
    return { id: id ?? crypto.randomUUID(), skill: { ...skill, ...(by && { by }), at: Date.now() } }
  },
  apply: (tx, { id, skill }) => tx.setSkill(id, skill),
})

const removeSkill = defineOp<{ id: string }>({
  id: 'agent.removeSkill',
  title: 'Delete board skill',
  description: 'Delete one of the skills of this board, for everyone. Undo does not cover it.',
  target: { kind: 'canvas' },
  hidden: true,
  args: z.object({ id: z.string() }),
  prepare(ctx, args) {
    onlyPeople(ctx.actor.kind)
    return args
  },
  apply: (tx, { id }) => tx.removeSkill(id),
})

export const agentPlugin = definePlugin({
  id: 'agent',
  title: 'Agent',
  description: 'The board\'s agent in the chat, on the server or on your own key.',
  optional: true,
  dependsOn: ['core'],
  ops: [undoTurn, revertOp, setSkill, removeSkill],
})
