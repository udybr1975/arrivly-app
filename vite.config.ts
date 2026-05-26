import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Force qrcode to its browser build — its CJS main entry can pull in
    // Node-only deps (fs, pngjs, Buffer) via esbuild, crashing Android Chrome
    // at module-evaluation time before React runs.
    alias: {
      'qrcode': 'qrcode/lib/browser',
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
