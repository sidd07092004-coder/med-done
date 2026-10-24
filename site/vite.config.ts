import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Public-facing site dev server. Runs on 5174 and proxies API calls to the
// FastAPI backend on 127.0.0.1:8000 so the app can use same-origin `/api` URLs.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
