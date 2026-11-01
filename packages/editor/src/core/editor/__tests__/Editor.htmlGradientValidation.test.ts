// packages/editor/src/core/editor/__tests__/Editor.htmlGradientValidation.test.ts
import { createManualClock } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlGradientDefinition, IPropertyTimeline, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../createEditor';
import type { IEditor } from '../types';
import { createEditorHtmlStage } from '../../stage/editorHtmlStage';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { cleanBody, createContainer } from './fixtures';

const present = (value: boolean): TimelinePropertyValue => ({ kind: 'boolean', value });
const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const editors: IEditor[] = [];

function setup(middlePresent = false, tracks: Readonly<Record<string, IPropertyTimeline>> = {}) {
  const root = document.createElement('div');
  const element = document.createElement('div'); element.id = 'gradient'; root.append(element); document.body.append(root);
  const gradient: IHtmlGradientDefinition = { id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
    centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
      { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, position: 0, opacity: 1, present: true },
      { id: 'middle', color: { kind: 'color', r: 0, g: 1, b: 0, a: 1 }, position: 50, opacity: 1, present: middlePresent },
      { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, position: 100, opacity: 1, present: true }
    ] };
  const context: IHtmlAnimationContext = { version: 1, gradients: { gradient: [gradient] }, bindings: { gradient: {
    leftPresent: { kind: 'gradient', gradientId: 'fill', component: 'present', stopId: 'left' },
    middlePresent: { kind: 'gradient', gradientId: 'fill', component: 'present', stopId: 'middle' },
    rightPresent: { kind: 'gradient', gradientId: 'fill', component: 'present', stopId: 'right' },
    rightPosition: { kind: 'gradient', gradientId: 'fill', component: 'position', stopId: 'right' },
    middleOpacity: { kind: 'gradient', gradientId: 'fill', component: 'opacity', stopId: 'middle' }
  } } };
  const container = createContainer();
  const stage = createEditorHtmlStage(container, { root, animationContext: context });
  const clock = createManualClock();
  const editor = createEditor(container, { data: createDoc([
    layer('gradient', [], { target: { selector: '#gradient' }, propertyTimelines: tracks })
  ], 100), stage, clock, defaultPlugins: false });
  editors.push(editor);
  const seek = (frame: number) => { editor.playback.seek(frame); clock.advance(1); };
  return { editor, stage, seek, element };
}

afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); cleanBody(); });

it('renders crossing stops at fractional frames and reverses position gestures without changing stop identities', () => {
  const { editor, stage, seek, element } = setup(true, {
    rightPosition: { initialValue: number(100), keys: [
      { frame: 1, value: number(100) }, { frame: 81, value: number(0) }
    ], transitions: [{ id: 'move-right', fromFrame: 1, toFrame: 81 }] }
  });
  const original = editor.document;
  const context = stage.animationContext;
  const expected = (stops: string) => `linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, ${stops})`;
  const beforeCrossing = expected('rgba(0, 255, 0, 1) 50%, rgba(0, 0, 255, 1) 50.625%');
  const tied = expected('rgba(0, 255, 0, 1) 50%, rgba(0, 0, 255, 1) 50%');
  const afterCrossing = expected('rgba(0, 0, 255, 1) 49.375%, rgba(0, 255, 0, 1) 50%');
  for (const [frame, css] of [[41.5, afterCrossing], [40.5, beforeCrossing], [41, tied], [41.5, afterCrossing]] as const) {
    seek(frame);
    expect(element.style.backgroundImage).toBe(css);
    expect(stage.diagnostics).toEqual([]);
    expect(editor.document).toEqual(original);
    expect(stage.animationContext).toEqual(context);
  }

  seek(41);
  const change = () => {
    expect(editor.propertyTimelines.set('gradient', 'rightPosition', number(25))).toEqual({ status: 'changed' });
    expect(editor.propertyTimelines.set('gradient', 'middleOpacity', number(.25), { initialValue: number(1) })).toEqual({ status: 'changed' });
  };
  const preview = expected('rgba(0, 0, 255, 1) 25%, rgba(0, 255, 0, 0.25) 50%');
  const cancelled = editor.propertyTimelines.beginTransaction('Move gradient stop');
  change();
  expect(element.style.backgroundImage).toBe(preview);
  cancelled.cancel();
  expect(editor.document).toEqual(original);
  expect(element.style.backgroundImage).toBe(tied);
  expect(editor.canUndo).toBe(false);

  const committed = editor.propertyTimelines.beginTransaction('Move gradient stop');
  change();
  expect(committed.commit()).toBe(true);
  const changed = editor.document;
  expect(editor.undo()).toBe(true);
  expect(editor.document).toEqual(original);
  expect(element.style.backgroundImage).toBe(tied);
  expect(editor.canUndo).toBe(false);
  const cancelWithRedo = editor.propertyTimelines.beginTransaction('Cancel another move');
  change();
  cancelWithRedo.cancel();
  expect(editor.canRedo).toBe(true);
  expect(editor.redo()).toBe(true);
  expect(editor.document).toEqual(changed);
  expect(element.style.backgroundImage).toBe(preview);
  expect(stage.animationContext).toEqual(context);
  expect(stage.animationContext.gradients?.gradient?.[0].stops.map((stop) => stop.id)).toEqual(['left', 'middle', 'right']);
});

it('adds a middle stop before removing the left stop, with reversible edits and no history for an invalid third removal', () => {
  const { editor, stage, seek } = setup();
  const original = editor.document;
  seek(20);
  expect(editor.propertyTimelines.set('gradient', 'middlePresent', present(true), { initialValue: present(false) })).toEqual({ status: 'changed' });
  const withMiddle = editor.document;
  seek(30);
  expect(editor.propertyTimelines.set('gradient', 'leftPresent', present(false), { initialValue: present(true) })).toEqual({ status: 'changed' });
  const withLeftRemoved = editor.document;
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(withMiddle);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(withLeftRemoved);
  seek(40);
  const beforeInvalidRemoval = editor.document;
  expect(editor.propertyTimelines.set('gradient', 'rightPresent', present(false), { initialValue: present(true) })).toMatchObject({
    status: 'refused', reason: expect.stringMatching(/deux points/)
  });
  expect(editor.document).toBe(beforeInvalidRemoval);
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(withMiddle);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original);
  expect(editor.canUndo).toBe(false);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(withMiddle);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(withLeftRemoved);
  expect(editor.canRedo).toBe(false);
});

it('refuses two separate removals that leave one point even when each is valid against the three-point source', () => {
  const { editor, stage, seek } = setup(true);
  const original = editor.document;
  seek(10);
  expect(editor.propertyTimelines.set('gradient', 'leftPresent', present(false), { initialValue: present(true) })).toEqual({ status: 'changed' });
  const before = editor.document;
  seek(20);
  expect(editor.propertyTimelines.set('gradient', 'rightPresent', present(false), { initialValue: present(true) })).toMatchObject({
    status: 'refused', reason: expect.stringMatching(/deux points/)
  });
  expect(editor.document).toBe(before);
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original);
  expect(editor.canUndo).toBe(false);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(before);
});

it('checks a future boundary on another presence track independently of the current frame', () => {
  const { editor, seek } = setup(false, { middlePresent: { initialValue: present(false), keys: [
    { frame: 20, value: present(true) }, { frame: 40, value: present(false) }
  ] } });
  seek(30);
  const before = editor.document;
  expect(editor.propertyTimelines.set('gradient', 'leftPresent', present(false), { initialValue: present(true) })).toMatchObject({
    status: 'refused', reason: expect.stringMatching(/deux points/)
  });
  expect(editor.document).toBe(before); expect(editor.canUndo).toBe(false);
});

it('validates the remaining gradient when deleting a last key and keeps valid deletions reversible', () => {
  const { editor, stage, seek } = setup(false, {
    middlePresent: { initialValue: present(false), keys: [{ frame: 20, value: present(true) }] },
    leftPresent: { initialValue: present(true), keys: [{ frame: 30, value: present(false) }] }
  });
  seek(40);
  const original = editor.document;
  expect(editor.propertyTimelines.deleteKey('gradient', 'middlePresent', 20)).toMatchObject({
    status: 'refused', reason: expect.stringMatching(/deux points/)
  });
  expect(editor.document).toBe(original); expect(editor.canUndo).toBe(false);
  expect(stage.diagnostics).toEqual([]);
  expect(editor.propertyTimelines.deleteKey('gradient', 'leftPresent', 30)).toEqual({ status: 'changed' });
  const withLeftRestored = editor.document;
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original);
  expect(stage.diagnostics).toEqual([]);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(withLeftRestored);
  expect(editor.propertyTimelines.deleteKey('gradient', 'middlePresent', 20)).toEqual({ status: 'changed' });
  const withoutTracks = editor.document;
  expect(withoutTracks.layers[0]).toMatchObject({ propertyTimelines: {} });
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(withLeftRestored);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(withoutTracks);
});

it('repairs an imported invalid combination by deleting a last key, with undo and redo', () => {
  const { editor, stage, seek } = setup(true, {
    leftPresent: { initialValue: present(true), keys: [{ frame: 10, value: present(false) }] },
    rightPresent: { initialValue: present(true), keys: [{ frame: 20, value: present(false) }] }
  });
  seek(30);
  const original = editor.document;
  expect(stage.diagnostics.some((issue) => /deux points/.test(issue.message))).toBe(true);
  expect(editor.propertyTimelines.deleteKey('gradient', 'rightPresent', 20)).toEqual({ status: 'changed' });
  const repaired = editor.document;
  expect(stage.diagnostics).toEqual([]);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original);
  expect(stage.diagnostics.some((issue) => /deux points/.test(issue.message))).toBe(true);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(repaired);
  expect(stage.diagnostics).toEqual([]);
});
