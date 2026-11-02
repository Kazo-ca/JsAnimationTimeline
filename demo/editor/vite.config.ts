// demo/editor/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { editorPort } from '../../tools/devPorts';

const port = editorPort();
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  resolve: { alias: [
    { find: /^@kazo-ca\/timeline-runtime$/, replacement: fileURLToPath(new URL('../../packages/runtime/src/index.ts', import.meta.url)) },
    { find: /^@kazo-ca\/timeline-editor$/, replacement: fileURLToPath(new URL('../../packages/editor/src/index.ts', import.meta.url)) },
    { find: /^@kazo-ca\/timeline-export-css$/, replacement: fileURLToPath(new URL('../../packages/export-css/src/index.ts', import.meta.url)) }
  ] },
  build: { outDir: 'dist', emptyOutDir: true, rollupOptions: { input: {
    main: fileURLToPath(new URL('index.html', import.meta.url)),
    scene: fileURLToPath(new URL('scene.html', import.meta.url)),
    propertyTimelines: fileURLToPath(new URL('property-timelines.html', import.meta.url)),
    propertyEditor: fileURLToPath(new URL('property-editor.html', import.meta.url)),
    htmlProperties: fileURLToPath(new URL('html-properties.html', import.meta.url)),
    atomicTransactions: fileURLToPath(new URL('atomic-transactions.html', import.meta.url)),
    hostRendering: fileURLToPath(new URL('host-rendering.html', import.meta.url)),
    finalCandidateConflicts: fileURLToPath(new URL('final-candidate-conflicts.html', import.meta.url)),
    historyRefusals: fileURLToPath(new URL('history-refusals.html', import.meta.url)),
    playbackExports: fileURLToPath(new URL('playback-exports.html', import.meta.url)),
    cssExports: fileURLToPath(new URL('css-exports.html', import.meta.url))
  } } },
  server: { port, strictPort: true },
  preview: { port, strictPort: true }
});
