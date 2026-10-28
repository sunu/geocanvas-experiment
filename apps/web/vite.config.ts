import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    // The sync Worker (npm run sync), which also proxies Montandon searches, geocoding and Notebook Factory, and stores uploads.
    proxy: {
      '/connect': { target: 'ws://localhost:8787', ws: true },
      '/monty': 'http://localhost:8787',
      '/tools': 'http://localhost:8787',
      '/notebooks': 'http://localhost:8787',
      '/reliefweb': 'http://localhost:8787',
      '/hapi': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
    },
  },
  // deck.gl-geotiff decodes COG tiles in a worker that uses top-level await.
  worker: { format: 'es' },
})
