import { z } from 'zod'
import { defineOp, definePlugin, type AnyObject } from '@ttx/core'

/**
 * A public GitHub issue or pull request, from a link someone pastes. No React here: the card is registered in
 * apps/web/src/github/ui.tsx. The board stores only the link; each browser reads the item from GitHub's API
 * (apps/web/src/github/api.ts), which allows CORS, so there is no proxy and no token. Public repositories only.
 */

export interface GithubRef {
  owner: string
  repo: string
  kind: 'issue' | 'pull'
  number: number
}

// A link to an item, with anything after it: /files, ?query, #issuecomment-1.
const ITEM = /^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)(?:[/?#].*)?$/i

/** The item a pasted GitHub link points to, or undefined when it is not an issue or a pull request. */
export function parseGithubUrl(text: string): GithubRef | undefined {
  const m = ITEM.exec(text.trim())
  return m ? { owner: m[1]!, repo: m[2]!, kind: m[3]!.toLowerCase() === 'pull' ? 'pull' : 'issue', number: Number(m[4]) } : undefined
}

/** The link as stored: the same for any spelling of it, so a pasted /files or #comment link finds its card. */
export const githubUrl = ({ owner, repo, kind, number }: GithubRef) => `https://github.com/${owner}/${repo}/${kind === 'pull' ? 'pull' : 'issues'}/${number}`

const STORED = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+$/

/** url is absent until a link is set. */
export type GithubBoardObject = AnyObject & { type: 'github'; url?: string }

export const githubPlugin = definePlugin({
  id: 'github',
  title: 'GitHub',
  description: 'Cards for public GitHub issues and pull requests, from a pasted link.',
  optional: true,
  dependsOn: ['core'],
  objectTypes: [
    {
      type: 'github',
      title: 'GitHub issue or pull request',
      description: 'A public GitHub issue or pull request, shown as a card with its state and, for a pull request, its checks.',
      fields: z.object({
        url: z.string().regex(STORED).optional().describe('Link to the item, e.g. https://github.com/owner/repo/issues/12 or .../pull/34'),
      }),
      defaultSize: { w: 380, h: 300 },
      layer: 'top',
      summarize: (o) => {
        const { url } = o as GithubBoardObject
        return url ? `GitHub ${url}` : 'no GitHub link yet'
      },
    },
  ],
  ops: [
    defineOp({
      id: 'github.setUrl',
      title: 'Set GitHub link',
      description: 'Show a public GitHub issue or pull request in the selected GitHub card. Other links on the page (files, comments) are read as the item.',
      target: { kind: 'objects', types: ['github'], max: 1 },
      args: z.object({
        url: z.string().refine((v) => !!parseGithubUrl(v), 'Not a link to a GitHub issue or pull request, e.g. https://github.com/owner/repo/issues/12').describe('Link to a public issue or pull request'),
      }),
      apply: (tx, { url }, target) => target.kind === 'objects' && tx.update({ [target.ids[0]!]: { url: githubUrl(parseGithubUrl(url)!) } }),
    }),
  ],
})
