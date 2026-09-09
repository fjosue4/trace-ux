import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + tracker to the Go server so a single origin
// serves everything during development.
const apiProxyTarget = process.env.TRACE_UX_DEV_API ?? 'http://localhost:8090';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiProxyTarget,
      '/t.js': apiProxyTarget,
    },
  },
});
