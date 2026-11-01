// tools/packaging/consumers.mjs : Verify packed npm and NuGet packages without contacting registries.
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { projectVersion, validateMetadata } from './metadata.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run via npm run test:packaging -- <npm-directory> <nupkg>');
const npmDirectory = resolve(process.argv[2] ?? 'artifacts/release-preparation');
const packages = Object.fromEntries(['runtime', 'editor', 'export-css'].map(name => [name, JSON.parse(readFileSync(join(root, `packages/${name}/package.json`), 'utf8'))]));
const project = readFileSync(join(root, 'dotnet/JsTimeline.Blazor/JsTimeline.Blazor.csproj'), 'utf8');
validateMetadata(packages, project);
const npmVersion = packages.runtime.version;
const nupkg = resolve(process.argv[3] ?? `artifacts/release-preparation/JsTimeline.Blazor.${projectVersion(project)}.nupkg`);
assert.ok(existsSync(nupkg), `NuGet package missing: ${nupkg}`);
const versionMatch = /^JsTimeline\.Blazor\.((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*))\.nupkg$/.exec(basename(nupkg));
assert.ok(versionMatch, 'Unexpected NuGet package filename');
const nugetVersion = versionMatch[1];
const dependencySource = resolve(process.env.PACKAGING_NUGET_SOURCE ?? join(homedir(), '.nuget', 'packages'));
assert.ok(existsSync(dependencySource), `Offline NuGet dependency source missing: ${dependencySource}`);
const temp = mkdtempSync(join(tmpdir(), 'jstimeline-package-check-'));

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, ...env }, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}):\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}
function write(path, content) { writeFileSync(join(temp, path), content); }
function xml(value) { return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;'); }

try {
  const env = { npm_config_cache: join(temp, 'npm-cache'), npm_config_offline: 'true' };
  const names = ['runtime', 'editor', 'export-css'];
  const archives = names.map(name => join(npmDirectory, `kazo-ca-timeline-${name}-${npmVersion}.tgz`));
  for (const archive of archives) assert.ok(existsSync(archive), `npm archive missing: ${archive}`);
  write('package.json', '{"private":true,"type":"module"}\n');
  run(process.execPath, [npmCli, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', ...archives], temp, env);
  for (const name of names) {
    const folder = join(temp, 'node_modules', '@kazo-ca', `timeline-${name}`);
    const pkg = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    assert.equal(pkg.name, `@kazo-ca/timeline-${name}`);
    assert.equal(pkg.version, npmVersion);
    if (name !== 'runtime') assert.equal(pkg.dependencies['@kazo-ca/timeline-runtime'], npmVersion);
    assert.deepEqual(readFileSync(join(folder, 'LICENSE')), readFileSync(join(root, 'LICENSE')));
    for (const file of [`dist/timeline-${name}.mjs`, `dist/timeline-${name}.umd.js`, 'dist/types/index.d.ts', ...(name === 'editor' ? ['dist/timeline-editor.css'] : [])]) {
      assert.ok(existsSync(join(folder, file)), `${pkg.name}: ${file} missing`);
    }
  }
  write('consumer.mjs', `import { createRequire } from 'node:module';\nimport { createEmptyDocument } from '@kazo-ca/timeline-editor';\nimport { exportCss } from '@kazo-ca/timeline-export-css';\nimport { validateDocument } from '@kazo-ca/timeline-runtime';\nimport assert from 'node:assert/strict';\nfor (const fn of [createEmptyDocument, exportCss, validateDocument]) assert.equal(typeof fn, 'function');\nconst require = createRequire(import.meta.url);\nfor (const name of ['runtime', 'editor', 'export-css']) assert.ok(Object.keys(require('@kazo-ca/timeline-' + name)).length);\nassert.ok(require.resolve('@kazo-ca/timeline-editor/timeline-editor.css'));\n`);
  run(process.execPath, ['consumer.mjs'], temp);
  write('playback-consumer.mjs', [
    "import assert from 'node:assert/strict';",
    "import { createRequire } from 'node:module';",
    "import { createEmptyDocument } from '@kazo-ca/timeline-editor';",
    "import { exportHtmlCss } from '@kazo-ca/timeline-export-css';",
    "import { compilePlayback, parsePlayback, samplePlayback, createPlaybackPlayer, compileHtmlPlayback, parseHtmlPlayback, createHtmlPlaybackPlayer, exportHtmlJavascript } from '@kazo-ca/timeline-runtime';",
    "const require = createRequire(import.meta.url);",
    "assert.equal(typeof exportHtmlCss, 'function');",
    "assert.equal(typeof require('@kazo-ca/timeline-export-css').exportHtmlCss, 'function');",
    "const commonjs = require('@kazo-ca/timeline-runtime');",
    "assert.equal(typeof commonjs.createHtmlInspectionStage, 'function');",
    "for (const name of ['compilePlayback', 'parsePlayback', 'samplePlayback', 'createPlaybackPlayer', 'compileHtmlPlayback', 'parseHtmlPlayback', 'createHtmlPlaybackPlayer', 'exportHtmlJavascript']) assert.equal(typeof commonjs[name], 'function');",
    "for (const fn of [createPlaybackPlayer, compileHtmlPlayback, parseHtmlPlayback, createHtmlPlaybackPlayer, exportHtmlJavascript]) assert.equal(typeof fn, 'function');",
    "const document = { ...createEmptyDocument(), settings: { fps: 24, totalFrames: 20 }, layers: [{ id: 'object', name: 'Object', type: 'layer', spans: [], propertyTimelines: { opacity: { initialValue: { kind: 'number', value: 1 }, keys: [{ frame: 10, value: { kind: 'number', value: 0.5 } }] } } }] };",
    "const source = JSON.stringify(document);",
    "const compiled = compilePlayback(document);",
    "assert.equal(compiled.status, 'exported');",
    "const playback = parsePlayback(JSON.parse(JSON.stringify(compiled.data)));",
    "assert.equal(playback.sampling, 'frames');",
    "assert.equal(samplePlayback(playback, 20).object.values.opacity.value, 0.5);",
    "assert.equal(samplePlayback(playback, 1).object.values.opacity.value, 1);",
    "assert.equal(JSON.stringify(document), source);",
  ].join('\n'));
  run(process.execPath, ['playback-consumer.mjs'], temp);
  write('consumer.ts', `import { createEmptyDocument } from '@kazo-ca/timeline-editor';\nimport { exportCss } from '@kazo-ca/timeline-export-css';\nimport { validateDocument } from '@kazo-ca/timeline-runtime';\nexportCss(createEmptyDocument());\nvalidateDocument(createEmptyDocument());\n`);
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', 'consumer.ts'], temp);
  for (const extension of ['mts', 'cts']) {
    const file = `consumer.${extension}`;
    write(file, readFileSync(join(temp, 'consumer.ts'), 'utf8'));
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2020', file], temp);
  }
  write('playback-consumer.ts', [
    "import { createEmptyDocument } from '@kazo-ca/timeline-editor';",
    "import { exportHtmlCss, type HtmlCssExportResult, type IExportHtmlCssOptions } from '@kazo-ca/timeline-export-css';",
    "const exportContinuous: (options: IExportHtmlCssOptions) => HtmlCssExportResult = options => exportHtmlCss(createEmptyDocument(), options);",
    "void exportContinuous;",
    "import { compilePlayback, parsePlayback, samplePlayback, createPlaybackPlayer, compileHtmlPlayback, parseHtmlPlayback, createHtmlPlaybackPlayer, exportHtmlJavascript } from '@kazo-ca/timeline-runtime';",
    "const result = compilePlayback(createEmptyDocument());",
    "if (result.status === 'exported') samplePlayback(parsePlayback(result.data), 1);",
    "void [createPlaybackPlayer, compileHtmlPlayback, parseHtmlPlayback, createHtmlPlaybackPlayer, exportHtmlJavascript];",
  ].join('\n'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', 'playback-consumer.ts'], temp);
  for (const extension of ['mts', 'cts']) {
    const file = `playback-consumer.${extension}`;
    write(file, readFileSync(join(temp, 'playback-consumer.ts'), 'utf8'));
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2020', file], temp);
  }
  write('transactions-consumer.ts', [
    "import type { IEditor, IEditorTransactions, IEditorTransactionRequest, IHtmlConflictTransactionRequest, EditorTransactionResult, IHostHistoryEffect, PropertyTimelineOperation, TransactionChangedEvent } from '@kazo-ca/timeline-editor';",
    "import { createHtmlInspectionStage, type IHtmlAnimationContext, type IHtmlInspectionStageOptions, type IHtmlStage } from '@kazo-ca/timeline-runtime';",
    "export function inspection(root: ParentNode, context: IHtmlAnimationContext): IHtmlStage {",
    "  const options: IHtmlInspectionStageOptions = { root, animationContext: context, preserveSource: read => read() };",
    "  return createHtmlInspectionStage(options);",
    "}",
    "const property: PropertyTimelineOperation = { kind: 'set', layerId: 'object', property: 'present', frame: 50, initialValue: { kind: 'boolean', value: false }, value: { kind: 'boolean', value: true } };",
    "const effect: IHostHistoryEffect = { prepare: direction => ({ changed: direction !== 'execute', apply() {}, rollback() {} }) };",
    "export function apply(editor: IEditor, context: IHtmlAnimationContext): EditorTransactionResult {",
    "  const transactions: IEditorTransactions = editor.transactions;",
    "  const request: IEditorTransactionRequest = { label: 'Add point', properties: [property], htmlContext: { stageId: 'html', context }, effect, isCurrent: () => true };",
    "  editor.on('transaction:changed', (event: TransactionChangedEvent) => { void [event.phase, event.cause, event.revision]; });",
    "  void transactions.fault;",
    "  return transactions.execute(request);",
    "}",
    "export function resolve(editor: IEditor, confirmation: IHtmlConflictTransactionRequest['confirmation']): EditorTransactionResult {",
    "  const request: IHtmlConflictTransactionRequest = { label: 'Confirm opacity winner and key', stageId: 'html', confirmation, winnerLayerId: 'object', properties: [{ kind: 'set', layerId: 'object', property: 'opacity', frame: 20, value: { kind: 'number', value: 0.5 } }], isCurrent: () => true };",
    "  return editor.transactions.resolveHtmlConflict(request);",
    "}",
  ].join('\n'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', 'transactions-consumer.ts'], temp);
  for (const extension of ['mts', 'cts']) {
    const file = `transactions-consumer.${extension}`;
    write(file, readFileSync(join(temp, 'transactions-consumer.ts'), 'utf8'));
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2020', file], temp);
  }
  write('host-render-consumer.ts', [
    "import { createEditor, type IEditor, type IEditorHostRenderer, type IHostRenderCandidate, type HostRenderCause } from '@kazo-ca/timeline-editor';",
    "import { createHtmlInspectionStage } from '@kazo-ca/timeline-runtime';",
    "const renderer: IEditorHostRenderer = { prepare(candidate: IHostRenderCandidate) {",
    "  const cause: HostRenderCause = candidate.cause;",
    "  void [candidate.document, candidate.htmlContexts, candidate.time, candidate.sample, cause];",
    "  return { changed: false, apply() {}, rollback() {} };",
    "} };",
    "export function attach(container: HTMLElement, root: ParentNode): IEditor {",
    "  return createEditor(container, { stage: createHtmlInspectionStage({ root }), hostRenderer: renderer });",
    "}",
  ].join('\n'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', 'host-render-consumer.ts'], temp);
  for (const extension of ['mts', 'cts']) {
    const file = `host-render-consumer.${extension}`;
    write(file, readFileSync(join(temp, 'host-render-consumer.ts'), 'utf8'));
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2020', file], temp);
  }
  write('spatial-consumer.mjs', [
    "import assert from 'node:assert/strict';",
    "import { createRequire } from 'node:module';",
    "import { composeHtmlSpatial, cloneHtmlAnimationContext, resolveHtmlSpatialBindings } from '@kazo-ca/timeline-runtime';",
    "const require = createRequire(import.meta.url);",
    "assert.equal(typeof require('@kazo-ca/timeline-runtime').composeHtmlSpatial, 'function');",
    "assert.equal(typeof resolveHtmlSpatialBindings, 'function');",
    "const definition = { id: 'geometry', version: 1, composition: 'prepend-trs', sourceTransform: 'translateX(100px)', origin: { x: { value: 50, unit: '%' }, y: { value: 50, unit: '%' }, z: { value: 7, unit: 'px' } }, provenance: { transform: { kind: 'authored', authoredValue: 'translateX(100px)', computedValue: 'matrix(1,0,0,1,100,0)' }, origin: { kind: 'authored', authoredValue: '50% 50% 7px', computedValue: '50px 50px 7px' } } };",
    "const binding = { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' };",
    "const context = cloneHtmlAnimationContext({ version: 1, bindings: { box: { rotation: binding } }, spatial: { box: [definition] } });",
    "const result = composeHtmlSpatial(context.spatial.box[0], [{ binding, value: { kind: 'number', value: 45 } }]);",
    "assert.equal(result.status, 'value');",
    "assert.equal(result.value.transform, 'translate(0px, 0px) rotate(45deg) scale(1, 1) translateX(100px)');",
  ].join('\n'));
  run(process.execPath, ['spatial-consumer.mjs'], temp);
  write('spatial-consumer.ts', [
    "import { composeHtmlDeclarations, composeHtmlSpatial, resolveHtmlSpatialBindings, type IHtmlSpatialDefinition, type HtmlSpatialBinding, type IHtmlAnimationContext } from '@kazo-ca/timeline-runtime';",
    "export function project(element: Element, definition: IHtmlSpatialDefinition, binding: HtmlSpatialBinding, context: IHtmlAnimationContext): void {",
    "  const value = { kind: 'number' as const, value: 45 };",
    "  composeHtmlSpatial(definition, [{ binding, value }]);",
    "  composeHtmlDeclarations(element, { angle: value }, { angle: { binding, valueKind: 'number' } }, [], undefined, [definition]);",
    "  resolveHtmlSpatialBindings(context, [{ layerId: 'box', binding: { binding, valueKind: 'number' } }]);",
    "}",
  ].join('\n'));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'esnext', '--moduleResolution', 'bundler', '--target', 'es2020', 'spatial-consumer.ts'], temp);
  for (const extension of ['mts', 'cts']) {
    const file = `spatial-consumer.${extension}`;
    write(file, readFileSync(join(temp, 'spatial-consumer.ts'), 'utf8'));
    run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2020', file], temp);
  }
  console.log('npm: three archives, license, ESM, CommonJS, CSS, playback, host transactions, host rendering, spatial projection, inspection stage and TypeScript Bundler/NodeNext OK');

  mkdirSync(join(temp, 'nuget-feed'));
  copyFileSync(nupkg, join(temp, 'nuget-feed', basename(nupkg)));
  write('NuGet.Config', `<configuration><packageSources><clear/><add key="local" value="${xml(join(temp, 'nuget-feed'))}"/><add key="dependencies" value="${xml(dependencySource)}"/></packageSources><packageSourceMapping><packageSource key="local"><package pattern="JsTimeline.Blazor"/></packageSource><packageSource key="dependencies"><package pattern="*"/></packageSource></packageSourceMapping></configuration>`);
  write('Consumer.csproj', `<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework><DefaultItemExcludes>$(DefaultItemExcludes);nuget-cache/**;node_modules/**</DefaultItemExcludes></PropertyGroup><ItemGroup><PackageReference Include="JsTimeline.Blazor" Version="${nugetVersion}" /></ItemGroup></Project>`);
  write('Program.cs', 'using JsTimeline.Blazor.Model;\nusing Microsoft.AspNetCore.Builder;\nvar app = WebApplication.CreateBuilder(args).Build();\napp.MapGet("/", () => typeof(TimelineDocument).FullName);\napp.Run();\n');
  run('dotnet', ['restore', 'Consumer.csproj', '--configfile', 'NuGet.Config', '--packages', join(temp, 'nuget-cache'), '--no-cache'], temp);
  run('dotnet', ['build', 'Consumer.csproj', '--no-restore'], temp);
  const manifest = JSON.parse(readFileSync(join(temp, 'obj/Debug/net8.0/staticwebassets.build.json'), 'utf8'));
  for (const path of ['js/timeline-runtime.mjs', 'js/timeline-editor.mjs', 'css/timeline-editor.css', 'Player/TimelinePlayer.razor.js', 'Editor/TimelineEditor.razor.js', 'stage/dotnetStage.js']) {
    assert.ok(manifest.Assets.some(asset => asset.SourceId === 'JsTimeline.Blazor' && asset.RelativePath === path && asset.ContentRoot.startsWith(join(temp, 'nuget-cache'))), `NuGet asset missing: ${path}`);
  }
  console.log('NuGet: local package, C# consumer and static assets OK');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
