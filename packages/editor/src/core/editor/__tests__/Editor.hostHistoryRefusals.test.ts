// packages/editor/src/core/editor/__tests__/Editor.hostHistoryRefusals.test.ts
import type { CommandRefusedEvent, EditorTransactionResult, ICommand } from '../../../index';
import { cleanupHistoryRefusals, historyRefusalState, setupHistoryRefusal } from './hostHistoryRefusalFixtures';

afterEach(cleanupHistoryRefusals);

describe.each([false, true])('public history refusal with hostRenderer=%s', (renderer) => {
  it.each(['undo', 'redo'] as const)('publishes the exact %s permission and original command without changing state', (direction) => {
    const fixture = setupHistoryRefusal(renderer);
    expect(fixture.editor.execute(fixture.command)).toBe(true);
    if (direction === 'redo') expect(fixture.editor.undo()).toBe(true);
    const before = historyRefusalState(fixture);
    const refused: CommandRefusedEvent[] = [];
    const observed: ReturnType<typeof historyRefusalState>[] = [];
    const success = jest.fn();
    fixture.editor.on('command:refused', (event) => { refused.push(event); observed.push(historyRefusalState(fixture)); });
    for (const event of ['document:changed', 'history:changed', 'transaction:changed'] as const) fixture.editor.on(event, success);
    fixture.controls[direction] = true;
    expect(fixture.editor[direction]()).toBe(false);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toBe(`Permission ${direction} refusée`);
    expect(refused[0].command).toBe(fixture.command);
    expect(observed).toEqual([before]);
    expect(historyRefusalState(fixture)).toEqual(before);
    expect(success).not.toHaveBeenCalled();
    fixture.controls[direction] = false;
    expect(fixture.editor[direction]()).toBe(true);
    expect(fixture.editor.document.settings.fps).toBe(direction === 'undo' ? 24 : 30);
    expect(refused).toHaveLength(1);
  });
});

it.each(['undo', 'redo'] as const)('reports a partial renderer %s failure only after restoring its preview and journal', (direction) => {
  const fixture = setupHistoryRefusal();
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  if (direction === 'redo') expect(fixture.editor.undo()).toBe(true);
  const before = historyRefusalState(fixture);
  const refused: CommandRefusedEvent[] = [];
  const observed: ReturnType<typeof historyRefusalState>[] = [];
  const success = jest.fn();
  fixture.editor.on('command:refused', (event) => { refused.push(event); observed.push(historyRefusalState(fixture)); });
  for (const event of ['document:changed', 'history:changed', 'transaction:changed'] as const) fixture.editor.on(event, success);
  fixture.controls.apply = direction;
  expect(fixture.editor[direction]()).toBe(false);
  expect(refused).toHaveLength(1);
  expect(refused[0]).toMatchObject({ command: fixture.command, reason: 'Rendu refusé après écriture' });
  expect(observed).toEqual([before]); expect(historyRefusalState(fixture)).toEqual(before);
  expect(success).not.toHaveBeenCalled();
  fixture.controls.apply = undefined;
  expect(fixture.editor[direction]()).toBe(true);
});

it('reports a prepare refusal without applying a candidate and keeps the entry retryable', () => {
  const fixture = setupHistoryRefusal();
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  const before = historyRefusalState(fixture);
  const refused = jest.fn(); fixture.editor.on('command:refused', refused);
  fixture.controls.prepare = 'undo';
  expect(fixture.editor.undo()).toBe(false);
  expect(refused).toHaveBeenCalledTimes(1);
  expect(refused).toHaveBeenCalledWith({ command: fixture.command, reason: 'Préparation du rendu refusée' });
  expect(historyRefusalState(fixture)).toEqual(before);
  fixture.controls.prepare = undefined;
  expect(fixture.editor.undo()).toBe(true);
});

it('keeps a failed compensation distinct from a recoverable command refusal', () => {
  const fixture = setupHistoryRefusal();
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  const refused = jest.fn(); fixture.editor.on('command:refused', refused);
  const success = jest.fn(); fixture.editor.on('transaction:changed', success);
  fixture.controls.apply = 'undo'; fixture.controls.rollback = true;
  expect(() => fixture.editor.undo()).toThrow('La compensation a échoué');
  expect(fixture.editor.transactions.fault).toBeDefined();
  expect(refused).not.toHaveBeenCalled(); expect(success).not.toHaveBeenCalled();
  expect(() => fixture.editor.undo()).toThrow(); expect(() => fixture.editor.redo()).toThrow();
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
});

it('refuses nested execute, undo, redo and transactions without emitting a second refusal', () => {
  const fixture = setupHistoryRefusal();
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  const before = historyRefusalState(fixture);
  const next: ICommand = { label: 'Next frame rate', do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 48 } }),
    undo: () => before.document };
  const refused: CommandRefusedEvent[] = [];
  const nested: { execute?: boolean; undo?: boolean; redo?: boolean; transaction?: EditorTransactionResult } = {};
  fixture.editor.on('command:refused', (event) => {
    refused.push(event);
    // Bound reentry so a regression fails with duplicate events instead of recursing forever.
    if (refused.length !== 1) return;
    nested.execute = fixture.editor.execute(next);
    nested.undo = fixture.editor.undo(); nested.redo = fixture.editor.redo();
    nested.transaction = fixture.editor.transactions.execute({ label: 'Nested transaction', commands: [next] });
  });
  fixture.controls.undo = true;
  expect(fixture.editor.undo()).toBe(false);
  expect(refused).toHaveLength(1);
  expect(nested).toMatchObject({ execute: false, undo: false, redo: false, transaction: { status: 'refused' } });
  expect(historyRefusalState(fixture)).toEqual(before);
  fixture.controls.undo = false;
  expect(fixture.editor.execute(next)).toBe(true);
  expect(fixture.editor.document.settings.fps).toBe(48);
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.undo()).toBe(true);
  expect(fixture.editor.document.settings.fps).toBe(24);
});

it('isolates a throwing refusal observer and allows a later retry', () => {
  const fixture = setupHistoryRefusal();
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  const before = historyRefusalState(fixture);
  const reporter = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const dispose = fixture.editor.on('command:refused', () => { throw new Error('Observer failed'); });
    const nextObserver = jest.fn(); fixture.editor.on('command:refused', nextObserver);
    fixture.controls.undo = true;
    expect(fixture.editor.undo()).toBe(false);
    expect(nextObserver).toHaveBeenCalledTimes(1); expect(reporter).toHaveBeenCalledTimes(1);
    expect(historyRefusalState(fixture)).toEqual(before);
    dispose(); fixture.controls.undo = false;
    expect(fixture.editor.undo()).toBe(true);
  } finally { reporter.mockRestore(); }
});

it('publishes one busy refusal when a success observer edits and the refusal observer retries that edit', () => {
  const fixture = setupHistoryRefusal();
  const next: ICommand = { label: 'Edit from an observer', do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 48 } }),
    undo: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 30 } }) };
  const refused: CommandRefusedEvent[] = [];
  const observed: ReturnType<typeof historyRefusalState>[] = [];
  let committed: ReturnType<typeof historyRefusalState> | undefined;
  let firstAttempt: boolean | undefined;
  let retried: boolean | undefined;
  fixture.editor.on('command:refused', (event) => {
    refused.push(event); observed.push(historyRefusalState(fixture));
    // Only one retry keeps this regression bounded if the busy path emits recursively.
    if (refused.length === 1) retried = fixture.editor.execute(next);
  });
  const dispose = fixture.editor.on('document:changed', () => {
    committed = historyRefusalState(fixture);
    firstAttempt = fixture.editor.execute(next);
  });
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  expect(refused).toHaveLength(1);
  expect(refused[0].command).toBe(next);
  expect(refused[0].reason).toBe('Une transaction atomique est en cours : réessayez après sa notification.');
  expect(firstAttempt).toBe(false); expect(retried).toBe(false);
  expect(observed).toEqual([committed]);
  expect(historyRefusalState(fixture)).toEqual(committed);
  expect(fixture.editor.document.settings.fps).toBe(30);
  dispose();
  expect(fixture.editor.execute(next)).toBe(true);
  expect(fixture.editor.document.settings.fps).toBe(48);
});

it.each(['command:before', 'renderer.prepare'] as const)('protects a queued busy refusal from %s when its observer retries the edit', (phase) => {
  const fixture = setupHistoryRefusal();
  const next: ICommand = { label: 'Edit during preparation', do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 48 } }),
    undo: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 30 } }) };
  const refused: CommandRefusedEvent[] = [];
  const observed: ReturnType<typeof historyRefusalState>[] = [];
  let firstAttempt: boolean | undefined;
  let retried: boolean | undefined;
  if (phase === 'command:before') fixture.controls.before = () => { firstAttempt = fixture.editor.execute(next); };
  else fixture.controls.duringPrepare = (cause) => { if (cause === 'execute') firstAttempt = fixture.editor.execute(next); };
  fixture.editor.on('command:refused', (event) => {
    refused.push(event); observed.push(historyRefusalState(fixture));
    // The first notification was queued during preparation, not emitted immediately.
    if (refused.length === 1) retried = fixture.editor.execute(next);
  });
  expect(fixture.editor.execute(fixture.command)).toBe(true);
  const committed = historyRefusalState(fixture);
  expect(refused).toHaveLength(1);
  expect(refused[0].command).toBe(next);
  expect(refused[0].reason).toBe('Une transaction atomique est en cours : réessayez après sa notification.');
  expect(firstAttempt).toBe(false); expect(retried).toBe(false);
  expect(observed).toEqual([committed]);
  expect(fixture.editor.document.settings.fps).toBe(30);
  fixture.controls.before = undefined; fixture.controls.duringPrepare = undefined;
  expect(fixture.editor.execute(next)).toBe(true);
  expect(fixture.editor.document.settings.fps).toBe(48);
});

it('discards a queued nested refusal with a cancelled parent batch and releases the notification guard', () => {
  const fixture = setupHistoryRefusal();
  const before = historyRefusalState(fixture);
  const next: ICommand = { label: 'Nested edit in a cancelled batch', do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 48 } }),
    undo: () => before.document };
  const refused: CommandRefusedEvent[] = [];
  let nested: boolean | undefined;
  fixture.controls.before = () => { nested = fixture.editor.execute(next); };
  fixture.controls.cancelBefore = true;
  fixture.editor.on('command:refused', (event) => refused.push(event));
  expect(fixture.editor.execute(fixture.command)).toBe(false);
  expect(nested).toBe(false);
  expect(refused).toHaveLength(1);
  expect(refused[0]).toEqual({ command: fixture.command, reason: 'cancelled' });
  expect(historyRefusalState(fixture)).toEqual(before);
  fixture.controls.before = undefined; fixture.controls.cancelBefore = false;
  expect(fixture.editor.execute(next)).toBe(true);
  expect(fixture.editor.document.settings.fps).toBe(48);
  expect(refused).toHaveLength(1);
});

it.each([false, true])('does not invent a refusal for an empty or no-op history with hostRenderer=%s', (renderer) => {
  const fixture = setupHistoryRefusal(renderer);
  const refused = jest.fn(); fixture.editor.on('command:refused', refused);
  expect(fixture.editor.undo()).toBe(false); expect(fixture.editor.redo()).toBe(false);
  expect(fixture.editor.transactions.execute({ label: 'No change' })).toMatchObject({ status: 'noop' });
  expect(fixture.editor.undo()).toBe(false); expect(fixture.editor.redo()).toBe(false);
  expect(refused).not.toHaveBeenCalled();
});
