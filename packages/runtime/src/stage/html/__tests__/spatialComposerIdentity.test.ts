// packages/runtime/src/stage/html/__tests__/spatialComposerIdentity.test.ts
import { composeHtmlDeclarations } from '../../../index';
import type { IHtmlResolvedBinding, IHtmlSpatialDefinition } from '../../../index';
import { number, spatialDefinition, spatialElement } from './spatialFixtures';

afterEach(() => { document.body.replaceChildren(); });

const bindings: Readonly<Record<string, IHtmlResolvedBinding>> = {
  rotation: { valueKind: 'number', binding: { kind: 'spatial', projectionId: 'a', component: 'rotation', unit: 'deg' } },
  offset: { valueKind: 'number', binding: { kind: 'spatial', projectionId: 'b', component: 'translateX', unit: 'px' } }
};

test('composes physically identical sources addressed by different local identifiers through the public declaration composer', () => {
  const element = spatialElement();
  const definitions = [spatialDefinition({ id: 'a' }), spatialDefinition({ id: 'b',
    provenance: { ...spatialDefinition().provenance, transform: { kind: 'computed', computedValue: 'matrix(1,0,0,1,100,0)' } } })];
  const original = JSON.stringify(definitions); const source = element.getAttribute('style');
  const result = composeHtmlDeclarations(element, { rotation: number(45), offset: number(10) }, bindings, [], undefined, definitions);
  expect(result.diagnostics).toEqual([]);
  expect(result.declarations.transform).toBe('translate(10px, 0px) rotate(45deg) scale(1, 1) translateX(100px)');
  expect(JSON.stringify(definitions)).toBe(original); expect(element.getAttribute('style')).toBe(source);
});

test.each<{ label: string; definitions: readonly IHtmlSpatialDefinition[] }>([
  { label: 'missing source', definitions: [spatialDefinition({ id: 'a' })] },
  { label: 'duplicate source', definitions: [spatialDefinition({ id: 'a' }), spatialDefinition({ id: 'b' }), spatialDefinition({ id: 'b' })] },
  { label: 'different physical source', definitions: [spatialDefinition({ id: 'a' }), spatialDefinition({ id: 'b', sourceTransform: 'translateX(200px)' })] }
])('refuses $label without emitting a partial transform', ({ definitions }) => {
  const result = composeHtmlDeclarations(spatialElement(), { rotation: number(45), offset: number(10) }, bindings, [], undefined, definitions);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.declarations.transform).toBeUndefined();
});

describe('a spatial refusal beside a valid HA4 transform', () => {
  const beside: Readonly<Record<string, IHtmlResolvedBinding>> = {
    x: { valueKind: 'number', binding: { kind: 'transform', component: 'x' } },
    pivot: { valueKind: 'number', binding: { kind: 'spatial', projectionId: 'absent', component: 'pivotX', unit: '%' } },
    rotation: { valueKind: 'number', binding: { kind: 'spatial', projectionId: 'absent', component: 'rotation', unit: 'deg' } }
  };

  test('keeps the transform when only a pivot is refused', () => {
    const { x, pivot } = beside;
    const result = composeHtmlDeclarations(spatialElement(), { x: number(10), pivot: number(50) }, { x, pivot }, [], undefined, []);
    expect(result.declarations.transform).toBeDefined();
    expect(result.declarations['transform-origin']).toBeUndefined();
    expect(new Set(result.diagnostics.map(({ property }) => property))).toEqual(new Set(['pivot']));
  });

  test('reports the transform when the refused projection also drives it', () => {
    const { x, rotation } = beside;
    const result = composeHtmlDeclarations(spatialElement(), { x: number(10), rotation: number(45) }, { x, rotation }, [], undefined, []);
    expect(result.declarations.transform).toBeUndefined();
    expect(new Set(result.diagnostics.map(({ property }) => property))).toEqual(new Set(['rotation', 'x']));
  });
});
