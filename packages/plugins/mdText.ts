import type { Plugin } from 'vite'

/** Imports a .md file as its text, as Wrangler's Text rule does in the Worker (the agent's skills, src/skills/). */
export const mdText: Plugin = {
  name: 'ttx-md-text',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('.md')) return { code: `export default ${JSON.stringify(code)}`, map: null }
  },
}
