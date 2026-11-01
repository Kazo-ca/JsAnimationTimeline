// demo/editor/src/hostRendering.ts
import { createEditor } from '@kazo-ca/timeline-editor';
import type { EditorTransactionResult, HostRenderCause, IEditorHostRenderer, IEditorTransactionRequest,
  PropertyTimelineMutationResult } from '@kazo-ca/timeline-editor';
import { composeHtmlDeclarations, createHtmlInspectionStage } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlResolvedBinding, ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import './htmlProperties.less';
import './hostRendering.less';

function node<T extends HTMLElement>(id: string, constructor: { new(...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing demo element: ${id}`);
  return element;
}
const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const initialContext: IHtmlAnimationContext = { version: 1, gradients: { gradient: [{
  id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
  centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
    { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, position: 0, opacity: 1, present: true },
    { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, position: 100, opacity: 1, present: true }
  ]
}] }, bindings: { gradient: { angle: { kind: 'gradient', gradientId: 'fill', component: 'angle' } } } };
const initial: ITimelineDocument = { version: '2.0.0', settings: { fps: 24, totalFrames: 100 }, layers: [
  { id: 'gradient', type: 'layer', name: 'Dégradé', target: { selector: '#gradient-box' }, spans: [], propertyTimelines: {} }
] };
const gradientBox = node('gradient-box', HTMLDivElement);
const sourceStyle = gradientBox.getAttribute('style');
function restoreStyle(value: string | null): void {
  if (value === null) gradientBox.removeAttribute('style'); else gradientBox.setAttribute('style', value);
}
const stage = createHtmlInspectionStage({ root: node('html-scene', HTMLDivElement), animationContext: initialContext,
  preserveSource: <T>(read: () => T): T => {
    const preview = gradientBox.getAttribute('style');
    restoreStyle(sourceStyle);
    try { return read(); } finally { restoreStyle(preview); }
  }
});
let failure: 'prepare' | 'apply' | undefined;
let journal: readonly IRenderEntry[] = [];
const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
  if (failure === 'prepare') throw new Error('Préparation du rendu refusée pour la démonstration.');
  const context = candidate.htmlContexts.find((entry) => entry.stageId === stage.id)?.context;
  const definition = context?.gradients?.gradient?.[0];
  if (context === undefined || definition === undefined) throw new Error('Missing candidate HTML gradient.');
  const values = { angle: number(definition.angle), ...candidate.sample.layer('gradient')?.propertyValues };
  const bindings: Record<string, IHtmlResolvedBinding> = {};
  for (const [property, value] of Object.entries(values)) {
    const binding = context.bindings?.gradient?.[property];
    if (binding === undefined) throw new Error(`Missing candidate binding: ${property}`);
    bindings[property] = { binding, valueKind: value.kind };
  }
  const composition = composeHtmlDeclarations(gradientBox, values, bindings, context.gradients?.gradient);
  if (composition.diagnostics.length) throw new Error(composition.diagnostics[0].reason);
  // Compare CSSOM values so harmless CSS serialization differences remain a no-op.
  const proposedStyle = gradientBox.ownerDocument.createElement('div').style;
  proposedStyle.setProperty('background-image', composition.declarations['background-image']);
  const next = proposedStyle.getPropertyValue('background-image');
  const beforeStyle = gradientBox.getAttribute('style');
  const beforeJournal = journal;
  const destroy = candidate.cause === 'destroy';
  return { changed: destroy ? beforeStyle !== sourceStyle : gradientBox.style.backgroundImage !== next,
    apply() {
      if (destroy) restoreStyle(sourceStyle); else gradientBox.style.setProperty('background-image', next);
      journal = [...beforeJournal, { cause: candidate.cause, frame: candidate.time.frame, gradient: gradientBox.style.backgroundImage }];
      if (failure === 'apply') throw new Error('Erreur simulée après écriture de l’aperçu.');
    },
    rollback() { restoreStyle(beforeStyle); journal = beforeJournal; }
  };
} };
const editor = createEditor(node('editor-host', HTMLDivElement), { data: initial, stage, hostRenderer });
const status = node('status', HTMLParagraphElement);
const frameInput = node('frame-input', HTMLInputElement);
const frameOutput = node('frame-output', HTMLOutputElement);
let frameInputDirty = false;
frameInput.addEventListener('input', () => { frameInputDirty = true; });
const probe = node('reentrant-probe', HTMLInputElement);
const observations: IHostObservation[] = [];
const reentrantResults: PropertyTimelineMutationResult[] = [];
let lastResult: EditorTransactionResult | PropertyTimelineMutationResult | undefined;
let action = 'initial';

function detached<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function captureState(): IHostState {
  return { timeline: editor.document, html: stage.animationContext, frame: editor.playback.frame,
    style: gradientBox.getAttribute('style'), gradient: getComputedStyle(gradientBox).backgroundImage,
    journal, canUndo: editor.canUndo, canRedo: editor.canRedo };
}
function renderReadouts(): void {
  const state = captureState();
  node('angle-output', HTMLOutputElement).value = `${state.gradient.match(/linear-gradient\(([-\d.]+)deg/)?.[1] ?? '?'}°`;
  node('history-output', HTMLParagraphElement).textContent = `Annulation : ${state.canUndo ? 'disponible' : 'aucune'} · Rétablissement : ${state.canRedo ? 'disponible' : 'aucun'}`;
  const last = observations[observations.length - 1];
  node('observation-output', HTMLParagraphElement).textContent = last === undefined ? 'Aucune modification enregistrée.'
    : `${last.event} · ${last.state.gradient}`;
  node('events-json', HTMLPreElement).textContent = JSON.stringify(observations, null, 2);
  node('project-json', HTMLPreElement).textContent = JSON.stringify({ timeline: state.timeline, html: state.html, journal }, null, 2);
}
function request(angle = 35): IEditorTransactionRequest {
  const current = stage.animationContext;
  return { label: 'Orienter le dégradé et ajouter une liaison', htmlContext: { stageId: stage.id, context: {
    ...current, bindings: { ...current.bindings, gradient: { ...current.bindings?.gradient, opacity: { kind: 'style', cssName: 'opacity' } } }
  } }, properties: [{ kind: 'set', layerId: 'gradient', property: 'angle', frame: 1, value: number(angle), initialValue: number(90) }] };
}
function report(result: EditorTransactionResult | PropertyTimelineMutationResult): void {
  lastResult = result;
  status.textContent = result.status === 'changed' ? 'Modification validée : tous les observateurs voient déjà le nouvel aperçu.'
    : result.status === 'noop' ? 'Aucune modification nécessaire.'
      : result.status === 'refused' ? `Modification refusée : ${result.reason}` : `Restauration impossible : ${result.fault.message}`;
  renderReadouts();
}
for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed', 'frame:render'] as const) {
  editor.on(event, () => {
    observations.push(detached({ event, action, state: captureState() }));
    if (event === 'document:changed' && probe.checked) {
      const result = editor.propertyTimelines.set('gradient', 'angle', number(55), { frame: 1, initialValue: number(90) });
      reentrantResults.push(result);
      node('reentrant-output', HTMLOutputElement).value = result.status === 'refused' ? 'Appel réentrant refusé.' : `Résultat : ${result.status}`;
    }
    renderReadouts();
  });
}
editor.on('frame:render', ({ sample }) => {
  if (!frameInputDirty) frameInput.value = String(sample.time.integerFrame);
  frameOutput.value = `Image ${sample.time.integerFrame} / 100`;
  frameOutput.dataset.frame = String(sample.time.integerFrame);
});
node('transaction-edit', HTMLButtonElement).addEventListener('click', () => { action = 'transaction'; report(editor.transactions.execute(request())); });
node('direct-edit', HTMLButtonElement).addEventListener('click', () => {
  action = 'direct'; report(editor.propertyTimelines.set('gradient', 'angle', number(55), { frame: 1, initialValue: number(90) }));
});
node('future-edit', HTMLButtonElement).addEventListener('click', () => {
  action = 'future'; report(editor.propertyTimelines.set('gradient', 'angle', number(120), { frame: 50, initialValue: number(90) }));
});
for (const kind of ['prepare', 'apply'] as const) {
  node(`fail-${kind}`, HTMLButtonElement).addEventListener('click', () => {
    action = `failure:${kind}`; failure = kind;
    try { report(editor.transactions.execute(request(72))); } finally { failure = undefined; }
  });
}
node('seek-form', HTMLFormElement).addEventListener('submit', (event) => {
  event.preventDefault(); const frame = Number(frameInput.value);
  if (Number.isInteger(frame) && frame >= 1 && frame <= 100) {
    frameInputDirty = false; action = 'seek'; editor.playback.pause(); editor.playback.seek(frame);
  }
});
renderReadouts();
window.hostRenderingFixture = Object.freeze({ ready: true, snapshot: () => detached({ ...captureState(), observations, reentrantResults, lastResult }) });
window.addEventListener('pagehide', (event) => { if (!event.persisted && !editor.isDestroyed) editor.destroy(); });

interface IRenderEntry { readonly cause: HostRenderCause; readonly frame: number; readonly gradient: string }
interface IHostState {
  readonly timeline: ITimelineDocument; readonly html: IHtmlAnimationContext; readonly frame: number;
  readonly style: string | null; readonly gradient: string; readonly journal: readonly IRenderEntry[];
  readonly canUndo: boolean; readonly canRedo: boolean;
}
interface IHostObservation { readonly event: string; readonly action: string; readonly state: IHostState }
interface IHostSnapshot extends IHostState {
  readonly observations: readonly IHostObservation[]; readonly reentrantResults: readonly PropertyTimelineMutationResult[];
  readonly lastResult?: EditorTransactionResult | PropertyTimelineMutationResult;
}
/** Read-only diagnostics; browser tests edit through visible controls. */
export interface IHostRenderingFixture { readonly ready: true; snapshot(): IHostSnapshot }
declare global { interface Window { hostRenderingFixture?: IHostRenderingFixture } }
