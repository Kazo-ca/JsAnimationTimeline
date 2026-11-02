// packages/editor/src/core/editor/__tests__/Editor.historyEntryKinds.test.ts
import type { ICommand } from '../../commands/ICommand';
import { setupHost, cleanupHosts, addStopRequest, attributeEffect, state } from './hostTransactionFixtures';

afterEach(cleanupHosts);

function customCommand(kind: 'host' | 'group'): ICommand & { readonly kind: typeof kind } {
  return { kind, label: `Custom ${kind} command`,
    do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 12 } }),
    undo: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 24 } }) };
}

it.each(['host', 'group'] as const)('preserves execute, undo and redo for a public command whose custom kind is %s', (kind) => {
  const fixture = setupHost();
  const { editor } = fixture;
  const before = editor.document;
  expect(editor.execute(customCommand(kind))).toBe(true);
  const changed = editor.document;
  expect(changed.settings.fps).toBe(12);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(before);
  expect(editor.canUndo).toBe(false); expect(editor.canRedo).toBe(true);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(changed);
  expect(editor.canRedo).toBe(false);
});

it.each(['host', 'group'] as const)('replays a mixed atomic group containing a public command whose custom kind is %s', (kind) => {
  const fixture = setupHost();
  const { editor } = fixture;
  const before = state(fixture);
  const effect = attributeEffect(fixture.element);
  const group = editor.propertyTimelines.beginTransaction('Custom command with atomic host changes');
  expect(editor.execute(customCommand(kind))).toBe(true);
  expect(editor.transactions.execute(addStopRequest(fixture, effect.effect))).toMatchObject({ status: 'changed' });
  expect(group.commit()).toBe(true);
  const changed = state(fixture);
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before.document); expect(fixture.stage.animationContext).toEqual(before.context);
  expect(fixture.root.innerHTML).toBe(before.dom); expect(effect.journal).toEqual([]); expect(editor.canUndo).toBe(false);
  expect(editor.redo()).toBe(true); expect(state(fixture)).toEqual(changed);
});
