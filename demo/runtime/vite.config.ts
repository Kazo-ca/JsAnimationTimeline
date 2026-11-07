// demo/runtime/vite.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { DEV_HOST, runtimePort } from '../../tools/devPorts';

/**
 * Démo du runtime : lit le package depuis ses sources (pas de build préalable),
 * construit vers demo/runtime/dist avec des chemins relatifs, servie (dev et
 * preview) sur `E2E_RUNTIME_PORT`, 9001 par défaut : le même port que lit
 * Playwright (voir tools/devPorts.ts).
 */
const RUNTIME_DEMO_PORT = runtimePort();

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  resolve: {
    alias: [
      {
        find: /^@kazo-ca\/timeline-runtime$/,
        replacement: fileURLToPath(new URL('../../packages/runtime/src/index.ts', import.meta.url)),
      },
      {
        find: /^@kazo-ca\/timeline-editor$/,
        replacement: fileURLToPath(new URL('../../packages/editor/src/index.ts', import.meta.url)),
      },
      {
        find: /^@kazo-ca\/timeline-export-css$/,
        replacement: fileURLToPath(new URL('../../packages/export-css/src/index.ts', import.meta.url)),
      },
    ],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      // Existing runtime pages and the preserved phase-validation demonstrations.
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        objectStage: fileURLToPath(new URL('object-stage.html', import.meta.url)),
        validationPhase3: fileURLToPath(new URL('validation-phase3.html', import.meta.url)),
        validationPhase4: fileURLToPath(new URL('validation-phase4.html', import.meta.url)),
        validationPhase5: fileURLToPath(new URL('validation-phase5.html', import.meta.url)),
        validationPhase7: fileURLToPath(new URL('validation-phase7.html', import.meta.url)),
        contextMenuFixture: fileURLToPath(new URL('fixtures/context-menu.html', import.meta.url)),
        easingFixture: fileURLToPath(new URL('fixtures/easing.html', import.meta.url)),
        propertyTimelines: fileURLToPath(new URL('fixtures/property-timelines.html', import.meta.url)),
        propertyApi: fileURLToPath(new URL('fixtures/property-api.html', import.meta.url)),
        propertyKeyframes: fileURLToPath(new URL('fixtures/property-keyframes.html', import.meta.url)),
        propertiesPanel: fileURLToPath(new URL('fixtures/properties-panel.html', import.meta.url)),
      },
    },
  },
  server: { host: DEV_HOST, port: RUNTIME_DEMO_PORT, strictPort: true },
  preview: { host: DEV_HOST, port: RUNTIME_DEMO_PORT, strictPort: true },
});
