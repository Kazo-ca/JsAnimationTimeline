// packages/editor/src/core/editor/__tests__/Editor.hostTransactionInspection.test.ts
import { createHtmlInspectionStage, createManualClock } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IPropertyTimeline, ITargetPropertyInfo, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../createEditor';
import type { IEditor } from '../types';
import { createDoc, layer, layerOf } from '../../../model/spans/__tests__/fixtures';
import { cleanBody, createContainer } from './fixtures';
import { attributeEffect, number } from './hostTransactionFixtures';

const editors: IEditor[] = [];
function setupInspection() {
  const root = document.createElement('main');
  const element = document.createElement('div'); element.id = 'inspected';
  element.setAttribute('style', 'opacity: 0.8; margin-top: 12px; color: red;');
  root.append(element); document.body.append(root);
  const source = element.getAttribute('style')!;
  element.setAttribute('style', 'opacity: 0.25; margin-top: 99px; color: red;');
  const preview = element.getAttribute('style')!;
  let reads = 0;
  let failReads = false;
  let hostWriting = false;
  const writeHostStyle = (value: string | null) => {
    hostWriting = true;
    try { if (value === null) element.removeAttribute('style'); else element.setAttribute('style', value); }
    finally { hostWriting = false; }
  };
  const stage = createHtmlInspectionStage({ root, preserveSource: <T>(read: () => T): T => {
    reads++;
    const previous = element.getAttribute('style');
    writeHostStyle(source);
    try {
      if (failReads) throw new Error('Host source is unavailable');
      return read();
    } finally {
      writeHostStyle(previous);
    }
  } });
  const clock = createManualClock();
  const opacity: IPropertyTimeline = { initialValue: number(.8), keys: [{ frame: 1, value: number(.8) }, { frame: 61, value: number(.2) }],
    transitions: [{ id: 'opacity-motion', fromFrame: 1, toFrame: 61 }] };
  const data = createDoc([layer('object', [], { target: { selector: '#inspected' }, propertyTimelines: { opacity } })], 100);
  const errors: unknown[] = [];
  const editor = createEditor(createContainer(), { stage, clock, data, defaultPlugins: false, onStageError: (error) => errors.push(error) });
  editors.push(editor);
  return { editor, stage, element, preview, data, errors, reads: () => reads, hostWriting: () => hostWriting, fail: (value: boolean) => { failReads = value; },
    seek: (frame: number) => { editor.playback.seek(frame); clock.advance(1); } };
}
const context: IHtmlAnimationContext = { version: 1, bindings: { object: { gap: { kind: 'style', cssName: 'margin-top', unit: 'px' } } } };

afterEach(() => { editors.splice(0).forEach((editor) => { if (!editor.isDestroyed) editor.destroy(); }); cleanBody(); });

it.each(['ink', 'display'] as const)('deletes the final %s alias key and replays it using the binding value kind', (property) => {
  const fixture = setupInspection();
  const { editor, stage } = fixture;
  const initialValue: TimelinePropertyValue = property === 'ink' ? { kind: 'color', r: 1, g: 0, b: 0, a: 1 } : { kind: 'text', value: 'block' };
  const value: TimelinePropertyValue = property === 'ink' ? { kind: 'color', r: 0, g: 0, b: 1, a: 1 } : { kind: 'text', value: 'none' };
  expect(editor.transactions.execute({ label: 'Create alias key', htmlContext: { stageId: stage.id, context: {
    version: 1, bindings: { object: { [property]: { kind: 'style', cssName: property === 'ink' ? 'color' : 'display' } } }
  } }, properties: [{ kind: 'set', layerId: 'object', property, frame: 50, value, initialValue }] })).toMatchObject({ status: 'changed' });
  const before = editor.document;
  expect(editor.transactions.execute({ label: 'Delete final alias key', properties: [
    { kind: 'delete-key', layerId: 'object', property, frame: 50 }
  ] })).toMatchObject({ status: 'changed' });
  const deleted = editor.document;
  expect(layerOf(deleted, 'object').propertyTimelines?.[property]).toBeUndefined();
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(before);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(deleted);
});

it('joins public inspection-only HTML context and properties to atomic history while the host remains the sole preview writer', () => {
  const fixture = setupInspection();
  const { editor, stage, element, preview } = fixture;
  const before = editor.document;
  const initialContext = stage.animationContext;
  const writes: string[] = [];
  const setProperty = element.style.setProperty.bind(element.style);
  const removeProperty = element.style.removeProperty.bind(element.style);
  const write = jest.spyOn(element.style, 'setProperty').mockImplementation((name, value, priority) => {
    if (!fixture.hostWriting()) writes.push(name);
    setProperty(name, value, priority);
  });
  const remove = jest.spyOn(element.style, 'removeProperty').mockImplementation((name) => {
    if (!fixture.hostWriting()) writes.push(name);
    return removeProperty(name);
  });
  const effect = attributeEffect(element);
  try {
    expect(stage.inspectProperty({ selector: '#inspected' }, 'opacity', { layerId: 'object' }).initialValue).toEqual(number(.8));
    expect(editor.transactions.execute({ label: 'Add gap and capture opacity', htmlContext: { stageId: stage.id, context },
      properties: [
        { kind: 'set', layerId: 'object', property: 'gap', frame: 50, value: number(20), initialValue: number(12) },
        { kind: 'capture', layerId: 'object', property: 'opacity', frame: 31 }
      ], effect: effect.effect
    })).toMatchObject({ status: 'changed' });
    const changed = editor.document;
    expect(stage.animationContext).toEqual(context);
    expect(layerOf(changed, 'object').propertyTimelines?.gap.keys).toEqual([{ frame: 50, value: number(20) }]);
    expect(layerOf(changed, 'object').propertyTimelines?.opacity.keys.find((key) => key.frame === 31)?.value).toEqual(number(.5));
    expect(stage.diagnostics).toEqual([]); expect(element.getAttribute('style')).toBe(preview);
    expect(element.getAttribute('data-designer')).toBe('edited');
    fixture.seek(80); expect(element.getAttribute('style')).toBe(preview);
    expect(editor.undo()).toBe(true); expect(editor.document).toEqual(before); expect(stage.animationContext).toEqual(initialContext);
    expect(element.hasAttribute('data-designer')).toBe(false); expect(element.getAttribute('style')).toBe(preview);
    expect(editor.redo()).toBe(true); expect(editor.document).toEqual(changed); expect(stage.animationContext).toEqual(context);
    expect(element.getAttribute('style')).toBe(preview);
    expect(writes).toEqual([]); expect(fixture.errors).toEqual([]);
    editor.destroy(); expect(element.getAttribute('style')).toBe(preview);
  } finally { write.mockRestore(); remove.mockRestore(); }
});

it('protects deferred metadata sampling and validation and invalidates their data after detach', () => {
  const fixture = setupInspection();
  const { editor, stage, element, preview } = fixture;
  const properties = stage.targets.describe?.({ selector: '#inspected' })?.properties ?? [];
  const info = properties.find((item): item is ITargetPropertyInfo => typeof item !== 'string' && item.name === 'opacity');
  if (info?.sample === undefined || info.validate === undefined) throw new Error('Missing public deferred inspection metadata');
  const reads = fixture.reads();
  expect(info.sample('object', 31)).toEqual(number(.5));
  expect(fixture.reads()).toBeGreaterThan(reads); expect(element.getAttribute('style')).toBe(preview);
  const beforeValidate = fixture.reads();
  expect(info.validate('object', { initialValue: number(.8), keys: [{ frame: 31, value: number(.4) }] })).toEqual([]);
  expect(fixture.reads()).toBeGreaterThan(beforeValidate); expect(element.getAttribute('style')).toBe(preview);
  const next = createDoc([layer('object', [], { target: { selector: '#inspected' }, propertyTimelines: {
    opacity: { initialValue: number(.8), keys: [{ frame: 1, value: number(.6) }] }
  } })], 100);
  editor.load(next);
  expect(info.sample('object', 31)).toEqual(number(.6)); expect(element.getAttribute('style')).toBe(preview);
  editor.destroy();
  expect(() => info.sample?.('object', 31)).toThrow();
  expect(info.validate('object', undefined)).toEqual([expect.objectContaining({ severity: 'error' })]);
  expect(element.getAttribute('style')).toBe(preview);
});

it('restores the host preview and refuses an atomic edit when source inspection fails', () => {
  const fixture = setupInspection();
  const { editor, stage, element, preview } = fixture;
  const before = editor.document;
  fixture.fail(true);
  const request = { label: 'Set gap from original styles', htmlContext: { stageId: stage.id, context }, properties: [
    { kind: 'set' as const, layerId: 'object', property: 'gap', frame: 50, value: number(20), initialValue: number(12) }
  ] };
  expect(editor.transactions.execute(request)).toMatchObject({ status: 'refused' });
  expect(editor.document).toBe(before); expect(stage.animationContext).toEqual({ version: 1 });
  expect(element.getAttribute('style')).toBe(preview); expect(editor.canUndo).toBe(false);
  fixture.fail(false);
  expect(editor.transactions.execute(request)).toMatchObject({ status: 'changed' });
  expect(element.getAttribute('style')).toBe(preview);
});
