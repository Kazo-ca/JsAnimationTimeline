// packages/editor/src/core/editor/__tests__/Editor.hostRenderer.test.ts
import { layerOf } from '../../../model/spans/__tests__/fixtures';
import { number } from './hostTransactionFixtures';
import { cleanupRenderers, renderRequest, rendererState, setupRenderer } from './hostRendererFixtures';

afterEach(cleanupRenderers);

it('renders the final document and context before every transaction and ordinary-command observer', () => {
  const fixture = setupRenderer();
  const { editor, element, stage } = fixture;
  let phase = '';
  const observations: { phase: string; event: string; image: string; canUndo: boolean; tracks: number; bindings: number }[] = [];
  for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed'] as const) {
    editor.on(event, () => observations.push({ phase, event, image: element.style.backgroundImage,
      canUndo: editor.canUndo, tracks: Object.keys(layerOf(editor.document, 'object').propertyTimelines ?? {}).length,
      bindings: Object.keys(stage.animationContext.bindings?.object ?? {}).length }));
  }
  phase = 'transaction execute'; expect(editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  phase = 'transaction undo'; expect(editor.undo()).toBe(true);
  phase = 'transaction redo'; expect(editor.redo()).toBe(true);
  phase = 'ordinary execute'; expect(editor.propertyTimelines.set('object', 'angle', number(55), { frame: 1 })).toEqual({ status: 'changed' });
  phase = 'ordinary undo'; expect(editor.undo()).toBe(true);
  phase = 'ordinary redo'; expect(editor.redo()).toBe(true);
  for (const [name, angle, tracks, bindings, canUndo] of [
    ['transaction execute', 35, 1, 2, true], ['transaction undo', 90, 0, 1, false], ['transaction redo', 35, 1, 2, true],
    ['ordinary execute', 55, 1, 2, true], ['ordinary undo', 35, 1, 2, true], ['ordinary redo', 55, 1, 2, true]
  ] as const) {
    const observed = observations.filter((entry) => entry.phase === name);
    expect(observed.map((entry) => entry.event)).toEqual(expect.arrayContaining(['document:changed', 'history:changed']));
    for (const observation of observed) expect(observation).toMatchObject({
      image: expect.stringContaining(`${angle}deg`), tracks, bindings, canUndo
    });
  }
  expect(observations.map((entry) => entry.event)).toEqual(expect.arrayContaining(['property:changed', 'transaction:changed']));
  expect(fixture.errors).toEqual([]);
});

it('provides immutable detached candidate snapshots without a second history entry', () => {
  const fixture = setupRenderer();
  expect(fixture.candidates.map((entry) => entry.cause)).toContain('initialize');
  const before = rendererState(fixture);
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  const candidate = fixture.candidates.find((entry) => entry.cause === 'execute');
  expect(candidate).toBeDefined();
  if (candidate === undefined) throw new Error('Host render was not prepared');
  expect(candidate.document).toEqual(fixture.editor.document);
  expect(candidate.htmlContexts).toEqual([{ stageId: fixture.stage.id, context: fixture.stage.animationContext }]);
  const sample = candidate.sample.layer('object');
  expect(sample?.propertyValues?.angle).toEqual(number(35));
  for (const value of [candidate, candidate.document, candidate.document.layers, candidate.htmlContexts,
    candidate.htmlContexts[0], candidate.htmlContexts[0].context, candidate.time, candidate.sample, candidate.sample.layers,
    sample, sample?.propertyValues, sample?.propertyValues?.angle]) {
    expect(Object.isFrozen(value)).toBe(true);
  }
  expect(candidate.sample.time).toEqual(candidate.time);
  expect(fixture.editor.undo()).toBe(true);
  expect(rendererState(fixture)).toEqual({ ...before, canRedo: true });
  expect(candidate.document).not.toEqual(fixture.editor.document);
  expect(fixture.editor.undo()).toBe(false);
});

it('keeps a committed render when a document observer throws and still supports undo and redo', () => {
  const fixture = setupRenderer();
  const report = jest.spyOn(console, 'error').mockImplementation(() => {});
  const seen: string[] = [];
  fixture.editor.on('document:changed', () => { throw new Error('Observer failed after render commit'); });
  fixture.editor.on('document:changed', () => seen.push(fixture.element.style.backgroundImage));
  try {
    expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
    expect(seen).toEqual([expect.stringContaining('35deg')]);
    expect(fixture.trace).not.toContain('execute:rollback');
    expect(fixture.editor.transactions.fault).toBeUndefined();
    expect(fixture.editor.undo()).toBe(true); expect(fixture.element.style.backgroundImage).toContain('90deg');
    expect(fixture.editor.redo()).toBe(true); expect(fixture.element.style.backgroundImage).toContain('35deg');
    expect(report).toHaveBeenCalled();
  } finally { report.mockRestore(); }
});
