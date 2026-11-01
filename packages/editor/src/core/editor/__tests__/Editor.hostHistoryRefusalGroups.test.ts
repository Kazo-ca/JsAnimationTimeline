// packages/editor/src/core/editor/__tests__/Editor.hostHistoryRefusalGroups.test.ts
import { createHtmlInspectionStage } from '@kazo-ca/timeline-runtime';
import { CommandRefusedError } from '../../../index';
import type { CommandRefusedEvent, ICommand, IHostHistoryEffect } from '../../../index';
import { cleanupHistoryRefusals, historyRefusalState, setupHistoryRefusal } from './hostHistoryRefusalFixtures';

afterEach(cleanupHistoryRefusals);

it.each(['transaction', 'group'] as const)('describes a refused composite %s with its label and an inert command', (kind) => {
  const fixture = setupHistoryRefusal();
  const duration: ICommand = { label: 'Extend duration', do: (doc) => ({ ...doc, settings: { ...doc.settings, totalFrames: 200 } }),
    undo: (doc) => ({ ...doc, settings: { ...doc.settings, totalFrames: 100 } }) };
  const label = 'Change scene settings';
  if (kind === 'transaction') {
    expect(fixture.editor.transactions.execute({ label, commands: [fixture.command, duration] })).toMatchObject({ status: 'changed' });
  } else {
    const group = fixture.editor.propertyTimelines.beginTransaction(label);
    expect(fixture.editor.execute(fixture.command)).toBe(true);
    expect(fixture.editor.execute(duration)).toBe(true);
    expect(group.commit()).toBe(true);
  }
  const before = historyRefusalState(fixture);
  const refused: CommandRefusedEvent[] = [];
  const observed: ReturnType<typeof historyRefusalState>[] = [];
  fixture.editor.on('command:refused', (event) => { refused.push(event); observed.push(historyRefusalState(fixture)); });
  fixture.controls.undo = true;
  expect(fixture.editor.undo()).toBe(false);
  expect(refused).toHaveLength(1);
  expect(refused[0].reason).toBe('Permission undo refusée');
  expect(refused[0].command.label).toBe(label);
  expect(refused[0].command).not.toBe(fixture.command);
  expect(refused[0].command.do(before.document)).toBe(before.document);
  expect(refused[0].command.undo(before.document)).toBe(before.document);
  expect(historyRefusalState(fixture)).toEqual(before); expect(observed).toEqual([before]);
  expect(fixture.editor.undo()).toBe(false);
  expect(refused).toHaveLength(2);
  expect(refused[1].command).toBe(refused[0].command);
  expect(observed).toEqual([before, before]);
  fixture.controls.undo = false;
  expect(fixture.editor.undo()).toBe(true);
  expect(fixture.editor.document.settings).toEqual({ fps: 24, totalFrames: 100 });
  expect(fixture.editor.redo()).toBe(true);
  expect(historyRefusalState(fixture).document).toEqual(before.document);
});

it.each(['prepare', 'apply'] as const)('reports an effect-only transaction %s refusal with an inert descriptor and a retryable effect', (phase) => {
  const fixture = setupHistoryRefusal();
  const label = 'Annotate the host';
  let fail = false;
  const restore = (value: string | null): void => {
    if (value === null) fixture.element.removeAttribute('data-effect'); else fixture.element.setAttribute('data-effect', value);
  };
  const effect: IHostHistoryEffect = { prepare(direction) {
    if (fail && direction === 'undo' && phase === 'prepare') throw new CommandRefusedError(label, 'Permission effet refusée');
    const before = fixture.element.getAttribute('data-effect');
    const next = direction === 'undo' ? null : 'edited';
    return { changed: before !== next, apply() {
      restore(next);
      if (fail && direction === 'undo' && phase === 'apply') throw new Error('Effet refusé après écriture');
    }, rollback() { restore(before); } };
  } };
  expect(fixture.editor.transactions.execute({ label, effect })).toMatchObject({ status: 'changed' });
  const before = historyRefusalState(fixture);
  const refused: CommandRefusedEvent[] = [];
  const observed: { state: ReturnType<typeof historyRefusalState>; effect: string | null }[] = [];
  fixture.editor.on('command:refused', (event) => {
    refused.push(event); observed.push({ state: historyRefusalState(fixture), effect: fixture.element.getAttribute('data-effect') });
  });
  fail = true;
  expect(fixture.editor.undo()).toBe(false);
  expect(refused).toHaveLength(1);
  expect(refused[0].reason).toBe(phase === 'prepare' ? 'Permission effet refusée' : 'Effet refusé après écriture');
  expect(refused[0].command.label).toBe(label);
  expect(refused[0].command.do(before.document)).toBe(before.document);
  expect(refused[0].command.undo(before.document)).toBe(before.document);
  expect(observed).toEqual([{ state: before, effect: 'edited' }]);
  expect(historyRefusalState(fixture)).toEqual(before);
  expect(fixture.element.getAttribute('data-effect')).toBe('edited');
  fail = false;
  expect(fixture.editor.undo()).toBe(true); expect(fixture.element.hasAttribute('data-effect')).toBe(false);
  expect(fixture.editor.redo()).toBe(true); expect(fixture.element.getAttribute('data-effect')).toBe('edited');
});

it('reports a failed group cancellation after compensation and leaves the gesture active for retry', () => {
  const fixture = setupHistoryRefusal();
  const group = fixture.editor.propertyTimelines.beginTransaction('Adjust scene');
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  const before = historyRefusalState(fixture);
  const refused: CommandRefusedEvent[] = [];
  const observed: { state: ReturnType<typeof historyRefusalState>; active: boolean }[] = [];
  fixture.editor.on('command:refused', (event) => {
    refused.push(event); observed.push({ state: historyRefusalState(fixture), active: group.active });
  });
  fixture.controls.apply = 'group-cancel';
  expect(() => group.cancel()).toThrow('Le regroupement n’a pas pu être compensé.');
  expect(refused).toHaveLength(1);
  expect(refused[0].reason).toBe('Rendu refusé après écriture');
  expect(refused[0].command.label).toBe('Adjust scene');
  expect(refused[0].command.do(before.document)).toBe(before.document);
  expect(refused[0].command.undo(before.document)).toBe(before.document);
  expect(observed).toEqual([{ state: before, active: true }]);
  expect(group.active).toBe(true); expect(historyRefusalState(fixture)).toEqual(before);
  fixture.controls.apply = undefined;
  group.cancel();
  expect(group.active).toBe(false); expect(fixture.editor.document.settings.fps).toBe(24);
  expect(fixture.element.getAttribute('data-preview')).toBe('24');
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
});

it('publishes a stale HTML revision preflight refusal without changing the current context or history', () => {
  const stage = createHtmlInspectionStage({ root: document.body });
  const fixture = setupHistoryRefusal(true, stage);
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  stage.setAnimationContext({ version: 1, bindings: {} });
  const before = historyRefusalState(fixture);
  const context = stage.animationContext;
  const refused: CommandRefusedEvent[] = [];
  const observed: { state: ReturnType<typeof historyRefusalState>; context: typeof context }[] = [];
  fixture.editor.on('command:refused', (event) => {
    refused.push(event); observed.push({ state: historyRefusalState(fixture), context: stage.animationContext });
  });
  expect(fixture.editor.undo()).toBe(false);
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({ command: fixture.command, reason: 'Le contexte a changé : la transaction a été annulée.' });
  expect(observed).toEqual([{ state: before, context }]);
  expect(historyRefusalState(fixture)).toEqual(before); expect(stage.animationContext).toEqual(context);
});
