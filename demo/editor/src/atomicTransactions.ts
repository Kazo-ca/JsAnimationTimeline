// demo/editor/src/atomicTransactions.ts
import { createEditor, createEditorHtmlStage } from '@kazo-ca/timeline-editor';
import type { EditorTransactionResult, IEditorTransactionRequest, IHostHistoryEffect,
  IPropertyTimelineTransaction, PropertyTimelineOperation, TransactionChangedEvent } from '@kazo-ca/timeline-editor';
import { composeHtmlDeclarations } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlGradientDefinition, ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import './htmlProperties.less';
import './atomicTransactions.less';

function node<T extends HTMLElement>(id: string, constructor: { new(...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing demo element: ${id}`);
  return element;
}
const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const boolean = (value: boolean): TimelinePropertyValue => ({ kind: 'boolean', value });
const middleColor = { kind: 'color', r: 0, g: 1, b: 0, a: 1 } as const;
const definition: IHtmlGradientDefinition = { id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
  centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
    { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, opacity: 1, position: 0, present: true },
    { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, opacity: 1, position: 100, present: true }
  ] };
const initialContext: IHtmlAnimationContext = { version: 1, gradients: { gradient: [definition] }, bindings: { gradient: {} } };
const initial: ITimelineDocument = { version: '2.0.0', settings: { fps: 24, totalFrames: 100 }, layers: [
  { id: 'gradient', type: 'layer', name: 'Dégradé', target: { selector: '#gradient-box' }, spans: [], propertyTimelines: {} }
] };
const gradientBox = node('gradient-box', HTMLDivElement);
gradientBox.style.backgroundImage = composeHtmlDeclarations(gradientBox, { angle: number(90) }, {
  angle: { binding: { kind: 'gradient', gradientId: 'fill', component: 'angle' }, valueKind: 'number' }
}, [definition]).declarations['background-image'];
const host = node('editor-host', HTMLDivElement);
const stage = createEditorHtmlStage(host, { root: node('html-scene', HTMLDivElement), animationContext: initialContext });
const editor = createEditor(host, { data: initial, stage });
const hostNote = document.querySelector('[data-host-note]');
if (!(hostNote instanceof HTMLSpanElement)) throw new Error('Missing host note.');
const note = hostNote;
const status = node('status', HTMLParagraphElement);
const frameInput = node('frame-input', HTMLInputElement);
const frameOutput = node('frame-output', HTMLOutputElement);
const reentrantProbe = node('reentrant-probe', HTMLInputElement);
let gesture: IPropertyTimelineTransaction | undefined;
let journal: readonly IHtmlJournalEntry[] = [];
let pending: readonly IHtmlJournalEntry[] = [];
const observations: IAtomicObservation[] = [];
const hostEvents: IHostEvent[] = [];
const reentrantResults: EditorTransactionResult[] = [];
let lastResult: EditorTransactionResult | undefined;
let intentCount = 0;
let destroyed = false;
let probing = false;

function fullXPath(element: Element): string {
  const segments: string[] = [];
  let current: Element | null = element;
  while (current !== null) {
    const tag = current.localName;
    const siblings: Element[] = Array.from(current.parentElement?.children ?? []).filter((entry) => entry.localName === tag);
    segments.unshift(tag === 'html' || tag === 'body' ? tag : `${tag}[${siblings.indexOf(current) + 1}]`);
    current = current.parentElement;
  }
  return `/${segments.join('/')}`;
}

function captureState(): IAtomicState {
  return { timeline: editor.document, html: stage.animationContext, frame: editor.playback.frame,
    noteId: note.getAttribute('id'), journal, pending, canUndo: editor.canUndo, canRedo: editor.canRedo,
    gradient: getComputedStyle(gradientBox).backgroundImage };
}
function detached<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function observe(event: string): void { observations.push(detached({ event, state: captureState() })); }
function hasMiddle(): boolean { return stage.animationContext.gradients?.gradient?.[0].stops.some((stop) => stop.id === 'middle') ?? false; }
function render(): void {
  const active = gesture?.active ?? false;
  for (const id of ['add-point', 'preview-point', 'invalid-edit', 'failed-effect']) node(id, HTMLButtonElement).disabled = hasMiddle() || active;
  node('commit-preview', HTMLButtonElement).disabled = !active;
  node('cancel-preview', HTMLButtonElement).disabled = !active;
  node('change-context', HTMLButtonElement).disabled = !hasMiddle() || active;
  node('structure-output', HTMLParagraphElement).textContent = `${stage.animationContext.gradients?.gradient?.[0].stops.length ?? 0} points définis · identifiant de la note : ${note.id || 'aucun'}`;
  node('journal-output', HTMLParagraphElement).textContent = journal.length ? `${journal[0].xpath} : id → ${journal[0].newValue}` : 'Aucune modification du document HTML.';
  node('project-json', HTMLPreElement).textContent = JSON.stringify({ timeline: editor.document, html: stage.animationContext, journal }, null, 2);
  node('events-json', HTMLPreElement).textContent = JSON.stringify({ observations, hostEvents }, null, 2);
}

/** The host owns its DOM journal and compensates both it and partially applied attributes. */
function noteEffect(failAfterWrite: boolean): IHostHistoryEffect {
  const originalId = note.getAttribute('id');
  const originalJournal = detached(journal);
  const entry: IHtmlJournalEntry = { xpath: fullXPath(note), attribute: 'id', oldValue: originalId, newValue: 'gradient-point-note' };
  return { prepare(direction) {
    const previousId = note.getAttribute('id');
    const previousJournal = detached(journal);
    const previousPending = detached(pending);
    const nextId = direction === 'undo' ? originalId : entry.newValue;
    const nextJournal = direction === 'undo' ? originalJournal : [...originalJournal, entry];
    const changed = previousId !== nextId || JSON.stringify(previousJournal) !== JSON.stringify(nextJournal);
    const setId = (id: string | null) => { if (id === null) note.removeAttribute('id'); else note.setAttribute('id', id); };
    return { changed,
      apply() {
        setId(nextId); journal = detached(nextJournal);
        pending = [...previousPending, { ...entry, oldValue: previousId, newValue: nextId }];
        if (failAfterWrite && direction === 'execute') throw new Error('Erreur simulée après écriture de la page.');
      },
      rollback() { setId(previousId); journal = previousJournal; pending = previousPending; }
    };
  } };
}

function addRequest(invalid = false, failAfterWrite = false): IEditorTransactionRequest {
  const current = stage.animationContext;
  const gradient = current.gradients?.gradient?.[0];
  if (gradient === undefined) throw new Error('Missing gradient definition.');
  const next: IHtmlAnimationContext = { ...current, gradients: { ...current.gradients, gradient: [{ ...gradient,
    stops: [gradient.stops[0], { id: 'middle', color: middleColor, opacity: .6, position: 50, present: false }, gradient.stops[1]]
  }] }, bindings: { ...current.bindings, gradient: { ...current.bindings?.gradient,
    middlePresent: { kind: 'gradient', gradientId: 'fill', stopId: 'middle', component: 'present' },
    middlePosition: { kind: 'gradient', gradientId: 'fill', stopId: 'middle', component: 'position' },
    middleColor: { kind: 'gradient', gradientId: 'fill', stopId: 'middle', component: 'color' },
    middleOpacity: { kind: 'gradient', gradientId: 'fill', stopId: 'middle', component: 'opacity' }
  } } };
  const properties: readonly PropertyTimelineOperation[] = [
    { kind: 'set', layerId: 'gradient', property: 'middlePresent', frame: 50, initialValue: boolean(false), value: boolean(true) },
    { kind: 'set', layerId: 'gradient', property: 'middlePosition', frame: 50, initialValue: number(50), value: invalid ? { kind: 'text', value: 'impossible' } : number(50) },
    { kind: 'set', layerId: 'gradient', property: 'middleColor', frame: 50, initialValue: middleColor, value: middleColor },
    { kind: 'set', layerId: 'gradient', property: 'middleOpacity', frame: 50, initialValue: number(.6), value: number(.6) }
  ];
  return { label: 'Ajouter le point central', properties, htmlContext: { stageId: stage.id, context: next }, effect: noteEffect(failAfterWrite) };
}
function contextRequest(): IEditorTransactionRequest {
  const current = stage.animationContext;
  const gradient = current.gradients?.gradient?.[0];
  if (gradient === undefined) throw new Error('Missing gradient definition.');
  return { label: 'Orienter le dégradé', htmlContext: { stageId: stage.id, context: { ...current,
    gradients: { ...current.gradients, gradient: [{ ...gradient, angle: 135 }] }
  } } };
}
function showResult(result: EditorTransactionResult): void {
  lastResult = result;
  status.textContent = result.status === 'changed' ? 'Modification validée dans l’historique commun.'
    : result.status === 'noop' ? 'Aucune modification nécessaire.'
      : result.status === 'refused' ? `Modification refusée : ${result.reason}` : `Restauration impossible : ${result.fault.message}`;
  render();
}
function edit(request: IEditorTransactionRequest): void { intentCount++; showResult(editor.transactions.execute(request)); }
function cancelGesture(): void {
  if (gesture?.active) { gesture.cancel(); status.textContent = 'Geste annulé : structure, clés et page restaurées.'; }
  gesture = undefined; render();
}

editor.on('document:changed', () => { observe('document:changed'); render(); });
editor.on('property:changed', () => { observe('property:changed'); render(); });
editor.on('history:changed', () => { observe('history:changed'); render(); });
editor.on('transaction:changed', (event: TransactionChangedEvent) => {
  observe(`transaction:${event.phase}:${event.cause}`);
  if (pending.length) { hostEvents.push({ cause: event.cause, changes: detached(pending) }); pending = []; }
  if (reentrantProbe.checked && event.cause === 'execute' && !probing) {
    probing = true;
    try {
      const result = editor.transactions.execute(contextRequest());
      reentrantResults.push(result);
      node('reentrant-output', HTMLOutputElement).value = result.status === 'refused' ? `Appel réentrant refusé : ${result.reason}` : `Résultat réentrant : ${result.status}`;
    } finally { probing = false; }
  }
  render();
});
editor.on('frame:render', ({ sample }) => {
  frameInput.value = String(sample.time.integerFrame);
  frameOutput.value = `Image ${sample.time.integerFrame} / 100`;
  frameOutput.dataset.frame = String(sample.time.integerFrame);
});
node('seek-form', HTMLFormElement).addEventListener('submit', (event) => {
  event.preventDefault(); const frame = Number(frameInput.value);
  if (Number.isInteger(frame) && frame >= 1 && frame <= 100) { editor.playback.pause(); editor.playback.seek(frame); }
});
node('add-point', HTMLButtonElement).addEventListener('click', () => edit(addRequest()));
node('invalid-edit', HTMLButtonElement).addEventListener('click', () => edit(addRequest(true)));
node('failed-effect', HTMLButtonElement).addEventListener('click', () => edit(addRequest(false, true)));
node('change-context', HTMLButtonElement).addEventListener('click', () => edit(contextRequest()));
node('preview-point', HTMLButtonElement).addEventListener('click', () => {
  gesture = editor.propertyTimelines.beginTransaction('Ajouter le point central');
  edit(addRequest()); render();
});
node('commit-preview', HTMLButtonElement).addEventListener('click', () => {
  if (gesture?.active) { gesture.commit(); status.textContent = 'Geste validé : une seule annulation.'; }
  gesture = undefined; render();
});
node('cancel-preview', HTMLButtonElement).addEventListener('click', cancelGesture);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && gesture?.active) { event.preventDefault(); cancelGesture(); } });
render();
window.atomicTransactionsFixture = Object.freeze({ ready: true,
  snapshot: () => detached({ ...captureState(), observations, hostEvents, reentrantResults, lastResult, intentCount })
});
window.addEventListener('pagehide', (event) => { if (!event.persisted && !destroyed) { editor.destroy(); destroyed = true; } });

interface IHtmlJournalEntry { readonly xpath: string; readonly attribute: 'id'; readonly oldValue: string | null; readonly newValue: string | null }
interface IHostEvent { readonly cause: TransactionChangedEvent['cause']; readonly changes: readonly IHtmlJournalEntry[] }
interface IAtomicState {
  readonly timeline: ITimelineDocument; readonly html: IHtmlAnimationContext; readonly frame: number;
  readonly noteId: string | null; readonly journal: readonly IHtmlJournalEntry[]; readonly pending: readonly IHtmlJournalEntry[];
  readonly canUndo: boolean; readonly canRedo: boolean; readonly gradient: string;
}
interface IAtomicObservation { readonly event: string; readonly state: IAtomicState }
interface IAtomicDemoSnapshot extends IAtomicState {
  readonly observations: readonly IAtomicObservation[]; readonly hostEvents: readonly IHostEvent[];
  readonly reentrantResults: readonly EditorTransactionResult[]; readonly lastResult?: EditorTransactionResult; readonly intentCount: number;
}
/** Read-only observations. Browser tests perform edits through visible controls. */
export interface IAtomicTransactionsFixture { readonly ready: true; snapshot(): IAtomicDemoSnapshot }
declare global { interface Window { atomicTransactionsFixture?: IAtomicTransactionsFixture } }
