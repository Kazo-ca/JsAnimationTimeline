// packages/editor/src/core/editor/__tests__/Editor.hostRendererTimingFailure.test.ts
import { createManualClock } from '@kazo-ca/timeline-runtime';
import type { IManualClock } from '@kazo-ca/timeline-runtime';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { number } from './hostTransactionFixtures';
import { cleanupRenderers, rendererState, setupRenderer } from './hostRendererFixtures';

function motionDocument(totalFrames = 200, fps = 10, endFrame = 181) {
  const doc = createDoc([layer('object', [], { target: { selector: '#rendered' }, propertyTimelines: {
    angle: { initialValue: number(90), keys: [{ frame: 1, value: number(0) }, { frame: endFrame, value: number(endFrame - 1) }],
      transitions: [{ id: 'angle-motion', fromFrame: 1, toFrame: endFrame }] }
  } })], totalFrames);
  return { ...doc, settings: { ...doc.settings, fps } };
}

afterEach(cleanupRenderers);

function setupTimingFailure(point: 'now' | 'schedule') {
  const manual = createManualClock();
  let armed = false;
  const clock: IManualClock = {
    now() {
      if (armed && point === 'now') { armed = false; throw new Error('Clock time read failed before commit'); }
      return manual.now();
    },
    advance: (delta) => manual.advance(delta), cancelFrame: (handle) => manual.cancelFrame(handle),
    get pendingFrames() { return manual.pendingFrames; },
    requestFrame(callback) {
      if (armed && point === 'schedule') { armed = false; throw new Error('Clock scheduling failed after host render'); }
      return manual.requestFrame(callback);
    }
  };
  const fixture = setupRenderer({ clock, data: motionDocument() });
  fixture.seek(41);
  fixture.editor.playback.play(); clock.advance(250); fixture.editor.playback.pause(); clock.advance(1);
  expect(fixture.editor.playback.time.frame).toBeCloseTo(43.5, 8);
  expect(fixture.editor.propertyTimelines.set('object', 'angle', number(45), { frame: 41 })).toEqual({ status: 'changed' });
  expect(fixture.editor.undo()).toBe(true); clock.advance(1);
  const pendingCallback = jest.fn(); clock.requestFrame(pendingCallback);
  const snapshot = () => ({ ...rendererState(fixture), time: fixture.editor.playback.time,
    fps: fixture.editor.playback.fps, totalFrames: fixture.editor.playback.totalFrames, pendingFrames: clock.pendingFrames });
  const before = snapshot();
  const events: string[] = [];
  for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed', 'playhead:changed', 'frame:render'] as const) {
    fixture.editor.on(event, () => events.push(event));
  }
  fixture.controls.onApply = (candidate) => { if (candidate.cause === 'execute') armed = true; };
  return { fixture, clock, before, snapshot, events, pendingCallback, armed: () => armed };
}

it('refuses a precommit clock read failure without changing fractional time, document, preview, history or pending callbacks', () => {
  const { fixture, clock, before, snapshot, events, pendingCallback, armed } = setupTimingFailure('now');
  expect(fixture.editor.execute({ label: 'Fail while scheduling accepted shorter timeline', do: () => motionDocument(30, 20, 21), undo: () => before.document })).toBe(false);
  delete fixture.controls.onApply;
  expect(armed()).toBe(false);
  expect(snapshot()).toEqual(before);
  expect(events).toEqual([]);
  expect(fixture.editor.transactions.fault).toBeUndefined();
  clock.advance(1);
  expect(pendingCallback).toHaveBeenCalledTimes(1);
  expect(events).toEqual([]);
  expect(fixture.editor.redo()).toBe(true);
});

it('reports postcommit scheduling failure while observers see committed timing, preview and history', () => {
  const { fixture, clock, before, snapshot, events, pendingCallback, armed } = setupTimingFailure('schedule');
  const observed: ReturnType<typeof snapshot>[] = [];
  fixture.editor.on('document:changed', () => observed.push(snapshot()));
  fixture.editor.on('history:changed', () => observed.push(snapshot()));
  const report = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    expect(fixture.editor.execute({ label: 'Commit despite later display scheduling failure', do: () => motionDocument(30, 20, 21), undo: () => before.document })).toBe(true);
    delete fixture.controls.onApply;
    expect(armed()).toBe(false);
    const committed = snapshot();
    expect(committed).toMatchObject({ document: motionDocument(30, 20, 21), context: before.context,
      dom: expect.stringContaining('20deg'), time: { frame: 30, integerFrame: 30, timeMs: 1450 },
      fps: 20, totalFrames: 30, canUndo: true, canRedo: false, pendingFrames: before.pendingFrames });
    expect(observed.length).toBeGreaterThan(0);
    for (const observation of observed) expect(observation).toEqual(committed);
    expect(events).toEqual(expect.arrayContaining(['document:changed', 'history:changed']));
    expect(report).toHaveBeenCalled();
    expect(fixture.editor.transactions.fault).toBeUndefined();
    clock.advance(1); expect(pendingCallback).toHaveBeenCalledTimes(1);
    expect(fixture.editor.undo()).toBe(true);
    expect(fixture.editor.document).toEqual(before.document);
  } finally { report.mockRestore(); }
});

it('refuses a stale command when the commit clock read advances active playback without rewinding physical time', () => {
  jest.useFakeTimers();
  try {
    const manual = createManualClock();
    let armed = false;
    const clock: IManualClock = {
      now() {
        if (armed) { armed = false; manual.advance(100); }
        return manual.now();
      },
      advance: (delta) => manual.advance(delta), requestFrame: (callback) => manual.requestFrame(callback),
      cancelFrame: (handle) => manual.cancelFrame(handle), get pendingFrames() { return manual.pendingFrames; }
    };
    const fixture = setupRenderer({ clock, data: motionDocument() });
    fixture.seek(41);
    expect(fixture.editor.propertyTimelines.set('object', 'angle', number(45), { frame: 41 })).toEqual({ status: 'changed' });
    expect(fixture.editor.undo()).toBe(true); clock.advance(1);
    fixture.editor.playback.play(); clock.advance(250);
    const before = rendererState(fixture);
    const beforeTime = fixture.editor.playback.time;
    const beforeClock = clock.now();
    expect(beforeTime.frame).toBeCloseTo(43.5, 8);
    const events: string[] = [];
    for (const event of ['document:changed', 'property:changed', 'history:changed', 'transaction:changed', 'playhead:changed', 'frame:render'] as const) {
      fixture.editor.on(event, () => events.push(event));
    }
    fixture.controls.onApply = (candidate) => { if (candidate.cause === 'execute') armed = true; };
    const accepted = fixture.editor.execute({ label: 'Reject timing candidate invalidated by clock callback',
      do: () => motionDocument(30, 20, 21), undo: () => before.document });
    delete fixture.controls.onApply;
    jest.runOnlyPendingTimers();
    expect(armed).toBe(false);
    expect(accepted).toBe(false);
    expect(rendererState(fixture)).toEqual(before);
    expect(fixture.editor.playback.fps).toBe(10); expect(fixture.editor.playback.totalFrames).toBe(200);
    expect(clock.now()).toBe(beforeClock + 100);
    expect(fixture.editor.playback.time.timeMs).toBeCloseTo(beforeTime.timeMs + 100, 8);
    expect(fixture.editor.playback.time.frame).toBeCloseTo(44.5, 8);
    expect(fixture.editor.playback.playing).toBe(true);
    expect(events).toEqual([]);
    expect(fixture.editor.transactions.fault).toBeUndefined();
  } finally { jest.clearAllTimers(); jest.useRealTimers(); }
});
