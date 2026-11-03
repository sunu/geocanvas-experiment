import * as Y from 'yjs'
import { z } from 'zod'

/**
 * A skill: a workflow the agent reads only when a request needs it (plans/plan-017.md, after
 * wri/project-zeno's src/agent/skills). The system prompt lists each skill's name, description and
 * when_to_use; skills__read gives the body and loads the skill's tools for the rest of the turn.
 * Built-in skills are files in packages/plugins/src/skills/; board skills are in the doc (plans/plan-026.md).
 */
export interface Skill {
  name: string
  description: string
  whenToUse: string
  /** Op or tool ids the workflow needs. The skill is offered only when the agent has all of them. */
  requires: string[]
  /** Op or tool ids loaded with the skill when the agent has them. */
  optional: string[]
  body: string
}

/** At most this many skills on one board. Each one's line goes into every turn's system prompt. */
export const MAX_BOARD_SKILLS = 20

/** A board skill as people write it. The limits keep each turn's prompt small. */
export const skillSchema = z.object({
  name: z.string().regex(/^[a-z0-9-]{2,40}$/, 'Use 2 to 40 characters: a-z, 0-9 and -'),
  description: z.string().trim().min(1, 'Write a description').max(300),
  whenToUse: z.string().trim().min(1, 'Say when the agent uses it').max(300),
  requires: z.array(z.string()).max(20),
  optional: z.array(z.string()).max(20),
  body: z.string().trim().min(1, 'Write the steps').max(8000),
})

/** A skill written on this board, for everyone on it. */
export interface BoardSkill extends Skill {
  id: string
  /** The person id of who saved it last, as their browser claims it until there are accounts. */
  by?: string
  at: number
}

const stored = skillSchema.extend({ by: z.string().optional(), at: z.number() })

/**
 * The board's own skills, in the doc's `skills` map: id → skill. One entry per skill, so two people who change two
 * skills at once keep both. Written only by the hidden ops agent.setSkill and agent.removeSkill (BoardTx.setSkill),
 * never by an agent. Not board objects: no undo, as for the chat.
 */
export class BoardSkills {
  readonly entries: Y.Map<unknown>
  private cached: BoardSkill[] | null = null
  private listeners = new Set<() => void>()

  constructor(doc: Y.Doc) {
    this.entries = doc.getMap('skills')
    this.entries.observe(() => {
      this.cached = null
      for (const listener of this.listeners) listener()
    })
  }

  /** Call `listener` after every change, local or remote. Returns the unsubscribe function. */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Every valid skill, by name. An entry that does not match the schema (a newer or broken client) is left out. The same array until the next change (for React). */
  list = (): BoardSkill[] => {
    if (this.cached) return this.cached
    const out: BoardSkill[] = []
    this.entries.forEach((value, id) => {
      const parsed = stored.safeParse(value)
      if (parsed.success) out.push({ ...parsed.data, id })
    })
    return (this.cached = out.sort((a, b) => a.name.localeCompare(b.name)))
  }
}
