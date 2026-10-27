import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // tldraw sync server (npm run sync).
    proxy: { '/connect': { target: 'ws://localhost:5858', ws: true } },
  },
})
