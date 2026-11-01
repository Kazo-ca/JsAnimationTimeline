// demo/editor/src/historyRefusals.ts
import { CommandRefusedError, createEditor } from '@kazo-ca/timeline-editor';
import type { HostRenderCause, ICommand, IEditorHostRenderer, ITransactionFault } from '@kazo-ca/timeline-editor';
import type { ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import './htmlProperties.less';
import './historyRefusals.less';

function node<T extends HTMLElement>(id: string, constructor: { new(...args: never[]): T }): T {
  const element = document.getElementById(id);
  if (!(element instanceof constructor)) throw new Error(`Missing demo element: ${id}`);
  return element;
}
function detached<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const initial: ITimelineDocument = { version: '2.0.0', settings: { fps: 24, totalFrames: 60 }, layers: [{
  id: 'box', name: 'Objet de démonstration', type: 'layer', spans: [], propertyTimelines: {
    opacity: { initialValue: number(.25), keys: [{ frame: 1, value: number(.25) }] }
  }
}] };
const preview = node('preview-box', HTMLDivElement);
const sourceStyle = preview.getAttribute('style');
const status = node('status', HTMLParagraphElement);
const denyUndo = node('deny-undo', HTMLInputElement);
const denyRedo = node('deny-redo', HTMLInputElement);
let journal: readonly IRenderEntry[] = [];
function restoreStyle(value: string | null): void {
  if (value === null) preview.removeAttribute('style'); else preview.setAttribute('style', value);
}
const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
  const opacity = candidate.sample.layer('box')?.propertyValues?.opacity;
  const proposal = document.createElement('div');
  if (sourceStyle !== null) proposal.setAttribute('style', sourceStyle);
  if (candidate.cause !== 'destroy' && opacity?.kind === 'number') proposal.style.opacity = String(opacity.value);
  const next = candidate.cause === 'destroy' ? sourceStyle : proposal.getAttribute('style');
  const beforeStyle = preview.getAttribute('style');
  const beforeJournal = journal;
  return { changed: beforeStyle !== next,
    apply() { restoreStyle(next); journal = [...beforeJournal, { cause: candidate.cause, style: next }]; },
    rollback() { restoreStyle(beforeStyle); journal = beforeJournal; }
  };
} };
const editor = createEditor(node('editor-host', HTMLDivElement), { data: initial, stage: false, defaultPlugins: false, hostRenderer });
const commandLabel = 'Modifier l’opacité';
function withOpacity(timeline: ITimelineDocument, value: number): ITimelineDocument {
  return { ...timeline, layers: timeline.layers.map((layer) => layer.id === 'box' && layer.type === 'layer' ? {
    ...layer, propertyTimelines: { ...layer.propertyTimelines, opacity: { initialValue: number(.25), keys: [{ frame: 1, value: number(value) }] } }
  } : layer) };
}
const command: ICommand = { label: commandLabel,
  do: (timeline) => {
    if (denyRedo.checked) throw new CommandRefusedError(commandLabel, 'Permission redo refusée');
    return withOpacity(timeline, .75);
  },
  undo: (timeline) => {
    if (denyUndo.checked) throw new CommandRefusedError(commandLabel, 'Permission undo refusée');
    return withOpacity(timeline, .25);
  }
};
const refusals: IRefusalObservation[] = [];
const successEvents: string[] = [];
let accepted: boolean | undefined;
function captureState(): IHistoryState {
  return { timeline: editor.document, style: preview.getAttribute('style'), opacity: getComputedStyle(preview).opacity,
    canUndo: editor.canUndo, canRedo: editor.canRedo };
}
function renderReadouts(): void {
  const state = captureState();
  node('opacity-output', HTMLOutputElement).value = `${Math.round(Number(state.opacity) * 100)} %`;
  node('history-output', HTMLParagraphElement).textContent = `Annulation : ${state.canUndo ? 'disponible' : 'aucune'} · Rétablissement : ${state.canRedo ? 'disponible' : 'aucun'}`;
  node('refusal-count', HTMLOutputElement).value = refusals.length === 0 ? 'Aucun refus.' : `${refusals.length} refus reçu${refusals.length === 1 ? '' : 's'}.`;
  node('apply', HTMLButtonElement).disabled = state.canUndo || state.canRedo;
  node('undo', HTMLButtonElement).disabled = !state.canUndo;
  node('redo', HTMLButtonElement).disabled = !state.canRedo;
  denyUndo.disabled = !state.canUndo; denyRedo.disabled = !state.canRedo;
  node('refusals-json', HTMLPreElement).textContent = JSON.stringify(refusals, null, 2);
  node('project-json', HTMLPreElement).textContent = JSON.stringify({ ...state, sourceStyle, journal, successEvents }, null, 2);
}
function perform(action: () => boolean, message: string): void {
  const refusalCount = refusals.length;
  accepted = action();
  if (accepted) { status.textContent = message; status.dataset.refused = 'false'; }
  else if (refusals.length === refusalCount) { status.textContent = 'Action non appliquée.'; status.dataset.refused = 'true'; }
  renderReadouts();
}
editor.on('command:refused', ({ command: refusedCommand, reason }) => {
  refusals.push(detached({ reason, commandLabel: refusedCommand.label, state: captureState() }));
  status.textContent = reason; status.dataset.refused = 'true'; renderReadouts();
});
for (const event of ['document:changed', 'history:changed', 'transaction:changed'] as const) {
  editor.on(event, () => { successEvents.push(event); renderReadouts(); });
}
node('apply', HTMLButtonElement).addEventListener('click', () => perform(() => editor.execute(command), 'Commande appliquée : opacité à 75 %.'));
node('undo', HTMLButtonElement).addEventListener('click', () => perform(() => editor.undo(), 'Annulation réussie : opacité à 25 %.'));
node('redo', HTMLButtonElement).addEventListener('click', () => perform(() => editor.redo(), 'Rétablissement réussi : opacité à 75 %.'));
renderReadouts();
window.historyRefusalsFixture = Object.freeze({ ready: true, snapshot: () => detached({ ...captureState(), sourceStyle,
  journal, refusals, successEvents, accepted, fault: editor.transactions.fault }) });
window.addEventListener('pagehide', (event) => { if (!event.persisted && !editor.isDestroyed) editor.destroy(); });

interface IHistoryState {
  readonly timeline: ITimelineDocument; readonly style: string | null; readonly opacity: string;
  readonly canUndo: boolean; readonly canRedo: boolean;
}
interface IRenderEntry { readonly cause: HostRenderCause; readonly style: string | null }
interface IRefusalObservation { readonly reason: string; readonly commandLabel: string; readonly state: IHistoryState }
interface IHistorySnapshot extends IHistoryState {
  readonly sourceStyle: string | null; readonly journal: readonly IRenderEntry[];
  readonly refusals: readonly IRefusalObservation[]; readonly successEvents: readonly string[];
  readonly accepted?: boolean; readonly fault?: ITransactionFault;
}
/** Read-only regression diagnostics; all edits use visible buttons and checkboxes. */
export interface IHistoryRefusalsFixture { readonly ready: true; snapshot(): IHistorySnapshot }
declare global { interface Window { historyRefusalsFixture?: IHistoryRefusalsFixture } }
