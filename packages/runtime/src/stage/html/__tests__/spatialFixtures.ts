// packages/runtime/src/stage/html/__tests__/spatialFixtures.ts
import type { HtmlPropertyBinding, IHtmlAnimationContext, IHtmlSpatialDefinition, ILayer,
  IPropertyTimeline, PropertyEasing, TimelinePropertyValue } from '../../../index';

export const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
export const text = (value: string): TimelinePropertyValue => ({ kind: 'text', value });

export function spatialDefinition(overrides: Partial<IHtmlSpatialDefinition> = {}): IHtmlSpatialDefinition {
  return { id: 'geometry', version: 1, composition: 'prepend-trs', sourceTransform: 'translateX(100px)',
    origin: { x: { value: 10, unit: '%' }, y: { value: 20, unit: '%' }, z: { value: 7, unit: 'px' } },
    provenance: {
      transform: { kind: 'authored', authoredValue: 'translateX(100px)', computedValue: 'matrix(1,0,0,1,100,0)' },
      origin: { kind: 'authored', authoredValue: '10% 20% 7px', computedValue: '20px 20px 7px' }
    }, ...overrides };
}

export function spatialContext(bindings: Readonly<Record<string, HtmlPropertyBinding>> = {
  rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' }
}, definition = spatialDefinition()): IHtmlAnimationContext {
  return { version: 1, bindings: { box: bindings }, spatial: { box: [definition] } };
}

export function track(from: number, to = from, easing?: PropertyEasing): IPropertyTimeline {
  return { initialValue: number(from), keys: [{ frame: 1, value: number(from) }, { frame: 101, value: number(to) }],
    transitions: [{ id: 'change', fromFrame: 1, toFrame: 101, ...(easing === undefined ? {} : { easing }) }] };
}

export function spatialLayer(properties: Readonly<Record<string, IPropertyTimeline>> = { rotation: track(0, 90) },
  id = 'box', selector = '#box'): ILayer {
  return { id, type: 'layer', name: id, target: { selector }, spans: [], propertyTimelines: properties };
}

export function spatialElement(sourceTransform = 'translateX(100px)'): HTMLElement {
  const element = document.createElement('div');
  element.id = 'box'; element.style.transform = sourceTransform;
  element.style.transformOrigin = '10% 20% 7px';
  document.body.append(element);
  return element;
}
