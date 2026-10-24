import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export default defineConfig({
  plugins: [react()],
  server: {
    // 0.0.0.0 so Cursor's browser can reach the dev server. The API stays on localhost.
    host: '0.0.0.0',
    port: 5173,
    // The API listens on 8787 (PORT in .env.example). Keep these in step.
    proxy: {
      '/api': 'http://127.0.0.1:8787',
    },
    fs: {
      allow: [repoRoot],
    },
  },
});
