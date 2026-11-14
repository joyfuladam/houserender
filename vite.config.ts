import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base and stable file names so the same build can be served from any
// path, including as a Claude artifact with its supporting files alongside.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { host: true },
  build: {
    rolldownOptions: {
      output: {
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
