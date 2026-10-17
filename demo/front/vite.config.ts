/// <reference types="vitest/config" />
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function buildIdentity() {
  let git = 'local';
  try { git = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch { /* A source archive may have no Git metadata. */ }
  const hash = createHash('sha256');
  const add = (path: string) => { hash.update(path + '\0'); hash.update(readFileSync(path)); };
  const walk = (path: string) => { for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const item = join(path, entry.name); if (entry.isDirectory()) walk(item); else add(item); } };
  walk('src');
  for (const path of ['index.html', 'package.json', 'package-lock.json', 'vite.config.ts']) add(path);
  return { git_sha: git, source_sha256: hash.digest('hex'), built_at: new Date().toISOString() };
}
const identity = buildIdentity();

// The Python server only accepts mutations from its own origin, so the dev proxy rewrites Origin.
const backend = process.env.TARVO_BACKEND || 'http://127.0.0.1:8765';

export default defineConfig({
  plugins: [react(), { name: 'tarvo-build-identity', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build-meta.json', source: JSON.stringify(identity, null, 2) + '\n' }); } }],
  define: { __CODE_VERSION__: JSON.stringify(`${identity.git_sha.slice(0, 7)} · front ${identity.source_sha256.slice(0, 10)}`) },
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
