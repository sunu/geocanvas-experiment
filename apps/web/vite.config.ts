import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The sync Worker (npm run sync), which also proxies Montandon searches, geocoding and Notebook Factory.
    proxy: {
      '/connect': { target: 'ws://localhost:8787', ws: true },
      '/monty': 'http://localhost:8787',
      '/tools': 'http://localhost:8787',
      '/notebooks': 'http://localhost:8787',
      '/reliefweb': 'http://localhost:8787',
      '/hapi': 'http://localhost:8787',
    },
  },
  // deck.gl-geotiff decodes COG tiles in a worker that uses top-level await.
  worker: { format: 'es' },
})
