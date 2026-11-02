// packages/editor/src/core/editor/__tests__/Editor.finalCandidateConflictFailures.test.ts
import type { IHtmlConflictTransactionRequest } from '../../../index';
import { cleanupConflicts, conflictDocument, context, diagnostic, layer, number, resolveRequest,
  seedRedo, setupConflict, state, track } from './finalCandidateConflictFixtures';

afterEach(cleanupConflicts);

it('honors command cancellation before changing the resolution, keys, renderer or redo', () => {
  const fixture = setupConflict(undefined, true);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture); const journal = [...fixture.journal];
  const success = jest.fn(); fixture.editor.on('transaction:changed', success);
  fixture.controls.cancelCommand = true;
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture))).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(fixture.journal).toEqual(journal); expect(success).not.toHaveBeenCalled();
  fixture.controls.cancelCommand = false;
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(previousRedo);
});

it.each(['property', 'layer'] as const)('refuses an announced key for an unrelated %s', (kind) => {
  const fixture = setupConflict(conflictDocument([
    layer('first', '.first', track(.3)), layer('second', '.second', track(.7)), layer('other', '#other', track(.2))
  ]));
  const other = document.createElement('div'); other.id = 'other'; other.style.opacity = '1';
  fixture.root.append(other); fixture.stage.refresh();
  const before = state(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { properties: [
    { kind: 'set', layerId: kind === 'layer' ? 'other' : 'first', property: kind === 'property' ? 'width' : 'opacity',
      frame: 20, value: number(.5), initialValue: number(1) }
  ] }))).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it.each(['signature', 'id', 'winner', 'stage', 'policy', 'frame', 'operation'] as const)(
  'refuses an invalid %s without effects, success notifications or lost redo', (kind) => {
    const fixture = setupConflict(undefined, true);
    const previousRedo = seedRedo(fixture);
    const request = resolveRequest(fixture);
    const before = state(fixture);
    const journal = [...fixture.journal];
    const events: string[] = [];
    for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) {
      fixture.editor.on(event, () => events.push(event));
    }
    const variants: Record<typeof kind, IHtmlConflictTransactionRequest> = {
      signature: { ...request, confirmation: { ...request.confirmation, signature: 'obsolete' } },
      id: { ...request, confirmation: { ...request.confirmation, id: 'missing-conflict' } },
      winner: { ...request, winnerLayerId: 'not-offered' },
      stage: { ...request, stageId: 'missing-stage' },
      policy: { ...request, beforeFirst: 'underlying' },
      frame: { ...request, properties: [...request.properties!, { kind: 'set', layerId: 'first', property: 'opacity', frame: 101, value: number(.6) }] },
      operation: { ...request, properties: [{ kind: 'capture', layerId: 'first', property: 'opacity', frame: 20 }] } as unknown as IHtmlConflictTransactionRequest
    };
    expect(fixture.editor.transactions.resolveHtmlConflict(variants[kind])).toMatchObject({ status: 'refused' });
    expect(state(fixture)).toEqual(before); expect(fixture.journal).toEqual(journal); expect(events).toEqual([]);
    expect(fixture.editor.transactions.fault).toBeUndefined();
    expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(previousRedo);
  }
);

it('refuses a previously confirmed diagnostic after the document keys changed', () => {
  const fixture = setupConflict();
  const request = resolveRequest(fixture);
  fixture.editor.load(conflictDocument([layer('first', '.first', track(.4)), layer('second', '.second', track(.7))]));
  const before = state(fixture);
  expect(diagnostic(fixture).signature).not.toBe(request.confirmation.signature);
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it('refuses a repeated resolved ticket without adding another history entry', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  const request = resolveRequest(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
  const changed = state(fixture);
  const success = jest.fn(); fixture.editor.on('transaction:changed', success);
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(changed); expect(success).not.toHaveBeenCalled();
  expect(fixture.editor.undo()).toBe(true); expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(fixture.editor.undo()).toBe(false);
});

it('rejects a choice that exposes a new blocking conflict under the original prefix', () => {
  const fixture = setupConflict(conflictDocument([
    layer('first', '.first', track(.3)), layer('second', '.second', track(.7)),
    layer('specific', '#specific', { initialValue: number(1), keys: [{ frame: 50, value: number(.8) }, { frame: 100, value: number(.9) }],
      transitions: [{ id: 'specific-motion', fromFrame: 50, toFrame: 100 }] })
  ]));
  const conflict = diagnostic(fixture, 'before-first-conflict');
  expect(fixture.stage.diagnostics.some((issue) => issue.code === 'priority-conflict')).toBe(false);
  const before = state(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict({ label: 'Expose ambiguous underlying rules', stageId: fixture.stage.id,
    confirmation: { id: conflict.id, signature: conflict.signature }, winnerLayerId: 'specific', beforeFirst: 'underlying',
    properties: [{ kind: 'set', layerId: 'specific', property: 'opacity', frame: 20, value: number(.8) }], isCurrent: () => true
  })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it('uses the required host guard to reject replaced DOM members even when the HA4 signature is unchanged', () => {
  const fixture = setupConflict();
  const request = resolveRequest(fixture, { isCurrent: () => fixture.root.querySelector('.first') === fixture.element });
  const replacement = fixture.element.cloneNode(true);
  fixture.element.replaceWith(replacement); fixture.stage.refresh();
  expect(diagnostic(fixture).signature).toBe(request.confirmation.signature);
  const before = state(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it.each(['false', 'throw', 'missing'] as const)('rejects a %s required host guard', (mode) => {
  const fixture = setupConflict();
  const before = state(fixture);
  const request = resolveRequest(fixture);
  const guarded = mode === 'missing' ? { ...request, isCurrent: undefined } : { ...request,
    isCurrent: () => { if (mode === 'throw') throw new Error('Disposed confirmation'); return false; } };
  expect(fixture.editor.transactions.resolveHtmlConflict(guarded as unknown as IHtmlConflictTransactionRequest)).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it.each(['onPrepare', 'onApply'] as const)('rechecks the host guard after renderer %s and compensates before notifications', (phase) => {
  const fixture = setupConflict(undefined, true);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture);
  const journal = [...fixture.journal];
  const success = jest.fn(); fixture.editor.on('transaction:changed', success);
  let current = true;
  fixture.controls[phase] = (candidate) => { if (candidate.cause === 'execute') current = false; };
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { isCurrent: () => current }))).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(fixture.journal).toEqual(journal); expect(success).not.toHaveBeenCalled();
  expect(fixture.editor.transactions.fault).toBeUndefined();
  fixture.controls[phase] = undefined;
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(previousRedo);
});

it('compensates a renderer failure after writing the resolved preview and preserves the complete redo entry', () => {
  const fixture = setupConflict(undefined, true);
  fixture.seek(20);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture);
  const journal = [...fixture.journal];
  const success = jest.fn(); fixture.editor.on('transaction:changed', success);
  fixture.controls.failApply = true;
  try {
    expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture))).toMatchObject({ status: 'refused' });
    expect(state(fixture)).toEqual(before); expect(fixture.journal).toEqual(journal); expect(success).not.toHaveBeenCalled();
    expect(fixture.editor.transactions.fault).toBeUndefined();
  } finally { fixture.controls.failApply = false; }
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(previousRedo);
});

it('latches a visible fault when a late stale guard cannot compensate the applied renderer', () => {
  const fixture = setupConflict(undefined, true);
  fixture.seek(20);
  const success = jest.fn(); fixture.editor.on('transaction:changed', success);
  let current = true;
  fixture.controls.onApply = (candidate) => { if (candidate.cause === 'execute') current = false; };
  fixture.controls.failRollback = true;
  const request = resolveRequest(fixture, { isCurrent: () => current });
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'faulted' });
  expect(fixture.editor.transactions.fault).toBeDefined(); expect(success).not.toHaveBeenCalled();
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'faulted' });
  expect(fixture.editor.transactions.execute({ label: 'Blocked after failed compensation' })).toMatchObject({ status: 'faulted' });
  expect(() => fixture.editor.undo()).toThrow(); expect(() => fixture.editor.redo()).toThrow();
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
});

it('revalidates current HTML capabilities on redo instead of allowing a newly divergent group', () => {
  const fixture = setupConflict();
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture))).toMatchObject({ status: 'changed' });
  const resolved = context(fixture);
  expect(fixture.editor.undo()).toBe(true);
  const other = document.createElement('button'); other.className = 'first'; other.style.opacity = '.2';
  fixture.root.append(other); fixture.stage.refresh();
  const before = state(fixture);
  expect(fixture.editor.redo()).toBe(false);
  expect(state(fixture)).toEqual(before); expect(fixture.editor.canRedo).toBe(true);
  other.remove(); fixture.stage.refresh();
  expect(fixture.editor.redo()).toBe(true); expect(context(fixture)).toEqual(resolved);
});
