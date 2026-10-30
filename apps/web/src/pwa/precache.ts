/**
 * What the service worker (sw.js) caches when it installs: the page, the entry chunk and what it loads at once, and the
 * chunks of both layouts (the canvas and the phone's) with what they load at once, and their CSS. Everything else
 * under /assets/ is cached the first time it is fetched. Used by the Vite plugin in vite.config.ts; no browser code.
 */

/** The parts of a Rollup output chunk or asset this reads. */
export interface BundleFile {
  type: 'chunk' | 'asset'
  fileName: string
  isEntry?: boolean
  imports?: string[]
  dynamicImports?: string[]
  viteMetadata?: { importedCss: Set<string> }
}

export function precacheList(bundle: Record<string, BundleFile>): string[] {
  const files = new Set<string>()
  const add = (name: string) => {
    const file = bundle[name]
    if (!file || files.has(name)) return
    files.add(name)
    for (const css of file.viteMetadata?.importedCss ?? []) files.add(css)
    for (const imported of file.imports ?? []) add(imported)
  }
  for (const entry of Object.values(bundle).filter((f) => f.type === 'chunk' && f.isEntry)) {
    add(entry.fileName)
    // The layouts are loaded by the entry (main.tsx) as soon as a board opens.
    for (const layout of entry.dynamicImports ?? []) add(layout)
  }
  return ['/', ...[...files].sort().map((f) => `/${f}`)]
}

/** The build's version, from the names of its files (they carry content hashes): a new build is a new service worker. */
export function buildVersion(bundle: Record<string, BundleFile>): string {
  let h = 0x811c9dc5
  for (const name of Object.keys(bundle).sort()) for (const c of name) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0
  return h.toString(16)
}
