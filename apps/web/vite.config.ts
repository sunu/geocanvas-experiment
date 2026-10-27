import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The sync Worker (npm run sync), which also proxies Montandon searches.
    proxy: { '/connect': { target: 'ws://localhost:8787', ws: true }, '/monty': 'http://localhost:8787' },
  },
})
