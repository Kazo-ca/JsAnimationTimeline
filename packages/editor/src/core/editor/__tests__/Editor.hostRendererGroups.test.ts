// packages/editor/src/core/editor/__tests__/Editor.hostRendererGroups.test.ts
import { number } from './hostTransactionFixtures';
import { cleanupRenderers, renderRequest, rendererState, setupRenderer } from './hostRendererFixtures';

afterEach(cleanupRenderers);

it('renders each mixed-group preview and commits one reversible history entry', () => {
  const fixture = setupRenderer();
  const before = rendererState(fixture);
  const observed: string[] = [];
  fixture.editor.on('document:changed', () => observed.push(fixture.element.style.backgroundImage));
  const gesture = fixture.editor.propertyTimelines.beginTransaction('Adjust gradient gesture');
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.propertyTimelines.set('object', 'angle', number(55), { frame: 1 })).toEqual({ status: 'changed' });
  expect(gesture.commit()).toBe(true);
  const committed = rendererState(fixture);
  expect(fixture.editor.undo()).toBe(true);
  expect(rendererState(fixture)).toEqual({ ...before, canRedo: true });
  expect(fixture.editor.redo()).toBe(true);
  expect(rendererState(fixture)).toEqual(committed);
  expect(observed).toEqual([expect.stringContaining('35deg'), expect.stringContaining('55deg'), expect.stringContaining('90deg'), expect.stringContaining('55deg')]);
});

it('cancels a mixed group with coherent source rendering and preserves an existing redo branch', () => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture, 25))).toMatchObject({ status: 'changed' });
  const priorRedo = fixture.editor.document;
  expect(fixture.editor.undo()).toBe(true);
  const before = rendererState(fixture);
  const gesture = fixture.editor.propertyTimelines.beginTransaction('Canceled gradient gesture');
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.propertyTimelines.set('object', 'angle', number(55), { frame: 1 })).toEqual({ status: 'changed' });
  const observed: ReturnType<typeof rendererState>[] = [];
  fixture.editor.on('document:changed', () => observed.push(rendererState(fixture)));
  gesture.cancel();
  expect(gesture.active).toBe(false);
  expect(rendererState(fixture)).toEqual(before);
  expect(observed.length).toBeGreaterThan(0);
  expect(observed[observed.length - 1]).toEqual(before);
  expect(fixture.candidates.map((entry) => entry.cause)).toContain('group-cancel');
  expect(fixture.editor.redo()).toBe(true);
  expect(fixture.editor.document).toEqual(priorRedo);
  expect(fixture.element.style.backgroundImage).toContain('25deg');
});
