import { Fragment, type ReactNode } from 'react'
import type { RichDoc } from '@ttx/plugins'

interface Mark {
  type?: string
  attrs?: Record<string, unknown>
}
interface Node {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Mark[]
  content?: Node[]
}

/** Links go only to the web and mail: a report's JSON comes from people and agents, so `javascript:` must not reach an href. */
const SAFE_HREF = /^(?:https?:|mailto:)/i

function withMark(children: ReactNode, m: Mark): ReactNode {
  switch (m.type) {
    case 'bold':
      return <strong>{children}</strong>
    case 'italic':
      return <em>{children}</em>
    case 'strike':
      return <s>{children}</s>
    case 'code':
      return <code>{children}</code>
    case 'link': {
      const href = String(m.attrs?.href ?? '')
      return SAFE_HREF.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : children
    }
    default:
      return children
  }
}

const all = (n: Node) => (n.content ?? []).map(draw)

function draw(n: Node, key: number): ReactNode {
  switch (n.type) {
    case 'text':
      return <Fragment key={key}>{(n.marks ?? []).reduce(withMark, n.text ?? '')}</Fragment>
    case 'paragraph':
      return <p key={key}>{all(n)}</p>
    case 'heading': {
      // The report's heading levels 1 to 3, in the same type, as the h2 to h4 of its heading blocks.
      const level = Math.min(Math.max(Number(n.attrs?.level) || 1, 1), 3)
      const H = `h${level + 1}` as 'h2' | 'h3' | 'h4'
      return <H key={key} className={`ttx-report__heading ttx-report__heading--${level}`}>{all(n)}</H>
    }
    case 'bulletList':
      return <ul key={key}>{all(n)}</ul>
    case 'orderedList':
      return <ol key={key} start={Number(n.attrs?.start) || 1}>{all(n)}</ol>
    case 'listItem':
      return <li key={key}>{all(n)}</li>
    case 'blockquote':
      return <blockquote key={key}>{all(n)}</blockquote>
    case 'codeBlock':
      return <pre key={key}><code>{all(n)}</code></pre>
    case 'horizontalRule':
      return <hr key={key} className="ttx-report__divider" />
    case 'hardBreak':
      return <br key={key} />
    default:
      // A node this version does not know (a newer tab's): show what it holds.
      return <Fragment key={key}>{all(n)}</Fragment>
  }
}

/** A report's rich text, drawn from its JSON without the editor (no Tiptap in this file, so the canvas does not load it). */
export function RichText({ doc }: { doc: RichDoc }) {
  return <>{all(doc as Node)}</>
}
