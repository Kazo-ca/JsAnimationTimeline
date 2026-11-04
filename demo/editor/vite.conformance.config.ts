// demo/editor/vite.conformance.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

/** A module id inside a workspace package source tree, on either path separator. */
const PACKAGE_SOURCE = /(?:^|[/\\])packages[/\\][^/\\]+[/\\]src[/\\]/;

/**
 * Fails the build when any bundled module comes from `packages/<name>/src/`.
 * The conformance page must exercise the BUILT packages (their `dist` exports),
 * so a silent fallback to the sources is made impossible.
 */
function rejectPackageSources(): Plugin {
  return {
    name: 'conformance-reject-package-sources',
    buildEnd() {
      const offenders = Array.from(this.getModuleIds()).filter((id) => PACKAGE_SOURCE.test(id));
      if (offenders.length > 0) {
        throw new Error(`Conformance build reads package sources instead of dist: ${offenders.slice(0, 5).join(', ')}`);
      }
    }
  };
}

// No resolve alias: `@kazo-ca/*` resolves through the node_modules workspace
// links to each package.json "exports", i.e. dist/*.mjs.
// Run after the main demo build, which empties `dist`; the editor preview
// server then serves /conformance/conformance.html on its usual port.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  base: './',
  plugins: [rejectPackageSources()],
  build: {
    outDir: 'dist/conformance',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('conformance.html', import.meta.url)) }
  }
});
