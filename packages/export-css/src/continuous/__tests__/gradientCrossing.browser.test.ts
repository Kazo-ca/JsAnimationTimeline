// packages/export-css/src/continuous/__tests__/gradientCrossing.browser.test.ts
import type { IHtmlAnimationContext, ITimelineDocument, IPropertyTimeline } from '@kazo-ca/timeline-runtime';
import { exportHtmlCss } from '../../exportHtmlCss';

const n = (value: number) => ({ kind: 'number' as const, value });
const context: IHtmlAnimationContext = { version: 1, bindings: { fill: {
  bluePosition: { kind: 'gradient', gradientId: 'fill', stopId: 'blue', component: 'position' }
} }, gradients: { fill: [{ id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
  centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
    { id: 'red', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, position: 20, opacity: 1, present: true },
    { id: 'blue', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, position: 80, opacity: 1, present: true }
  ] }] } };
function scene(interpolated: boolean): ITimelineDocument {
  const timeline: IPropertyTimeline = { initialValue: n(80), keys: [{ frame: 1, value: n(80) }, { frame: 5, value: n(0) }],
    ...(interpolated ? { transitions: [{ id: 'crossing', fromFrame: 1, toFrame: 5 }] } : {}) };
  return { version: '2.0.0', settings: { fps: 24, totalFrames: 8 }, layers: [{ id: 'fill', name: 'Gradient', type: 'layer',
    target: { selector: '#box' }, spans: [], propertyTimelines: { bluePosition: timeline } }] };
}
beforeEach(() => { document.body.innerHTML = '<main id="scene"><div id="box"></div></main>'; });

test('exports held crossed stops faithfully without changing the saved context or source DOM', () => {
  const doc = scene(false);
  const before = JSON.stringify({ doc, context });
  const dom = document.documentElement.outerHTML;
  const result = exportHtmlCss(doc, { root: document.querySelector('main')!, animationContext: context });
  expect(result.status).toBe('exported');
  if (result.status !== 'exported') throw new Error(JSON.stringify(result.diagnostics));
  expect(result.fidelity).toBe('continuous');
  expect(result.css).toContain('background-image: linear-gradient(90deg, rgba(255, 0, 0, 1) 20%, rgba(0, 0, 255, 1) 80%)');
  expect(result.css).toContain('50% { background-image: linear-gradient(90deg, rgba(0, 0, 255, 1) 0%, rgba(255, 0, 0, 1) 20%); animation-timing-function: steps(1, end); }');
  expect(JSON.stringify({ doc, context })).toBe(before);
  expect(document.documentElement.outerHTML).toBe(dom);
});

test('refuses an interpolated crossing as a whole CSS artifact and retains JSON/JavaScript alternatives', () => {
  const doc = scene(true);
  const before = JSON.stringify({ doc, context });
  const result = exportHtmlCss(doc, { root: document.querySelector('main')!, animationContext: context });
  expect(result).toMatchObject({ status: 'refused', css: '', html: '', alternatives: ['javascript', 'json'],
    diagnostics: [expect.objectContaining({ code: 'unsupported-gradient-interpolation', layerId: 'fill', property: 'bluePosition' })] });
  expect(JSON.stringify({ doc, context })).toBe(before);
});
