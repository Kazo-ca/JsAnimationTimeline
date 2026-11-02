// packages/editor/src/core/editor/__tests__/Editor.hostTransactionFailures.test.ts
import { resolveHtmlConflict } from '@kazo-ca/timeline-runtime';
import type { IHostHistoryEffect } from '../transactionTypes';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { createEditor } from '../createEditor';
import { createEditorHtmlStage } from '../../stage/editorHtmlStage';
import { createContainer } from './fixtures';
import type { ICommand } from '../../commands/ICommand';
import { CommandRefusedError } from '../../commands/CommandRefusedError';
import { setupHost, cleanupHosts, addStopRequest, positionRequest, attributeEffect, boolean, number, state,
  observeTransactions } from './hostTransactionFixtures';

afterEach(cleanupHosts);

it.each([false, true])('refuses a live target without freezing its DOM node (intermediate command: %s)', (intermediate) => {
  const fixture = setupHost();
  const before = state(fixture);
  const live = document.createElement('div');
  const createLive: ICommand = { label: 'Introduce live target',
    do: (doc) => ({ ...doc, layers: [...doc.layers, layer('live', [], { target: { element: live } })] }),
    undo: (doc) => ({ ...doc, layers: doc.layers.filter((entry) => entry.id !== 'live') }) };
  const removeLive: ICommand = { label: 'Remove live target', do: createLive.undo, undo: createLive.do };
  expect(fixture.editor.transactions.execute({ label: 'Unsafe host target', commands: intermediate ? [createLive, removeLive] : [createLive] }))
    .toMatchObject({ status: 'refused' });
  expect(Object.isFrozen(live)).toBe(false);
  expect(state(fixture)).toEqual(before); expect(fixture.editor.transactions.fault).toBeUndefined();
  live.id = 'still-owned-by-host'; expect(live.id).toBe('still-owned-by-host');
});

it.each(['undo', 'redo'] as const)('refuses an unsafe documentary %s result without freezing the host node', (direction) => {
  const fixture = setupHost();
  const live = document.createElement('div');
  let unsafe = false;
  const withLive = (doc: typeof fixture.editor.document) => ({ ...doc,
    layers: [...doc.layers, layer('live', [], { target: { element: live } })] });
  const command: ICommand = { label: 'Guard replay result',
    do: (doc) => unsafe ? withLive(doc) : ({ ...doc, settings: { ...doc.settings, fps: 12 } }),
    undo: (doc) => unsafe ? withLive(doc) : ({ ...doc, settings: { ...doc.settings, fps: 24 } }) };
  expect(fixture.editor.transactions.execute({ label: command.label, commands: [command] })).toMatchObject({ status: 'changed' });
  if (direction === 'redo') expect(fixture.editor.undo()).toBe(true);
  const before = state(fixture);
  unsafe = true;
  expect(fixture.editor[direction]()).toBe(false);
  expect(Object.isFrozen(live)).toBe(false); expect(state(fixture)).toEqual(before);
});

function seedRedo(fixture: ReturnType<typeof setupHost>) {
  expect(fixture.editor.propertyTimelines.set('gradient', 'rightPosition', number(80), { frame: 10, initialValue: number(100) })).toEqual({ status: 'changed' });
  const previous = fixture.editor.document;
  expect(fixture.editor.undo()).toBe(true);
  return previous;
}

it('refuses a second invalid operation without partial keys, structure, DOM effects, success events or lost redo', () => {
  const fixture = setupHost();
  const oldRedo = seedRedo(fixture);
  const before = state(fixture);
  const host = attributeEffect(fixture.element);
  const events = observeTransactions(fixture.editor);
  const request = addStopRequest(fixture, host.effect);
  expect(fixture.editor.transactions.execute({ ...request, properties: [
    ...(request.properties ?? []),
    { kind: 'set', layerId: 'gradient', property: 'rightPosition', frame: 101, value: number(50), initialValue: number(100) }
  ] })).toMatchObject({ status: 'refused', reason: expect.any(String) });
  expect(state(fixture)).toEqual(before); expect(host.journal).toEqual([]); expect(host.pending).toEqual([]);
  expect(events).toEqual([]); expect(fixture.editor.transactions.fault).toBeUndefined();
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(oldRedo);
});

it('rejects a temporary invalid interval even when the final selected frame would have two points', () => {
  const fixture = setupHost();
  fixture.seek(50);
  const before = state(fixture);
  const request = addStopRequest(fixture);
  expect(fixture.editor.transactions.execute({ ...request, properties: [
    { kind: 'set', layerId: 'gradient', property: 'leftPresent', frame: 10, value: boolean(false), initialValue: boolean(true) },
    ...(request.properties ?? [])
  ] })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before);
});

it('compensates a partially applied DOM attribute, Full XPath journal and pending host notification buffer', () => {
  const fixture = setupHost();
  const oldRedo = seedRedo(fixture);
  const before = state(fixture);
  const trace: string[] = [];
  const host = attributeEffect(fixture.element, { trace, afterApply: () => { throw new Error('Host apply failed after writing'); } });
  const events = observeTransactions(fixture.editor);
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'refused' });
  expect(trace).toEqual(['data-designer:execute:apply', 'data-designer:execute:rollback']);
  expect(state(fixture)).toEqual(before); expect(host.journal).toEqual([]); expect(host.pending).toEqual([]);
  expect(events).toEqual([]); expect(fixture.editor.transactions.fault).toBeUndefined();
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(oldRedo);
});

it.each(['false', 'throw', 'stale'] as const)('refuses a %s guard before committing any part of the request', (kind) => {
  const fixture = setupHost();
  const oldRedo = seedRedo(fixture);
  const before = state(fixture);
  const host = attributeEffect(fixture.element);
  let calls = 0;
  const isCurrent = () => {
    calls++;
    if (kind === 'throw') throw new Error('Selection disposed');
    return kind === 'stale' && calls === 1;
  };
  expect(fixture.editor.transactions.execute({ ...addStopRequest(fixture, host.effect), isCurrent })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(host.journal).toEqual([]); expect(host.pending).toEqual([]);
  if (kind === 'stale') expect(calls).toBeGreaterThanOrEqual(2);
  expect(fixture.editor.redo()).toBe(true); expect(fixture.editor.document).toEqual(oldRedo);
});

it('does not replay the original selection guard during undo or redo', () => {
  const fixture = setupHost();
  let current = true;
  expect(fixture.editor.transactions.execute({ ...addStopRequest(fixture), isCurrent: () => current })).toMatchObject({ status: 'changed' });
  const changed = state(fixture);
  current = false;
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.redo()).toBe(true);
  expect(state(fixture)).toEqual(changed);
});

it('refuses a history replay when the context was changed externally instead of overwriting that newer context', () => {
  const fixture = setupHost();
  expect(fixture.editor.transactions.execute(addStopRequest(fixture))).toMatchObject({ status: 'changed' });
  const originalContext = fixture.stage.animationContext;
  const gradients = originalContext.gradients!;
  fixture.stage.setAnimationContext({ ...originalContext, gradients: { ...gradients,
    gradient: gradients.gradient.map((entry) => ({ ...entry, angle: 45 })) } });
  const before = state(fixture);
  expect(fixture.editor.undo()).toBe(false);
  expect(state(fixture)).toEqual(before); expect(fixture.editor.canUndo).toBe(true);
});

it('exposes a failed compensation as a fault and blocks edits and history without pretending load repairs host state', () => {
  const fixture = setupHost();
  const before = state(fixture);
  const host = attributeEffect(fixture.element, {
    afterApply: () => { throw new Error('Partial write'); },
    beforeRollback: () => { throw new Error('Host rollback unavailable'); }
  });
  const events = observeTransactions(fixture.editor);
  const result = fixture.editor.transactions.execute(addStopRequest(fixture, host.effect));
  expect(result).toMatchObject({ status: 'faulted', fault: { message: expect.any(String), participantIds: expect.any(Array) } });
  expect(fixture.editor.transactions.fault).toBeDefined();
  expect(events).toEqual([]);
  const faulted = state(fixture);
  expect(fixture.editor.transactions.execute(positionRequest(30)).status).toBe('faulted');
  expect(() => fixture.editor.propertyTimelines.set('gradient', 'rightPosition', number(30), { initialValue: number(100) })).toThrow();
  expect(() => fixture.editor.undo()).toThrow(); expect(() => fixture.editor.redo()).toThrow();
  expect(() => fixture.editor.execute({ label: 'Blocked legacy command', do: (doc) => doc, undo: (doc) => doc })).toThrow();
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
  expect(() => fixture.editor.load(before.document)).toThrow();
  expect(state(fixture)).toEqual(faulted); expect(fixture.editor.transactions.fault).toBeDefined();
  expect(() => fixture.editor.destroy()).not.toThrow(); expect(fixture.editor.isDestroyed).toBe(true);
  // Recovery is explicit host work; loading only the temporal document cannot do it.
  fixture.element.removeAttribute('data-designer'); host.journal.length = 0; host.pending.length = 0;
  const container = createContainer();
  const restoredStage = createEditorHtmlStage(container, { root: fixture.root, animationContext: before.context });
  const restored = createEditor(container, { stage: restoredStage, data: before.document, defaultPlugins: false });
  try {
    expect(restored.transactions.fault).toBeUndefined();
    expect(restored.transactions.execute(positionRequest(70))).toMatchObject({ status: 'changed' });
    expect(restored.undo()).toBe(true); expect(restored.document).toEqual(before.document);
  } finally { restored.destroy(); }
});

it('keeps the previous history entry when a reversible host effect cannot prepare undo', () => {
  const fixture = setupHost();
  let refuseUndo = true;
  const host = attributeEffect(fixture.element);
  const effect: IHostHistoryEffect = { prepare(direction) {
    if (direction === 'undo' && refuseUndo) throw new Error('Host undo preparation unavailable');
    return host.effect.prepare(direction);
  } };
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, effect))).toMatchObject({ status: 'changed' });
  const changed = state(fixture);
  expect(fixture.editor.undo()).toBe(false); expect(state(fixture)).toEqual(changed);
  expect(fixture.editor.transactions.fault).toBeUndefined();
  refuseUndo = false;
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.redo()).toBe(true);
  expect(state(fixture)).toEqual(changed);
});

it.each(['undo', 'redo'] as const)('compensates a partially failing %s without consuming the history entry', (direction) => {
  const fixture = setupHost();
  let fail = false;
  const host = attributeEffect(fixture.element, { afterApply: (current) => {
    if (fail && current === direction) throw new Error('History apply failed after writing');
  } });
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  if (direction === 'redo') expect(fixture.editor.undo()).toBe(true);
  const before = state(fixture);
  const journal = [...host.journal]; const pending = [...host.pending];
  const events = observeTransactions(fixture.editor);
  fail = true;
  expect(fixture.editor[direction]()).toBe(false);
  expect(state(fixture)).toEqual(before); expect(host.journal).toEqual(journal); expect(host.pending).toEqual(pending);
  expect(events).toEqual([]); expect(fixture.editor.transactions.fault).toBeUndefined();
  fail = false;
  expect(fixture.editor[direction]()).toBe(true); expect(events).toHaveLength(1);
});

it('refuses unknown HTML participants and invalid candidate bindings without invoking host effects', () => {
  const fixture = setupHost();
  const before = state(fixture);
  const apply = jest.fn();
  const rollback = jest.fn();
  const effect: IHostHistoryEffect = { prepare: () => ({ changed: true, apply, rollback }) };
  expect(fixture.editor.transactions.execute({ ...addStopRequest(fixture, effect),
    htmlContext: { stageId: 'missing-stage', context: fixture.stage.animationContext }
  })).toMatchObject({ status: 'refused' });
  expect(fixture.editor.transactions.execute({ label: 'Invalid binding', effect,
    htmlContext: { stageId: fixture.stage.id, context: { ...fixture.stage.animationContext, bindings: { gradient: {
      missing: { kind: 'gradient', gradientId: 'fill', component: 'position', stopId: 'missing' }
    } } } }
  })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(apply).not.toHaveBeenCalled(); expect(rollback).not.toHaveBeenCalled();
});

it('rejects a stale saved resolution instead of rewriting its signature to fit changed keys', () => {
  const track = (value: number) => ({ initialValue: number(1), keys: [{ frame: 1, value: number(value) }] });
  const fixture = setupHost({ data: createDoc([
    layer('firstRule', [], { target: { selector: '.first-rule' }, propertyTimelines: { opacity: track(.3) } }),
    layer('secondRule', [], { target: { selector: '.second-rule' }, propertyTimelines: { opacity: track(.7) } })
  ], 100) });
  fixture.element.className = 'first-rule second-rule'; fixture.element.style.opacity = '1'; fixture.stage.refresh();
  fixture.seek(1);
  const conflict = fixture.stage.diagnostics.find((item) => item.code === 'priority-conflict');
  if (conflict === undefined) throw new Error('Missing priority conflict fixture');
  const context = resolveHtmlConflict(fixture.stage.animationContext, conflict, 'firstRule');
  const before = state(fixture);
  const saved = JSON.stringify(context);
  expect(fixture.editor.transactions.execute({ label: 'Apply obsolete resolution',
    htmlContext: { stageId: fixture.stage.id, context },
    properties: [{ kind: 'set', layerId: 'firstRule', property: 'opacity', frame: 1, value: number(.5) }]
  })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(JSON.stringify(context)).toBe(saved);
});

it('does not implicitly retarget an animated object when a host effect renames its existing ID', () => {
  const fixture = setupHost();
  expect(fixture.editor.propertyTimelines.set('gradient', 'rightPosition', number(80), { frame: 10, initialValue: number(100) })).toEqual({ status: 'changed' });
  const before = state(fixture);
  const host = attributeEffect(fixture.element, { attribute: 'id', value: 'renamed-gradient' });
  expect(fixture.editor.transactions.execute({ ...positionRequest(30), effect: host.effect })).toMatchObject({ status: 'refused' });
  expect(state(fixture)).toEqual(before); expect(fixture.element.id).toBe('gradient');
  expect(host.journal).toEqual([]); expect(host.pending).toEqual([]);
});

it('revalidates a documentary command on redo without replaying the original selection guard or losing the entry', () => {
  const fixture = setupHost();
  let allowed = true;
  let selected = true;
  const initialFps = fixture.editor.document.settings.fps;
  const command: ICommand = { label: 'Change frame rate with a live permission',
    do(doc) {
      if (!allowed) throw new CommandRefusedError('Change frame rate with a live permission', 'Cette modification n’est plus autorisée.');
      return { ...doc, settings: { ...doc.settings, fps: 48 } };
    },
    undo: (doc) => ({ ...doc, settings: { ...doc.settings, fps: initialFps } })
  };
  const host = attributeEffect(fixture.element);
  expect(fixture.editor.transactions.execute({ ...addStopRequest(fixture, host.effect), commands: [command], isCurrent: () => selected })).toMatchObject({ status: 'changed' });
  const changed = state(fixture);
  expect(fixture.editor.undo()).toBe(true);
  const before = state(fixture);
  const pending = [...host.pending]; const events = observeTransactions(fixture.editor);
  allowed = false; selected = false;
  expect(fixture.editor.redo()).toBe(false);
  expect(state(fixture)).toEqual(before); expect(host.pending).toEqual(pending); expect(host.journal).toEqual([]);
  expect(events).toEqual([]); expect(fixture.editor.canRedo).toBe(true);
  allowed = true;
  expect(fixture.editor.redo()).toBe(true); expect(state(fixture)).toEqual(changed);
});

it.each(['undo', 'redo'] as const)('throws and latches a visible fault when %s cannot compensate a partial host write', (direction) => {
  const fixture = setupHost();
  let fail = false;
  const host = attributeEffect(fixture.element, {
    afterApply: (current) => { if (fail && current === direction) throw new Error('History write failed'); },
    beforeRollback: (current) => { if (fail && current === direction) throw new Error('History compensation failed'); }
  });
  expect(fixture.editor.transactions.execute(addStopRequest(fixture, host.effect))).toMatchObject({ status: 'changed' });
  if (direction === 'redo') expect(fixture.editor.undo()).toBe(true);
  const events = observeTransactions(fixture.editor);
  fail = true;
  expect(() => fixture.editor[direction]()).toThrow();
  expect(fixture.editor.transactions.fault).toMatchObject({ message: expect.any(String), participantIds: expect.any(Array) });
  expect(events).toEqual([]);
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
  expect(fixture.editor.transactions.execute(positionRequest(30))).toMatchObject({ status: 'faulted' });
  expect(() => fixture.editor.undo()).toThrow(); expect(() => fixture.editor.redo()).toThrow();
  expect(() => fixture.editor.execute({ label: 'Blocked command', do: (doc) => doc, undo: (doc) => doc })).toThrow();
  expect(() => fixture.editor.destroy()).not.toThrow();
});
