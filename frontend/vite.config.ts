import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The FastAPI backend listens on 127.0.0.1:8000. We proxy the three
// server namespaces so the browser always makes same-origin requests
// (no CORS, cookies/authorization behave normally).
const BACKEND = 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/admin': { target: BACKEND, changeOrigin: true },
      '/uploads': { target: BACKEND, changeOrigin: true },
    },
  },
});
