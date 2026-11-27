import {defineConfig} from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        // Shared by the launcher, editor, and tools loaded on demand.
        manualChunks: { 'effect-ui': ['@effect/ui', '@effect/ui/html', 'effect'] },
      },
    },
  },
});
