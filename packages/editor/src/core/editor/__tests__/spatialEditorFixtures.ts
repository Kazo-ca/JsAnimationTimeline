// packages/editor/src/core/editor/__tests__/spatialEditorFixtures.ts
import { composeHtmlDeclarations, createHtmlInspectionStage, createManualClock, findNodeById, isLayer } from '@kazo-ca/timeline-runtime';
import type { HtmlPropertyBinding, IHtmlAnimationContext, IHtmlResolvedBinding, IHtmlSpatialDefinition,
  ILayer, IPropertyTimeline, TimelinePropertyValue, TimelinePropertyValues } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../../../index';
import type { IEditor, IEditorHostRenderer } from '../../../index';

export const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
export const text = (value: string): TimelinePropertyValue => ({ kind: 'text', value });
const editors: IEditor[] = [];

export function spatialDefinition(): IHtmlSpatialDefinition {
  return { id: 'geometry', version: 1, composition: 'prepend-trs', sourceTransform: 'translateX(100px)',
    origin: { x: { value: 10, unit: '%' }, y: { value: 20, unit: '%' }, z: { value: 7, unit: 'px' } },
    provenance: { transform: { kind: 'authored', authoredValue: 'translateX(100px)', computedValue: 'matrix(1,0,0,1,100,0)' },
      origin: { kind: 'authored', authoredValue: '10% 20% 7px', computedValue: '20px 20px 7px' } } };
}

export function spatialContext(bindings: Readonly<Record<string, HtmlPropertyBinding>> = {
  rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' }
}): IHtmlAnimationContext { return { version: 1, bindings: { box: bindings }, spatial: { box: [spatialDefinition()] } }; }

export function curve(from = 0, to = 90): IPropertyTimeline {
  return { initialValue: number(from), keys: [{ frame: 1, value: number(from) }, { frame: 101, value: number(to) }],
    transitions: [{ id: 'change', fromFrame: 1, toFrame: 101, easing: { kind: 'effect', family: 'quadratic', mode: 'in' } }] };
}

export function spatialTrack(editor: IEditor, property: string): IPropertyTimeline | undefined {
  const layer = findNodeById(editor.document.layers, 'box');
  return layer !== undefined && isLayer(layer) ? layer.propertyTimelines?.[property] : undefined;
}

export function setupSpatial(properties: Readonly<Record<string, IPropertyTimeline>> = { rotation: curve() },
  context = spatialContext()) {
  const root = document.createElement('main'); const element = document.createElement('div');
  element.id = 'box'; element.style.transform = 'translateX(100px)'; element.style.transformOrigin = '10% 20% 7px';
  root.append(element); document.body.append(root);
  const container = document.createElement('div'); document.body.append(container);
  const source = element.getAttribute('style')!;
  const stage = createHtmlInspectionStage({ root, animationContext: context, preserveSource: <T>(read: () => T): T => {
    const before = element.getAttribute('style'); element.setAttribute('style', source);
    try { return read(); } finally { if (before === null) element.removeAttribute('style'); else element.setAttribute('style', before); }
  } });
  function compose(values: TimelinePropertyValues, current: IHtmlAnimationContext) {
    const resolved: Record<string, IHtmlResolvedBinding> = {};
    for (const [property, value] of Object.entries(values)) {
      const binding = current.bindings?.box[property]; if (binding !== undefined) resolved[property] = { binding, valueKind: value.kind };
    }
    return composeHtmlDeclarations(element, values, resolved, [], undefined, current.spatial?.box);
  }
  const renders: { cause: string; css: Readonly<Record<string, string>> }[] = [];
  const hostRenderer: IEditorHostRenderer = { prepare(candidate) {
    const current = candidate.htmlContexts.find((entry) => entry.stageId === stage.id)?.context;
    if (current === undefined) throw new Error('Missing spatial context');
    const projected = compose(candidate.sample.layer('box')?.propertyValues ?? {}, current);
    if (projected.diagnostics.length > 0) throw new Error(JSON.stringify(projected.diagnostics));
    const before = element.getAttribute('style');
    return { changed: true,
      apply() {
        element.setAttribute('style', source);
        if (candidate.cause !== 'destroy') for (const [name, value] of Object.entries(projected.declarations)) element.style.setProperty(name, value);
        renders.push({ cause: candidate.cause, css: projected.declarations });
      },
      rollback() { if (before === null) element.removeAttribute('style'); else element.setAttribute('style', before); }
    };
  } };
  const layer: ILayer = { id: 'box', name: 'Box', type: 'layer', target: { selector: '#box' }, spans: [], propertyTimelines: properties };
  const clock = createManualClock();
  const editor = createEditor(container, { data: { version: '2.0.0', settings: { fps: 10, totalFrames: 101 }, layers: [layer] },
    stage, hostRenderer, clock, defaultPlugins: false }); editors.push(editor);
  return { editor, stage, element, root, source, context, renders,
    seek(frame: number) { editor.playback.seek(frame); clock.advance(1); },
    sampleCss(frame: number) { return compose(editor.sample(frame).layer('box')?.propertyValues ?? {}, stage.animationContext); }
  };
}

export function cleanupSpatial(): void {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  document.body.replaceChildren();
}
