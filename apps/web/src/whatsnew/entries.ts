import news from './news.json'

/**
 * What's new: what people on a board can see changed, newest first. Every push deploys, so there are no release
 * numbers: an entry is a date, and a person has seen it up to the newest date they opened the dialog on (seen.ts).
 * The entries are in news.json, which the deploy writes from the last two weeks of commits with a model
 * (scripts/generate-news.ts, generate.ts); the committed file is what a local build and a failed generation fall back to.
 */
export interface NewsEntry {
  /** `YYYY-MM-DD`. */
  date: string
  new?: string[]
  improved?: string[]
  fixed?: string[]
}

export const SECTIONS = [
  ['new', 'New'],
  ['improved', 'Improved'],
  ['fixed', 'Fixed'],
] as const

export const NEWS: NewsEntry[] = news
