/// <reference path="./markdown.d.ts" />
import addEvent from './add-event.md'
import mapData from './map-data.md'
import runCode from './run-code.md'
import satelliteImagery from './satellite-imagery.md'
import showPlace from './show-place.md'

/**
 * A skill: a workflow the agent reads only when a request needs it (plans/plan-017.md, after
 * wri/project-zeno's src/agent/skills). The system prompt lists each skill's name, description and
 * when_to_use; skills__read gives the body and loads the skill's tools for the rest of the turn.
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

/** One skill file: `key: value` lines between `---` lines, then the body. */
export function parseSkill(text: string): Skill {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) throw new Error('A skill file starts with frontmatter between --- lines')
  const meta = new Map<string, string>()
  for (const line of m[1]!.split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) meta.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  const list = (key: string) => (meta.get(key) ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  const name = meta.get('name')
  if (!name) throw new Error('A skill needs a name')
  return { name, description: meta.get('description') ?? '', whenToUse: meta.get('when_to_use') ?? '', requires: list('requires'), optional: list('optional'), body: m[2]!.trim() }
}

/** Every skill. To add one, write its .md file here and import it above. */
export const SKILLS: Skill[] = [addEvent, showPlace, mapData, satelliteImagery, runCode].map(parseSkill)
