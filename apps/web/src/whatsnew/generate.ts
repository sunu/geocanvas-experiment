import { z } from 'zod'
import type { NewsEntry } from './entries'

/**
 * What's new, written by a model from the commit subjects of the last two weeks (scripts/generate-news.ts runs it in
 * the deploy). The model's answer is data, not code: it is checked here, and anything that does not fit is refused,
 * so a bad answer leaves the committed news.json as it was.
 */

/** Days of commits that are turned into entries again on each deploy; older entries stay as they are. */
export const WINDOW_DAYS = 14
export const MAX_LINES = 5
export const MAX_ENTRIES = 30

export interface Commit {
  /** `YYYY-MM-DD`. */
  date: string
  subject: string
}

export function buildPrompt(commits: Commit[]): string {
  return `You write the "What's new" list of a web app for humanitarian planners who use it. Below are its commit subjects, one per line as "date subject".

Write entries that tell those people what they can now do or what now works better. Rules:
- One entry per date that has something they would notice. Skip a date with nothing: documentation, CI, tests, refactors, internal changes.
- Merge related commits into one line. At most ${MAX_LINES} lines per entry, each under 12 words, plain language, no jargon, no commit prefixes, no names of files or code.
- Put each line under "new" (a new thing), "improved" (an existing thing is better) or "fixed" (a bug is gone). Leave out an empty list.
- Use only what the subjects say. Do not invent features.

Answer with JSON only: {"entries":[{"date":"YYYY-MM-DD","new":["…"],"improved":["…"],"fixed":["…"]}]}

Commits:
${commits.map((c) => `${c.date} ${c.subject}`).join('\n')}`
}

const lines = z.array(z.string().trim().min(1).max(140)).max(MAX_LINES).optional()
const entries = z.object({
  entries: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), new: lines, improved: lines, fixed: lines })),
})

/** The model's answer as entries: only dates in the window, one per date, newest first, nothing empty. Throws when it is not the format. */
export function parseNews(text: string, from: string, to: string): NewsEntry[] {
  // Models sometimes wrap JSON in a code fence.
  const json = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')
  const parsed = entries.parse(JSON.parse(json))
  const byDate = new Map<string, NewsEntry>()
  for (const e of parsed.entries) {
    if (e.date < from || e.date > to || byDate.has(e.date)) continue
    const entry: NewsEntry = { date: e.date }
    for (const key of ['new', 'improved', 'fixed'] as const) if (e[key]?.length) entry[key] = e[key]
    if (entry.new || entry.improved || entry.fixed) byDate.set(e.date, entry)
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1))
}

/** The new entries for the window, then the kept ones from before it. */
export function mergeNews(generated: NewsEntry[], kept: NewsEntry[], from: string): NewsEntry[] {
  return [...generated, ...kept.filter((e) => e.date < from)].slice(0, MAX_ENTRIES)
}
