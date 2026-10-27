import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  // react-map-gl sits in the root node_modules. maplibre-gl@5 sits in this app.
  // deck.gl 9.4 interleaved mode does not work with maplibre-gl 6 yet.
  resolve: { dedupe: ['maplibre-gl', 'react', 'react-dom'] },
})
