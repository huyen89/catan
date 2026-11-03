import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The engine is pure (lint-enforced) and the shared package only declares schemas/constants, so
 * their modules have no import side effects. Telling the bundler so lets it keep code that only
 * lazy routes use (reducer, zod schemas) out of the main chunk instead of hoisting everything the
 * barrel `index.ts` re-exports.
 */
const SIDE_EFFECT_FREE = /[\\/]packages[\\/](engine|shared)[\\/]src[\\/]/;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rolldownOptions: {
      treeshake: {
        moduleSideEffects: (id: string) => !SIDE_EFFECT_FREE.test(id),
      },
    },
  },
});
