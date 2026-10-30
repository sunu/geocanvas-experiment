import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'
import { DEFAULT_PORT, TOKEN_FILE } from '../mcp/src/pairing.ts'
import { mdText } from '../../packages/plugins/mdText.ts'
import { buildVersion, precacheList, type BundleFile } from './src/pwa/precache.ts'

/**
 * In dev, hands the app's own pages the MCP companion's saved pairing token (apps/mcp/src/pairing.ts), so a tab pairs
 * with no link (apps/web/src/mcp/bridge.ts). Only same-origin requests get it: the browser sets Sec-Fetch-Site and a
 * page cannot, so another site on localhost cannot read the token.
 */
const mcpPairing: Plugin = {
  name: 'ttx-mcp-pairing',
  configureServer(server) {
    server.middlewares.use('/__ttx-mcp', (req, res) => {
      res.setHeader('cache-control', 'no-store')
      if (req.headers['sec-fetch-site'] !== 'same-origin') return void res.writeHead(403).end()
      let token: string
      try {
        token = readFileSync(TOKEN_FILE, 'utf8').trim()
      } catch {
        // The companion has never run.
        return void res.writeHead(404).end()
      }
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ port: Number(process.env.TTX_MCP_PORT ?? DEFAULT_PORT), token }))
    })
  },
}

/**
 * The service worker (src/pwa/sw.js), written into the build as /sw.js with the build's version and the files to cache
 * when it installs (src/pwa/precache.ts). Not in dev: it is registered in production builds only.
 */
const serviceWorker: Plugin = {
  name: 'ttx-service-worker',
  apply: 'build',
  generateBundle(_options, bundle) {
    const files = bundle as unknown as Record<string, BundleFile>
    const head = `const VERSION = ${JSON.stringify(buildVersion(files))}\nconst PRECACHE = ${JSON.stringify(precacheList(files))}\n`
    this.emitFile({ type: 'asset', fileName: 'sw.js', source: head + readFileSync(new URL('./src/pwa/sw.js', import.meta.url), 'utf8') })
  },
}

export default defineConfig({
  plugins: [react(), tailwindcss(), mcpPairing, mdText, serviceWorker],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // The sync Worker (npm run sync), which also proxies Montandon searches, geocoding and Notebook Factory, and stores uploads.
    proxy: {
      '/connect': { target: 'ws://localhost:8787', ws: true },
      '/agent': 'http://localhost:8787',
      '/monty': 'http://localhost:8787',
      '/tools': 'http://localhost:8787',
      '/notebooks': 'http://localhost:8787',
      '/reliefweb': 'http://localhost:8787',
      '/floodmaps': 'http://localhost:8787',
      '/hapi': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
      '/openeo': 'http://localhost:8787',
    },
  },
  // deck.gl-geotiff decodes COG tiles in a worker that uses top-level await.
  worker: { format: 'es' },
})
