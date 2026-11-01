// packages/editor/src/core/editor/__tests__/Editor.finalCandidateConflictInput.test.ts
import type { EditorTransactionResult, IHtmlConflictTransactionRequest } from '../../../index';
import { cleanupConflicts, context, resolveRequest, seedRedo, setupConflict, state } from './finalCandidateConflictFixtures';

afterEach(cleanupConflicts);

it.each([null, undefined])('refuses an absent conflict request (%s) without changing state or redo', (input) => {
  const fixture = setupConflict(undefined, true);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture);
  const journal = [...fixture.journal];
  expect(fixture.editor.transactions.resolveHtmlConflict(input as unknown as IHtmlConflictTransactionRequest))
    .toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
  expect(fixture.journal).toEqual(journal);
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.editor.document).toEqual(previousRedo);
});

it('refuses a throwing input getter and prevents its nested mutation before reading the request', () => {
  const fixture = setupConflict(undefined, true);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture);
  const journal = [...fixture.journal];
  let nested: EditorTransactionResult | undefined;
  const request: IHtmlConflictTransactionRequest = { ...resolveRequest(fixture), get label(): string {
    nested = fixture.editor.transactions.execute({ label: 'Unwanted nested edit', commands: [{ label: 'Change frame rate',
      do: (document) => ({ ...document, settings: { ...document.settings, fps: 48 } }), undo: () => before.document
    }] });
    throw new Error('Input getter failed');
  } };
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'refused', reason: 'Input getter failed' });
  expect(nested).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
  expect(fixture.journal).toEqual(journal);
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.editor.document).toEqual(previousRedo);
});

it('ignores foreign transaction fields instead of executing or reading their injected participants', () => {
  const fixture = setupConflict(undefined, true);
  const before = state(fixture);
  const injected = jest.fn(() => { throw new Error('Foreign transaction field was read'); });
  const request = { ...resolveRequest(fixture), get commands() { return injected(); },
    get effect() { return injected(); }, get htmlContext() { return injected(); } };
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
  expect(injected).not.toHaveBeenCalled();
  expect(fixture.editor.document.settings).toEqual(before.document.settings);
  expect(fixture.editor.undo()).toBe(true);
  expect(state(fixture)).toEqual({ ...before, canRedo: true });
});

it('refuses the initially missing guard even when an accessor would later supply one', () => {
  const fixture = setupConflict(undefined, true);
  const previousRedo = seedRedo(fixture);
  const before = state(fixture);
  const guard = jest.fn(() => true);
  let reads = 0;
  const request = { ...resolveRequest(fixture), get isCurrent() { return ++reads === 1 ? undefined : guard; } };
  expect(fixture.editor.transactions.resolveHtmlConflict(request as unknown as IHtmlConflictTransactionRequest))
    .toMatchObject({ status: 'refused' });
  expect(reads).toBe(1);
  expect(guard).not.toHaveBeenCalled();
  expect(state(fixture)).toEqual(before);
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.editor.document).toEqual(previousRedo);
});

it('uses the first confirmed winner and ticket when their accessors change on subsequent reads', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  const base = resolveRequest(fixture);
  const reads = { id: 0, signature: 0, winner: 0, guard: 0 };
  const guard = jest.fn(() => true);
  const request: IHtmlConflictTransactionRequest = { ...base,
    confirmation: {
      get id() { return ++reads.id === 1 ? base.confirmation.id : 'changed-id'; },
      get signature() { return ++reads.signature === 1 ? base.confirmation.signature : 'changed-signature'; }
    },
    get winnerLayerId() { return ++reads.winner === 1 ? 'first' : 'second'; },
    get isCurrent() { reads.guard++; return guard; }
  };
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
  expect(context(fixture).resolutions?.[0].winnerLayerId).toBe('first');
  expect(reads).toEqual({ id: 1, signature: 1, winner: 1, guard: 1 });
  expect(guard.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(fixture.editor.undo()).toBe(true);
  expect(state(fixture)).toEqual({ ...before, canRedo: true });
});

it('keeps the owned confirmation when host callbacks mutate the original request', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  const base = resolveRequest(fixture);
  const request = { ...base, confirmation: { ...base.confirmation }, isCurrent: () => {
    request.confirmation.signature = 'changed-in-guard';
    request.winnerLayerId = 'second';
    return true;
  } };
  fixture.editor.on('command:before', () => {
    request.confirmation.id = 'changed-before-command';
    request.winnerLayerId = 'unknown';
  });
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
  expect(context(fixture).resolutions?.[0].winnerLayerId).toBe('first');
  expect(fixture.editor.undo()).toBe(true);
  expect(state(fixture)).toEqual({ ...before, canRedo: true });
});
