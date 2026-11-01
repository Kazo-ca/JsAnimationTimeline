// packages/editor/src/core/editor/__tests__/Editor.htmlProperties.test.ts
import { createManualClock, resolveHtmlConflict } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../createEditor';
import type { IEditor } from '../types';
import { createEditorHtmlStage } from '../../stage/editorHtmlStage';
import { createDoc, layer, layerOf } from '../../../model/spans/__tests__/fixtures';
import { cleanBody, createContainer } from './fixtures';

const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const editors: IEditor[] = [];
const data = () => createDoc([
  layer('group', [], { target: { selector: '.button' }, propertyTimelines: {
    opacity: { initialValue: number(1), keys: [{ frame: 1, value: number(0.5) }] }
  } }),
  layer('specific', [], { target: { selector: '#button-2' }, propertyTimelines: {
    opacity: { initialValue: number(1), keys: [{ frame: 50, value: number(0.8) }] }
  } })
], 100);

function setup(context?: IHtmlAnimationContext) {
  const root = document.createElement('div');
  const elements = Array.from({ length: 4 }, (_, i) => {
    const element = document.createElement('div');
    element.className = 'button'; element.id = `button-${i + 1}`;
    element.style.cssText = `opacity: 1; margin-top: ${i === 1 ? 20 : 10}px; z-index: 1; transform: none;`;
    root.append(element); return element;
  });
  document.body.append(root);
  const container = createContainer();
  const stage = createEditorHtmlStage(container, { root, animationContext: context });
  const clock = createManualClock();
  const editor = createEditor(container, { data: data(), stage, clock, defaultPlugins: false });
  editors.push(editor);
  const seek = (frame: number) => { editor.playback.seek(frame); clock.advance(1); };
  return { editor, elements, stage, seek };
}
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); cleanBody(); });

it('captures a resolved specific target through the atomic candidate instead of its raw initial value', () => {
  const { editor, elements, seek } = setup();
  seek(20);
  expect(editor.transactions.execute({ label: 'Capture resolved opacity', properties: [
    { kind: 'capture', layerId: 'specific', property: 'opacity', frame: 20 }
  ] })).toMatchObject({ status: 'changed' });
  expect(layerOf(editor.document, 'specific').propertyTimelines?.opacity.keys[0]).toEqual({ frame: 20, value: number(.8) });
  expect(elements[1].style.opacity).toBe('0.8');
  expect(editor.undo()).toBe(true); expect(editor.redo()).toBe(true);
  expect(elements[1].style.opacity).toBe('0.8');
});

it('refuses an atomic group capture when its resolved members show different values', () => {
  const { editor, seek } = setup();
  seek(20);
  const before = editor.document;
  expect(editor.transactions.execute({ label: 'Capture mixed group', properties: [
    { kind: 'capture', layerId: 'group', property: 'opacity', frame: 20 }
  ] })).toMatchObject({ status: 'refused' });
  expect(editor.document).toBe(before); expect(editor.canUndo).toBe(false);
});

it('captures the case 59 displayed value and preserves the complete rendered range through undo/redo', () => {
  const { editor, elements, stage, seek } = setup();
  const before = editor.document;
  for (const frame of [1, 20, 49, 50, 100]) {
    seek(frame);
    expect(elements.map((element) => element.style.opacity)).toEqual(['0.5', '0.8', '0.5', '0.5']);
  }
  seek(20);
  expect(editor.propertyTimelines.capture('specific', 'opacity')).toEqual({ status: 'changed' });
  expect(layerOf(editor.document, 'specific').propertyTimelines?.opacity.keys).toEqual([
    { frame: 20, value: number(0.8) }, { frame: 50, value: number(0.8) }
  ]);
  expect(stage.diagnostics).toEqual([]);
  seek(1);
  expect(elements[1].style.opacity).toBe('0.8');
  const after = editor.document;
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before);
  expect(elements[1].style.opacity).toBe('0.8');
  expect(editor.redo()).toBe(true);
  expect(editor.document).toEqual(after);
  expect(elements[1].style.opacity).toBe('0.8');
});

it('refuses the divergent margin without blocking a held edit to the common opacity property', () => {
  const { editor, stage, elements, seek } = setup({ version: 1, bindings: { group: {
    marginTop: { kind: 'style', cssName: 'margin-top', unit: 'px' }
  } } });
  seek(50);
  const inspected = stage.inspectProperty({ selector: '.button' }, 'marginTop', { layerId: 'group', valueKind: 'number' });
  expect(inspected.editable).toBe(false);
  expect(inspected.reason).toMatch(/ID/);
  const before = editor.document;
  expect(editor.propertyTimelines.set('group', 'marginTop', number(30), { initialValue: number(10) })).toMatchObject({ status: 'refused', reason: expect.stringMatching(/ID/) });
  expect(editor.document).toBe(before);
  expect(elements.map((element) => element.style.marginTop)).toEqual(['10px', '20px', '10px', '10px']);
  // Editing an existing explicit key does not need to capture a non-common group sample.
  expect(editor.propertyTimelines.set('group', 'opacity', number(0.4), { frame: 1 })).toEqual({ status: 'changed' });
  expect(elements.map((element) => element.style.opacity)).toEqual(['0.4', '0.8', '0.4', '0.4']);
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before);
});

it('uses a supplied original value for a new property with no entry in the resolution plan', () => {
  const { editor, elements, seek } = setup({ version: 1, bindings: { group: {
    zIndex: { kind: 'style', cssName: 'z-index', unit: '' }
  } } });
  seek(20);
  const before = editor.document;
  expect(editor.propertyTimelines.set('group', 'zIndex', number(7), { initialValue: number(1) })).toEqual({ status: 'changed' });
  expect(layerOf(editor.document, 'group').propertyTimelines?.zIndex).toEqual({
    initialValue: number(1), keys: [{ frame: 20, value: number(7) }]
  });
  expect(elements.map((element) => element.style.zIndex)).toEqual(['7', '7', '7', '7']);
  seek(19);
  expect(elements.map((element) => element.style.zIndex)).toEqual(['1', '1', '1', '1']);
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before);
  expect(elements.map((element) => element.style.zIndex)).toEqual(['1', '1', '1', '1']);
  expect(editor.redo()).toBe(true);
  seek(20);
  expect(elements.map((element) => element.style.zIndex)).toEqual(['7', '7', '7', '7']);
});

it('refuses capturing a group whose currently displayed members differ', () => {
  const { editor, seek } = setup();
  seek(20);
  const before = editor.document;
  const result = editor.propertyTimelines.capture('group', 'opacity');
  expect(result).toMatchObject({ status: 'refused' });
  expect(editor.document).toBe(before);
  expect(editor.canUndo).toBe(false);
});

it('allows an explicit new group key even when a more specific target displays another value', () => {
  const { editor, elements, stage, seek } = setup();
  seek(20);
  const before = editor.document;
  expect(editor.propertyTimelines.set('group', 'opacity', number(0.4))).toEqual({ status: 'changed' });
  expect(layerOf(editor.document, 'group').propertyTimelines?.opacity.keys).toEqual([
    { frame: 1, value: number(0.5) }, { frame: 20, value: number(0.4) }
  ]);
  const conflict = stage.diagnostics.find((item) => item.code === 'before-first-conflict')!;
  expect(conflict).toMatchObject({ fromFrame: 1, toFrame: 50, toFrameExclusive: true, choices: ['specific'] });
  expect(elements.map((element) => element.style.opacity)).toEqual(['0.4', '1', '0.4', '0.4']);
  stage.setAnimationContext(resolveHtmlConflict({ version: 1 }, conflict, 'specific', 'first-key'));
  expect(elements.map((element) => element.style.opacity)).toEqual(['0.4', '0.8', '0.4', '0.4']);
  // The host owns its saved-context history separately; reset this choice before timeline undo.
  stage.setAnimationContext({ version: 1 });
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before);
  expect(elements.map((element) => element.style.opacity)).toEqual(['0.5', '0.8', '0.5', '0.5']);
  expect(editor.redo()).toBe(true);
  expect(stage.diagnostics.some((item) => item.code === 'before-first-conflict')).toBe(true);
  expect(elements.map((element) => element.style.opacity)).toEqual(['0.4', '1', '0.4', '0.4']);
});

it('reports a saved prefix decision as stale when timeline undo changes its conflict context', () => {
  const { editor, elements, stage, seek } = setup();
  seek(20);
  const before = editor.document;
  expect(editor.propertyTimelines.set('group', 'opacity', number(0.4))).toEqual({ status: 'changed' });
  const conflict = stage.diagnostics.find((item) => item.code === 'before-first-conflict')!;
  stage.setAnimationContext(resolveHtmlConflict({ version: 1 }, conflict, 'specific', 'first-key'));
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(before);
  expect(stage.diagnostics.some((item) => item.code === 'stale-resolution')).toBe(true);
  expect(elements[1].style.opacity).toBe('0.8');
  expect(editor.redo()).toBe(true);
  expect(stage.diagnostics).toEqual([]);
  expect(elements[1].style.opacity).toBe('0.8');
});
