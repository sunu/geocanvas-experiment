/**
 * Which build this is (issue #125). Every push deploys, so the commit is the version: there are no release numbers and
 * no channels. vite.config.ts injects it as `__TTX_BUILD__` for a build that has a commit (CI); the dev server and a
 * local build have none, and nothing is shown for them.
 */
export interface Build {
  /** The short commit. */
  sha: string
  /** When it was built, ISO UTC. */
  time?: string
  /** The branch, for a branch Worker; not for main. */
  branch?: string
}

declare const __TTX_BUILD__: Build | null | undefined

/** The running build, if it has a commit. Tests and tools that do not go through Vite have no define. */
export const BUILD: Build | undefined = (typeof __TTX_BUILD__ === 'undefined' ? null : __TTX_BUILD__) ?? undefined

/** The build a CI run makes (GITHUB_SHA and GITHUB_REF_NAME are set by GitHub Actions); none without a commit. */
export function buildFromEnv(env: Record<string, string | undefined>, now: Date): Build | undefined {
  const sha = env.GITHUB_SHA?.slice(0, 7)
  if (!sha) return undefined
  const branch = env.GITHUB_REF_NAME
  return {
    sha,
    time: now.toISOString(),
    ...(branch && branch !== 'main' ? { branch } : {}),
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** `2 Nov 2026 14:05 UTC`, whatever the reader's locale and time zone. */
export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

/** `abc1234 · feat/maps · 2 Nov 2026 14:05 UTC`: what a bug report names, and what Copy puts on the clipboard. */
export function formatBuild(build: Build): string {
  return [build.sha, build.branch, build.time && formatTime(build.time)].filter(Boolean).join(' · ')
}
