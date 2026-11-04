// tools/conformance/node-conformance.mjs : TL-C04, TL-C05, TL-C15 and TL-C16 against the packed npm archives, in plain Node with no DOM.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run via npm run test:conformance:node -- <npm-archive-directory>');
assert.ok(process.argv[2], 'Usage: npm run test:conformance:node -- <npm-archive-directory>');
const npmDirectory = resolve(process.argv[2]);
const names = ['runtime', 'editor', 'export-css'];
const version = JSON.parse(readFileSync(join(root, 'packages/runtime/package.json'), 'utf8')).version;
const archives = names.map((name) => join(npmDirectory, `kazo-ca-timeline-${name}-${version}.tgz`));
for (const archive of archives) assert.ok(existsSync(archive), `npm archive missing: ${archive}`);

/** Runs inside the temp project against the installed archives; one PASS line per case, in order. */
const consumer = String.raw`
import assert from 'node:assert/strict';
import { compilePlayback, evaluateLayer, parsePlayback, samplePlayback, validateDocument } from '@kazo-ca/timeline-runtime';
import * as editorPackage from '@kazo-ca/timeline-editor';
import * as exportCssPackage from '@kazo-ca/timeline-export-css';

assert.equal(typeof document, 'undefined', 'the cases must run with no DOM');
assert.equal(typeof window, 'undefined', 'the cases must run with no DOM');

// The three archives are installed and imported: one public export of each editor and export-css must exist.
assert.equal(typeof editorPackage.createEditor, 'function', 'timeline-editor must export createEditor');
assert.equal(typeof exportCssPackage.exportHtmlCss, 'function', 'timeline-export-css must export exportHtmlCss');
console.log('PASS packages: timeline-editor createEditor and timeline-export-css exportHtmlCss are exported, with no DOM');

const num = (value) => ({ kind: 'number', value });
const key = (frame, value) => ({ frame, value: num(value) });
const documentOf = (propertyTimelines, totalFrames = 100) => ({
  version: '2.0.0', settings: { fps: 24, totalFrames },
  layers: [{ id: 'logo', type: 'layer', name: 'Objet', target: { ref: 'logo' }, spans: [], propertyTimelines }]
});
const sample = (doc, property, frame) => {
  const value = evaluateLayer(doc.layers[0], frame).propertyValues?.[property];
  assert.equal(value?.kind, 'number', property + ' at ' + frame);
  return value.value;
};
const values = (doc, property, frames) => frames.map((frame) => sample(doc, property, frame));

// TL-C04: without a tween the value holds until the next key, then after the last one.
const hold = documentOf({ x: { initialValue: num(0), keys: [key(1, 10), key(30, 50), key(60, 90)] } });
assert.deepEqual(values(hold, 'x', [1, 15, 29, 29.875, 30, 45, 59.875, 60, 80, 100]), [10, 10, 10, 10, 50, 50, 50, 90, 90, 90]);
console.log('PASS TL-C04 generic evaluation: the value persists to the next key, then after the last one');

// TL-C05: origin 100 %, first key at 50 = 80 %: 100 % before 50, and no key at frame 1.
const origin = documentOf({ opacity: { initialValue: num(1), keys: [key(50, 0.8)] } });
assert.deepEqual(values(origin, 'opacity', [1, 25, 49, 49.875]), [1, 1, 1, 1]);
assert.deepEqual(values(origin, 'opacity', [50, 75, 100]), [0.8, 0.8, 0.8]);
assert.deepEqual(origin.layers[0].propertyTimelines.opacity.keys.map(({ frame }) => frame), [50]);
console.log('PASS TL-C05 generic evaluation: 100 % before the first key at 50, 80 % from 50, no key added at 1');

// TL-C15: the generic playback JSON, with no DOM, carries no CSS, DOM or XPath notion and reproduces the evaluation.
const tween = documentOf({
  opacity: { initialValue: num(1), keys: [key(1, 0.2), key(100, 1)], transitions: [{ id: 'fade', fromFrame: 1, toFrame: 100, easing: { kind: 'effect', family: 'sine', mode: 'in' } }] },
  x: { initialValue: num(0), keys: [key(10, 5), key(60, 30)] }
});
const before = JSON.stringify(tween);
const compiled = compilePlayback(tween);
assert.equal(compiled.status, 'exported');
const json = JSON.parse(JSON.stringify(compiled.data));
const names = (value) => Array.isArray(value) ? value.flatMap(names)
  : value !== null && typeof value === 'object' ? Object.entries(value).flatMap(([name, inner]) => [name, ...names(inner)]) : [];
assert.deepEqual(names(json).filter((name) => /css|dom|xpath|selector|style|html|element|class/i.test(name)), []);
assert.doesNotMatch(JSON.stringify(json), /xpath|selector|css|<[a-z]/i);
const playback = parsePlayback(json);
assert.equal(playback.sampling, 'frames');
for (let frame = 1; frame <= 100; frame++) {
  const state = samplePlayback(playback, frame).logo;
  assert.ok(state, 'object logo at ' + frame);
  for (const property of ['opacity', 'x']) assert.equal(state.values[property].value, sample(tween, property, frame), property + ' at frame ' + frame);
}
assert.equal(JSON.stringify(tween), before, 'compiling must not touch the editable document');
console.log('PASS TL-C15 generic playback JSON: compilePlayback, parsePlayback and samplePlayback with typeof document === undefined, no CSS, DOM or XPath field');

// TL-C16: the compiled playback document is not an editable document.
assert.deepEqual(validateDocument(tween), []);
const issues = validateDocument(json);
assert.ok(issues.length > 0, 'validateDocument must reject a compiled playback document');
console.log('PASS TL-C16 validateDocument: the compiled playback document is refused (' + issues.length + ' issue(s)), the editable document is accepted');
`;

const temp = mkdtempSync(join(tmpdir(), 'jstimeline-node-conformance-'));
function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

try {
  for (const archive of archives) {
    console.log(`SHA-256 ${createHash('sha256').update(readFileSync(archive)).digest('hex')}  ${archive.slice(npmDirectory.length + 1)}`);
  }
  writeFileSync(join(temp, 'package.json'), '{"private":true,"type":"module"}\n');
  const env = { npm_config_cache: join(temp, 'npm-cache'), npm_config_offline: 'true' };
  run(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...archives], temp, env);
  writeFileSync(join(temp, 'conformance.mjs'), consumer);
  process.stdout.write(run(process.execPath, ['conformance.mjs'], temp));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
