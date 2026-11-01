// packages/export-css/src/continuous/__tests__/target.browser.test.ts
import type { IPropertyTimeline, IHtmlResolvedBinding, HtmlTransformValues } from '@kazo-ca/timeline-runtime';
import { compileContinuousTarget } from '../target';

const number = (value: number) => ({ kind: 'number' as const, value });
const track = (from: number, to: number, first = 10, last = 80): IPropertyTimeline => ({ initialValue: number(from),
  keys: [{ frame: first, value: number(from) }, { frame: last, value: number(to) }], transitions: [{ id: 'move', fromFrame: first, toFrame: last }] });
const transformBase: HtmlTransformValues = { x: 0, y: 0, rotation: 30, scaleX: 1, scaleY: 1, skewX: 0, skewY: 0 };
function trajectory(property: string, timeline: IPropertyTimeline, binding: IHtmlResolvedBinding['binding']) {
  return { layerId: 'object', property, timeline, binding: { binding, valueKind: timeline.initialValue.kind } };
}

describe('continuous CSS destination compilation', () => {
  it('uses independent destinations for opacity and position timing', () => {
    const result = compileContinuousTarget({ selector: '#scene #box', element: document.createElement('div'), gradients: [], trajectories: [
      trajectory('opacity', track(0.2, 0.9), { kind: 'style', cssName: 'opacity' }),
      trajectory('left', track(8, 100, 20, 65), { kind: 'style', cssName: 'left', unit: 'px' })
    ] }, 97);
    expect(result.map((animation) => animation.property)).toEqual(['opacity', 'left']);
    expect(result[0].frames.map((frame) => frame.frame)).toEqual([1, 10, 80, 98]);
    expect(result[1].frames.map((frame) => frame.frame)).toEqual([1, 20, 65, 98]);
    expect(result[1].frames[2].value).toBe('100px');
  });

  it('keeps an unanimated transform base while animating one component', () => {
    const result = compileContinuousTarget({ selector: '#scene #box', element: document.createElement('div'), gradients: [], transformBase,
      trajectories: [trajectory('x', track(12, 80, 1, 97), { kind: 'transform', component: 'x' })] }, 97);
    expect(result[0].property).toBe('transform');
    expect(result[0].frames[0].value).toContain('translate(12px, 0px) rotate(30deg)');
    expect(result[0].frames[1].value).toContain('translate(80px, 0px) rotate(30deg)');
  });

  it('refuses incompatible component timings instead of sharing one arbitrary easing', () => {
    const x = { ...track(0, 100), transitions: [{ id: 'x', fromFrame: 10, toFrame: 80, easing: { kind: 'bezier' as const, x1: 0.42, y1: 0, x2: 1, y2: 1 } }] };
    expect(() => compileContinuousTarget({ selector: '#box', element: document.createElement('div'), gradients: [], transformBase, trajectories: [
      trajectory('x', x, { kind: 'transform', component: 'x' }), trajectory('y', track(0, 20), { kind: 'transform', component: 'y' })
    ] }, 100)).toThrow(/composantes/);
  });

  it('does not mistake equal samples around an easing excursion for a held interval', () => {
    const x = { ...track(0, 100, 1, 101), transitions: [{ id: 'x', fromFrame: 1, toFrame: 101,
      easing: { kind: 'bezier' as const, x1: 0, y1: 0, x2: 1, y2: -1 / 3 } }] };
    const held: IPropertyTimeline = { initialValue: number(0), keys: [{ frame: 51, value: number(0) }] };
    expect(() => compileContinuousTarget({ selector: '#box', element: document.createElement('div'), gradients: [], transformBase, trajectories: [
      trajectory('x', x, { kind: 'transform', component: 'x' }), trajectory('y', held, { kind: 'transform', component: 'y' })
    ] }, 101)).toThrow(/découpée/);
  });

  it('refuses intrinsic CSS clamping and unsupported numeric interpolation', () => {
    const target = { selector: '#box', element: document.createElement('div'), gradients: [] };
    expect(() => compileContinuousTarget({ ...target, trajectories: [trajectory('opacity', track(-1, 2), { kind: 'style', cssName: 'opacity' })] }, 100)).toThrow(/bornage/);
    expect(() => compileContinuousTarget({ ...target, trajectories: [trajectory('z', track(0, 10), { kind: 'style', cssName: 'z-index' })] }, 100)).toThrow(/destination/);
    expect(() => compileContinuousTarget({ ...target, trajectories: [trajectory('left', track(0, 10), { kind: 'style', cssName: 'left', unit: '%' })] }, 100)).toThrow(/unité/);
  });

  it('retains held colors and refuses animation-control destinations', () => {
    const color: IPropertyTimeline = { initialValue: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, keys: [{ frame: 40, value: { kind: 'color', r: 1, g: 0, b: 0, a: 0.5 } }] };
    const target = { selector: '#box', element: document.createElement('div'), gradients: [] };
    const result = compileContinuousTarget({ ...target, trajectories: [trajectory('color', color, { kind: 'style', cssName: 'background-color' })] }, 100);
    expect(result[0].frames.map((frame) => frame.value)).toEqual(['rgba(0, 0, 255, 1)', 'rgba(255, 0, 0, 0.5)', 'rgba(255, 0, 0, 0.5)']);
    expect(() => compileContinuousTarget({ ...target, trajectories: [trajectory('name', { initialValue: { kind: 'text', value: 'none' }, keys: [] }, { kind: 'style', cssName: 'animation-name' })] }, 100)).toThrow(/destination/);
  });
});
