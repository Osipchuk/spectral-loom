import { defineConfig } from 'vitest/config';

// base './' keeps every asset path relative, so the built folder can be dropped
// anywhere (e.g. the blog's public/demos/spectral-loom/) and loaded via iframe.
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
