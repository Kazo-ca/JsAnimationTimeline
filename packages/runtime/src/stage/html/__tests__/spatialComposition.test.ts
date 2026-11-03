// packages/runtime/src/stage/html/__tests__/spatialComposition.test.ts
import { composeHtmlDeclarations, composeHtmlSpatial } from '../../../index';
import type { IHtmlSpatialChange, TimelinePropertyValue } from '../../../index';
import { number, spatialDefinition, spatialElement, text } from './spatialFixtures';

afterEach(() => { document.body.replaceChildren(); });

test('composes source-relative adjustments from already evaluated values without mutating inputs or measuring DOM', () => {
  const definition = spatialDefinition({ sourceTransform: 'perspective(600px) rotateY(15deg) translateX(calc(25% + 1em))' });
  const changes: readonly IHtmlSpatialChange[] = [
    { binding: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'rem' }, value: number(2.5) },
    { binding: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'turn' }, value: number(0.25) },
    { binding: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }, value: number(-2) }
  ];
  const before = JSON.stringify({ definition, changes });
  expect(composeHtmlSpatial(definition, changes)).toEqual({ status: 'value', value: {
    transform: 'translate(2.5rem, 0px) rotate(0.25turn) scale(-2, 1) perspective(600px) rotateY(15deg) translateX(calc(25% + 1em))'
  } });
  expect(JSON.stringify({ definition, changes })).toBe(before);
});

test('changes one pivot axis while preserving the original other axis and Z expression', () => {
  const definition = spatialDefinition({ origin: { x: { value: 50, unit: '%' }, y: { css: 'calc(50% + 2em)' }, z: { css: 'var(--depth)' } } });
  expect(composeHtmlSpatial(definition, [{ binding: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' }, value: number(25) }]))
    .toEqual({ status: 'value', value: { 'transform-origin': '25% calc(50% + 2em) var(--depth)' } });
});

test('uses a held source-text value as the suffix and preserves the source definition', () => {
  const definition = spatialDefinition();
  const result = composeHtmlSpatial(definition, [
    { binding: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' }, value: number(45) },
    { binding: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' }, value: text('translateX(200px)') }
  ]);
  expect(result).toEqual({ status: 'value', value: { transform: 'translate(0px, 0px) rotate(45deg) scale(1, 1) translateX(200px)' } });
  expect(definition.sourceTransform).toBe('translateX(100px)');
});

test.each<TimelinePropertyValue>([number(NaN), number(Infinity), text('2'), { kind: 'boolean', value: true }])(
  'refuses invalid evaluated numeric values without a partial declaration', (value) => {
    expect(composeHtmlSpatial(spatialDefinition(), [
      { binding: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' }, value: number(45) },
      { binding: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }, value }
    ])).toMatchObject({ status: 'unsupported' });
  }
);

test('refuses duplicate channels and foreign projection IDs instead of picking an iteration-order winner', () => {
  const change: IHtmlSpatialChange = { binding: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }, value: number(2) };
  expect(composeHtmlSpatial(spatialDefinition(), [change, { ...change, value: number(3) }])).toMatchObject({ status: 'unsupported' });
  expect(composeHtmlSpatial(spatialDefinition(), [{ ...change, binding: { ...change.binding, projectionId: 'missing' } }]))
    .toMatchObject({ status: 'unsupported' });
});

test('uses the shared declaration compositor without changing the supplied element', () => {
  const element = spatialElement(); const before = element.getAttribute('style');
  const value = composeHtmlDeclarations(element, { angle: number(45), x: number(25), y: number(75) }, {
    angle: { binding: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' }, valueKind: 'number' },
    x: { binding: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' }, valueKind: 'number' },
    y: { binding: { kind: 'spatial', projectionId: 'geometry', component: 'pivotY', unit: '%' }, valueKind: 'number' }
  }, [], undefined, [spatialDefinition()]);
  expect(value.diagnostics).toEqual([]);
  expect(value.declarations).toEqual({ transform: 'translate(0px, 0px) rotate(45deg) scale(1, 1) translateX(100px)', 'transform-origin': '25% 75% 7px' });
  expect(element.getAttribute('style')).toBe(before);
});
