// packages/editor/src/core/editor/__tests__/Editor.hostTransactionLifecycle.test.ts
import { createObjectStage } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../createEditor';
import type { IHostHistoryEffect } from '../transactionTypes';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { captureContext, createContainer } from './fixtures';
import { setupHost, cleanupHosts, addStopRequest, positionRequest, attributeEffect, number, state, observeTransactions } from './hostTransactionFixtures';

afterEach(cleanupHosts);

it('revalidates legacy property permissions when undoing a mixed atomic group', () => {
  const object = { x: 0 };
  const stage = createObjectStage({ id: 'objects', unscoped: true,
    objects: [{ id: 'object', label: 'Object', object, properties: ['x'] }], apply: () => {} });
  const fixture = setupHost({ stage, data: createDoc([layer('objectLayer', [], { target: { ref: 'object' } })], 100) });
  const { editor } = fixture;
  const host = attributeEffect(fixture.element);
  const gesture = editor.propertyTimelines.beginTransaction('Mixed permission gesture');
  expect(editor.propertyTimelines.set('objectLayer', 'x', number(10), { frame: 50, initialValue: number(0) })).toEqual({ status: 'changed' });
  expect(editor.transactions.execute({ label: 'Host metadata', effect: host.effect })).toMatchObject({ status: 'changed' });
  expect(gesture.commit()).toBe(true);
  const changed = editor.document;
  stage.remove('object'); stage.add({ id: 'object', label: 'Object', object, properties: [] });
  expect(editor.undo()).toBe(false); expect(editor.document).toBe(changed);
  expect(fixture.element.getAttribute('data-designer')).toBe('edited'); expect(editor.canUndo).toBe(true);
  stage.remove('object'); stage.add({ id: 'object', label: 'Object', object, properties: ['x'] });
  expect(editor.undo()).toBe(true); expect(fixture.element.hasAttribute('data-designer')).toBe(false);
});

it('compensates an active mixed gesture before load and invalidates only the old transaction handle', () => {
  const fixture = setupHost();
  const { editor, element, stage } = fixture;
  const before = state(fixture);
  const host = attributeEffect(element);
  const old = editor.propertyTimelines.beginTransaction('Old gesture');
  expect(editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  const loaded = { ...before.document, settings: { ...before.document.settings, fps: 12 } };
  const observed: { readonly attribute: string | null; readonly context: typeof before.context }[] = [];
  editor.on('document:loaded', () => observed.push({ attribute: element.getAttribute('data-designer'), context: stage.animationContext }));
  editor.load(loaded);
  expect(editor.document).toBe(loaded); expect(stage.animationContext).toEqual(before.context);
  expect(element.hasAttribute('data-designer')).toBe(false); expect(host.journal).toEqual([]);
  expect(observed).toEqual([{ attribute: null, context: before.context }]);
  expect(old.active).toBe(false); expect(editor.canUndo).toBe(false); expect(editor.canRedo).toBe(false);
  const current = editor.propertyTimelines.beginTransaction('New gesture');
  expect(editor.transactions.execute(positionRequest(60))).toMatchObject({ status: 'changed' });
  const preview = state(fixture);
  expect(() => old.commit()).toThrow(); expect(() => old.cancel()).toThrow();
  expect(current.active).toBe(true); expect(state(fixture)).toEqual(preview);
  expect(current.commit()).toBe(true); expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(loaded);
});

it('compensates an active gesture before destruction and invalidates a retained transaction facade', () => {
  const fixture = setupHost();
  const { editor, stage, element } = fixture;
  const before = stage.animationContext;
  const transactions = editor.transactions;
  const host = attributeEffect(element);
  const gesture = editor.propertyTimelines.beginTransaction('Interrupted gesture');
  expect(transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  editor.destroy();
  expect(editor.isDestroyed).toBe(true); expect(gesture.active).toBe(false);
  expect(element.hasAttribute('data-designer')).toBe(false); expect(stage.animationContext).toEqual(before);
  expect(host.journal).toEqual([]);
  expect(() => gesture.cancel()).toThrow(); expect(() => transactions.execute(positionRequest(20))).toThrow();
  expect(() => editor.destroy()).not.toThrow();
});

it.each(['load', 'destroy'] as const)('refuses a reentrant %s from a partially applied effect and restores the previous live state', (action) => {
  const fixture = setupHost();
  const before = state(fixture);
  const host = attributeEffect(fixture.element, { afterApply: () => {
    if (action === 'load') fixture.editor.load({ ...before.document, settings: { ...before.document.settings, fps: 12 } });
    else fixture.editor.destroy();
  } });
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'refused' });
  expect(fixture.editor.isDestroyed).toBe(false); expect(state(fixture)).toEqual(before);
  expect(host.journal).toEqual([]); expect(host.pending).toEqual([]);
  expect(fixture.editor.transactions.fault).toBeUndefined();
});

it('honors a cancellable command veto without applying context, properties or a prepared host effect', () => {
  const capture = captureContext('test.hostTransactionVeto');
  const fixture = setupHost({ plugins: [capture.plugin] });
  const before = state(fixture);
  const host = attributeEffect(fixture.element);
  capture.context().events.onCancellable('command:before', (event) => event.cancel());
  const events = observeTransactions(fixture.editor);
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(host.journal).toEqual([]); expect(host.pending).toEqual([]);
  expect(events).toEqual([]);
});

it('rechecks live capabilities in both history directions while retaining the entry and host effect on refusal', () => {
  const object = { caption: '' };
  const stage = createObjectStage({ id: 'objects', unscoped: true,
    objects: [{ id: 'object', label: 'Object', object, properties: ['caption'] }], apply: () => {} });
  const fixture = setupHost({ stage, data: createDoc([layer('objectLayer', [], { target: { ref: 'object' } })], 100) });
  const { editor } = fixture;
  const host = attributeEffect(fixture.element);
  const permissions = (allowed: boolean) => {
    stage.remove('object'); stage.add({ id: 'object', label: 'Object', object, properties: allowed ? ['caption'] : [] });
  };
  expect(editor.transactions.execute({ label: 'Change caption and host attribute', properties: [
    { kind: 'set', layerId: 'objectLayer', property: 'caption', frame: 50,
      value: { kind: 'text', value: 'Hello' }, initialValue: { kind: 'text', value: '' } }
  ], effect: host.effect })).toMatchObject({ status: 'changed' });
  const changed = editor.document;
  permissions(false);
  expect(editor.undo()).toBe(false); expect(editor.document).toBe(changed); expect(editor.canUndo).toBe(true);
  expect(fixture.element.getAttribute('data-designer')).toBe('edited');
  permissions(true);
  expect(editor.undo()).toBe(true);
  const undone = editor.document;
  permissions(false);
  expect(editor.redo()).toBe(false); expect(editor.document).toBe(undone); expect(editor.canRedo).toBe(true);
  expect(fixture.element.hasAttribute('data-designer')).toBe(false);
  permissions(true);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(changed);
  expect(fixture.element.getAttribute('data-designer')).toBe('edited');
});

it('refuses a context mutation attempted during host preparation without losing the existing revision', () => {
  const fixture = setupHost();
  const before = state(fixture);
  const host = attributeEffect(fixture.element);
  const effect: IHostHistoryEffect = { prepare(direction) {
    const context = fixture.stage.animationContext;
    fixture.stage.setAnimationContext({ ...context, gradients: { ...context.gradients,
      gradient: context.gradients!.gradient.map((entry) => ({ ...entry, angle: 45 })) } });
    return host.effect.prepare(direction);
  } };
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, effect))).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(host.journal).toEqual([]);
});

it('uses explicit property frames even when the playhead changes before the request executes', () => {
  const fixture = setupHost();
  fixture.seek(20);
  const request = addStopRequest(fixture);
  fixture.seek(80);
  expect(fixture.editor.transactions.execute(request)).toMatchObject({ status: 'changed' });
  expect(fixture.editor.sample(49).layer('gradient')?.propertyValues?.middlePresent).toEqual({ kind: 'boolean', value: false });
  expect(fixture.editor.sample(50).layer('gradient')?.propertyValues?.middlePresent).toEqual({ kind: 'boolean', value: true });
  expect(fixture.editor.sample(80).layer('gradient')?.propertyValues?.middlePosition).toEqual(number(60));
});

it('keeps generic property transactions independent of HTML and records a reversible non-DOM host effect', () => {
  const object = { x: 0, y: 0 };
  const stage = createObjectStage({ id: 'objects', unscoped: true,
    objects: [{ id: 'object', label: 'Generic object', object, properties: ['x', 'y'] }], apply: () => {} });
  const editor = createEditor(createContainer(), { stage, defaultPlugins: false,
    data: createDoc([layer('objectLayer', [], { target: { ref: 'object' } })], 100) });
  const host = { state: 'original' };
  const effect: IHostHistoryEffect = { prepare(direction) {
    const before = host.state;
    const target = direction === 'undo' ? 'original' : 'modified';
    return { changed: before !== target, apply: () => { host.state = target; }, rollback: () => { host.state = before; } };
  } };
  try {
    const original = editor.document;
    const events = observeTransactions(editor);
    expect(editor.transactions.execute({ label: 'Update generic object', properties: [
      { kind: 'set', layerId: 'objectLayer', property: 'x', frame: 50, value: number(20), initialValue: number(0) },
      { kind: 'set', layerId: 'objectLayer', property: 'y', frame: 50, value: number(30), initialValue: number(0) }
    ], effect })).toMatchObject({ status: 'changed' });
    const changed = editor.document;
    expect(editor.sample(49).layer('objectLayer')?.propertyValues).toEqual({ x: number(0), y: number(0) });
    expect(editor.sample(50).layer('objectLayer')?.propertyValues).toEqual({ x: number(20), y: number(30) });
    expect(host.state).toBe('modified'); expect(events).toHaveLength(1);
    expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original); expect(host.state).toBe('original');
    expect(editor.canUndo).toBe(false);
    expect(editor.redo()).toBe(true); expect(editor.document).toEqual(changed); expect(host.state).toBe('modified');
  } finally { editor.destroy(); }
});
