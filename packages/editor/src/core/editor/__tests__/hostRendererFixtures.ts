// packages/editor/src/core/editor/__tests__/hostRendererFixtures.ts
import { createHtmlInspectionStage, createManualClock } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IManualClock } from '@kazo-ca/timeline-runtime';
import type { HostRenderCause, IEditorHostRenderer, IHostRenderCandidate } from '../../../index';
import { createEditor } from '../createEditor';
import type { EditorOptions, IEditor } from '../types';
import type { IEditorTransactionRequest } from '../transactionTypes';
import { createDoc, layer } from '../../../model/spans/__tests__/fixtures';
import { cleanBody, createContainer } from './fixtures';
import { number } from './hostTransactionFixtures';

const editors: IEditor[] = [];

interface RendererControls {
  prepare?: HostRenderCause;
  apply?: HostRenderCause;
  rollback?: HostRenderCause;
  onPrepare?: (candidate: IHostRenderCandidate) => void;
  onApply?: (candidate: IHostRenderCandidate) => void;
}

export function setupRenderer(options: Pick<EditorOptions, 'plugins' | 'data'> & { clock?: IManualClock } = {}, initialControls: RendererControls = {}) {
  const root = document.createElement('main');
  const element = document.createElement('div');
  element.id = 'rendered';
  element.setAttribute('style', 'background-image: linear-gradient(90deg, red 0%, blue 100%); opacity: 0.8;');
  root.append(element); document.body.append(root);
  const source = element.getAttribute('style')!;
  const context: IHtmlAnimationContext = { version: 1, gradients: { object: [{
    id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
    centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
      { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, position: 0, opacity: 1, present: true },
      { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, position: 100, opacity: 1, present: true }
    ]
  }] }, bindings: { object: { angle: { kind: 'gradient', gradientId: 'fill', component: 'angle' } } } };
  const stage = createHtmlInspectionStage({ root, animationContext: context, preserveSource: <T>(read: () => T): T => {
    const previous = element.getAttribute('style');
    element.setAttribute('style', source);
    try { return read(); }
    finally { if (previous === null) element.removeAttribute('style'); else element.setAttribute('style', previous); }
  } });
  const controls: RendererControls = { ...initialControls };
  const candidates: IHostRenderCandidate[] = [];
  const trace: string[] = [];
  const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
    candidates.push(candidate); trace.push(`${candidate.cause}:prepare`);
    controls.onPrepare?.(candidate);
    if (controls.prepare === candidate.cause) throw new Error('Host render preparation failed');
    const before = element.getAttribute('style');
    const proposedContext = candidate.htmlContexts.find((entry) => entry.stageId === stage.id)?.context;
    if (proposedContext === undefined) throw new Error('Missing candidate HTML context');
    const sampled = candidate.sample.layer('object')?.propertyValues?.angle;
    const angle = sampled?.kind === 'number' ? sampled.value : proposedContext.gradients?.object?.[0]?.angle;
    if (angle === undefined) throw new Error('Missing candidate gradient angle');
    const next = candidate.cause === 'destroy' ? source : `background-image: linear-gradient(${angle}deg, red 0%, blue 100%); opacity: 0.8;`;
    return { changed: next !== before,
      apply() {
        trace.push(`${candidate.cause}:apply`);
        element.setAttribute('style', next);
        controls.onApply?.(candidate);
        if (controls.apply === candidate.cause) throw new Error('Host render application failed');
      },
      rollback() {
        trace.push(`${candidate.cause}:rollback`);
        if (controls.rollback === candidate.cause) throw new Error('Host render compensation failed');
        if (before === null) element.removeAttribute('style'); else element.setAttribute('style', before);
      }
    };
  } };
  const clock = options.clock ?? createManualClock();
  const errors: unknown[] = [];
  const data = createDoc([layer('object', [], { target: { selector: '#rendered' } })], 100);
  const editor = createEditor(createContainer(), { stage, data, clock, defaultPlugins: false, hostRenderer,
    onStageError: (error) => errors.push(error), ...options });
  editors.push(editor);
  return { editor, stage, element, root, source, context, controls, candidates, trace, clock, errors,
    seek(frame: number) { editor.playback.seek(frame); clock.advance(1); }
  };
}

export type RendererFixture = ReturnType<typeof setupRenderer>;

export function renderRequest(fixture: RendererFixture, angle = 35): IEditorTransactionRequest {
  return { label: 'Set gradient angle and host context', htmlContext: { stageId: fixture.stage.id, context: {
    ...fixture.context, bindings: { object: { ...fixture.context.bindings?.object, fade: { kind: 'style', cssName: 'opacity' } } }
  } }, properties: [{ kind: 'set', layerId: 'object', property: 'angle', frame: 1, value: number(angle), initialValue: number(90) }] };
}

export function rendererState(fixture: RendererFixture) {
  return { document: fixture.editor.document, context: fixture.stage.animationContext,
    dom: fixture.root.innerHTML, canUndo: fixture.editor.canUndo, canRedo: fixture.editor.canRedo };
}

export function renderedAngle(fixture: RendererFixture): number {
  return Number(fixture.element.style.backgroundImage.match(/^linear-gradient\(([-\d.]+)deg/)?.[1]);
}

export function cleanupRenderers(): void {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  cleanBody();
}
