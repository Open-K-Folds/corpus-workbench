import {fileURLToPath} from 'node:url';
import {defineConfig, type Plugin} from 'vite';

// Expose the exact chunk URL to the drawer. A browser remembers a failed module
// import for that URL, so an explicit retry needs a fresh URL for the same build.
function projectFilesUrl(): Plugin {
  const id = 'virtual:workbench-project-files-url';
  let dev = false;
  return {
    name: 'workbench-project-files-url',
    configResolved(config) { dev = config.command === 'serve'; },
    resolveId(source) { if (source === id) return '\0' + id; },
    load(source) {
      if (source !== '\0' + id) return;
      if (dev) return 'export default "/src/project-files.ts"';
      const reference = this.emitFile({type: 'chunk', name: 'project-files', preserveSignature: 'strict',
        id: fileURLToPath(new URL('./src/project-files.ts', import.meta.url))});
      return 'export default import.meta.ROLLUP_FILE_URL_' + reference;
    },
  };
}

export default defineConfig({
  plugins: [projectFilesUrl()],
  build: {
    rollupOptions: {
      output: {
        // Shared by the launcher, editor, and tools loaded on demand.
        manualChunks: { 'effect-ui': ['@effect/ui', '@effect/ui/html', 'effect'] },
      },
    },
  },
});
