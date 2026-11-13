import { defineConfig } from 'vite';

// Must match the GitHub repo name: the site is served from https://<user>.github.io/pdf-tool/
export default defineConfig({
  base: '/pdf-tool/',
  server: { port: 5813, strictPort: true },
  worker: { format: 'es' },
  // Keep the Emscripten loader out of dep pre-bundling so its
  // `new URL('gs.wasm', import.meta.url)` keeps resolving in dev.
  optimizeDeps: { exclude: ['@okathira/ghostpdl-wasm'] },
});
