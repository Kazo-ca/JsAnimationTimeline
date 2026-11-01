// packages/editor/src/core/editor/__tests__/finalCandidateConflictFixtures.ts
import { createHtmlInspectionStage, createManualClock, findNodeById, isLayer } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic, ILayer, IPropertyTimeline, ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../../../index';
import type { IEditor, IEditorHostRenderer, IHostRenderCandidate, IHtmlConflictTransactionRequest } from '../../../index';

export const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
export const track = (value: number, frame = 1): IPropertyTimeline => ({ initialValue: number(1), keys: [{ frame, value: number(value) }] });
export const layer = (id: string, selector: string, opacity: IPropertyTimeline): ILayer => ({
  id, name: id, type: 'layer', spans: [], target: { selector }, propertyTimelines: { opacity }
});
export const conflictDocument = (layers: readonly ILayer[] = [layer('first', '.first', track(.3)), layer('second', '.second', track(.7))]): ITimelineDocument => ({
  version: '2.0.0', settings: { fps: 24, totalFrames: 100 }, layers
});
const editors: IEditor[] = [];

export function setupConflict(data = conflictDocument(), renderer = false, animationContext: IHtmlAnimationContext = { version: 1 }) {
  const root = document.createElement('main');
  const element = document.createElement('button');
  element.id = 'specific'; element.className = 'first second button'; element.style.opacity = '1';
  root.append(element); document.body.append(root);
  const container = document.createElement('div'); document.body.append(container);
  const source = element.getAttribute('style')!;
  const stage = createHtmlInspectionStage({ root, animationContext, preserveSource: <T>(read: () => T): T => {
    const previous = element.getAttribute('style'); element.setAttribute('style', source);
    try { return read(); }
    finally { if (previous === null) element.removeAttribute('style'); else element.setAttribute('style', previous); }
  } });
  const controls: { failApply?: boolean; failRollback?: boolean; cancelCommand?: boolean; onPrepare?: (candidate: IHostRenderCandidate) => void;
    onApply?: (candidate: IHostRenderCandidate) => void } = {};
  const candidates: IHostRenderCandidate[] = [];
  const journal: string[] = [];
  const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
    candidates.push(candidate); controls.onPrepare?.(candidate);
    const context = candidate.htmlContexts.find((entry) => entry.stageId === stage.id)?.context;
    const winner = context?.resolutions?.[0]?.winnerLayerId;
    const value = winner === undefined ? undefined : candidate.sample.layer(winner)?.propertyValues?.opacity;
    const before = element.getAttribute('style');
    const previousJournal = [...journal];
    const next = candidate.cause === 'destroy' || value?.kind !== 'number' ? source : `opacity: ${value.value};`;
    return { changed: next !== before, apply() {
      element.setAttribute('style', next);
      journal.push(`${candidate.cause}:${next}`);
      controls.onApply?.(candidate);
      if (controls.failApply) throw new Error('Render failed after a partial write');
    }, rollback() {
      if (controls.failRollback) throw new Error('Host render compensation unavailable');
      if (before === null) element.removeAttribute('style'); else element.setAttribute('style', before);
      journal.splice(0, journal.length, ...previousJournal);
    } };
  } };
  const clock = createManualClock();
  const editor = createEditor(container, { data, stage, clock, defaultPlugins: false,
    plugins: [{ id: 'test.ha10Cancellation', dependencies: [], destroy() {}, init(ctx) {
      ctx.events.onCancellable('command:before', (event) => { if (controls.cancelCommand) event.cancel(); });
    } }], ...(renderer ? { hostRenderer } : {}) });
  editors.push(editor);
  const seek = (frame: number) => { editor.playback.seek(frame); clock.advance(1); };
  seek(1);
  return { editor, stage, root, element, clock, seek, controls, candidates, journal };
}
export type ConflictFixture = ReturnType<typeof setupConflict>;
export function resolveRequest(fixture: ConflictFixture, overrides: Partial<IHtmlConflictTransactionRequest> = {}): IHtmlConflictTransactionRequest {
  const conflict = diagnostic(fixture);
  return { label: 'Choose first rule and set advertised key', stageId: fixture.stage.id,
    confirmation: { id: conflict.id, signature: conflict.signature }, winnerLayerId: 'first',
    properties: [{ kind: 'set', layerId: 'first', property: 'opacity', frame: 20, value: number(.5) }],
    isCurrent: () => true, ...overrides };
}
export function diagnostic(fixture: ConflictFixture, code = 'priority-conflict'): IHtmlResolutionDiagnostic {
  const result = fixture.stage.diagnostics.find((issue) => issue.code === code);
  if (result === undefined) throw new Error(`Missing ${code} fixture diagnostic`);
  return result;
}
export function context(fixture: ConflictFixture): IHtmlAnimationContext { return fixture.stage.animationContext; }
export function state(fixture: ConflictFixture) {
  return { document: fixture.editor.document, context: context(fixture), dom: fixture.root.innerHTML,
    canUndo: fixture.editor.canUndo, canRedo: fixture.editor.canRedo };
}
export function property(fixture: ConflictFixture, id = 'first'): IPropertyTimeline | undefined {
  const node = findNodeById(fixture.editor.document.layers, id);
  return node !== undefined && isLayer(node) ? node.propertyTimelines?.opacity : undefined;
}
export function seedRedo(fixture: ConflictFixture): ITimelineDocument {
  expect(fixture.editor.transactions.execute({ label: 'Set an unrelated frame rate', commands: [{ label: 'Set frame rate',
    do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 30 } }),
    undo: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 24 } })
  }] })).toMatchObject({ status: 'changed' });
  const result = fixture.editor.document;
  expect(fixture.editor.undo()).toBe(true);
  return result;
}
export function cleanupConflicts(): void {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  document.body.replaceChildren();
}
