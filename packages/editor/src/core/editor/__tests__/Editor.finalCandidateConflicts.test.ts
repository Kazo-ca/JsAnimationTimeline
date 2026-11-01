// packages/editor/src/core/editor/__tests__/Editor.finalCandidateConflicts.test.ts
import { evaluatePropertyTimeline, resolveHtmlConflict } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IPropertyTimeline } from '@kazo-ca/timeline-runtime';
import { cleanupConflicts, conflictDocument, context, diagnostic, layer, number, property, resolveRequest,
  setupConflict, state, track } from './finalCandidateConflictFixtures';

afterEach(cleanupConflicts);

it('commits an explicit conflict decision and its advertised key in one public transaction', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  const originalDiagnostic = diagnostic(fixture);
  const request = resolveRequest(fixture);
  const savedRequest = JSON.stringify(request);
  expect(fixture.editor.transactions.resolveHtmlConflict(request)).toMatchObject({ status: 'changed' });
  expect(property(fixture)?.keys).toEqual([{ frame: 1, value: number(.3) }, { frame: 20, value: number(.5) }]);
  expect(property(fixture, 'second')).toEqual(track(.7));
  expect(fixture.stage.diagnostics).toEqual([]);
  const finalDiagnostic = diagnostic(setupConflict(fixture.editor.document));
  expect(finalDiagnostic.signature).not.toBe(originalDiagnostic.signature);
  expect(context(fixture)).toEqual(resolveHtmlConflict(before.context, finalDiagnostic, 'first'));
  expect(JSON.stringify(request)).toBe(savedRequest);
  const changed = state(fixture);
  expect(fixture.editor.undo()).toBe(true);
  expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(diagnostic(fixture)).toEqual(originalDiagnostic);
  expect(fixture.editor.undo()).toBe(false);
  expect(fixture.editor.redo()).toBe(true);
  expect(state(fixture)).toEqual(changed);
});

it('continues to refuse an old saved resolution passed through the HA8 API with edited keys', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  const resolved = resolveHtmlConflict(context(fixture), diagnostic(fixture), 'first');
  expect(fixture.editor.transactions.execute({ label: 'Choose first rule and set advertised key',
    htmlContext: { stageId: fixture.stage.id, context: resolved },
    properties: [{ kind: 'set', layerId: 'first', property: 'opacity', frame: 20, value: number(.5) }]
  })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it('accepts advertised keys that make priority contenders equivalent without saving a needless decision', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  const original = diagnostic(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { properties: [
    { kind: 'set', layerId: 'first', property: 'opacity', frame: 1, value: number(.7) }
  ] }))).toMatchObject({ status: 'changed' });
  expect(context(fixture).resolutions ?? []).toEqual([]); expect(fixture.stage.diagnostics).toEqual([]);
  expect(property(fixture)).toEqual(property(fixture, 'second'));
  const changed = state(fixture);
  expect(fixture.editor.undo()).toBe(true); expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(diagnostic(fixture)).toEqual(original);
  expect(fixture.editor.redo()).toBe(true); expect(state(fixture)).toEqual(changed);
});

it('records a decision without adding an implicit key when the choice advertises no writes', () => {
  const fixture = setupConflict();
  const before = state(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { properties: [] }))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.document).toEqual(before.document);
  expect(context(fixture).resolutions).toHaveLength(1);
  expect(fixture.editor.undo()).toBe(true);
  expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.editor.document).toEqual(before.document);
});

it('keeps case 59 automatic and rejects a fabricated confirmation without adding keys', () => {
  const fixture = setupConflict(conflictDocument([
    layer('all', '.button', track(.5)), layer('specific', '#specific', track(.8, 50))
  ]));
  expect(fixture.stage.diagnostics).toEqual([]);
  const before = state(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict({ label: 'Unnecessary choice', stageId: fixture.stage.id,
    confirmation: { id: 'absent-conflict', signature: 'absent-signature' }, winnerLayerId: 'specific',
    isCurrent: () => true
  })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
  expect(property(fixture, 'specific')?.keys).toEqual([{ frame: 50, value: number(.8) }]);
});

it('does not save a stale prefix decision when advertised initial keys remove its ambiguity', () => {
  const fixture = setupConflict(conflictDocument([
    layer('all', '.button', { initialValue: number(1), keys: [{ frame: 1, value: number(.5) }, { frame: 20, value: number(.4) }] }),
    layer('specific', '#specific', track(.8, 50))
  ]));
  const conflict = diagnostic(fixture, 'before-first-conflict');
  const before = state(fixture);
  expect(fixture.editor.transactions.resolveHtmlConflict({ label: 'Create the announced first key', stageId: fixture.stage.id,
    confirmation: { id: conflict.id, signature: conflict.signature }, winnerLayerId: 'specific', beforeFirst: 'initial',
    properties: [{ kind: 'set', layerId: 'specific', property: 'opacity', frame: 1, value: number(1) }], isCurrent: () => true
  })).toMatchObject({ status: 'changed' });
  expect(context(fixture).resolutions ?? []).toEqual([]);
  expect(fixture.stage.diagnostics).toEqual([]);
  expect(property(fixture, 'specific')?.keys).toEqual([{ frame: 1, value: number(1) }, { frame: 50, value: number(.8) }]);
  expect(fixture.editor.undo()).toBe(true);
  expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(diagnostic(fixture, 'before-first-conflict')).toEqual(conflict);
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.stage.diagnostics).toEqual([]);
});

it('resolves differently named property aliases against the same CSS destination', () => {
  const html: IHtmlAnimationContext = { version: 1, bindings: {
    first: { fade: { kind: 'style', cssName: 'opacity' } },
    second: { transparency: { kind: 'style', cssName: 'opacity' } }
  } };
  const fixture = setupConflict(conflictDocument([
    { ...layer('first', '.first', track(.3)), propertyTimelines: { fade: track(.3) } },
    { ...layer('second', '.second', track(.7)), propertyTimelines: { transparency: track(.7) } }
  ]), false, html);
  const before = state(fixture);
  const conflict = diagnostic(fixture);
  expect(conflict.contributions).toEqual([{ layerId: 'first', property: 'fade' }, { layerId: 'second', property: 'transparency' }]);
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { winnerLayerId: 'second', properties: [
    { kind: 'set', layerId: 'second', property: 'transparency', frame: 20, value: number(.6) }
  ] }))).toMatchObject({ status: 'changed' });
  const finalDiagnostic = diagnostic(setupConflict(fixture.editor.document, false, html));
  expect(context(fixture)).toEqual(resolveHtmlConflict(html, finalDiagnostic, 'second'));
  expect(fixture.stage.diagnostics).toEqual([]);
  expect(fixture.editor.undo()).toBe(true); expect(state(fixture)).toEqual({ ...before, canRedo: true });
  expect(fixture.editor.redo()).toBe(true);
});

it('returns detached contributor metadata that cannot change the engine permission check', () => {
  const fixture = setupConflict();
  const original = diagnostic(fixture);
  const contributions = original.contributions as { layerId: string; property: string }[];
  expect(contributions).toHaveLength(2);
  contributions[0].property = 'width'; contributions[0].layerId = 'forged';
  expect(diagnostic(fixture).contributions).toEqual([
    { layerId: 'first', property: 'opacity' }, { layerId: 'second', property: 'opacity' }
  ]);
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.redo()).toBe(true);
});

it('checks the host source-style guard before and after rendering instead of comparing its animated preview', () => {
  const fixture = setupConflict(undefined, true);
  fixture.seek(20); fixture.element.style.opacity = '.6';
  const observed: string[] = [];
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { isCurrent: () => {
    const opacity = getComputedStyle(fixture.element).opacity;
    observed.push(opacity); return opacity === '1';
  } }))).toMatchObject({ status: 'changed' });
  expect(observed.length).toBeGreaterThanOrEqual(3);
  expect(observed.every((value) => value === '1')).toBe(true);
  expect(fixture.element.style.opacity).toBe('0.5');
  expect(fixture.editor.undo()).toBe(true); expect(fixture.element.style.opacity).toBe('1');
  expect(fixture.editor.redo()).toBe(true); expect(fixture.element.style.opacity).toBe('0.5');
});

it('uses the shortened final prefix and its real signature after adding an earlier announced key', () => {
  const data = conflictDocument([
    layer('all', '.button', { initialValue: number(1), keys: [{ frame: 1, value: number(.5) }, { frame: 10, value: number(.4) }] }),
    layer('specific', '#specific', track(.8, 50))
  ]);
  const fixture = setupConflict(data);
  const original = diagnostic(fixture, 'before-first-conflict');
  expect(original.toFrame).toBe(50);
  expect(fixture.editor.transactions.resolveHtmlConflict({ label: 'Shorten the unresolved prefix', stageId: fixture.stage.id,
    confirmation: { id: original.id, signature: original.signature }, winnerLayerId: 'specific', beforeFirst: 'underlying',
    properties: [{ kind: 'set', layerId: 'specific', property: 'opacity', frame: 20, value: number(.9) }], isCurrent: () => true
  })).toMatchObject({ status: 'changed' });
  const final = diagnostic(setupConflict(fixture.editor.document), 'before-first-conflict');
  expect(final.toFrame).toBe(20); expect(final.toFrameExclusive).toBe(true);
  expect(final.signature).not.toBe(original.signature);
  expect(context(fixture)).toEqual(resolveHtmlConflict({ version: 1 }, final, 'specific', 'underlying'));
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.document).toEqual(data);
  expect(fixture.editor.redo()).toBe(true); expect(fixture.stage.diagnostics).toEqual([]);
});

it.each(['evaluated', 'edited'] as const)('preserves normal MotionTween splitting for an announced %s key value', (mode) => {
  const tween: IPropertyTimeline = { initialValue: number(1), keys: [{ frame: 1, value: number(.3) }, { frame: 100, value: number(.9) }],
    transitions: [{ id: 'curve', fromFrame: 1, toFrame: 100, easing: { kind: 'effect', family: 'quadratic', mode: 'in' } }] };
  const first = layer('first', '.first', tween);
  const fixture = setupConflict(conflictDocument([first, layer('second', '.second', track(.7))]));
  const ordinary = setupConflict(conflictDocument([first]));
  const evaluated = evaluatePropertyTimeline(tween, 20);
  const value = mode === 'edited' ? number(.5) : evaluated;
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('Missing evaluated MotionTween value');
  expect(ordinary.editor.propertyTimelines.set('first', 'opacity', value, { frame: 20 })).toMatchObject({ status: 'changed' });
  expect(fixture.editor.transactions.resolveHtmlConflict(resolveRequest(fixture, { properties: [
    { kind: 'set', layerId: 'first', property: 'opacity', frame: 20, value }
  ] }))).toMatchObject({ status: 'changed' });
  expect(property(fixture)).toEqual(property(ordinary));
  expect(property(fixture)?.transitions).toHaveLength(2);
  expect(property(fixture)?.transitions?.every((transition) => mode === 'evaluated' ? transition.source !== undefined : transition.source === undefined)).toBe(true);
  const after = property(fixture);
  expect(fixture.editor.undo()).toBe(true); expect(property(fixture)).toEqual(tween);
  expect(fixture.editor.redo()).toBe(true); expect(property(fixture)).toEqual(after);
});
