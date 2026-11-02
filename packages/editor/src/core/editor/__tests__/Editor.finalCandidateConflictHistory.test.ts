// packages/editor/src/core/editor/__tests__/Editor.finalCandidateConflictHistory.test.ts
import type { EditorTransactionResult, TransactionChangedEvent } from '../../../index';
import { cleanupConflicts, context, diagnostic, number, property, resolveRequest,
  seedRedo, setupConflict, state } from './finalCandidateConflictFixtures';

afterEach(cleanupConflicts);

it('exposes the final decision, keys, preview and history coherently to every execute, undo and redo observer', () => {
  const fixture = setupConflict(undefined, true);
  fixture.seek(20);
  let phase = 'execute';
  const observations: { phase: string; event: string; opacity: string; resolutions: number; keys: number;
    canUndo: boolean; canRedo: boolean }[] = [];
  for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) {
    fixture.editor.on(event, () => observations.push({ phase, event, opacity: fixture.element.style.opacity,
      resolutions: context(fixture).resolutions?.length ?? 0, keys: property(fixture)?.keys.length ?? 0,
      canUndo: fixture.editor.canUndo, canRedo: fixture.editor.canRedo }));
  }
  let current = true;
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { isCurrent: () => current }))).toMatchObject({ status: 'changed' });
  current = false;
  phase = 'undo'; expect(fixture.editor.undo()).toBe(true);
  phase = 'redo'; expect(fixture.editor.redo()).toBe(true);
  for (const [name, opacity, resolutions, keys, canUndo, canRedo] of [
    ['execute', '0.5', 1, 2, true, false], ['undo', '1', 0, 1, false, true], ['redo', '0.5', 1, 2, true, false]
  ] as const) {
    const seen = observations.filter((entry) => entry.phase === name);
    expect(seen.map((entry) => entry.event)).toEqual(expect.arrayContaining([
      'document:changed', 'property:changed', 'history:changed', 'transaction:changed'
    ]));
    for (const entry of seen) expect(entry).toMatchObject({ opacity, resolutions, keys, canUndo, canRedo });
  }
});

it('rejects synchronous reentry during success notification and allows a new call afterwards', () => {
  const fixture = setupConflict();
  const request = resolveRequest(fixture);
  const nested: EditorTransactionResult[] = [];
  const dispose = fixture.editor.on('transaction:changed', () => nested.push(fixture.editor.transactions.resolveHtmlConflict(request)));
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
  expect(nested).toEqual([expect.objectContaining({ status: 'refused' })]);
  dispose();
  expect(fixture.editor.undo()).toBe(true);
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
});

it('cancels a gesture back to its original unresolved conflict and preserves the older redo branch', () => {
  const fixture = setupConflict(undefined, true);
  fixture.seek(20);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture);
  const originalDiagnostic = diagnostic(fixture);
  const events: TransactionChangedEvent[] = [];
  fixture.editor.on('transaction:changed', (event) => events.push(event));
  const gesture = fixture.editor.propertyTimelines.beginTransaction('Resolve and adjust');
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(events.map((event) => event.phase)).toEqual(['preview']);
  gesture.cancel();
  expect(gesture.active).toBe(false);
  expect(state(fixture)).toEqual(before);
  expect(diagnostic(fixture)).toEqual(originalDiagnostic);
  expect(events.map((event) => event.phase)).toEqual(['preview', 'cancel']);
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(previousRedo);
});

it('commits a mixed gesture as one undo entry and restores its original known conflict on undo', () => {
  const fixture = setupConflict(undefined, true);
  const before = state(fixture);
  const events: TransactionChangedEvent[] = [];
  fixture.editor.on('transaction:changed', (event) => events.push(event));
  const gesture = fixture.editor.propertyTimelines.beginTransaction('Resolve and rename');
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.transactions.execute({ label: 'Name the winner', commands: [{ label: 'Rename first rule',
    do: (doc) => ({ ...doc, layers: doc.layers.map((item) => item.id === 'first' ? { ...item, name: 'Chosen rule' } : item) }),
    undo: (doc) => ({ ...doc, layers: doc.layers.map((item) => item.id === 'first' ? { ...item, name: 'first' } : item) })
  }] })).toMatchObject({ status: 'changed' });
  expect(gesture.commit()).toBe(true);
  expect(events.filter((event) => event.phase === 'commit')).toHaveLength(1);
  const changed = state(fixture);
  expect(fixture.editor.undo()).toBe(true); expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(fixture.editor.undo()).toBe(false);
  expect(fixture.editor.redo()).toBe(true); expect(state(fixture)).toEqual(changed);
  expect(property(fixture)?.keys).toEqual([{ frame: 1, value: number(.3) }, { frame: 20, value: number(.5) }]);
});
