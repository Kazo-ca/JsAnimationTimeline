// packages/editor/src/core/editor/__tests__/Editor.hostRendererLifecycle.test.ts
import { createManualClock } from '@kazo-ca/timeline-runtime';
import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { number } from './hostTransactionFixtures';
import { cleanupRenderers, renderRequest, renderedAngle, rendererState, setupRenderer } from './hostRendererFixtures';

function motionDocument(totalFrames = 200, fps = 10, endFrame = 181): ITimelineDocument {
  const doc = createDoc([layer('object', [], { target: { selector: '#rendered' }, propertyTimelines: {
    angle: { initialValue: number(90), keys: [{ frame: 1, value: number(0) }, { frame: endFrame, value: number(endFrame - 1) }],
      transitions: [{ id: 'angle-motion', fromFrame: 1, toFrame: endFrame }] }
  } })], totalFrames);
  return { ...doc, settings: { ...doc.settings, fps } };
}

afterEach(cleanupRenderers);

it('renders load, seek and fractional playback before frame observers without adding history', () => {
  const fixture = setupRenderer();
  fixture.editor.load(motionDocument());
  expect(fixture.element.style.backgroundImage).toContain('0deg');
  expect(fixture.candidates.map((entry) => entry.cause)).toContain('load');
  const observed: { frame: number; image: string }[] = [];
  fixture.editor.on('frame:render', (event) => observed.push({ frame: event.sample.time.frame, image: fixture.element.style.backgroundImage }));
  fixture.seek(41);
  expect(fixture.element.style.backgroundImage).toContain('40deg');
  expect(observed).toContainEqual({ frame: 41, image: expect.stringContaining('40deg') });
  fixture.editor.playback.play(); fixture.clock.advance(250); fixture.editor.playback.pause(); fixture.clock.advance(1);
  expect(fixture.editor.playback.time.frame).toBeCloseTo(43.5, 8);
  expect(fixture.element.style.backgroundImage).toContain('42.5deg');
  expect(observed.some((entry) => Math.abs(entry.frame - 43.5) < 1e-8 && entry.image.includes('42.5deg'))).toBe(true);
  expect(fixture.candidates.map((entry) => entry.cause)).toEqual(expect.arrayContaining(['seek', 'playback']));
  expect(fixture.editor.canUndo).toBe(false); expect(fixture.editor.canRedo).toBe(false);
});

it('uses candidate fps and duration when rendering an ordinary settings command before observers', () => {
  const fixture = setupRenderer();
  const initial = motionDocument();
  fixture.editor.load(initial); fixture.seek(41);
  const observed: { frame: number; timeMs: number; image: string }[] = [];
  fixture.editor.on('document:changed', () => observed.push({ frame: fixture.editor.playback.time.frame,
    timeMs: fixture.editor.playback.time.timeMs, image: fixture.element.style.backgroundImage }));
  expect(fixture.editor.execute({ label: 'Double frame rate',
    do: (doc) => ({ ...doc, settings: { ...doc.settings, fps: 20 } }), undo: () => initial })).toBe(true);
  expect(observed).toEqual([{ frame: 41, timeMs: 2000, image: expect.stringContaining('40deg') }]);
  const doubled = fixture.editor.document;
  expect(fixture.editor.execute({ label: 'Shorten timeline', do: () => motionDocument(30, 20, 21), undo: () => doubled })).toBe(true);
  expect(observed[1]).toEqual({ frame: 30, timeMs: 1450, image: expect.stringContaining('20deg') });
  const candidate = [...fixture.candidates].reverse().find((entry) => entry.cause === 'execute');
  expect(candidate?.time).toEqual(fixture.editor.playback.time);
  expect(candidate?.sample.time).toEqual(fixture.editor.playback.time);
  expect(fixture.editor.undo()).toBe(true); expect(renderedAngle(fixture)).toBeCloseTo(29, 10);
  expect(fixture.editor.undo()).toBe(true); expect(renderedAngle(fixture)).toBeCloseTo(29, 10);
});

it.each(['prepare', 'apply'] as const)('restores a failed load %s including the previous redo branch', (phase) => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  expect(fixture.editor.undo()).toBe(true);
  const before = rendererState(fixture); const time = fixture.editor.playback.time;
  fixture.controls[phase] = 'load';
  expect(() => fixture.editor.load(motionDocument())).toThrow();
  expect(rendererState(fixture)).toEqual(before); expect(fixture.editor.playback.time).toEqual(time);
  expect(fixture.editor.transactions.fault).toBeUndefined();
  delete fixture.controls[phase];
  expect(fixture.editor.redo()).toBe(true); expect(fixture.element.style.backgroundImage).toContain('35deg');
});

it('refreshes the host preview without history and restores source styles exactly on destruction', () => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  const before = rendererState(fixture);
  fixture.editor.stage.refreshTargets();
  expect(rendererState(fixture)).toEqual(before);
  expect(fixture.candidates.map((entry) => entry.cause)).toContain('refresh');
  fixture.editor.destroy();
  expect(fixture.element.getAttribute('style')).toBe(fixture.source);
  expect(fixture.candidates.map((entry) => entry.cause)).toContain('destroy');
  const calls = fixture.candidates.length;
  fixture.clock.advance(1000); fixture.editor.destroy();
  expect(fixture.candidates).toHaveLength(calls);
});

it.each(['prepare', 'apply'] as const)('keeps the editor usable when destruction render %s fails and can retry cleanup', (phase) => {
  const fixture = setupRenderer();
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  const before = rendererState(fixture);
  fixture.controls[phase] = 'destroy';
  expect(() => fixture.editor.destroy()).toThrow();
  expect(fixture.editor.isDestroyed).toBe(false);
  expect(rendererState(fixture)).toEqual(before);
  expect(fixture.editor.transactions.fault).toBeUndefined();
  delete fixture.controls[phase];
  expect(fixture.editor.undo()).toBe(true);
  expect(() => fixture.editor.destroy()).not.toThrow();
  expect(fixture.element.getAttribute('style')).toBe(fixture.source);
});

it.each(['prepare', 'apply'] as const)('compensates a failed seek %s render while retaining the requested paused time for explicit retry', (phase) => {
  const fixture = setupRenderer();
  fixture.editor.load(motionDocument()); fixture.clock.advance(1);
  const before = rendererState(fixture);
  const events: string[] = [];
  fixture.editor.on('playhead:changed', () => events.push('playhead'));
  fixture.editor.on('frame:render', () => events.push('frame'));
  fixture.controls[phase] = 'seek';
  expect(() => fixture.seek(41)).toThrow();
  expect(rendererState(fixture)).toEqual(before);
  expect(fixture.editor.playback.time).toEqual({ frame: 41, integerFrame: 41, timeMs: 4000 });
  expect(events).toEqual([]);
  const preparations = fixture.candidates.length;
  expect(() => fixture.clock.advance(1000)).not.toThrow();
  expect(fixture.candidates).toHaveLength(preparations);
  expect(rendererState(fixture)).toEqual(before);
  expect(events).toEqual([]);
  delete fixture.controls[phase];
  fixture.seek(41);
  expect(renderedAngle(fixture)).toBeCloseTo(40, 10);
});

it('keeps transport, history and DOM unchanged when a timing command fails during rendering', () => {
  const fixture = setupRenderer();
  fixture.editor.load(motionDocument()); fixture.seek(41);
  const before = rendererState(fixture); const time = fixture.editor.playback.time;
  fixture.controls.apply = 'execute';
  expect(fixture.editor.execute({ label: 'Rejected shorter timeline', do: () => motionDocument(30, 20, 21), undo: () => before.document })).toBe(false);
  expect(rendererState(fixture)).toEqual(before); expect(fixture.editor.playback.time).toEqual(time);
  delete fixture.controls.apply;
  expect(fixture.editor.execute({ label: 'Shorter timeline', do: () => motionDocument(30, 20, 21), undo: () => before.document })).toBe(true);
  expect(fixture.editor.playback.time).toEqual({ frame: 30, integerFrame: 30, timeMs: 1450 });
  expect(renderedAngle(fixture)).toBeCloseTo(20, 10);
  expect(fixture.editor.undo()).toBe(true);
});

it.each(['prepare', 'apply'] as const)('restores source styles and cancels scheduled work when initialize %s fails', (phase) => {
  const clock = createManualClock();
  const calls: string[] = [];
  expect(() => setupRenderer({ data: motionDocument(), clock }, { [phase]: 'initialize', onPrepare: (candidate) => calls.push(candidate.cause) })).toThrow();
  const element = document.querySelector<HTMLElement>('#rendered')!;
  expect(element.style.backgroundImage).toContain('90deg');
  expect(clock.pendingFrames).toBe(0);
  const before = [...calls];
  clock.advance(1000);
  expect(calls).toEqual(before); expect(element.style.backgroundImage).toContain('90deg');
});

it('tears down prepared host rendering and initialized plugins when another plugin fails during initialization', () => {
  const clock = createManualClock();
  const destroy = jest.fn();
  const calls: string[] = [];
  expect(() => setupRenderer({ data: motionDocument(), clock, plugins: [
    { id: 'test.goodHostPlugin', dependencies: [], init() {}, destroy },
    { id: 'test.failedHostPlugin', dependencies: ['test.goodHostPlugin'], init() { throw new Error('Plugin initialization failed'); }, destroy() {} }
  ] }, { onPrepare: (candidate) => calls.push(candidate.cause) })).toThrow('Plugin initialization failed');
  expect(destroy).toHaveBeenCalledTimes(1);
  expect(document.querySelector<HTMLElement>('#rendered')?.style.backgroundImage).toContain('90deg');
  expect(clock.pendingFrames).toBe(0);
  const before = [...calls]; clock.advance(1000);
  expect(calls).toEqual(before);
});
