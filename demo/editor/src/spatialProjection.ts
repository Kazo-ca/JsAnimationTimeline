// demo/editor/src/spatialProjection.ts
import { compileHtmlPlayback, createHtmlPlaybackPlayer, createHtmlStage, createManualClock, createPlayer,
  exportHtmlJavascript } from '@kazo-ca/timeline-runtime';
import { exportHtmlCss } from '@kazo-ca/timeline-export-css';
import { createExample, createScene, FPS, FRAMES, readScene } from './spatialProjectionScene';
import type { ISpatialExample, ISpatialSceneSnapshot, SpatialScenario } from './spatialProjectionScene';
import { probeSpatialGroup } from './spatialProjectionGroup';
import type { ISpatialGroupProbe } from './spatialProjectionGroup';
import './spatialProjection.less';

function node<T extends HTMLElement>(id: string, constructor: { new(...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing spatial demo element: ${id}`);
  return element;
}
interface IController { seek(frame: number): void; destroy(): void }
interface IComparison {
  readonly example: ISpatialExample; readonly roots: readonly HTMLElement[];
  readonly preview: IController; readonly json: IController; readonly javascript: IController;
  readonly animations: readonly Animation[]; readonly stylesheet?: HTMLStyleElement;
  readonly css: string; readonly cssRefused: boolean;
}
const status = node('status', HTMLParagraphElement);
const cssStatus = node('css-status', HTMLParagraphElement);
const frameInput = node('frame', HTMLInputElement);
const scenarioInput = node('scenario', HTMLSelectElement);
let comparison: IComparison | undefined;
let frame = 51;
let loading = false;
let restored = false;
let enlarged = false;
let group: ISpatialGroupProbe | undefined;

async function prepareFrame(id: string, example: ISpatialExample): Promise<HTMLElement> {
  const iframe = node(id, HTMLIFrameElement);
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { iframe.removeEventListener('load', ready); iframe.removeEventListener('error', failed); };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error('La scène ne peut pas être chargée.')); };
    iframe.addEventListener('load', ready, { once: true }); iframe.addEventListener('error', failed, { once: true });
    iframe.srcdoc = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"></body></html>';
  });
  const owner = iframe.contentDocument;
  if (owner === null) throw new Error('La scène est inaccessible.');
  const root = createScene(owner, example); owner.body.append(root); return root;
}
async function standalone(source: string, root: HTMLElement): Promise<IController> {
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  try {
    const module: { createPlayer(options: { root: HTMLElement }): IController } = await import(/* @vite-ignore */ url);
    return module.createPlayer({ root });
  } finally { URL.revokeObjectURL(url); }
}
function controls(disabled: boolean): void {
  document.querySelectorAll<HTMLButtonElement>('[data-control]').forEach((button) => { button.disabled = disabled; });
}
function dispose(): void {
  if (comparison === undefined || restored) return;
  comparison.preview.destroy(); comparison.json.destroy(); comparison.javascript.destroy();
  comparison.animations.forEach((animation) => animation.cancel()); comparison.stylesheet?.remove(); restored = true;
}
function snapshot() {
  return { ready: comparison !== undefined && !loading, frame, scenario: scenarioInput.value, restored, enlarged,
    preview: comparison === undefined ? undefined : readScene(comparison.roots[0]),
    cssScene: comparison === undefined || comparison.cssRefused ? undefined : readScene(comparison.roots[1]),
    json: comparison === undefined ? undefined : readScene(comparison.roots[2]),
    javascript: comparison === undefined ? undefined : readScene(comparison.roots[3]),
    css: comparison?.css ?? '', cssRefused: comparison?.cssRefused ?? false,
    editable: comparison?.example.document, context: comparison?.example.context, group };
}
function showState(): void {
  node('snapshot-output', HTMLPreElement).textContent = JSON.stringify(snapshot(), null, 2);
}
function seek(value: number): void {
  if (!Number.isFinite(value) || comparison === undefined || restored) return;
  frame = Math.max(1, Math.min(FRAMES, value));
  comparison.preview.seek(frame); comparison.json.seek(Math.floor(frame)); comparison.javascript.seek(Math.floor(frame));
  comparison.animations.forEach((animation) => { animation.currentTime = (frame - 1) * 1000 / FPS; });
  frameInput.value = String(frame); node('frame-output', HTMLOutputElement).value = `Image ${frame} / ${FRAMES}`;
  showState();
}
async function load(): Promise<void> {
  if (loading) return;
  loading = true; controls(true); node('load-example', HTMLButtonElement).disabled = true;
  status.textContent = 'Préparation des quatre rendus…';
  dispose(); comparison = undefined; restored = false; enlarged = false;
  let preview: IController | undefined; let json: IController | undefined; let javascript: IController | undefined;
  try {
    const example = createExample(scenarioInput.value as SpatialScenario);
    const roots = await Promise.all(['preview-frame', 'css-frame', 'json-frame', 'javascript-frame'].map((id) => prepareFrame(id, example)));
    const stage = createHtmlStage({ root: roots[0], mode: 'frame', animationContext: example.context });
    preview = createPlayer(example.document, { stage, clock: createManualClock() });
    const playback = compileHtmlPlayback(example.document, { root: roots[0], animationContext: example.context, sourceStage: stage });
    if (playback.status !== 'exported') throw new Error(playback.diagnostics.map((issue) => issue.message).join(' '));
    json = createHtmlPlaybackPlayer(JSON.parse(JSON.stringify(playback.data)), { root: roots[2], clock: createManualClock() });
    javascript = await standalone(exportHtmlJavascript(playback.data), roots[3]);
    const css = exportHtmlCss(example.document, { root: roots[0], rootSelector: '#spatial-scene', animationContext: example.context, sourceStage: stage });
    let stylesheet: HTMLStyleElement | undefined;
    if (css.status === 'exported') {
      stylesheet = roots[1].ownerDocument.createElement('style'); stylesheet.textContent = css.css;
      roots[1].ownerDocument.head.append(stylesheet);
    }
    const animations = roots[1].getAnimations({ subtree: true });
    animations.forEach((animation) => { animation.pause(); animation.currentTime = 0; });
    comparison = { example, roots, preview, json, javascript, animations, stylesheet, css: css.css, cssRefused: css.status === 'refused' };
    cssStatus.dataset.refused = String(css.status === 'refused');
    cssStatus.textContent = css.status === 'refused'
      ? `CSS refusé : ${css.diagnostics.map((issue) => issue.message).join(' ')} Utilisez le JSON ou le JavaScript.`
      : 'CSS continu accepté : les matrices, les pivots et les coins peuvent être comparés entre les images.';
    node('css-output', HTMLPreElement).textContent = css.css;
    seek(frame); controls(false); status.textContent = 'Comparaison prête. Les clés sources sont conservées.';
  } catch (error) {
    preview?.destroy(); json?.destroy(); javascript?.destroy();
    status.textContent = `Comparaison impossible : ${error instanceof Error ? error.message : String(error)}`;
  } finally { loading = false; node('load-example', HTMLButtonElement).disabled = false; showState(); }
}
node('load-example', HTMLButtonElement).addEventListener('click', () => { void load(); });
node('seek-form', HTMLFormElement).addEventListener('submit', (event) => { event.preventDefault(); seek(Number(frameInput.value)); });
node('resize-reference', HTMLButtonElement).addEventListener('click', () => {
  if (comparison === undefined || restored) return;
  enlarged = !enlarged;
  for (const root of comparison.roots) {
    const box = root.querySelector<HTMLElement>('#spatial-box');
    if (box !== null) { box.style.width = enlarged ? '240px' : '200px'; box.style.fontSize = enlarged ? '20px' : '16px'; }
  }
  seek(frame);
});
node('restore', HTMLButtonElement).addEventListener('click', () => {
  dispose(); controls(true); status.textContent = 'Les transformations et les pivots sources sont restaurés.'; showState();
});
node('probe-group', HTMLButtonElement).addEventListener('click', () => {
  const owner = node('group-frame', HTMLIFrameElement).contentDocument;
  if (owner === null) throw new Error('Group example is unavailable.');
  group = probeSpatialGroup(owner, node('group-source', HTMLSelectElement).value === 'stylesheet' ? 'stylesheet' : 'inline');
  node('group-status', HTMLParagraphElement).textContent = group.editable ? 'Groupe accepté.' : `Groupe refusé : ${group.reason ?? group.diagnostics.join(' ')}`;
  showState();
});
window.addEventListener('resize', showState);
window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); });
export interface ISpatialProjectionSnapshot {
  readonly ready: boolean; readonly frame: number; readonly scenario: string; readonly restored: boolean; readonly enlarged: boolean;
  readonly preview?: ISpatialSceneSnapshot; readonly cssScene?: ISpatialSceneSnapshot;
  readonly json?: ISpatialSceneSnapshot; readonly javascript?: ISpatialSceneSnapshot;
  readonly css: string; readonly cssRefused: boolean; readonly editable?: ISpatialExample['document']; readonly context?: ISpatialExample['context'];
  readonly group?: ISpatialGroupProbe;
}
export interface ISpatialProjectionFixture { snapshot(): ISpatialProjectionSnapshot }
window.spatialProjectionFixture = Object.freeze({ snapshot });
declare global { interface Window { spatialProjectionFixture?: ISpatialProjectionFixture } }
void load();
