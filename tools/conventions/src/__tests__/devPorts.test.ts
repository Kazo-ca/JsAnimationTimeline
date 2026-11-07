// tools/conventions/src/__tests__/devPorts.test.ts
/**
 * Tests de tools/devPorts.ts (ports des démos, lus dans l'environnement) :
 * valeurs par défaut inchangées, ports choisis par variable, refus d'une
 * valeur invalide.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DEFAULT_EDITOR_PORT,
  DEFAULT_RUNTIME_PORT,
  DEV_HOST,
  devUrl,
  editorPort,
  portFromEnv,
  runtimePort
} from '../../../devPorts';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const read = (file: string): string => fs.readFileSync(path.join(REPO_ROOT, file), 'utf8');

// « localhost » peut désigner [::1] pour Vite et 127.0.0.1 pour Chromium :
// un serveur qui n'écoute que sur l'un refuse alors des requêtes au hasard.
describe('devPorts loopback host', () => {
  it('binds and addresses the demos on one explicit IPv4 loopback', () => {
    // Assert
    expect(DEV_HOST).toBe('127.0.0.1');
    expect(devUrl(9461)).toBe('http://127.0.0.1:9461');
  });

  it.each(['demo/editor/vite.config.ts', 'demo/runtime/vite.config.ts', 'packages/editor/vite.config.ts'])(
    '%s serves on DEV_HOST', (file) => {
      // Arrange
      const config = read(file);

      // Assert
      expect(config).toMatch(/server: \{[^}]*host: DEV_HOST/);
      if (file.startsWith('demo/')) expect(config).toMatch(/preview: \{[^}]*host: DEV_HOST/);
    }
  );

  it('no e2e file addresses a demo server on localhost', () => {
    // Arrange
    const files = (fs.readdirSync(path.join(REPO_ROOT, 'e2e'), { recursive: true }) as string[])
      .map((file) => path.join('e2e', file).split(path.sep).join('/'))
      .filter((file) => file.endsWith('.ts') && !/\/(node_modules|test-results|playwright-report)\//.test(file));

    // Assert
    expect(files.filter((file) => /https?:\/\/localhost:/.test(read(file)))).toEqual([]);
  });
});

describe('devPorts', () => {
  it('keeps 9002 and 9001 when nothing is set', () => {
    // Assert
    expect([DEFAULT_EDITOR_PORT, DEFAULT_RUNTIME_PORT]).toEqual([9002, 9001]);
    expect([editorPort({}), runtimePort({})]).toEqual([9002, 9001]);
    expect(editorPort({ E2E_V2_EDITOR_PORT: '  ' })).toBe(9002);
  });

  it('reads each worktree pair from E2E_V2_EDITOR_PORT and E2E_RUNTIME_PORT', () => {
    // Arrange
    const env = { E2E_V2_EDITOR_PORT: '9100', E2E_RUNTIME_PORT: '9101' };

    // Assert
    expect([editorPort(env), runtimePort(env)]).toEqual([9100, 9101]);
  });

  it.each(['abc', '0', '65536', '91.5', '-1', '9e3', '0x2328', '9000.0', '+9000'])('refuses %p with a clear message', (value) => {
    // Act + Assert
    expect(() => portFromEnv('E2E_V2_EDITOR_PORT', 9000, { E2E_V2_EDITOR_PORT: value })).toThrow(
      `E2E_V2_EDITOR_PORT doit être un port entier de 1 à 65535 (reçu : « ${value} »).`
    );
  });
});

describe('devPorts validation', () => {
  it('accepts a padded value', () => {
    // Assert
    expect(editorPort({ E2E_V2_EDITOR_PORT: ' 9100 ' })).toBe(9100);
  });

  it('accepts runtime 9000 when the v2 editor uses 9100', () => {
    const env = { E2E_V2_EDITOR_PORT: '9100', E2E_RUNTIME_PORT: '9000' };
    expect([editorPort(env), runtimePort(env)]).toEqual([9100, 9000]);
  });

  it('refuses an invalid runtime port', () => {
    // Act + Assert
    expect(() => runtimePort({ E2E_RUNTIME_PORT: '9e3' })).toThrow(
      'E2E_RUNTIME_PORT doit être un port entier de 1 à 65535 (reçu : « 9e3 »).'
    );
  });

  it.each([
    [{ E2E_V2_EDITOR_PORT: '9100', E2E_RUNTIME_PORT: '9100' }],
    [{ E2E_V2_EDITOR_PORT: '9001' }],
    [{ E2E_RUNTIME_PORT: '9002' }]
  ])('refuses the same port for both demos (%p)', (env) => {
    // Act + Assert
    expect(() => editorPort(env)).toThrow(/doivent être différents/);
    expect(() => runtimePort(env)).toThrow(/doivent être différents/);
  });
});

