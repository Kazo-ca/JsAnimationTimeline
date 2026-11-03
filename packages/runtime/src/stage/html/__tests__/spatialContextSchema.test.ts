// packages/runtime/src/stage/html/__tests__/spatialContextSchema.test.ts
import Ajv2020 from 'ajv/dist/2020';
import { cloneHtmlAnimationContext } from '../../../index';
import { readJson } from '../../../model/__tests__/fixtures/schema';
import { spatialContext, spatialDefinition } from './spatialFixtures';

const schema = readJson('html-animation-context.schema.json');
if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) throw new Error('Expected context schema');
const validate = new Ajv2020({ strict: true, allErrors: true }).compile({ ...schema });

test('clones and serializes spatial definitions, expression origins and explicit conversion provenance', () => {
  const context = spatialContext(undefined, spatialDefinition({
    sourceTransform: 'translateX(calc(5% + 2px)) rotate(var(--source-angle))',
    origin: { x: { css: 'calc(50% + 2em)' }, y: { value: 20, unit: '%' }, z: { css: 'var(--origin-depth)' } },
    conversions: [{ id: 'convert-source', property: 'source', confirmedAtFrame: 50,
      originalValue: 'var(--source-transform)', replacementValue: 'translateX(100px)', reason: 'source-unavailable', consent: 'explicit' }]
  }));
  const before = JSON.stringify(context); const cloned = cloneHtmlAnimationContext(context);
  expect(cloned).toEqual(context); expect(JSON.stringify(context)).toBe(before);
  expect(validate(cloned)).toBe(true); expect(validate.errors).toBeNull();
  expect(cloneHtmlAnimationContext(JSON.parse(JSON.stringify(cloned)))).toEqual(context);
  expect(cloned.spatial).not.toBe(context.spatial);
  expect(cloned.spatial?.box[0].origin).not.toBe(context.spatial?.box[0].origin);
  expect(cloned.spatial?.box[0].provenance.transform).not.toBe(context.spatial?.box[0].provenance.transform);
  expect(cloned.spatial?.box[0].conversions?.[0]).not.toBe(context.spatial?.box[0].conversions?.[0]);
});

test.each(['px', '%', 'em', 'rem', 'vw', 'vh'] as const)('preserves the spatial length unit %s', (unit) => {
  const context = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit } });
  expect(validate(context)).toBe(true); expect(cloneHtmlAnimationContext(context)).toEqual(context);
});

test.each(['deg', 'rad', 'turn'] as const)('preserves the spatial angle unit %s', (unit) => {
  const context = spatialContext({ rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit } });
  expect(validate(context)).toBe(true); expect(cloneHtmlAnimationContext(context)).toEqual(context);
});

test.each<unknown>([
  { ...spatialDefinition(), version: 2 }, { ...spatialDefinition(), composition: 'append-trs' },
  { ...spatialDefinition(), id: '' }, { ...spatialDefinition(), unknown: true },
  { ...spatialDefinition(), origin: { x: { value: 10, unit: '%' }, y: { value: 20, unit: '%' }, z: { value: 5, unit: '%' } } },
  { ...spatialDefinition(), origin: { x: { value: 10, unit: '%', css: '10%' }, y: { value: 20, unit: '%' }, z: { value: 0, unit: 'px' } } },
  { ...spatialDefinition(), provenance: { transform: { kind: 'guessed', computedValue: 'none' }, origin: { kind: 'computed', computedValue: '0px 0px' } } },
  { ...spatialDefinition(), conversions: [{ id: 'conversion', property: 'source', confirmedAtFrame: 0,
    originalValue: 'none', replacementValue: 'none', reason: 'source-unavailable', consent: 'explicit' }] },
  { ...spatialDefinition(), conversions: [{ id: 'conversion', property: 'source', confirmedAtFrame: 50,
    originalValue: 'none', replacementValue: 'none', reason: 'source-unavailable', consent: 'implicit' }] }
])('rejects malformed spatial context through both public clone and JSON schema', (definition) => {
  const value = { ...spatialContext(), spatial: { box: [definition] } };
  expect(validate(value)).toBe(false); expect(() => cloneHtmlAnimationContext(value)).toThrow();
});

test.each<unknown>([
  { kind: 'spatial', projectionId: 'geometry', component: 'rotateX', unit: 'deg' },
  { kind: 'spatial', projectionId: 'geometry', component: 'scaleX', unit: '%' },
  { kind: 'spatial', projectionId: 'geometry', component: 'translateX' },
  { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'deg' },
  { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform', unit: '' },
  { kind: 'spatial', projectionId: '', component: 'rotation', unit: 'deg' }
])('rejects a malformed spatial binding without unit inference', (binding) => {
  const value = { ...spatialContext(), bindings: { box: { rotation: binding } } };
  expect(validate(value)).toBe(false); expect(() => cloneHtmlAnimationContext(value)).toThrow();
});

test('rejects dangling projection references and duplicate definitions after shape validation', () => {
  const definition = spatialDefinition();
  for (const context of [{ ...spatialContext(), spatial: {} },
    { ...spatialContext(), spatial: { box: [definition, { ...definition, sourceTransform: 'none' }] } }]) {
    expect(validate(context)).toBe(true); expect(() => cloneHtmlAnimationContext(context)).toThrow();
  }
});

test.each(['none; color:red', 'translateX(url(javascript:alert(1)))', 'rotate(banana)',
  'translateX(calc(1px +))', 'translateX(1e999px)', 'matrix(1,0,0,1,1e999,0)',
  `translateX(calc(${'('.repeat(150)}1px${')'.repeat(150)}))`,
  `translateX(${'calc('.repeat(150)}1px${')'.repeat(150)})`])(
  'refuses unsafe or malformed source syntax after structural schema validation', (sourceTransform) => {
    const context = spatialContext(undefined, spatialDefinition({ sourceTransform }));
    expect(validate(context)).toBe(true);
    expect(() => cloneHtmlAnimationContext(context)).toThrow(TypeError);
  }
);

test('refuses declaration-breaking origin expressions after structural schema validation', () => {
  const context = spatialContext(undefined, spatialDefinition({ origin: { ...spatialDefinition().origin, x: { css: '0;display:none' } } }));
  expect(validate(context)).toBe(true); expect(() => cloneHtmlAnimationContext(context)).toThrow(TypeError);
});

test('rejects accessor and prototype payloads without running user code', () => {
  const getter = jest.fn(() => 'none'); const definition = { ...spatialDefinition() };
  Object.defineProperty(definition, 'sourceTransform', { enumerable: true, get: getter });
  expect(() => cloneHtmlAnimationContext({ ...spatialContext(), spatial: { box: [definition] } })).toThrow();
  expect(getter).not.toHaveBeenCalled();
  const unsafe: unknown = JSON.parse('{"version":1,"spatial":{"__proto__":[]}}');
  expect(validate(unsafe)).toBe(false); expect(() => cloneHtmlAnimationContext(unsafe)).toThrow();
});

test.each([NaN, Infinity, -Infinity])('rejects non-finite origin value %s before any application', (value) => {
  const definition = spatialDefinition({ origin: { ...spatialDefinition().origin, x: { value, unit: '%' } } });
  const context = spatialContext(undefined, definition);
  expect(validate(context)).toBe(false); expect(() => cloneHtmlAnimationContext(context)).toThrow();
});
