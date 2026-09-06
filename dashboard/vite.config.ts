import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + tracker to the Go server so a single origin
// serves everything during development (make dev in one terminal, npm run dev here).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8090',
      '/t.js': 'http://localhost:8090',
    },
  },
});
