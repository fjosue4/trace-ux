import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev server proxies API + tracker to the Go server so a single origin
// serves everything during development.
const apiProxyTarget = process.env.TRACE_UX_DEV_API ?? 'http://localhost:8090';
const apiProxy = {
  target: apiProxyTarget,
  changeOrigin: true,
  // The browser talks to Vite on :5173 while Vite forwards to Go on :8090.
  // Remove the browser-only origin headers so Go's same-origin CSRF check sees
  // this as the local development proxy, not as a cross-origin request.
  configure(proxy: { on: (event: string, listener: (proxyReq: { removeHeader: (name: string) => void }) => void) => void }) {
    proxy.on('proxyReq', (proxyReq) => {
      proxyReq.removeHeader('origin');
      proxyReq.removeHeader('referer');
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiProxy,
      '/t.js': apiProxy,
    },
  },
});
