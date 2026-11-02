// packages/runtime/src/stage/html/__tests__/gradients.test.ts
import { composeHtmlDeclarations } from '../cssCompose';
import { readHtmlPropertyBase } from '../cssBaseline';
import { isHtmlGradientDefinition } from '../gradients';
import type { IHtmlGradientDefinition, IHtmlResolvedBinding } from '../cssTypes';
import type { TimelinePropertyValue } from '../../../model/propertyTimeline';

const gradient: IHtmlGradientDefinition = { id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
  centerX: 50, centerY: 50, radiusX: 50, radiusY: 50,
  stops: [
    { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, opacity: 1, position: 0, present: true },
    { id: 'middle', color: { kind: 'color', r: 0, g: 1, b: 0, a: 1 }, opacity: .5, position: 40, present: false },
    { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, opacity: 1, position: 100, present: true }
  ] };
const n = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const bound = (component: 'angle' | 'position' | 'opacity' | 'present' | 'type' | 'color', stopId?: string): IHtmlResolvedBinding => ({
  binding: { kind: 'gradient', gradientId: 'fill', component, ...(stopId ? { stopId } : {}) },
  valueKind: component === 'present' ? 'boolean' : component === 'type' ? 'text' : component === 'color' ? 'color' : 'number'
});

it('validates unique stable stop ids and canonical RGB/opacity ownership', () => {
  expect(isHtmlGradientDefinition(gradient)).toBe(true);
  expect(isHtmlGradientDefinition({ ...gradient, stops: [gradient.stops[0], gradient.stops[0]] })).toBe(false);
  expect(isHtmlGradientDefinition({ ...gradient, stops: [{ ...gradient.stops[0], color: { ...gradient.stops[0].color, a: .5 } }, gradient.stops[2]] })).toBe(false);
  expect(isHtmlGradientDefinition({ ...gradient, radiusX: -1 })).toBe(false);
});

it('reads individual source components without depending on stop array indices', () => {
  const target = document.createElement('div');
  expect(readHtmlPropertyBase(target, bound('position', 'right'), [gradient])).toEqual({ status: 'value', value: n(100) });
  expect(readHtmlPropertyBase(target, bound('present', 'middle'), [gradient])).toEqual({ status: 'value', value: { kind: 'boolean', value: false } });
  expect(readHtmlPropertyBase(target, bound('opacity', 'missing'), [gradient]).status).toBe('unsupported');
});

it('adds and removes a stop at its own key without changing other stop values or identities', () => {
  const target = document.createElement('div');
  const render = (present: boolean) => composeHtmlDeclarations(target,
    { presence: { kind: 'boolean', value: present }, rightPosition: n(80) },
    { presence: bound('present', 'middle'), rightPosition: bound('position', 'right') }, [gradient]);
  expect(render(false).declarations['background-image']).toBe('linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(0, 0, 255, 1) 80%)');
  expect(render(true).declarations['background-image']).toBe('linear-gradient(90deg, rgba(255, 0, 0, 1) 0%, rgba(0, 255, 0, 0.5) 40%, rgba(0, 0, 255, 1) 80%)');
  expect(gradient.stops[2].position).toBe(100);
  expect(gradient.stops[1].present).toBe(false);
});

it('composes linear, radial and conic geometry from the same stable stops', () => {
  const target = document.createElement('div');
  const render = (type: string) => composeHtmlDeclarations(target, { type: { kind: 'text', value: type } }, { type: bound('type') }, [gradient]);
  expect(render('radial').declarations['background-image']).toContain('radial-gradient(ellipse 50% 50% at 50% 50%,');
  expect(render('conic').declarations['background-image']).toContain('conic-gradient(from 90deg at 50% 50%,');
  expect(render('conic').declarations['background-image']).toContain('100%)');
  expect(render('invalid').declarations['background-image']).toBeUndefined();
  expect(render('invalid').diagnostics).toHaveLength(1);
});

it('rejects invalid alpha or too few present stops while retaining unrelated declarations', () => {
  const target = document.createElement('div');
  const invalid = composeHtmlDeclarations(target,
    { color: { kind: 'color', r: 1, g: 0, b: 0, a: .3 }, opacity: n(.7) },
    { color: bound('color', 'left'), opacity: { binding: { kind: 'style', cssName: 'opacity', unit: '' }, valueKind: 'number' } }, [gradient]);
  expect(invalid.declarations).toEqual({ opacity: '0.7' });
  expect(invalid.diagnostics).toHaveLength(1);
  const removed = composeHtmlDeclarations(target, { presence: { kind: 'boolean', value: false } }, { presence: bound('present', 'left') }, [gradient]);
  expect(removed.declarations['background-image']).toBeUndefined();
  expect(removed.diagnostics).toHaveLength(1);
});

it.each(['linear', 'radial', 'conic'] as const)('orders crossed %s stops by evaluated position without changing their channels or source', (type) => {
  const definition: IHtmlGradientDefinition = { ...gradient, type };
  const before = JSON.stringify(definition);
  const target = document.createElement('div');
  const result = composeHtmlDeclarations(target,
    { rightPosition: n(-20), leftOpacity: n(.25), rightColor: { kind: 'color', r: 1, g: 1, b: 0, a: 1 } },
    { rightPosition: bound('position', 'right'), leftOpacity: bound('opacity', 'left'), rightColor: bound('color', 'right') }, [definition]);
  expect(result.diagnostics).toEqual([]);
  expect(result.declarations['background-image']).toContain('rgba(255, 255, 0, 1) -20%, rgba(255, 0, 0, 0.25) 0%');
  expect(result.declarations['background-image']).not.toContain('rgba(0, 255, 0,');
  expect(JSON.stringify(definition)).toBe(before);
  expect(readHtmlPropertyBase(target, bound('position', 'right'), [definition])).toEqual({ status: 'value', value: n(100) });
});

it('preserves structural order at equal positions after seeking across a crossing', () => {
  const definition: IHtmlGradientDefinition = { ...gradient, stops: [gradient.stops[2], gradient.stops[0]] };
  const before = JSON.stringify(definition);
  const target = document.createElement('div');
  const render = (left: number, right: number) => composeHtmlDeclarations(target,
    { leftPosition: n(left), rightPosition: n(right) },
    { leftPosition: bound('position', 'left'), rightPosition: bound('position', 'right') }, [definition]).declarations['background-image'];
  expect(render(20, 80)).toBe('linear-gradient(90deg, rgba(255, 0, 0, 1) 20%, rgba(0, 0, 255, 1) 80%)');
  expect(render(80, 20)).toBe('linear-gradient(90deg, rgba(0, 0, 255, 1) 20%, rgba(255, 0, 0, 1) 80%)');
  expect(render(50, 50)).toBe('linear-gradient(90deg, rgba(0, 0, 255, 1) 50%, rgba(255, 0, 0, 1) 50%)');
  expect(render(20, 80)).toBe('linear-gradient(90deg, rgba(255, 0, 0, 1) 20%, rgba(0, 0, 255, 1) 80%)');
  expect(JSON.stringify(definition)).toBe(before);
});
