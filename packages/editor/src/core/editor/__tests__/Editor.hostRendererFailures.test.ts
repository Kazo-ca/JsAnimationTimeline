// packages/editor/src/core/editor/__tests__/Editor.hostRendererFailures.test.ts
import type { ICommand } from '../../commands/ICommand';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { attributeEffect, number } from './hostTransactionFixtures';
import { cleanupRenderers, renderRequest, rendererState, setupRenderer } from './hostRendererFixtures';

afterEach(cleanupRenderers);

it.each(['prepare', 'apply'] as const)('compensates transaction render %s failure without partial effects, events or losing redo', (phase) => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture, 25))).toMatchObject({ status: 'changed' });
  const redoDocument = fixture.editor.document;
  expect(fixture.editor.undo()).toBe(true);
  const before = rendererState(fixture);
  const host = attributeEffect(fixture.element);
  const events: string[] = [];
  for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) {
    fixture.editor.on(event, () => events.push(event));
  }
  fixture.controls[phase] = 'execute';
  expect(fixture.editor.transactions.execute({ ...renderRequest(fixture, 35), effect: host.effect })).toMatchObject({ status: 'refused' });
  expect(rendererState(fixture)).toEqual(before);
  expect(host.journal).toEqual([]); expect(host.pending).toEqual([]); expect(events).toEqual([]);
  expect(fixture.editor.transactions.fault).toBeUndefined();
  delete fixture.controls[phase];
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.editor.document).toEqual(redoDocument);
  expect(fixture.element.style.backgroundImage).toContain('25deg');
});

it.each(['property', 'command'] as const)('refuses an ordinary %s edit when its render fails and retains the old history branch', (kind) => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture, 25))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.undo()).toBe(true);
  const before = rendererState(fixture);
  fixture.controls.apply = 'execute';
  if (kind === 'property') {
    expect(fixture.editor.propertyTimelines.set('object', 'angle', number(40), { frame: 1, initialValue: number(90) })).toMatchObject({ status: 'refused' });
  } else {
    const command: ICommand = { label: 'Change gradient directly', do: () => createDoc([layer('object', [], {
      target: { selector: '#rendered' }, propertyTimelines: { angle: { initialValue: number(90), keys: [{ frame: 1, value: number(40) }] } }
    })], 100), undo: () => before.document };
    expect(fixture.editor.execute(command)).toBe(false);
  }
  expect(rendererState(fixture)).toEqual(before);
  expect(fixture.editor.transactions.fault).toBeUndefined();
  delete fixture.controls.apply;
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.element.style.backgroundImage).toContain('25deg');
});

it.each(['prepare', 'apply'] as const)('keeps undo and redo recoverable after compensated render %s failures', (phase) => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  const committed = rendererState(fixture);
  fixture.controls[phase] = 'undo';
  expect(fixture.editor.undo()).toBe(false);
  expect(rendererState(fixture)).toEqual(committed);
  delete fixture.controls[phase];
  expect(fixture.editor.undo()).toBe(true);
  const undone = rendererState(fixture);
  fixture.controls[phase] = 'redo';
  expect(fixture.editor.redo()).toBe(false);
  expect(rendererState(fixture)).toEqual(undone);
  delete fixture.controls[phase];
  expect(fixture.editor.redo()).toBe(true);
  expect(rendererState(fixture)).toEqual(committed);
});

it('exposes a failed render compensation as a persistent fault and keeps destruction available', () => {
  const fixture = setupRenderer();
  fixture.controls.apply = 'execute'; fixture.controls.rollback = 'execute';
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'faulted' });
  expect(fixture.editor.transactions.fault).toBeDefined();
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
  expect(fixture.editor.transactions.execute(renderRequest(fixture, 55))).toMatchObject({ status: 'faulted' });
  expect(() => fixture.editor.propertyTimelines.set('object', 'angle', number(55), { frame: 1 })).toThrow();
  expect(() => fixture.editor.undo()).toThrow(); expect(() => fixture.editor.redo()).toThrow();
  const beforeDestroy = [...fixture.trace];
  expect(() => fixture.editor.destroy()).not.toThrow();
  expect(fixture.editor.isDestroyed).toBe(true);
  expect(fixture.trace).toEqual(beforeDestroy);
});
