/// <reference types="vitest/config" />
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

/**
 * Generates dist/sw.js after the build with a precache list of every emitted
 * application file. The service worker only ever caches the static app shell;
 * it never sees transferred files, text, or pairing payloads (those never go
 * over HTTP at all).
 */
function serviceWorkerPlugin(): Plugin {
  let outDir = 'dist';
  return {
    name: 'fileshare-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) walk(full);
          else files.push(relative(outDir, full).split(sep).join('/'));
        }
      };
      walk(outDir);
      const precache = files.filter((f) => f !== 'sw.js' && !f.endsWith('.map')).sort();
      const template = readFileSync('src/sw/sw-template.js', 'utf8');
      const hash = createHash('sha256').update(template);
      for (const f of precache) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 12);
      const sw = template
        .replace('__FILESHARE_VERSION__', version)
        .replace('__FILESHARE_PRECACHE__', JSON.stringify(precache.map((f) => './' + f)));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig(({ mode }) => ({
  // Relative base so the static build works from any path (GitHub Pages
  // project sites, Cloudflare Pages, Netlify, a sub-folder, ...).
  base: './',
  // `--mode https` (npm run dev:lan / preview:lan) serves over HTTPS with a
  // self-signed certificate so phones on the same Wi-Fi get a secure context
  // (needed for camera, Web Crypto, OPFS and the service worker).
  plugins: [
    react(),
    tailwindcss(),
    serviceWorkerPlugin(),
    ...(mode === 'https' ? [basicSsl()] : []),
  ],
  resolve: { alias: { '@': '/src' } },
  build: {
    target: ['es2022', 'safari16', 'chrome110'],
    sourcemap: false,
    chunkSizeWarningLimit: 400,
  },
  worker: { format: 'es' },
  server: { host: false },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./tests/unit/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    pool: 'threads',
    maxWorkers: 2,
  },
}));
