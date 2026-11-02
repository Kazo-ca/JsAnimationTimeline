// packages/editor/src/core/editor/__tests__/Editor.hostTransactions.test.ts
import type { IHtmlAnimationContext, ITimelineDocument } from '@kazo-ca/timeline-runtime';
import type { ICommand } from '../../commands/ICommand';
import { layer } from '../../../model/spans/__tests__/fixtures';
import { setupHost, cleanupHosts, addStopRequest, contextWithStop, attributeEffect, boolean, number, track, state,
  observeTransactions } from './hostTransactionFixtures';

afterEach(cleanupHosts);

it('adds the stop structure, bindings, independent keys and host effect as one reversible entry', () => {
  const fixture = setupHost();
  const { editor, stage, seek, element } = fixture;
  seek(50);
  const before = state(fixture);
  const host = attributeEffect(element);
  const events = observeTransactions(editor);

  expect(editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  const changed = state(fixture);
  expect(stage.animationContext.gradients?.gradient?.[0].stops.map((stop) => stop.id)).toEqual(['left', 'right', 'middle']);
  expect(track(fixture, 'middlePresent')).toMatchObject({ initialValue: boolean(false), keys: [{ frame: 50, value: boolean(true) }] });
  expect(track(fixture, 'middlePosition')).toMatchObject({ initialValue: number(50), keys: [{ frame: 50, value: number(60) }] });
  expect(element.style.backgroundImage).toContain('rgba(0, 255, 0, 1) 60%');
  expect(element.getAttribute('data-designer')).toBe('edited');
  expect(host.journal).toEqual([{ fullXPath: '/html/body/main/div[1]', attribute: 'data-designer', oldValue: null, newValue: 'edited' }]);
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ label: 'Add gradient stop', phase: 'commit', cause: 'execute' });
  seek(49); expect(element.style.backgroundImage).not.toContain('rgba(0, 255, 0,');
  seek(50); expect(element.style.backgroundImage).toContain('rgba(0, 255, 0, 1) 60%');

  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before.document);
  expect(stage.animationContext).toEqual(before.context);
  expect(element.hasAttribute('data-designer')).toBe(false);
  expect(host.journal).toEqual([]);
  expect(editor.canUndo).toBe(false);
  expect(editor.redo()).toBe(true);
  expect(editor.document).toEqual(changed.document);
  expect(stage.animationContext).toEqual(changed.context);
  expect(fixture.root.innerHTML).toBe(changed.dom);
  expect(events.map((event) => event.cause)).toEqual(['execute', 'undo', 'redo']);
  expect(fixture.errors).toEqual([]);
});

it('creates a target object, its ID and first key atomically without renaming existing targets', () => {
  const fixture = setupHost();
  const { editor, orphan, element, stage, seek } = fixture;
  seek(50);
  const before = state(fixture);
  const object = layer('newObject', [], { target: { selector: '#new-target' } });
  const createObject: ICommand = { label: 'Create object',
    do: (doc) => ({ ...doc, layers: [...doc.layers, object] }),
    undo: (doc) => ({ ...doc, layers: doc.layers.filter((entry) => entry.id !== object.id) }) };
  const host = attributeEffect(orphan, { attribute: 'id', value: 'new-target', fullXPath: '/html/body/main/div[2]' });
  expect(editor.transactions.execute({ label: 'Create object and opacity key', commands: [createObject], effect: host.effect,
    properties: [{ kind: 'set', layerId: 'newObject', property: 'opacity', frame: 50, value: number(.4), initialValue: number(.8) }]
  })).toMatchObject({ status: 'changed' });
  const changed = editor.document;
  expect(orphan.id).toBe('new-target'); expect(element.id).toBe('gradient');
  expect(host.journal).toEqual([{ fullXPath: '/html/body/main/div[2]', attribute: 'id', oldValue: null, newValue: 'new-target' }]);
  expect(orphan.style.opacity).toBe('0.4');
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before.document);
  expect(orphan.hasAttribute('id')).toBe(false); expect(orphan.style.opacity).toBe('0.8');
  expect(editor.canUndo).toBe(false);
  expect(editor.redo()).toBe(true);
  expect(editor.document).toEqual(changed); expect(orphan.id).toBe('new-target'); expect(orphan.style.opacity).toBe('0.4');
});

it('records a context-only change and keeps a deeply equal context as a no-op', () => {
  const fixture = setupHost();
  const { editor, stage } = fixture;
  const doc = editor.document;
  const original = stage.animationContext;
  const context = contextWithStop(original);
  const events = observeTransactions(editor);
  expect(editor.transactions.execute({ label: 'Prepare stop', htmlContext: { stageId: stage.id, context } })).toMatchObject({ status: 'changed' });
  expect(editor.document).toBe(doc);
  expect(stage.animationContext).toEqual(context);
  expect(editor.undo()).toBe(true); expect(stage.animationContext).toEqual(original);
  expect(editor.canRedo).toBe(true);
  const equalContext: IHtmlAnimationContext = JSON.parse(JSON.stringify(original));
  expect(editor.transactions.execute({ label: 'Same context', htmlContext: { stageId: stage.id, context: equalContext } })).toEqual({ status: 'noop' });
  expect(events.map((event) => event.cause)).toEqual(['execute', 'undo']);
  expect(editor.canRedo).toBe(true);
  expect(editor.redo()).toBe(true); expect(stage.animationContext).toEqual(context);
});

it('records an effect-only entry and preserves redo for an unchanged prepared effect', () => {
  const fixture = setupHost();
  const { editor, element } = fixture;
  const original = editor.document;
  const host = attributeEffect(element);
  const events = observeTransactions(editor);
  expect(editor.transactions.execute({ label: 'Change source attribute', effect: host.effect })).toMatchObject({ status: 'changed' });
  expect(editor.document).toBe(original); expect(element.getAttribute('data-designer')).toBe('edited');
  expect(editor.undo()).toBe(true);
  expect(element.hasAttribute('data-designer')).toBe(false); expect(editor.canRedo).toBe(true);
  const apply = jest.fn();
  const rollback = jest.fn();
  expect(editor.transactions.execute({ label: 'Nothing changed', effect: { prepare: () => ({ changed: false, apply, rollback }) } })).toEqual({ status: 'noop' });
  expect(apply).not.toHaveBeenCalled(); expect(rollback).not.toHaveBeenCalled();
  expect(editor.transactions.execute({ label: 'Empty operation' })).toEqual({ status: 'noop' });
  expect(editor.canRedo).toBe(true); expect(editor.canUndo).toBe(false);
  expect(events).toHaveLength(2);
  expect(editor.redo()).toBe(true); expect(element.getAttribute('data-designer')).toBe('edited');
});

it('validates the final gradient when replacing a point rather than rejecting a temporary one-stop candidate', () => {
  const fixture = setupHost();
  const { editor, element, seek, stage } = fixture;
  seek(50);
  const before = state(fixture);
  const request = addStopRequest(fixture);
  expect(editor.transactions.execute({ ...request, label: 'Replace the left stop', properties: [
    { kind: 'set', layerId: 'gradient', property: 'leftPresent', frame: 50, value: boolean(false), initialValue: boolean(true) },
    ...(request.properties ?? [])
  ] })).toMatchObject({ status: 'changed' });
  expect(element.style.backgroundImage).not.toContain('rgba(255, 0, 0,');
  expect(element.style.backgroundImage).toContain('rgba(0, 255, 0, 1) 60%');
  expect(element.style.backgroundImage).toContain('rgba(0, 0, 255, 1) 100%');
  expect(stage.diagnostics).toEqual([]);
  seek(49);
  expect(element.style.backgroundImage).toContain('rgba(255, 0, 0, 1) 0%');
  expect(element.style.backgroundImage).not.toContain('rgba(0, 255, 0,');
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before.document); expect(stage.animationContext).toEqual(before.context);
  expect(editor.redo()).toBe(true); seek(50);
  expect(stage.diagnostics).toEqual([]); expect(element.style.backgroundImage).toContain('rgba(0, 255, 0, 1) 60%');
});

it('owns caller values and gradient definitions so later mutations cannot rewrite undo or redo', () => {
  const fixture = setupHost();
  const request = addStopRequest(fixture);
  const suppliedContext = request.htmlContext!.context;
  const stops = suppliedContext.gradients!.gradient[0].stops.map((stop) => ({ ...stop, color: { ...stop.color } }));
  const gradient = { ...suppliedContext.gradients!.gradient[0], stops };
  const context: IHtmlAnimationContext = { ...suppliedContext, gradients: { gradient: [gradient] } };
  const value = { kind: 'number' as const, value: 60 };
  expect(fixture.editor.transactions.execute({ ...request, htmlContext: { stageId: fixture.stage.id, context }, properties: [
    { kind: 'set', layerId: 'gradient', property: 'middlePosition', frame: 50, value, initialValue: number(50) }
  ] })).toMatchObject({ status: 'changed' });
  const committed = state(fixture);
  stops[2].id = 'changed-id'; stops[2].position = 2; value.value = 99;
  expect(state(fixture)).toEqual(committed);
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.redo()).toBe(true);
  expect(state(fixture)).toEqual(committed);
  expect(track(fixture, 'middlePosition')?.keys).toEqual([{ frame: 50, value: number(60) }]);
});

it('reloads the editable document and separate HTML context with the same identities and before-first behavior', () => {
  const fixture = setupHost();
  expect(fixture.editor.transactions.execute(addStopRequest(fixture))).toMatchObject({ status: 'changed' });
  const serialized = JSON.stringify({ document: fixture.editor.toJSON(), context: fixture.stage.animationContext });
  const saved: { document: ITimelineDocument; context: IHtmlAnimationContext } = JSON.parse(serialized);
  const restored = setupHost({ data: saved.document }, saved.context);
  expect(restored.stage.animationContext).toEqual(fixture.stage.animationContext);
  expect(restored.editor.document).toEqual(fixture.editor.document);
  restored.seek(49);
  expect(restored.element.style.backgroundImage).not.toContain('rgba(0, 255, 0,');
  restored.seek(50);
  expect(restored.element.style.backgroundImage).toContain('rgba(0, 255, 0, 1) 60%');
  expect(restored.editor.canUndo).toBe(false); expect(restored.errors).toEqual([]);
});
