// packages/editor/src/core/editor/__tests__/Editor.hostTransactionEvents.test.ts
import type { EditorTransactionResult, IHostHistoryEffect } from '../transactionTypes';
import type { PropertyTimelineMutationResult } from '../propertyTimelineTypes';
import { captureContext } from './fixtures';
import { setupHost, cleanupHosts, addStopRequest, positionRequest, attributeEffect, number, state, observeTransactions } from './hostTransactionFixtures';

afterEach(cleanupHosts);

it.each(['prepare', 'apply', 'command:before'] as const)('reports a synchronous busy refusal for property edits during %s without early success events', (phase) => {
  const capture = captureContext('test.atomicBusy');
  const fixture = setupHost({ plugins: [capture.plugin] });
  const { editor } = fixture;
  const results: PropertyTimelineMutationResult[] = [];
  const snapshots: { before: ReturnType<typeof state>; after: ReturnType<typeof state>; emitted: readonly string[] }[] = [];
  const successEvents: string[] = [];
  for (const event of ['document:changed', 'property:changed', 'transaction:changed', 'history:changed'] as const) {
    editor.on(event, () => successEvents.push(event));
  }
  let attempted = false;
  const attempt = () => {
    if (attempted) return;
    attempted = true;
    const before = state(fixture);
    results.push(editor.propertyTimelines.set('gradient', 'rightPosition', number(25), { frame: 50, initialValue: number(100) }));
    snapshots.push({ before, after: state(fixture), emitted: [...successEvents] });
  };
  const host = attributeEffect(fixture.element);
  const effect: IHostHistoryEffect = { prepare(direction) {
    if (phase === 'prepare') attempt();
    const change = host.effect.prepare(direction);
    return { ...change, apply() { if (phase === 'apply') attempt(); change.apply(); } };
  } };
  if (phase === 'command:before') capture.context().events.onCancellable('command:before', attempt);
  expect(editor.transactions.execute(addStopRequest(fixture, effect))).toMatchObject({ status: 'changed' });
  expect(results).toEqual([{ status: 'refused', reason: expect.stringMatching(/transaction atomique.*cours/i) }]);
  expect(snapshots).toHaveLength(1);
  expect(snapshots[0].after).toEqual(snapshots[0].before);
  expect(snapshots[0].emitted).toEqual([]);
  expect(successEvents).toContain('transaction:changed');
  expect(editor.propertyTimelines.set('gradient', 'rightPosition', number(25), { frame: 50, initialValue: number(100) })).toEqual({ status: 'changed' });
  expect(editor.undo()).toBe(true); expect(editor.undo()).toBe(true); expect(editor.canUndo).toBe(false);
});

it('publishes document, property, render, history and terminal events only after the entire state is installed', () => {
  const fixture = setupHost();
  const { editor } = fixture;
  fixture.seek(50);
  const host = attributeEffect(fixture.element);
  const observations: { readonly event: string; readonly state: ReturnType<typeof state>; readonly journal: string }[] = [];
  for (const event of ['document:changed', 'property:changed', 'frame:render', 'history:changed', 'stage:targetsChanged', 'stage:report', 'transaction:changed'] as const) {
    editor.on(event, () => observations.push({ event, state: state(fixture), journal: JSON.stringify(host.journal) }));
  }
  expect(editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  const verify = () => {
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.map((entry) => entry.event)).toEqual(expect.arrayContaining(['document:changed', 'property:changed', 'history:changed', 'transaction:changed']));
    for (const observation of observations) {
      expect(observation.state).toEqual(state(fixture));
      expect(observation.journal).toBe(JSON.stringify(host.journal));
    }
    expect(observations[observations.length - 1]?.event).toBe('transaction:changed');
    observations.length = 0;
  };
  verify();
  expect(editor.undo()).toBe(true); verify();
  expect(editor.redo()).toBe(true); verify();
});

it('refuses notification-time reentrant mutations synchronously and accepts an explicit retry after publication', () => {
  const fixture = setupHost();
  const { editor } = fixture;
  const results: EditorTransactionResult[] = [];
  const nested: { readonly property: string; readonly command: boolean; readonly undo: boolean; readonly redo: boolean;
    readonly before: ReturnType<typeof state>; readonly after: ReturnType<typeof state> }[] = [];
  let once = true;
  editor.on('document:changed', () => {
    if (!once) return;
    once = false;
    const snapshot = state(fixture);
    results.push(editor.transactions.execute(positionRequest(25)));
    const property = editor.propertyTimelines.set('gradient', 'rightPosition', number(25), { frame: 50, initialValue: number(100) }).status;
    const command = editor.execute({ label: 'Reentrant rename', do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 48 } }), undo: (doc) => doc });
    const undo = editor.undo(); const redo = editor.redo();
    nested.push({ property, command, undo, redo, before: snapshot, after: state(fixture) });
  });
  expect(editor.transactions.execute(addStopRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(results).toHaveLength(1); expect(results[0]).toMatchObject({ status: 'refused', reason: expect.any(String) });
  expect(nested).toHaveLength(1);
  expect(nested[0]).toMatchObject({ property: 'refused', command: false, undo: false, redo: false });
  expect(nested[0].after).toEqual(nested[0].before);
  expect(editor.transactions.fault).toBeUndefined();
  expect(editor.transactions.execute(positionRequest(25))).toMatchObject({ status: 'changed' });
  expect(editor.undo()).toBe(true); expect(editor.undo()).toBe(true); expect(editor.canUndo).toBe(false);
});

it('contains observer exceptions and continues the committed event batch without compensating success', () => {
  const fixture = setupHost();
  const { editor, element } = fixture;
  const host = attributeEffect(element);
  const events = observeTransactions(editor);
  const error = new Error('Observer failed after commit');
  const report = jest.spyOn(console, 'error').mockImplementation(() => {});
  const seen: ReturnType<typeof state>[] = [];
  editor.on('document:changed', () => { throw error; });
  editor.on('document:changed', () => seen.push(state(fixture)));
  try {
    expect(editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
    expect(seen).toHaveLength(1); expect(seen[0]).toEqual(state(fixture));
    expect(events).toHaveLength(1); expect(events[0].phase).toBe('commit');
    expect(report).toHaveBeenCalled(); expect(editor.transactions.fault).toBeUndefined();
    expect(element.getAttribute('data-designer')).toBe('edited');
    expect(editor.undo()).toBe(true); expect(element.hasAttribute('data-designer')).toBe(false);
    expect(editor.redo()).toBe(true); expect(element.getAttribute('data-designer')).toBe('edited');
  } finally { report.mockRestore(); }
});

it('keeps detailed property events scoped to changed tracks and suppresses them for context-only commits', () => {
  const fixture = setupHost();
  const changes: { property: string; cause: string }[] = [];
  fixture.editor.on('property:changed', (event) => changes.push({ property: event.property, cause: event.cause }));
  const request = addStopRequest(fixture);
  expect(fixture.editor.transactions.execute(request)).toMatchObject({ status: 'changed' });
  expect(changes).toHaveLength(2);
  expect(changes).toEqual(expect.arrayContaining([
    { property: 'middlePresent', cause: 'execute' }, { property: 'middlePosition', cause: 'execute' }
  ]));
  changes.length = 0;
  const context = fixture.stage.animationContext;
  expect(fixture.editor.transactions.execute({ label: 'Change source angle', htmlContext: { stageId: fixture.stage.id,
    context: { ...context, gradients: { ...context.gradients, gradient: context.gradients!.gradient.map((entry) => ({ ...entry, angle: 180 })) } }
  } })).toMatchObject({ status: 'changed' });
  expect(changes).toEqual([]);
});
