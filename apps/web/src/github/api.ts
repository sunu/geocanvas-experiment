import type { GithubRef } from '@ttx/plugins'
import { perPage } from '../cards/perPage'
import { cutAtWord } from '../cards/text'

/**
 * A public GitHub issue or pull request, read straight from api.github.com, which sends CORS headers: no Worker
 * proxy and no token. Requests without a token are limited to 60 an hour per IP address (people in one office
 * share it), so an issue costs 2 requests and a pull request 3, and answers are kept per page; the card's refresh
 * button asks again. Private repositories answer 404.
 */

export type ItemState = 'open' | 'draft' | 'merged' | 'closed' | 'not_planned'

export interface Label {
  name: string
  /** Hex without '#'. */
  color: string
}

/** Checks and commit statuses of a pull request's head, in one answer. */
export type ChecksState = 'passing' | 'failing' | 'pending' | 'none'

/** A pull request that mentions an issue. */
export interface LinkedPull {
  title: string
  url: string
  /** "owner/repo#12": the repository is shown when it is not the issue's own. */
  label: string
  state: ItemState
}

export interface GithubItem {
  kind: 'issue' | 'pull'
  title: string
  state: ItemState
  /** The item's page on GitHub. */
  url: string
  author?: string
  assignees: string[]
  labels: Label[]
  comments: number
  /** ISO dates. */
  createdAt: string
  updatedAt: string
  /** The first lines of the text, without markup. */
  summary?: string
  /** Pull requests only. */
  pull?: { base: string; head: string; changedFiles: number; additions: number; deletions: number; checks?: ChecksState }
  /** Issues only: the pull requests that mention it, newest first. */
  linked: LinkedPull[]
}

/** Pull requests listed under an issue. */
const MAX_LINKED = 5
const SUMMARY_CHARS = 280

const FAILED = new Set(['failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure', 'stale'])

/** One state from a head commit's check runs and its combined commit status. Neutral and skipped runs are not failures. */
export function checksState(runs: { status: string; conclusion: string | null }[], combined?: { state: string; total_count: number }): ChecksState {
  const statuses = combined?.total_count ? combined.state : undefined
  if (runs.some((r) => r.conclusion && FAILED.has(r.conclusion)) || statuses === 'failure' || statuses === 'error') return 'failing'
  if (runs.some((r) => r.status !== 'completed') || statuses === 'pending') return 'pending'
  return runs.length || statuses ? 'passing' : 'none'
}

/** The first words of an issue's text with the markup taken out: comments from templates, images, links, headings, tags. */
export function bodySummary(markdown: string | null | undefined): string | undefined {
  const text = (markdown ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+\[[ xX]\]\s+/gm, '')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text ? cutAtWord(text, SUMMARY_CHARS) : undefined
}

interface Person {
  login: string
}
interface RawItem {
  title: string
  state: string
  state_reason?: string | null
  draft?: boolean
  merged?: boolean
  html_url: string
  user?: Person | null
  assignees?: Person[] | null
  labels?: (string | { name?: string; color?: string })[]
  comments?: number
  created_at: string
  updated_at: string
  body?: string | null
  pull_request?: { merged_at?: string | null }
}

interface RawPull extends RawItem {
  review_comments?: number
  head: { sha: string; ref: string }
  base: { ref: string }
  changed_files?: number
  additions?: number
  deletions?: number
}

const itemState = (r: { state: string; state_reason?: string | null; draft?: boolean; merged?: boolean; pull_request?: { merged_at?: string | null } }): ItemState => {
  if (r.merged || r.pull_request?.merged_at) return 'merged'
  if (r.state === 'open') return r.draft ? 'draft' : 'open'
  return r.state_reason === 'not_planned' ? 'not_planned' : 'closed'
}

/** The pull requests among an issue's timeline events that mention it, each once, newest first (the timeline runs oldest first). */
export function linkedPulls(timeline: unknown[], ref: GithubRef): LinkedPull[] {
  const own = `${ref.owner}/${ref.repo}`.toLowerCase()
  const seen = new Set<string>()
  const found: LinkedPull[] = []
  for (const e of [...timeline].reverse() as { event?: string; source?: { issue?: RawItem & { number: number; repository?: { full_name: string } } } }[]) {
    const i = e.event === 'cross-referenced' ? e.source?.issue : undefined
    if (!i?.pull_request || seen.has(i.html_url)) continue
    seen.add(i.html_url)
    const repo = i.repository?.full_name
    found.push({ title: i.title, url: i.html_url, label: `${repo && repo.toLowerCase() !== own ? repo : ''}#${i.number}`, state: itemState(i) })
  }
  return found.slice(0, MAX_LINKED)
}

export class GithubError extends Error {}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, { headers: { Accept: 'application/vnd.github+json' } })
  if (res.ok) return (await res.json()) as T
  if (res.status === 404) throw new GithubError('Not found. Only public repositories can be shown.')
  if ((res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000
    const at = reset ? ` Try again at ${new Date(reset).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.` : ''
    throw new GithubError(`GitHub's limit for requests without a key is reached.${at}`)
  }
  throw new GithubError(`GitHub answered ${res.status}.`)
}

const repoPath = (ref: GithubRef) => `/repos/${ref.owner}/${ref.repo}`

async function read(ref: GithubRef): Promise<GithubItem> {
  const base = repoPath(ref)
  // GitHub serves a pull request at /issues/<n> too, so a link spelled as an issue may be one.
  const pull = ref.kind === 'pull' ? await get<RawPull>(`${base}/pulls/${ref.number}`) : undefined
  const raw: RawItem = pull ?? (await get<RawItem>(`${base}/issues/${ref.number}`))
  const isPull = ref.kind === 'pull' || !!raw.pull_request
  const item: GithubItem = {
    kind: isPull ? 'pull' : 'issue',
    title: raw.title,
    state: itemState(raw),
    url: raw.html_url,
    author: raw.user?.login,
    assignees: (raw.assignees ?? []).map((a) => a.login),
    labels: (raw.labels ?? []).flatMap((l) => (typeof l === 'string' ? [{ name: l, color: '888888' }] : l.name ? [{ name: l.name, color: l.color ?? '888888' }] : [])),
    comments: raw.comments ?? 0,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    summary: bodySummary(raw.body),
    linked: [],
  }
  if (!isPull) {
    // The links are extra: the card is still worth showing without them.
    item.linked = await get<unknown[]>(`${base}/issues/${ref.number}/timeline?per_page=100`).then((t) => linkedPulls(t, ref), () => [])
    return item
  }
  const pr = pull ?? (await get<RawPull>(`${base}/pulls/${ref.number}`))
  item.state = itemState(pr)
  item.comments = (pr.comments ?? 0) + (pr.review_comments ?? 0)
  const sha: string = pr.head.sha
  const [runs, combined] = await Promise.allSettled([
    get<{ check_runs: { status: string; conclusion: string | null }[] }>(`${base}/commits/${sha}/check-runs?per_page=100`),
    get<{ state: string; total_count: number }>(`${base}/commits/${sha}/status`),
  ])
  item.pull = {
    base: pr.base.ref,
    head: pr.head.ref,
    changedFiles: pr.changed_files ?? 0,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    // Left unknown when both answers failed, so the card shows nothing rather than "no checks".
    checks: runs.status === 'fulfilled' || combined.status === 'fulfilled' ? checksState(runs.status === 'fulfilled' ? runs.value.check_runs : [], combined.status === 'fulfilled' ? combined.value : undefined) : undefined,
  }
  return item
}

/** The item, once per page; `refresh` asks GitHub again. A failure is not kept. */
export const loadGithub = perPage(read, (ref: GithubRef) => `${ref.owner}/${ref.repo}/${ref.kind}/${ref.number}`)
