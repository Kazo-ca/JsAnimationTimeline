// packages/editor/src/core/editor/__tests__/Editor.hostRendererTeardown.test.ts
import { createManualClock } from '@kazo-ca/timeline-runtime';
import type { IEditorContext } from '../../context/IEditorContext';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { number } from './hostTransactionFixtures';
import { cleanupRenderers, renderRequest, setupRenderer } from './hostRendererFixtures';

function angleDocument(value: number) {
  return createDoc([layer('object', [], { target: { selector: '#rendered' }, propertyTimelines: {
    angle: { initialValue: number(90), keys: [{ frame: 1, value: number(value) }] }
  } })], 100);
}

afterEach(cleanupRenderers);

it.each(['prepare', 'apply'] as const)('invalidates retained plugin facades after startup and destroy-render %s both fail', (phase) => {
  const clock = createManualClock();
  const calls: string[] = [];
  let captured: IEditorContext | undefined;
  let startupError: unknown;
  try {
    setupRenderer({ data: angleDocument(35), clock, plugins: [{
      id: 'test.retainedFailedHost', dependencies: [],
      init(ctx) { captured = ctx; throw new Error('Original plugin startup failure'); }, destroy() {}
    }] }, { [phase]: 'destroy', onPrepare: (candidate) => calls.push(candidate.cause) });
  } catch (error) { startupError = error; }
  expect(startupError).toBeInstanceOf(Error);
  expect(startupError).toMatchObject({ cause: expect.any(Error), cleanupError: expect.any(Error),
    message: expect.stringContaining('Original plugin startup failure') });
  expect(document.querySelector('.JsTimeLine')).toBeNull();
  expect(clock.pendingFrames).toBe(0);
  const ctx = captured;
  if (ctx === undefined) throw new Error('Plugin did not retain its initialized context');
  const beforeDocument = ctx.document;
  const beforeDom = document.body.innerHTML;
  const beforeCalls = [...calls];
  let commandError: unknown; let subscriptionError: unknown;
  try { ctx.commands.execute({ label: 'Late edit from failed plugin', do: () => angleDocument(55), undo: () => beforeDocument }); }
  catch (error) { commandError = error; }
  try { ctx.events.on('document:changed', () => {}); }
  catch (error) { subscriptionError = error; }
  clock.advance(1000);
  expect(commandError).toBeInstanceOf(Error);
  expect(subscriptionError).toBeInstanceOf(Error);
  expect(ctx.document).toBe(beforeDocument);
  expect(document.body.innerHTML).toBe(beforeDom);
  expect(calls).toEqual(beforeCalls);
  expect(clock.pendingFrames).toBe(0);
});

it.each(['editor:destroying', 'plugin.destroy'] as const)('refuses commands from %s after releasing the host preview', (callback) => {
  let captured: IEditorContext | undefined;
  const outcomes: { accepted: boolean; documentChanged: boolean; renders: number; beforeStyle: string | null; afterStyle: string | null }[] = [];
  const fixture = setupRenderer({ plugins: [{
    id: 'test.hostTeardownCommand', dependencies: [],
    init(ctx) {
      captured = ctx;
      if (callback === 'editor:destroying') ctx.events.on('editor:destroying', () => attempt?.());
    },
    destroy() { if (callback === 'plugin.destroy') attempt?.(); }
  }] });
  const ctx = captured;
  if (ctx === undefined) throw new Error('Plugin did not retain its initialized context');
  expect(fixture.editor.transactions.execute(renderRequest(fixture))).toMatchObject({ status: 'changed' });
  const beforeDocument = fixture.editor.document;
  const attempt = () => {
    const beforeStyle = fixture.element.getAttribute('style');
    const count = fixture.candidates.length;
    let accepted = false;
    try { accepted = ctx.commands.execute({ label: 'Rejected teardown edit', do: () => angleDocument(55), undo: () => beforeDocument }); }
    catch { /* A lifecycle rejection also prevents the teardown mutation. */ }
    outcomes.push({ accepted, documentChanged: ctx.document !== beforeDocument, renders: fixture.candidates.length - count,
      beforeStyle, afterStyle: fixture.element.getAttribute('style') });
  };
  expect(() => fixture.editor.destroy()).not.toThrow();
  expect(outcomes).toEqual([{ accepted: false, documentChanged: false, renders: 0, beforeStyle: fixture.source, afterStyle: fixture.source }]);
  expect(fixture.element.getAttribute('style')).toBe(fixture.source);
  expect(fixture.editor.isDestroyed).toBe(true);
  expect(document.querySelector('.JsTimeLine')).toBeNull();
  expect(fixture.clock.pendingFrames).toBe(0);
  const calls = fixture.candidates.length;
  fixture.clock.advance(1000);
  expect(fixture.candidates).toHaveLength(calls);
  expect(fixture.element.getAttribute('style')).toBe(fixture.source);
});
