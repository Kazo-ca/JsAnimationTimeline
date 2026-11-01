// packages/editor/src/core/editor/__tests__/Editor.spatialProjection.test.ts
import { captureHtmlTransformBase, createHtmlStage } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IPropertyTimeline } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../../../index';
import { cleanupSpatial, curve, number, setupSpatial, spatialContext, spatialTrack, text } from './spatialEditorFixtures';

afterEach(cleanupSpatial);

it('captures an eased rotation inside its tween without changing any fractional projected sample', () => {
  const fixture = setupSpatial(); const { editor, element } = fixture;
  const frames = [1, 10.125, 49.875, 50, 51, 76.625, 101];
  const before = frames.map(fixture.sampleCss); const original = editor.document;
  fixture.seek(51);
  expect(editor.propertyTimelines.capture('box', 'rotation', { frame: 50 })).toEqual({ status: 'changed' });
  expect(spatialTrack(editor, 'rotation')?.transitions).toHaveLength(2);
  expect(spatialTrack(editor, 'rotation')?.keys).toHaveLength(3);
  expect(frames.map(fixture.sampleCss)).toEqual(before);
  const matrix = captureHtmlTransformBase(element);
  expect(matrix.status).toBe('value');
  if (matrix.status !== 'value') throw new Error(matrix.reason);
  expect(matrix.value.x).toBeCloseTo(100 * Math.cos(Math.PI / 8), 7);
  expect(matrix.value.y).toBeCloseTo(100 * Math.sin(Math.PI / 8), 7);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original);
  expect(editor.redo()).toBe(true); expect(frames.map(fixture.sampleCss)).toEqual(before);
});

it('records a source-transform conversion at the selected frame and preserves earlier history', () => {
  const context = spatialContext({ rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
    source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' } });
  const fixture = setupSpatial({ rotation: curve() }, context); const { editor, stage } = fixture;
  const before = editor.document;
  const conversion = { id: 'source-at-50', property: 'source', confirmedAtFrame: 50,
    originalValue: 'translateX(100px)', replacementValue: 'translateX(200px)', reason: 'source-unavailable' as const, consent: 'explicit' as const };
  const converted: IHtmlAnimationContext = { ...context, spatial: { box: [{ ...context.spatial!.box[0], conversions: [conversion] }] } };
  expect(editor.transactions.execute({ label: 'Capture source conversion', htmlContext: { stageId: stage.id, context: converted },
    properties: [{ kind: 'set', layerId: 'box', property: 'source', frame: 50, initialValue: text('translateX(100px)'), value: text('translateX(200px)') }]
  })).toMatchObject({ status: 'changed' });
  expect(fixture.sampleCss(49.875).declarations.transform).toContain('translateX(100px)');
  expect(fixture.sampleCss(50).declarations.transform).toContain('translateX(200px)');
  expect(fixture.sampleCss(90).declarations.transform).toContain('translateX(200px)');
  expect(stage.animationContext.spatial?.box[0].sourceTransform).toBe('translateX(100px)');
  const after = editor.document;
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(before);
  expect(stage.animationContext).toEqual(context); expect(editor.undo()).toBe(false);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(after);
  expect(stage.animationContext).toEqual(converted);
});

it('keeps source-transform keys held and refuses a MotionTween without consuming undo history', () => {
  const source: IPropertyTimeline = { initialValue: text('translateX(100px)'), keys: [
    { frame: 1, value: text('translateX(100px)') }, { frame: 101, value: text('translateX(200px)') }
  ] };
  const fixture = setupSpatial({ source }, spatialContext({ source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' } }));
  const before = fixture.editor.document;
  expect(fixture.editor.propertyTimelines.createTransition('box', 'source', [1, 101])).toMatchObject({ status: 'refused' });
  expect(fixture.editor.document).toBe(before); expect(fixture.editor.canUndo).toBe(false);
  expect(fixture.editor.propertyTimelines.capture('box', 'source', { frame: 50 })).toEqual({ status: 'changed' });
  expect(spatialTrack(fixture.editor, 'source')?.keys[1]).toEqual({ frame: 50, value: text('translateX(100px)') });
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.document).toEqual(before);
});

it('rejects reinterpretation of a populated spatial unit atomically, preserving the redo branch', () => {
  const context = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: '%' } });
  const fixture = setupSpatial({ offset: curve(10, 30) }, context); const { editor, stage } = fixture;
  expect(editor.propertyTimelines.capture('box', 'offset', { frame: 50 })).toEqual({ status: 'changed' });
  const split = editor.document;
  expect(editor.propertyTimelines.set('box', 'offset', number(40), { frame: 101 })).toEqual({ status: 'changed' });
  const redo = editor.document; expect(editor.undo()).toBe(true);
  const before = { document: editor.document, context: stage.animationContext, dom: fixture.root.innerHTML, renders: fixture.renders.length };
  const observed: string[] = [];
  for (const name of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) editor.on(name, () => observed.push(name));
  const changedContext = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' } });
  expect(editor.transactions.execute({ label: 'Change recorded unit', htmlContext: { stageId: stage.id, context: changedContext },
    properties: [{ kind: 'set', layerId: 'box', property: 'offset', frame: 80, value: number(15) }]
  })).toMatchObject({ status: 'refused' });
  expect(editor.document).toBe(before.document); expect(editor.document).toEqual(split);
  expect(stage.animationContext).toEqual(before.context); expect(fixture.root.innerHTML).toBe(before.dom);
  expect(fixture.renders).toHaveLength(before.renders); expect(observed).toEqual([]);
  expect(editor.canRedo).toBe(true); expect(editor.redo()).toBe(true); expect(editor.document).toEqual(redo);
  expect(editor.undo()).toBe(true);
  expect(editor.transactions.execute({ label: 'Use original unit', htmlContext: { stageId: stage.id, context },
    properties: [{ kind: 'set', layerId: 'box', property: 'offset', frame: 80, value: number(15) }]
  })).toMatchObject({ status: 'changed' });
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(split);
});

it.each([false, true])('protects an empty-key track initial unit during an atomic context change (addKey=%s)', (addKey) => {
  const context = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'em' } });
  const fixture = setupSpatial({ offset: { initialValue: number(2), keys: [] } }, context);
  const { editor, stage } = fixture;
  expect(fixture.sampleCss(1).declarations.transform).toContain('translate(2em, 0px)');
  expect(editor.propertyTimelines.set('box', 'offset', number(9), { frame: 60 })).toEqual({ status: 'changed' });
  const redo = editor.document; expect(editor.undo()).toBe(true);
  const before = { document: editor.document, context: stage.animationContext, dom: fixture.root.innerHTML, renders: fixture.renders.length };
  const observed: string[] = [];
  for (const name of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) editor.on(name, () => observed.push(name));
  const replacement = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' } });
  expect(editor.transactions.execute({ label: 'Reinterpret empty track unit', htmlContext: { stageId: stage.id, context: replacement },
    ...(addKey ? { properties: [{ kind: 'set' as const, layerId: 'box', property: 'offset', frame: 50, value: number(5) }] } : {})
  })).toMatchObject({ status: 'refused' });
  expect(editor.document).toBe(before.document); expect(stage.animationContext).toEqual(before.context);
  expect(fixture.root.innerHTML).toBe(before.dom); expect(fixture.renders).toHaveLength(before.renders);
  expect(fixture.sampleCss(1).declarations.transform).toContain('translate(2em, 0px)');
  expect(observed).toEqual([]); expect(editor.canUndo).toBe(false); expect(editor.canRedo).toBe(true);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(redo); expect(editor.undo()).toBe(true);
  expect(editor.transactions.execute({ label: 'Keep the original unit', htmlContext: { stageId: stage.id, context },
    properties: [{ kind: 'set', layerId: 'box', property: 'offset', frame: 50, value: number(5) }]
  })).toMatchObject({ status: 'changed' });
  expect(fixture.sampleCss(1).declarations.transform).toContain('translate(2em, 0px)');
  expect(fixture.sampleCss(50).declarations.transform).toContain('translate(5em, 0px)');
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(before.document); expect(stage.animationContext).toEqual(context);
});

it('allows an explicitly removed spatial track to be recreated with a new unit and source baseline', () => {
  const context = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'em' } });
  const fixture = setupSpatial({ offset: { initialValue: number(2), keys: [] } }, context); const { editor, stage } = fixture;
  const original = editor.document;
  expect(editor.transactions.execute({ label: 'Remove the old track explicitly', commands: [{ label: 'Remove offset track',
    do: (document) => ({ ...document, layers: document.layers.map((layer) => layer.id === 'box' ? { ...layer, propertyTimelines: {} } : layer) }),
    undo: () => original
  }] })).toMatchObject({ status: 'changed' });
  expect(spatialTrack(editor, 'offset')).toBeUndefined();
  const removed = editor.document;
  const replacement = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' } });
  const created = editor.transactions.execute({ label: 'Create a new pixel track', htmlContext: { stageId: stage.id, context: replacement },
    properties: [{ kind: 'set', layerId: 'box', property: 'offset', frame: 50, initialValue: number(0), value: number(5) }]
  });
  if (created.status !== 'changed') throw new Error(JSON.stringify(created));
  expect(fixture.sampleCss(1).declarations.transform).toContain('translate(0px, 0px)');
  const recreated = editor.document;
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(removed); expect(stage.animationContext).toEqual(context);
  expect(editor.undo()).toBe(true); expect(editor.document).toEqual(original); expect(fixture.sampleCss(1).declarations.transform).toContain('translate(2em, 0px)');
  expect(editor.redo()).toBe(true); expect(editor.redo()).toBe(true); expect(editor.document).toEqual(recreated);
  expect(stage.animationContext).toEqual(replacement);
});

it('cancels a combined pivot gesture back to its source projection and prior redo history', () => {
  const context = spatialContext({ pivotX: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' },
    pivotY: { kind: 'spatial', projectionId: 'geometry', component: 'pivotY', unit: '%' } });
  const fixture = setupSpatial({}, context); const { editor } = fixture;
  expect(editor.propertyTimelines.set('box', 'pivotX', number(30), { frame: 1, initialValue: number(10) })).toEqual({ status: 'changed' });
  const redo = editor.document; expect(editor.undo()).toBe(true);
  const before = { document: editor.document, context: fixture.stage.animationContext, dom: fixture.root.innerHTML };
  const gesture = editor.propertyTimelines.beginTransaction('Adjust pivot');
  expect(editor.transactions.execute({ label: 'Set both pivot axes', properties: [
    { kind: 'set', layerId: 'box', property: 'pivotX', frame: 50, value: number(25), initialValue: number(10) },
    { kind: 'set', layerId: 'box', property: 'pivotY', frame: 50, value: number(75), initialValue: number(20) }
  ] })).toMatchObject({ status: 'changed' });
  fixture.seek(50); expect(fixture.element.style.transformOrigin).toBe('25% 75% 7px');
  gesture.cancel(); expect(gesture.active).toBe(false);
  expect(editor.document).toEqual(before.document); expect(fixture.stage.animationContext).toEqual(before.context);
  expect(fixture.root.innerHTML).toBe(before.dom); expect(editor.canRedo).toBe(true);
  expect(editor.redo()).toBe(true); expect(editor.document).toEqual(redo);
});

it('refuses a new group key when authored relative sources merely share the current computed matrix', () => {
  const root = document.createElement('main');
  const first = document.createElement('div'); const second = document.createElement('div');
  first.className = second.className = 'group'; first.id = 'box'; second.id = 'other';
  first.style.transform = 'translateX(50%)'; second.style.transform = 'translateX(100px)';
  first.style.width = second.style.width = '200px'; first.style.transformOrigin = second.style.transformOrigin = '50% 50% 7px';
  root.append(first, second); document.body.append(root);
  const container = document.createElement('div'); document.body.append(container);
  const context = spatialContext(); const definition = context.spatial!.box[0];
  const animationContext: IHtmlAnimationContext = { ...context, spatial: { box: [{ ...definition, sourceTransform: 'translateX(50%)',
    origin: { ...definition.origin, x: { value: 50, unit: '%' }, y: { value: 50, unit: '%' } },
    provenance: { ...definition.provenance, transform: { kind: 'authored', authoredValue: 'translateX(50%)', computedValue: 'matrix(1,0,0,1,100,0)' } }
  }] } };
  const read = window.getComputedStyle.bind(window);
  const computed = jest.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const original = read(element, pseudo);
    if (element !== first && element !== second) return original;
    const captured = document.createElement('div').style;
    captured.cssText = original.cssText; captured.transform = 'matrix(1,0,0,1,100,0)';
    return captured;
  });
  const stage = createHtmlStage({ mode: 'frame', root, animationContext });
  const editor = createEditor(container, { stage, defaultPlugins: false, data: { version: '2.0.0', settings: { fps: 10, totalFrames: 101 },
    layers: [{ id: 'box', type: 'layer', name: 'Group', target: { selector: '.group' }, spans: [] }] } });
  const before = editor.document; const source = root.innerHTML;
  try {
    expect(editor.propertyTimelines.set('box', 'rotation', number(45), { frame: 50, initialValue: number(0) })).toMatchObject({ status: 'refused' });
    expect(editor.document).toBe(before); expect(spatialTrack(editor, 'rotation')).toBeUndefined();
    expect(editor.canUndo).toBe(false); expect(root.innerHTML).toBe(source);
  } finally { editor.destroy(); computed.mockRestore(); }
});
