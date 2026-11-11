import { defineConfig } from 'vite';

export default defineConfig({
  // Cross-origin isolation isn't required, but matches what a production deployment of a video tool usually sets.
  server: {
    headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' },
    // Only needed because this example links skiamovin from outside its root (file:../../packages/skiamovin).
    fs: { allow: ['../..'] },
  },
  preview: { headers: { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' } },
  // Skiamovin locates its .wasm with `new URL(..., import.meta.url)`, which pre-bundling would break.
  optimizeDeps: { exclude: ['skiamovin'], include: ['mediabunny'] },
  // Only needed because this example links skiamovin from the repo (file:), which carries its own mediabunny.
  resolve: { dedupe: ['mediabunny'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
});
