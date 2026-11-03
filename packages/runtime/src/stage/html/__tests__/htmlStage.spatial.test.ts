// packages/runtime/src/stage/html/__tests__/htmlStage.spatial.test.ts
import { captureHtmlTransformBase, compileHtmlPlayback, createHtmlPlaybackPlayer, createHtmlStage,
  evaluatePropertyTimeline, exportHtmlJavascript, parseHtmlPlayback } from '../../../index';
import type { IPropertyTimeline } from '../../../index';
import { createHost, docOf, timeAt } from '../../__tests__/fakeStage';
import { number, spatialContext, spatialDefinition, spatialElement, spatialLayer, text, track } from './spatialFixtures';

afterEach(() => { document.body.replaceChildren(); });

function sourceStyles(element: HTMLElement) {
  return ['transform', 'transform-origin'].map((name) => ({ name, value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name) }));
}

test('prepends the evaluated rotation to the source translation at the midpoint', () => {
  const element = spatialElement();
  const layer = spatialLayer();
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext() });
  const host = createHost([stage]);
  try {
    host.load(docOf([layer], 101)); host.render(timeAt(51));
    const result = captureHtmlTransformBase(element);
    expect(result.status).toBe('value');
    if (result.status !== 'value') throw new Error(result.reason);
    expect(result.value.x).toBeCloseTo(70.710678, 5);
    expect(result.value.y).toBeCloseTo(70.710678, 5);
  } finally { host.destroy(); }
});

test('retains HA4 absolute rotation behavior when no spatial binding is requested', () => {
  const element = spatialElement();
  const host = createHost([createHtmlStage({ mode: 'frame' })]);
  try {
    host.load(docOf([spatialLayer()], 101)); host.render(timeAt(51));
    const result = captureHtmlTransformBase(element);
    expect(result).toMatchObject({ status: 'value', value: { x: 100, y: 0, rotation: 45 } });
  } finally { host.destroy(); }
});

test('composes translation, rotation and scale before the retained source in the specified order', () => {
  const element = spatialElement();
  const context = spatialContext({
    offsetX: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' },
    offsetY: { kind: 'spatial', projectionId: 'geometry', component: 'translateY', unit: 'px' },
    rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
    sizeX: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' },
    sizeY: { kind: 'spatial', projectionId: 'geometry', component: 'scaleY' }
  });
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ offsetX: track(30), offsetY: track(40), rotation: track(90), sizeX: track(2), sizeY: track(3) })], 101));
    host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    const result = captureHtmlTransformBase(element);
    expect(result.status).toBe('value');
    if (result.status !== 'value') throw new Error(result.reason);
    expect(result.value.x).toBeCloseTo(30, 8); expect(result.value.y).toBeCloseTo(240, 8);
    expect(result.value.scaleX).toBeCloseTo(2, 8); expect(result.value.scaleY).toBeCloseTo(3, 8);
  } finally { host.destroy(); }
});

test.each([['rad', Math.PI / 2], ['turn', 0.25]] as const)('projects rotation expressed in %s without reinterpreting it as degrees', (unit, value) => {
  const element = spatialElement();
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit }
  }) }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation: track(0, value) })], 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    const result = captureHtmlTransformBase(element);
    expect(result.status).toBe('value');
    if (result.status !== 'value') throw new Error(result.reason);
    expect(result.value.x).toBeCloseTo(70.710678, 5); expect(result.value.y).toBeCloseTo(70.710678, 5);
  } finally { host.destroy(); }
});

test('projects the evaluated eased angle at fractional frames instead of interpolating endpoint matrices', () => {
  const element = spatialElement();
  const rotation = track(0, 90, { kind: 'effect', family: 'quadratic', mode: 'in' });
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext() });
  const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation })], 101));
    for (const frame of [1, 10.25, 49.125, 51, 89.875, 101]) {
      host.render(timeAt(frame));
      const angle = 90 * Math.pow((frame - 1) / 100, 2) * Math.PI / 180;
      const result = captureHtmlTransformBase(element);
      expect(result.status).toBe('value');
      if (result.status !== 'value') throw new Error(result.reason);
      expect(result.value.x).toBeCloseTo(100 * Math.cos(angle), 7);
      expect(result.value.y).toBeCloseTo(100 * Math.sin(angle), 7);
      expect(stage.diagnostics).toEqual([]);
    }
  } finally { host.destroy(); }
});

test('keeps relative translation and the unanimated origin axes without changing source styles', () => {
  const element = spatialElement('translateX(10%)');
  element.style.transformOrigin = '1.5rem calc(50% + 2em) var(--depth)';
  const source = sourceStyles(element);
  const context = spatialContext({
    offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: '%' },
    pivot: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: 'rem' }
  }, spatialDefinition({ sourceTransform: 'translateX(10%)',
    origin: { x: { value: 1.5, unit: 'rem' }, y: { css: 'calc(50% + 2em)' }, z: { css: 'var(--depth)' } },
    provenance: { transform: { kind: 'authored', authoredValue: 'translateX(10%)', computedValue: 'matrix(1,0,0,1,20,0)' },
      origin: { kind: 'authored', authoredValue: '1.5rem calc(50% + 2em) var(--depth)', computedValue: '24px 82px 7px' } } }));
  const before = JSON.stringify(context);
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ offset: track(12.5), pivot: track(2.75) })], 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    expect(element.style.transform).toMatch(/^translate\(12\.5%,\s*0px\).*translateX\(10%\)$/);
    expect(element.style.transformOrigin).toBe('2.75rem calc(50% + 2em) var(--depth)');
    expect(JSON.stringify(context)).toBe(before);
  } finally { host.destroy(); }
  expect(sourceStyles(element)).toEqual(source);
});

test('holds captured source transform text only from its selected keyframe onward', () => {
  const element = spatialElement();
  const sourceTransform: IPropertyTimeline = { initialValue: text('translateX(100px)'), keys: [
    { frame: 50, value: text('translateX(200px)') }, { frame: 80, value: text('translateX(30px)') }
  ] };
  const context = spatialContext({ rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
    source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' } });
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation: track(90), source: sourceTransform })], 101));
    for (const [frame, translation] of [[49.99, 100], [50, 200], [79.25, 200], [80, 30], [1, 100]]) {
      host.render(timeAt(frame));
      expect(stage.diagnostics).toEqual([]);
      const result = captureHtmlTransformBase(element);
      expect(result.status).toBe('value');
      if (result.status !== 'value') throw new Error(result.reason);
      expect(result.value.x).toBeCloseTo(0, 7); expect(result.value.y).toBeCloseTo(translation, 7);
    }
  } finally { host.destroy(); }
});

test('rejects executable or declaration-breaking source text without writing it to the element', () => {
  const element = spatialElement(); const source = element.getAttribute('style');
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' }
  }) }); const host = createHost([stage]);
  try {
    for (const value of ['none; display:none', 'translateX(url(javascript:alert(1)))', 'expression(alert(1))']) {
      host.load(docOf([spatialLayer({ source: { initialValue: text('translateX(100px)'), keys: [{ frame: 1, value: text(value) }] } })], 101));
      host.render(timeAt(1));
      expect(stage.diagnostics.some((issue) => issue.blocking)).toBe(true);
      expect(element.getAttribute('style')).toBe(source);
    }
  } finally { host.destroy(); }
});

test('keeps the text source channel non-interpolable through public property inspection', () => {
  spatialElement();
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' }
  }) }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ source: { initialValue: text('translateX(100px)'), keys: [{ frame: 50, value: text('translateX(200px)') }] } })], 101));
    expect(stage.inspectProperty({ selector: '#box' }, 'source', { layerId: 'box' })).toMatchObject({
      editable: true, interpolable: false, initialValue: text('translateX(100px)')
    });
  } finally { host.destroy(); }
});

test('refuses direct context changes that reinterpret a populated spatial unit without changing preview', () => {
  const element = spatialElement();
  const context = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: '%' } });
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ offset: track(10, 30) })], 101)); host.render(timeAt(51));
    const before = sourceStyles(element);
    const reinterpreted = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' } });
    expect(() => stage.setAnimationContext(reinterpreted)).toThrow();
    expect(stage.animationContext).toEqual(context); expect(sourceStyles(element)).toEqual(before);
    host.render(timeAt(51.25));
    const translated = element.style.transform.match(/^translate\(([^%]+)%, 0px\)/);
    expect(translated).not.toBeNull(); expect(Number(translated?.[1])).toBeCloseTo(20.05, 10);
  } finally { host.destroy(); }
});

test('protects the initial value unit of a retained track with no keys in the direct context setter', () => {
  const element = spatialElement();
  const context = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'em' } });
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ offset: { initialValue: number(2), keys: [] } })], 101)); host.render(timeAt(1));
    const before = sourceStyles(element);
    const reinterpreted = spatialContext({ offset: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'px' } });
    expect(() => stage.setAnimationContext(reinterpreted)).toThrow();
    expect(stage.animationContext).toEqual(context); expect(sourceStyles(element)).toEqual(before);
    host.render(timeAt(75.5)); expect(sourceStyles(element)).toEqual(before);
  } finally { host.destroy(); }
});

test.each([0, -2, 3])('supports the finite scale value %s without a hidden clamp', (scale) => {
  const element = spatialElement();
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    size: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }
  }) }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ size: track(scale) })], 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]); expect(element.style.transform).toContain(`scale(${scale}, 1)`);
  } finally { host.destroy(); }
});

test('preserves easing overshoot for a spatial scale outside the Designer authored-input restriction', () => {
  const element = spatialElement();
  const size = track(0.01, 0.1, { kind: 'effect', family: 'back', mode: 'in', parameters: { amplitude: 10 } });
  const evaluated = evaluatePropertyTimeline(size, 51);
  expect(evaluated.kind).toBe('number');
  if (evaluated.kind !== 'number') throw new Error('Expected numeric fixture');
  expect(evaluated.value).toBeLessThan(0);
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    size: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }
  }) }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ size })], 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    const displayed = Number(element.style.transform.match(/scale\(([^,]+)/)?.[1]);
    expect(displayed).toBeCloseTo(evaluated.value, 10);
  } finally { host.destroy(); }
});

test('uses the same projection for HA5 JSON playback and standalone Javascript export', () => {
  const element = spatialElement();
  const data = docOf([spatialLayer()], 101); const context = spatialContext();
  const source = sourceStyles(element); const before = JSON.stringify({ data, context });
  const compiled = compileHtmlPlayback(data, { root: document.body, animationContext: context });
  expect(compiled.status).toBe('exported');
  if (compiled.status !== 'exported') throw new Error(JSON.stringify(compiled.diagnostics));
  expect(sourceStyles(element)).toEqual(source); expect(JSON.stringify({ data, context })).toBe(before);
  const playback = parseHtmlPlayback(JSON.parse(JSON.stringify(compiled.data)));
  const player = createHtmlPlaybackPlayer(playback, { root: document.body });
  try {
    player.seek(51);
    const result = captureHtmlTransformBase(element);
    expect(result.status).toBe('value');
    if (result.status !== 'value') throw new Error(result.reason);
    expect(result.value.x).toBeCloseTo(70.710678, 5); expect(result.value.y).toBeCloseTo(70.710678, 5);
    const javascript = exportHtmlJavascript(playback);
    expect(javascript).toContain('rotate(45deg)'); expect(javascript).toContain('translateX(100px)');
  } finally { player.destroy(); }
  expect(sourceStyles(element)).toEqual(source);
});

test('composes two independent pivot channels into one transform origin', () => {
  const element = spatialElement();
  const layer = spatialLayer({ pivotX: track(25), pivotY: track(75) });
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    pivotX: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' },
    pivotY: { kind: 'spatial', projectionId: 'geometry', component: 'pivotY', unit: '%' }
  }) });
  const host = createHost([stage]);
  try {
    host.load(docOf([layer], 101)); host.render(timeAt(1));
    expect(stage.diagnostics).toEqual([]);
    expect(element.style.transformOrigin).toBe('25% 75% 7px');
  } finally { host.destroy(); }
});
