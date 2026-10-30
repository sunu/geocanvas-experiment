import { useEffect, useState, type FormEvent } from 'react'
import { ArrowClockwiseIcon, ArrowSquareOutIcon, ChatCircleIcon, GithubLogoIcon } from '@phosphor-icons/react'
import { parseGithubUrl, type GithubBoardObject } from '@ttx/plugins'
import type { ObjectViewProps } from '../canvas/registry'
import { ObjectHeader } from '../canvas/ObjectHeader'
import { useReportLoading } from '../canvas/loading'
import { loadGithub, type ChecksState, type GithubItem, type ItemState } from './api'

const STATE_TEXT: Record<ItemState, string> = { open: 'Open', draft: 'Draft', merged: 'Merged', closed: 'Closed', not_planned: 'Not planned' }
const CHECKS_TEXT: Record<Exclude<ChecksState, 'none'>, string> = { passing: 'Checks passing', failing: 'Checks failing', pending: 'Checks running' }

/**
 * A public GitHub issue or pull request. A new card asks for a link: paste it and the card shows the item.
 * The board stores only the link; each browser reads the item from GitHub (api.ts). Double-click to change the link.
 */
export function GithubObject({ runtime, object: o, editing, onDone }: ObjectViewProps<GithubBoardObject>) {
  const ref = o.url ? parseGithubUrl(o.url) : undefined
  const key = o.url ?? ''
  const [state, setState] = useState<{ key: string; item?: GithubItem; error?: unknown }>()
  const [refreshing, setRefreshing] = useState(false)

  const load = (refresh: boolean) => {
    if (!ref) return () => {}
    let current = true
    setRefreshing(refresh)
    loadGithub(ref, { refresh })
      .then(
        (item) => current && setState({ key, item }),
        (error) => current && setState({ key, error }),
      )
      .finally(() => current && setRefreshing(false))
    return () => {
      current = false
    }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(false), [key])

  const shown = state?.key === key ? state : undefined
  useReportLoading(!!ref && shown?.item === undefined && shown?.error === undefined)
  return (
    <div className="ttx-github">
      <ObjectHeader icon={<GithubLogoIcon size={14} aria-hidden />} title={ref ? `${ref.owner}/${ref.repo}#${ref.number}` : 'GitHub'}>
        {ref && (
          <>
            <button type="button" title="Check for changes" aria-label="Refresh" disabled={refreshing} onClick={() => load(true)} {...control}>
              <ArrowClockwiseIcon size={14} />
            </button>
            <a href={o.url} target="_blank" rel="noopener noreferrer" title="Open on GitHub" aria-label="Open on GitHub" {...control}>
              <ArrowSquareOutIcon size={14} />
            </a>
          </>
        )}
      </ObjectHeader>
      <div className="ttx-github__body">
        {editing ? (
          <LinkField onSubmit={(url) => runtime.invoke('github.setUrl', { kind: 'objects', ids: [o.id] }, { url }).then((r) => (r.status === 'applied' ? (onDone(), undefined) : r.error))} />
        ) : !ref ? (
          <div className="ttx-github__note">Double-click to paste a link to a GitHub issue or pull request.</div>
        ) : shown?.error !== undefined ? (
          <div className="ttx-github__note">Could not load it: {shown.error instanceof Error ? shown.error.message : String(shown.error)}</div>
        ) : !shown?.item ? (
          <div className="ttx-github__note">Loading…</div>
        ) : (
          <Item item={shown.item} />
        )}
      </div>
    </div>
  )
}

/**
 * For the card's buttons and links: a press on one is for it, not a select or drag of the card.
 */
const control = {
  onPointerDown: (e: { stopPropagation(): void }) => e.stopPropagation(),
  onDoubleClick: (e: { stopPropagation(): void }) => e.stopPropagation(),
}

/** Takes a link; pasting one is enough. Resolves to the reason when the card could not take it. */
function LinkField({ onSubmit }: { onSubmit(url: string): Promise<string | undefined> }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string>()
  const submit = async (url: string) => {
    // Checked here for a short message; the op checks again.
    setError(parseGithubUrl(url) ? await onSubmit(url) : 'Not a link to a GitHub issue or pull request, e.g. https://github.com/owner/repo/issues/12')
  }
  return (
    <form
      className="ttx-github__form"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        void submit(text)
      }}
    >
      <input
        autoFocus
        aria-label="GitHub link"
        placeholder="Paste a GitHub issue or pull request link"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onPaste={(e) => {
          const pasted = e.clipboardData.getData('text')
          if (!parseGithubUrl(pasted)) return
          e.preventDefault()
          setText(pasted)
          void submit(pasted)
        }}
      />
      {error && <div className="ttx-github__error">{error}</div>}
      <div className="ttx-github__note">Public repositories only.</div>
    </form>
  )
}

const day = (iso: string) => iso.slice(0, 10)

function Item({ item }: { item: GithubItem }) {
  const checks = item.pull?.checks
  return (
    <>
      <a className="ttx-github__title" href={item.url} target="_blank" rel="noopener noreferrer" {...control}>
        {item.title}
      </a>
      <div className="ttx-github__meta">
        <span className={`ttx-github__state is-${item.state}`}>{STATE_TEXT[item.state]}</span>
        <span>
          {item.kind === 'pull' ? 'Pull request' : 'Issue'}
          {item.author && ` by ${item.author}`} · opened {day(item.createdAt)} · updated {day(item.updatedAt)}
        </span>
        {item.comments > 0 && (
          <span className="ttx-github__count" title="Comments">
            <ChatCircleIcon size={12} aria-hidden /> {item.comments}
          </span>
        )}
      </div>
      {item.labels.length > 0 && (
        <div className="ttx-github__labels">
          {item.labels.map((l) => (
            <span key={l.name} className="ttx-github__label">
              <i style={{ background: `#${l.color}` }} aria-hidden />
              {l.name}
            </span>
          ))}
        </div>
      )}
      {item.assignees.length > 0 && <div className="ttx-github__meta">Assigned to {item.assignees.join(', ')}</div>}
      {item.summary && <div className="ttx-github__summary">{item.summary}</div>}
      {item.pull && (
        <div className="ttx-github__pull">
          <div>
            {item.pull.head} → {item.pull.base} · {item.pull.changedFiles} file{item.pull.changedFiles === 1 ? '' : 's'}, +{item.pull.additions} −{item.pull.deletions}
          </div>
          {checks && checks !== 'none' && <div className={`ttx-github__checks is-${checks}`}>{CHECKS_TEXT[checks]}</div>}
        </div>
      )}
      {item.linked.length > 0 && (
        <div className="ttx-github__linked">
          <div className="ttx-github__meta">Pull requests that mention it</div>
          {item.linked.map((p) => (
            <a key={p.url} href={p.url} target="_blank" rel="noopener noreferrer" {...control}>
              <span className={`ttx-github__state is-${p.state}`}>{STATE_TEXT[p.state]}</span>
              <span className="ttx-github__linkedtitle">
                {p.title} <em>{p.label}</em>
              </span>
            </a>
          ))}
        </div>
      )}
    </>
  )
}
