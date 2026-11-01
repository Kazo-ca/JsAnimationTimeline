// packages/editor/src/core/editor/__tests__/Editor.hostRendererGuards.test.ts
import { captureContext } from './fixtures';
import { number } from './hostTransactionFixtures';
import { cleanupRenderers, renderRequest, rendererState, setupRenderer } from './hostRendererFixtures';

afterEach(cleanupRenderers);

it('refuses mutations during committed notifications without changing the visible state and allows an immediate retry', () => {
  const fixture = setupRenderer();
  const results: unknown[] = [];
  const observations: { before: ReturnType<typeof rendererState>; after: ReturnType<typeof rendererState>; seekFailed: boolean }[] = [];
  let attempted = false;
  fixture.editor.on('document:changed', () => {
    if (attempted) return;
    attempted = true;
    const before = rendererState(fixture);
    results.push(fixture.editor.transactions.execute(renderRequest(fixture, 55)));
    results.push(fixture.editor.propertyTimelines.set('object', 'angle', number(55), { frame: 1 }));
    results.push(fixture.editor.execute({ label: 'Nested ordinary command', do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 48 } }), undo: (doc) => doc }));
    results.push(fixture.editor.undo(), fixture.editor.redo());
    let seekFailed = false;
    try { fixture.editor.playback.seek(20); } catch { seekFailed = true; }
    observations.push({ before, after: rendererState(fixture), seekFailed });
  });
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(results).toEqual([expect.objectContaining({ status: 'refused' }), expect.objectContaining({ status: 'refused' }), false, false, false]);
  expect(observations).toHaveLength(1);
  expect(observations[0].after).toEqual(observations[0].before);
  expect(observations[0].seekFailed).toBe(true);
  expect(fixture.element.style.backgroundImage).toContain('35deg');
  expect(fixture.editor.playback.frame).toBe(1);
  expect(fixture.editor.transactions.execute(renderRequest(fixture, 55))).toMatchObject({ status: 'changed' });
  expect(fixture.element.style.backgroundImage).toContain('55deg');
  expect(fixture.editor.undo()).toBe(true); expect(fixture.element.style.backgroundImage).toContain('35deg');
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.canUndo).toBe(false);
});

it.each(['onPrepare', 'onApply'] as const)('rejects a renderer %s navigation attempt before it alters transport or nested history', (hook) => {
  const fixture = setupRenderer();
  const outcomes: { seekFailed: boolean; time: number; nested: string }[] = [];
  fixture.controls[hook] = (candidate) => {
    if (candidate.cause !== 'execute') return;
    let seekFailed = false;
    try { fixture.editor.playback.seek(20); } catch { seekFailed = true; }
    const nested = fixture.editor.propertyTimelines.set('object', 'angle', number(55), { frame: 1 }).status;
    outcomes.push({ seekFailed, time: fixture.editor.playback.time.timeMs, nested });
  };
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(outcomes).toEqual([{ seekFailed: true, time: 0, nested: 'refused' }]);
  delete fixture.controls[hook];
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.canUndo).toBe(false);
});

it('does not duplicate command interception when ordinary commands use the host render pipeline', () => {
  const capture = captureContext('test.hostRendererBefore');
  const fixture = setupRenderer({ plugins: [capture.plugin] });
  let calls = 0;
  capture.context().events.onCancellable('command:before', () => { calls++; });
  expect(fixture.editor.propertyTimelines.set('object', 'angle', number(35), { frame: 1, initialValue: number(90) })).toEqual({ status: 'changed' });
  expect(calls).toBe(1);
  expect(fixture.editor.undo()).toBe(true); expect(fixture.editor.redo()).toBe(true);
  expect(calls).toBe(1);
});

it('keeps first playhead and frame observers guarded after the new preview is visible', () => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  fixture.clock.advance(1);
  const seen: { event: string; status: string; seekFailed: boolean; before: ReturnType<typeof rendererState>; after: ReturnType<typeof rendererState>; frame: number }[] = [];
  for (const event of ['playhead:changed', 'frame:render'] as const) fixture.editor.on(event, () => {
    const before = rendererState(fixture);
    const result = fixture.editor.transactions.execute(renderRequest(fixture, 55));
    let seekFailed = false;
    try { fixture.editor.playback.seek(60); } catch { seekFailed = true; }
    seen.push({ event, status: result.status, seekFailed, before, after: rendererState(fixture), frame: fixture.editor.playback.frame });
  });
  fixture.seek(20);
  expect(seen.map((entry) => entry.event)).toEqual(['playhead:changed', 'frame:render']);
  for (const entry of seen) {
    expect(entry).toMatchObject({ status: 'refused', seekFailed: true, frame: 20 });
    expect(entry.after).toEqual(entry.before);
    expect(entry.before.dom).toContain('35deg');
  }
  expect(fixture.editor.transactions.execute(renderRequest(fixture, 55))).toMatchObject({ status: 'changed' });
  expect(fixture.element.style.backgroundImage).toContain('55deg');
});
