// demo/editor/src/finalCandidateConflicts.ts
import { createEditor } from '@kazo-ca/timeline-editor';
import type { EditorTransactionResult, IEditorHostRenderer, IHtmlConflictTransactionRequest } from '@kazo-ca/timeline-editor';
import { createHtmlInspectionStage, defaultPropertyRegistry, isLayer, prepareHtmlResolution } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic, IHtmlResolvedLayer, ILayer, IPropertyTimeline,
  ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import './htmlProperties.less';
import './finalCandidateConflicts.less';

function node<T extends HTMLElement>(id: string, constructor: { new(...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing demo element: ${id}`);
  return element;
}
function detached<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const track = (value: number, frame = 1): IPropertyTimeline => ({ initialValue: number(1), keys: [{ frame, value: number(value) }] });
const layer = (id: string, selector: string, opacity: IPropertyTimeline): ILayer => ({
  id, name: selector, type: 'layer', spans: [], target: { selector }, propertyTimelines: { opacity }
});
const prefix = new URLSearchParams(location.search).get('scenario') === 'prefix';
const initial: ITimelineDocument = { version: '2.0.0', settings: { fps: 24, totalFrames: 100 }, layers: prefix ? [
  layer('all', '.button', { initialValue: number(1), keys: [{ frame: 1, value: number(.5) }, { frame: 20, value: number(.4) }] }),
  layer('specific', '#specific', track(.8, 50))
] : [layer('first', '.first', track(.3)), layer('second', '.second', track(.7))] };
const scene = node('html-scene', HTMLDivElement);
const target = node('specific', HTMLDivElement);
const sourceStyle = target.getAttribute('style');
function restoreStyle(value: string | null): void {
  if (value === null) target.removeAttribute('style'); else target.setAttribute('style', value);
}
function preserveSource<T>(read: () => T): T {
  const preview = target.getAttribute('style'); restoreStyle(sourceStyle);
  try { return read(); } finally { restoreStyle(preview); }
}
function layers(timeline: ITimelineDocument): readonly IHtmlResolvedLayer[] {
  return timeline.layers.filter(isLayer).flatMap((entry) => {
    const selector = entry.target !== undefined && 'selector' in entry.target ? entry.target.selector : undefined;
    return selector === undefined ? [] : [{ layerId: entry.id, layer: entry, target: { selector }, elements: Array.from(scene.querySelectorAll(selector)) }];
  });
}
const plan = (timeline: ITimelineDocument, context: IHtmlAnimationContext) =>
  prepareHtmlResolution(timeline, layers(timeline), context, defaultPropertyRegistry);
const stage = createHtmlInspectionStage({ root: scene, animationContext: { version: 1 }, preserveSource });
const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
  const context = candidate.htmlContexts.find((entry) => entry.stageId === stage.id)?.context;
  if (context === undefined) throw new Error('Missing candidate HTML context.');
  const resolved = plan(candidate.document, context).evaluate(candidate.time.frame).find((entry) => entry.element === target);
  const opacity = resolved?.properties.find((entry) => entry.property === 'opacity')?.value;
  const proposed = document.createElement('div');
  if (sourceStyle !== null) proposed.setAttribute('style', sourceStyle);
  if (candidate.cause !== 'destroy' && opacity?.kind === 'number') proposed.style.opacity = String(opacity.value);
  const next = candidate.cause === 'destroy' ? sourceStyle : proposed.getAttribute('style');
  const before = target.getAttribute('style');
  return { changed: before !== next, apply() { restoreStyle(next); }, rollback() { restoreStyle(before); } };
} };
const editor = createEditor(node('editor-host', HTMLDivElement), { data: initial, stage, hostRenderer });
const status = node('status', HTMLParagraphElement);
const choice = node('winner', HTMLSelectElement);
const addKey = node('add-key', HTMLInputElement);
const expired = node('expired', HTMLInputElement);
const observations: IConflictObservation[] = [];
let lastResult: EditorTransactionResult | undefined;
let oldRequest: IHtmlConflictTransactionRequest | undefined;
let lastFrame = 1;

if (prefix) {
  const option = document.createElement('option'); option.value = 'specific'; option.textContent = '#specific · valeur d’origine avant l’image 50';
  choice.replaceChildren(option); choice.disabled = true;
  node('scenario-title', HTMLHeadingElement).textContent = 'Avant la première clé d’un ID';
}
function currentDiagnostic(): IHtmlResolutionDiagnostic | undefined {
  return stage.diagnostics.find((entry) => entry.code === (prefix ? 'before-first-conflict' : 'priority-conflict'));
}
function captureState(): IConflictState {
  return { timeline: editor.document, html: stage.animationContext, style: target.getAttribute('style'),
    opacity: getComputedStyle(target).opacity, canUndo: editor.canUndo, canRedo: editor.canRedo };
}
function renderReadouts(): void {
  const state = captureState();
  node('opacity-output', HTMLOutputElement).value = `${Math.round(Number(state.opacity) * 100)} %`;
  node('frame-output', HTMLOutputElement).value = `Image ${lastFrame} / 100`;
  node('conflict-summary', HTMLParagraphElement).textContent = currentDiagnostic()?.message ?? 'Aucun conflit non résolu.';
  const count = state.html.resolutions?.length ?? 0;
  node('decision-summary', HTMLParagraphElement).textContent = `${count} décision enregistrée. ${prefix && count === 0 && editor.canUndo ? 'La nouvelle clé rend la décision de préfixe inutile.' : ''}`;
  node('announced-key', HTMLParagraphElement).textContent = !addKey.checked ? 'Aucune clé ne sera créée : seule la décision sera enregistrée.'
    : prefix ? 'Clé annoncée : #specific, opacité 100 % à l’image 1. La clé à 50 reste à 80 %.'
      : `Clé annoncée : .${choice.value}, opacité 50 % à l’image 20. La clé à 1 reste inchangée.`;
  node('history-output', HTMLParagraphElement).textContent = `Annulation : ${state.canUndo ? 'disponible' : 'aucune'} · Rétablissement : ${state.canRedo ? 'disponible' : 'aucun'}`;
  node('confirm', HTMLButtonElement).disabled = currentDiagnostic() === undefined;
  node('undo-decision', HTMLButtonElement).disabled = !state.canUndo;
  node('redo-decision', HTMLButtonElement).disabled = !state.canRedo;
  node('retry', HTMLButtonElement).disabled = oldRequest === undefined;
  const last = observations[observations.length - 1];
  node('observation-output', HTMLParagraphElement).textContent = last === undefined ? 'Aucune modification enregistrée.' : `${last.event} · opacité ${Math.round(Number(last.opacity) * 100)} %`;
  node('project-json', HTMLPreElement).textContent = JSON.stringify({ ...state, diagnostics: stage.diagnostics }, null, 2);
  node('events-json', HTMLPreElement).textContent = JSON.stringify(observations, null, 2);
}
function report(result: EditorTransactionResult): void {
  lastResult = result;
  status.textContent = result.status === 'changed' ? 'Choix et clés annoncées enregistrés ensemble.'
    : result.status === 'noop' ? 'Aucune modification nécessaire.'
      : result.status === 'refused' ? `Modification refusée : ${result.reason}` : `Restauration impossible : ${result.fault.message}`;
  renderReadouts();
}
function confirmedRequest(diagnostic: IHtmlResolutionDiagnostic): IHtmlConflictTransactionRequest {
  const membership = layers(editor.document);
  return { label: 'Confirm HTML priority and advertised key', stageId: stage.id,
    confirmation: { id: diagnostic.id, signature: diagnostic.signature }, winnerLayerId: choice.value,
    ...(prefix ? { beforeFirst: 'initial' as const } : {}),
    properties: addKey.checked ? [{ kind: 'set', layerId: choice.value, property: 'opacity', frame: prefix ? 1 : 20, value: number(prefix ? 1 : .5) }] : [],
    isCurrent: () => !expired.checked && preserveSource(() => target.getAttribute('style') === sourceStyle &&
      membership.every((entry) => {
        const selector = 'selector' in entry.target ? entry.target.selector : undefined;
        if (selector === undefined) return false;
        const current = Array.from(scene.querySelectorAll(selector));
        return current.length === entry.elements.length && current.every((element, index) => element === entry.elements[index]);
      }))
  };
}
node('confirm', HTMLButtonElement).addEventListener('click', () => {
  const diagnostic = currentDiagnostic(); if (diagnostic === undefined) return;
  oldRequest = confirmedRequest(diagnostic); report(editor.transactions.resolveHtmlConflict(oldRequest));
});
node('retry', HTMLButtonElement).addEventListener('click', () => {
  if (oldRequest !== undefined) report(editor.transactions.resolveHtmlConflict(oldRequest));
});
node('undo-decision', HTMLButtonElement).addEventListener('click', () => { editor.undo(); renderReadouts(); });
node('redo-decision', HTMLButtonElement).addEventListener('click', () => { editor.redo(); renderReadouts(); });
for (const frame of [1, 20, 50]) {
  node(`frame-${frame}`, HTMLButtonElement).addEventListener('click', () => { editor.playback.pause(); editor.playback.seek(frame); });
}
for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) {
  editor.on(event, () => { observations.push(detached({ event, ...captureState() })); renderReadouts(); });
}
editor.on('frame:render', ({ sample }) => { lastFrame = sample.time.integerFrame; renderReadouts(); });
choice.addEventListener('change', renderReadouts); addKey.addEventListener('change', renderReadouts);
renderReadouts();
window.finalCandidateConflictsFixture = Object.freeze({ ready: true, snapshot: () => detached({ ...captureState(),
  diagnostics: stage.diagnostics, unresolvedDiagnostics: plan(editor.document, { ...stage.animationContext, resolutions: [] }).diagnostics,
  observations, lastResult, frame: lastFrame }) });
window.addEventListener('pagehide', (event) => { if (!event.persisted && !editor.isDestroyed) editor.destroy(); });

interface IConflictState {
  readonly timeline: ITimelineDocument; readonly html: IHtmlAnimationContext; readonly style: string | null;
  readonly opacity: string; readonly canUndo: boolean; readonly canRedo: boolean;
}
interface IConflictObservation extends IConflictState { readonly event: string }
interface IConflictSnapshot extends IConflictState {
  readonly diagnostics: readonly IHtmlResolutionDiagnostic[]; readonly unresolvedDiagnostics: readonly IHtmlResolutionDiagnostic[];
  readonly observations: readonly IConflictObservation[]; readonly lastResult?: EditorTransactionResult; readonly frame: number;
}
/** Read-only browser diagnostics; mutations go through the visible controls. */
export interface IFinalCandidateConflictsFixture { readonly ready: true; snapshot(): IConflictSnapshot }
declare global { interface Window { finalCandidateConflictsFixture?: IFinalCandidateConflictsFixture } }
