/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function codeVersion() {
  try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { return 'local'; }
}

// The Python server only accepts mutations from its own origin, so the dev proxy rewrites Origin.
const backend = process.env.TARVO_BACKEND || 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react()],
  define: { __CODE_VERSION__: JSON.stringify(codeVersion()) },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: backend,
        changeOrigin: true,
        configure: proxy => proxy.on('proxyReq', request => request.setHeader('origin', backend)),
      },
    },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
