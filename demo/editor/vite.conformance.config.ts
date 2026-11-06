// demo/editor/vite.conformance.config.ts
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const BUILT_PACKAGES = ['runtime', 'editor', 'export-css'] as const;

/** Newest modification time (ms) of any file under a directory, 0 when it holds none. */
function newestMtime(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce((newest, entry) => {
    const path = join(directory, entry.name);
    return Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }, 0);
}

/** Names the packages whose dist entry is missing or older than one of their source files. */
function staleDistProblems(): string[] {
  return BUILT_PACKAGES.flatMap((name) => {
    const entry = join(REPOSITORY_ROOT, 'packages', name, 'dist', `timeline-${name}.mjs`);
    if (!existsSync(entry)) return [`packages/${name}: ${entry} est absent`];
    const sources = join(REPOSITORY_ROOT, 'packages', name, 'src');
    return newestMtime(sources) > statSync(entry).mtimeMs ? [`packages/${name}: src plus récent que dist/timeline-${name}.mjs`] : [];
  });
}

/** Fails the build when a package dist is missing or older than its sources: the page must test what was built. */
function rejectStaleDist(): Plugin {
  return {
    name: 'conformance-reject-stale-dist',
    buildStart() {
      const problems = staleDistProblems();
      if (problems.length > 0) {
        throw new Error(`Conformance build: dist absent ou périmé (${problems.join('; ')}). Lancez d'abord \`npm run build\`.`);
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
  plugins: [rejectStaleDist(), rejectPackageSources()],
  build: {
    outDir: 'dist/conformance',
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('conformance.html', import.meta.url)) }
  }
});
