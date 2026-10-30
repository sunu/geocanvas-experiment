/** A Markdown file, imported as its text (Wrangler's Text rule, mdText in vite.config.ts and vitest.config.ts). */
declare module '*.md' {
  const text: string
  export default text
}
