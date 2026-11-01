// packages/editor/src/core/editor/__tests__/Editor.hostTransactionGroups.test.ts
import { setupHost, cleanupHosts, addStopRequest, positionRequest, attributeEffect, number, state, observeTransactions } from './hostTransactionFixtures';

afterEach(cleanupHosts);

it('cancels a mixed group in reverse host-effect order and preserves the earlier redo branch', () => {
  const fixture = setupHost();
  const { editor, element } = fixture;
  expect(editor.propertyTimelines.set('gradient', 'rightPosition', number(80), { frame: 10, initialValue: number(100) })).toEqual({ status: 'changed' });
  const oldRedo = editor.document;
  expect(editor.undo()).toBe(true);
  const before = state(fixture);
  const trace: string[] = [];
  const first = attributeEffect(element, { attribute: 'data-first', name: 'first', trace });
  const second = attributeEffect(element, { attribute: 'data-second', name: 'second', trace });
  const events = observeTransactions(editor);
  const gesture = editor.propertyTimelines.beginTransaction('Mixed host gesture');
  expect(editor.transactions.execute(addStopRequest(fixture, first.effect))).toMatchObject({ status: 'changed' });
  expect(editor.transactions.execute({ ...positionRequest(70), effect: second.effect })).toMatchObject({ status: 'changed' });
  expect(editor.propertyTimelines.set('gradient', 'middlePosition', number(65), { frame: 50 })).toEqual({ status: 'changed' });
  expect(events.filter((event) => event.phase === 'commit')).toEqual([]);
  expect(events.filter((event) => event.phase === 'preview')).toHaveLength(2);
  trace.length = 0;
  gesture.cancel();
  expect(gesture.active).toBe(false);
  expect(trace.map((entry) => entry.split(':')[0])).toEqual(['second', 'first']);
  expect(state(fixture)).toEqual(before);
  expect(first.journal).toEqual([]); expect(second.journal).toEqual([]);
  expect(first.pending).toEqual([]); expect(second.pending).toEqual([]);
  expect(events.filter((event) => event.phase === 'cancel')).toHaveLength(1);
  expect(events.filter((event) => event.phase === 'commit')).toEqual([]);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(oldRedo);
});

it('commits a mixed group once and replays all participants through the existing undo stack', () => {
  const fixture = setupHost();
  const { editor, element, seek } = fixture;
  seek(50);
  const before = state(fixture);
  const trace: string[] = [];
  const first = attributeEffect(element, { attribute: 'data-first', name: 'first', trace });
  const second = attributeEffect(element, { attribute: 'data-second', name: 'second', trace });
  const events = observeTransactions(editor);
  const gesture = editor.propertyTimelines.beginTransaction('Add and position gradient stop');
  expect(editor.transactions.execute(addStopRequest(fixture, first.effect))).toMatchObject({ status: 'changed' });
  expect(editor.transactions.execute({ ...positionRequest(70), effect: second.effect })).toMatchObject({ status: 'changed' });
  expect(editor.propertyTimelines.set('gradient', 'middlePosition', number(65), { frame: 50 })).toEqual({ status: 'changed' });
  expect(gesture.commit()).toBe(true);
  const changed = state(fixture);
  expect(events.filter((event) => event.phase === 'commit')).toHaveLength(1);
  expect(events[events.length - 1]).toMatchObject({ phase: 'commit', label: 'Add and position gradient stop', cause: 'execute' });
  trace.length = 0;
  expect(editor.undo()).toBe(true);
  expect(trace.map((entry) => entry.split(':')[0])).toEqual(['second', 'first']);
  expect(editor.document).toEqual(before.document); expect(fixture.stage.animationContext).toEqual(before.context);
  expect(fixture.root.innerHTML).toBe(before.dom); expect(editor.canUndo).toBe(false);
  trace.length = 0;
  expect(editor.redo()).toBe(true);
  expect(trace.map((entry) => entry.split(':')[0])).toEqual(['first', 'second']);
  expect(state(fixture)).toEqual(changed);
});

it('keeps an earlier successful preview when a later batch is refused and still cancels the complete gesture', () => {
  const fixture = setupHost();
  const { editor } = fixture;
  const original = state(fixture);
  const first = attributeEffect(fixture.element);
  const gesture = editor.propertyTimelines.beginTransaction('Partial gesture');
  expect(editor.transactions.execute(addStopRequest(fixture, first.effect))).toMatchObject({ status: 'changed' });
  const preview = state(fixture);
  expect(editor.transactions.execute({ label: 'Invalid later key', properties: [
    { kind: 'set', layerId: 'gradient', property: 'rightPosition', frame: 101, value: number(20) }
  ] })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(preview); expect(gesture.active).toBe(true);
  gesture.cancel();
  expect(state(fixture)).toEqual(original); expect(first.journal).toEqual([]);
});

it('faults visibly when cancellation cannot compensate a host participant and keeps destruction available', () => {
  const fixture = setupHost();
  const { editor } = fixture;
  const host = attributeEffect(fixture.element, {
    afterApply: (direction) => { if (direction === 'undo') throw new Error('Undo effect failed'); },
    beforeRollback: () => { throw new Error('Compensation failed'); }
  });
  const gesture = editor.propertyTimelines.beginTransaction('Failing cancellation');
  expect(editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  expect(() => gesture.cancel()).toThrow();
  expect(editor.transactions.fault).toBeDefined();
  expect(editor.transactions.execute(positionRequest(30))).toMatchObject({ status: 'faulted' });
  expect(() => editor.undo()).toThrow(); expect(() => editor.redo()).toThrow();
  expect(() => editor.destroy()).not.toThrow(); expect(editor.isDestroyed).toBe(true);
});
