// packages/editor/src/core/editor/__tests__/hostHistoryRefusalFixtures.ts
import { createManualClock } from '@kazo-ca/timeline-runtime';
import type { IHtmlStage, ITimelineDocument } from '@kazo-ca/timeline-runtime';
import { CommandRefusedError, createEditor } from '../../../index';
import type { HostRenderCause, ICommand, IEditor, IEditorHostRenderer } from '../../../index';

const editors: IEditor[] = [];
export function setupHistoryRefusal(renderer = true, stage: IHtmlStage | false = false) {
  const container = document.createElement('div');
  const element = document.createElement('div');
  document.body.append(container, element);
  const data: ITimelineDocument = { version: '2.0.0', settings: { fps: 24, totalFrames: 100 }, layers: [] };
  const clock = createManualClock();
  const controls: { undo?: boolean; redo?: boolean; prepare?: HostRenderCause; apply?: HostRenderCause; rollback?: boolean;
    before?: () => void; cancelBefore?: boolean; duringPrepare?: (cause: HostRenderCause) => void } = {};
  const journal: string[] = [];
  const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
    controls.duringPrepare?.(candidate.cause);
    if (controls.prepare === candidate.cause) throw new Error('Préparation du rendu refusée');
    const before = element.getAttribute('data-preview');
    const beforeJournal = [...journal];
    const next = candidate.cause === 'destroy' ? null : String(candidate.document.settings.fps);
    const restore = (value: string | null): void => {
      if (value === null) element.removeAttribute('data-preview'); else element.setAttribute('data-preview', value);
    };
    return { changed: before !== next, apply() {
      restore(next); journal.push(`${candidate.cause}:${next}`);
      if (controls.apply === candidate.cause) throw new Error('Rendu refusé après écriture');
    }, rollback() {
      if (controls.rollback) throw new Error('Compensation indisponible');
      restore(before); journal.splice(0, journal.length, ...beforeJournal);
    } };
  } };
  const editor = createEditor(container, { data, stage, clock, defaultPlugins: false,
    plugins: [{ id: 'test.historyRefusal', dependencies: [], init(ctx) {
      ctx.events.onCancellable('command:before', (event) => { controls.before?.(); if (controls.cancelBefore) event.cancel(); });
    }, destroy() {} }],
    ...(renderer ? { hostRenderer } : {}) });
  editors.push(editor);
  const command: ICommand = { label: 'Change frame rate', do: (doc) => {
    if (controls.redo) throw new CommandRefusedError('Change frame rate', 'Permission redo refusée');
    return { ...doc, settings: { ...doc.settings, fps: 30 } };
  }, undo: (doc) => {
    if (controls.undo) throw new CommandRefusedError('Change frame rate', 'Permission undo refusée');
    return { ...doc, settings: { ...doc.settings, fps: 24 } };
  } };
  return { editor, element, controls, command, journal, clock };
}
export type HistoryRefusalFixture = ReturnType<typeof setupHistoryRefusal>;
export function historyRefusalState(fixture: HistoryRefusalFixture) {
  return { document: fixture.editor.document, preview: fixture.element.getAttribute('data-preview'),
    journal: [...fixture.journal], canUndo: fixture.editor.canUndo, canRedo: fixture.editor.canRedo,
    fault: fixture.editor.transactions.fault };
}
export function cleanupHistoryRefusals(): void {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  document.body.replaceChildren();
}
