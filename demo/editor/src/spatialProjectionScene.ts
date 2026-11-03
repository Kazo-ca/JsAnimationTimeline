// demo/editor/src/spatialProjectionScene.ts
import type { HtmlPropertyBinding, IHtmlAnimationContext, IHtmlSpatialDefinition, IPropertyTimeline,
  ITimelineDocument, PropertyEasing } from '@kazo-ca/timeline-runtime';

export type SpatialScenario = 'rotation' | 'relative' | 'pivots' | 'negative' | 'source' | 'incompatible';
export const FRAMES = 101;
export const FPS = 25;
const number = (value: number) => ({ kind: 'number' as const, value });
function track(from: number, to = from, easing?: PropertyEasing): IPropertyTimeline {
  return { initialValue: number(from), keys: [{ frame: 1, value: number(from) }, { frame: FRAMES, value: number(to) }],
    transitions: [{ id: 'motion', fromFrame: 1, toFrame: FRAMES, ...(easing === undefined ? {} : { easing }) }] };
}
export interface ISpatialExample {
  readonly document: ITimelineDocument; readonly context: IHtmlAnimationContext;
  readonly source: string; readonly origin: string;
}
export function createExample(scenario: SpatialScenario): ISpatialExample {
  const source = scenario === 'relative' ? 'translateX(10%)' : 'translateX(100px)';
  const origin = '10% 20% 7px';
  const definition: IHtmlSpatialDefinition = { id: 'geometry', version: 1, composition: 'prepend-trs', sourceTransform: source,
    origin: { x: { value: 10, unit: '%' }, y: { value: 20, unit: '%' }, z: { value: 7, unit: 'px' } },
    provenance: { transform: { kind: 'authored', authoredValue: source, computedValue: scenario === 'relative' ? 'matrix(1,0,0,1,20,0)' : 'matrix(1,0,0,1,100,0)' },
      origin: { kind: 'authored', authoredValue: origin, computedValue: '20px 16px 7px' } } };
  const bindings: Record<string, HtmlPropertyBinding> = { rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' } };
  const properties: Record<string, IPropertyTimeline> = { rotation: track(0, 90) };
  if (scenario === 'relative') {
    bindings.translateX = { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'em' };
    bindings.translateY = { kind: 'spatial', projectionId: 'geometry', component: 'translateY', unit: 'vw' };
    properties.translateX = track(0, 4); properties.translateY = track(0, 4);
  }
  if (scenario === 'pivots') {
    bindings.pivotX = { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' };
    bindings.pivotY = { kind: 'spatial', projectionId: 'geometry', component: 'pivotY', unit: '%' };
    properties.rotation = track(30); properties.pivotX = track(10, 70); properties.pivotY = track(20, 80);
  }
  if (scenario === 'negative') {
    bindings.scaleX = { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' };
    properties.rotation = track(0); properties.scaleX = track(1, -1);
  }
  if (scenario === 'source') {
    bindings.source = { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' };
    properties.source = { initialValue: { kind: 'text', value: source }, keys: [
      { frame: 1, value: { kind: 'text', value: source } }, { frame: 51, value: { kind: 'text', value: 'translateX(200px)' } }
    ] };
  }
  if (scenario === 'incompatible') {
    bindings.translateX = { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' };
    properties.translateX = track(0, 60);
    properties.rotation = track(0, 90, { kind: 'bezier', x1: .42, y1: 0, x2: 1, y2: 1 });
  }
  return { source, origin, context: { version: 1, bindings: { box: bindings }, spatial: { box: [definition] } },
    document: { version: '2.0.0', settings: { fps: FPS, totalFrames: FRAMES }, layers: [
      { id: 'box', name: 'Objet spatial', type: 'layer', target: { selector: '#spatial-box' }, spans: [],
        propertyTimelines: Object.fromEntries(Object.entries(properties).map(([property, timeline]) => [property, {
          ...timeline, ...(timeline.transitions === undefined ? {} : {
            transitions: timeline.transitions.map((transition) => ({ ...transition, id: `${property}-${transition.id}` }))
          })
        }])) }
    ] } };
}

export function createScene(owner: Document, example: ISpatialExample): HTMLElement {
  const root = owner.createElement('div'); root.id = 'spatial-scene'; root.className = 'JsTimeLine';
  const style = owner.createElement('style');
  style.textContent = '.JsTimeLine#spatial-scene{position:relative;box-sizing:border-box;min-height:310px;background:#edf2eb;overflow:hidden;font:16px/1.4 sans-serif}.JsTimeLine #spatial-box{position:absolute;top:80px;left:30px;width:200px;height:80px;box-sizing:border-box;border:3px solid #163f3b;background:#1c897b;color:white;display:grid;place-items:center}.JsTimeLine #spatial-box::before{content:"";position:absolute;left:0;top:0;width:10px;height:10px;background:#ffb45d}';
  const box = owner.createElement('div'); box.id = 'spatial-box'; box.textContent = 'Source + ajustements';
  box.style.transform = example.source; box.style.transformOrigin = example.origin;
  root.append(style, box); return root;
}

export interface ISpatialSceneSnapshot {
  readonly matrix: readonly number[]; readonly origin: readonly number[]; readonly corners: readonly (readonly number[])[];
  readonly declaration: string; readonly originDeclaration: string; readonly width: number; readonly height: number;
  readonly font: number; readonly viewport: number;
}
export function readScene(root: HTMLElement): ISpatialSceneSnapshot {
  const box = root.querySelector<HTMLElement>('#spatial-box'); const view = root.ownerDocument.defaultView;
  if (box === null || view === null) throw new Error('Spatial scene is unavailable.');
  const style = view.getComputedStyle(box); const matrix = new DOMMatrix(style.transform);
  const origin = style.transformOrigin.split(/\s+/).map((value) => Number.parseFloat(value));
  const width = Number.parseFloat(style.width); const height = Number.parseFloat(style.height);
  const corners = [[0, 0], [width, 0], [width, height], [0, height]].map(([x, y]) => {
    const point = matrix.transformPoint(new DOMPoint(x - origin[0], y - origin[1], -(origin[2] ?? 0)));
    return [point.x + origin[0], point.y + origin[1], point.z + (origin[2] ?? 0)];
  });
  return { matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f], origin, corners,
    declaration: box.style.transform, originDeclaration: box.style.transformOrigin, width, height,
    font: Number.parseFloat(style.fontSize), viewport: view.innerWidth };
}
