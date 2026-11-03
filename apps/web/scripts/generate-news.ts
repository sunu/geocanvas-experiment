/**
 * Writes src/whatsnew/news.json from the commit subjects of the last two weeks, with a model on OpenRouter (the
 * deploy runs it before the build; src/whatsnew/generate.ts has the prompt and the checks). Only the subjects and
 * dates of commits leave the repository. It never fails the build: with no key, no answer or an answer that does not
 * fit, news.json stays as it is.
 *
 *   OPENROUTER_API_KEY=… node apps/web/scripts/generate-news.ts
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildPrompt, mergeNews, parseNews, WINDOW_DAYS, type Commit } from '../src/whatsnew/generate.ts'
import type { NewsEntry } from '../src/whatsnew/entries.ts'

/** Same low-cost model as the board agent (apps/worker/wrangler.jsonc); NEWS_MODEL overrides it. */
const MODEL = process.env.NEWS_MODEL ?? 'openai/gpt-6-luna'
const FILE = new URL('../src/whatsnew/news.json', import.meta.url)
/** Most commit subjects sent, newest first. */
const MAX_COMMITS = 300

async function main() {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) return console.log('What’s new: no OPENROUTER_API_KEY, keeping news.json')
  const to = new Date().toISOString().slice(0, 10)
  const from = new Date(Date.now() - WINDOW_DAYS * 864e5).toISOString().slice(0, 10)
  const log = execFileSync('git', ['log', `--since=${from}`, '--no-merges', '--format=%ad\t%s', '--date=short'], { encoding: 'utf8' })
  const commits: Commit[] = log
    .split('\n')
    .flatMap((line) => {
      const [date, subject] = line.split('\t')
      return date && subject ? [{ date, subject }] : []
    })
    .slice(0, MAX_COMMITS)
  if (!commits.length) return console.log('What’s new: no commits in the window, keeping news.json')

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, 'x-title': 'humanitarian-ttx' },
    body: JSON.stringify({ model: MODEL, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: buildPrompt(commits) }] }),
  })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const answer = ((await res.json()) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content
  if (!answer) throw new Error('OpenRouter gave no message')

  const generated = parseNews(answer, from, to)
  if (!generated.length) throw new Error('the model gave no entries')
  const kept = JSON.parse(readFileSync(FILE, 'utf8')) as NewsEntry[]
  writeFileSync(FILE, JSON.stringify(mergeNews(generated, kept, from), null, 2) + '\n')
  console.log(`What’s new: ${generated.length} entries from ${commits.length} commits`)
}

main().catch((e) => console.warn(`What’s new: not generated (${e instanceof Error ? e.message : e}), keeping news.json`))
