// packages/runtime/src/stage/html/__tests__/spatialSpecificity.test.ts
import { captureHtmlTransformBase, createHtmlStage, defaultPropertyRegistry, prepareHtmlResolution, resolveHtmlConflict } from '../../../index';
import type { HtmlPropertyBinding, IHtmlAnimationContext, IHtmlSpatialDefinition, ILayer } from '../../../index';
import { createHost, docOf, timeAt } from '../../__tests__/fakeStage';
import { number, spatialDefinition, spatialElement, spatialLayer, track } from './spatialFixtures';

afterEach(() => { document.body.replaceChildren(); });

function context(first: Readonly<Record<string, HtmlPropertyBinding>>, second: Readonly<Record<string, HtmlPropertyBinding>>,
  secondDefinition: Partial<IHtmlSpatialDefinition> = {}): IHtmlAnimationContext {
  return { version: 1, bindings: { group: first, specific: second },
    spatial: { group: [spatialDefinition({ id: 'a' })], specific: [spatialDefinition({ id: 'b', ...secondDefinition })] } };
}

function rotationContext(secondDefinition: Partial<IHtmlSpatialDefinition> = {}): IHtmlAnimationContext {
  return context({ rotation: { kind: 'spatial', projectionId: 'a', component: 'rotation', unit: 'deg' } },
    { rotation: { kind: 'spatial', projectionId: 'b', component: 'rotation', unit: 'deg' } }, secondDefinition);
}

function plan(layers: readonly ILayer[], animationContext: IHtmlAnimationContext) {
  return prepareHtmlResolution(docOf(layers, 101), layers.map((layer) => ({ layerId: layer.id, layer, target: layer.target!,
    elements: Array.from(document.querySelectorAll('selector' in layer.target! ? layer.target!.selector : '')) })), animationContext, defaultPropertyRegistry);
}

test('applies selector specificity to one spatial component despite different local projection identifiers', () => {
  const element = spatialElement(); element.className = 'button';
  const other = element.cloneNode(true) as HTMLElement; other.id = 'other'; document.body.append(other);
  const layers = [spatialLayer({ rotation: track(20) }, 'group', '.button'), spatialLayer({ rotation: track(80) }, 'specific', '#box')];
  for (const ordered of [layers, [...layers].reverse()]) {
    const animationContext = rotationContext(); const before = JSON.stringify({ ordered, animationContext });
    const resolved = plan(ordered, animationContext);
    expect(resolved.diagnostics).toEqual([]);
    expect(resolved.evaluate(51).find((state) => state.element === element)?.properties).toEqual([
      expect.objectContaining({ layerId: 'specific', property: 'rotation', value: { kind: 'number', value: 80 } })
    ]);
    const stage = createHtmlStage({ mode: 'frame', animationContext }); const host = createHost([stage]);
    try {
      host.load(docOf(ordered, 101)); host.render(timeAt(51));
      expect(stage.diagnostics).toEqual([]); expect(element.style.transform).toContain('rotate(80deg)');
      expect(other.style.transform).toContain('rotate(20deg)');
    } finally { host.destroy(); }
    expect(JSON.stringify({ ordered, animationContext })).toBe(before);
  }
});

test('composes distinct components sharing a physical source despite local identifier and provenance differences', () => {
  const element = spatialElement(); element.className = 'button';
  const animationContext = context({ offset: { kind: 'spatial', projectionId: 'a', component: 'translateX', unit: 'px' } },
    { rotation: { kind: 'spatial', projectionId: 'b', component: 'rotation', unit: 'deg' } }, {
      provenance: { ...spatialDefinition().provenance, transform: { kind: 'computed', computedValue: 'matrix(1,0,0,1,100,0)' } },
      conversions: [{ id: 'capture', property: 'rotation', confirmedAtFrame: 1, originalValue: 'var(--angle)',
        replacementValue: '0deg', reason: 'source-unavailable', consent: 'explicit' }]
    });
  const layers = [spatialLayer({ offset: track(30) }, 'group', '.button'), spatialLayer({ rotation: track(90) }, 'specific', '#box')];
  const stage = createHtmlStage({ mode: 'frame', animationContext }); const host = createHost([stage]);
  try {
    host.load(docOf(layers, 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    const result = captureHtmlTransformBase(element); expect(result.status).toBe('value');
    if (result.status !== 'value') throw new Error(result.reason);
    expect(result.value.x).toBeCloseTo(30, 8); expect(result.value.y).toBeCloseTo(100, 8);
    expect(element.style.transform).toContain('rotate(90deg)');
  } finally { host.destroy(); }
});

test('keeps differing values at equal specificity as a genuine priority conflict', () => {
  const element = spatialElement(); element.className = 'button primary';
  const layers = [spatialLayer({ rotation: track(20) }, 'group', '.button'), spatialLayer({ rotation: track(80) }, 'specific', '.primary')];
  const resolved = plan(layers, rotationContext());
  expect(resolved.diagnostics).toEqual([expect.objectContaining({ code: 'priority-conflict', blocking: true,
    choices: ['group', 'specific'] })]);
  expect(resolved.evaluate(51).find((state) => state.element === element)?.properties).toEqual([]);
});

test('does not invent a priority conflict for equal histories and physical sources with different provenance', () => {
  const element = spatialElement(); element.className = 'button primary';
  const animationContext = rotationContext({ provenance: { ...spatialDefinition().provenance,
    transform: { kind: 'computed', computedValue: 'matrix(1,0,0,1,100,0)' } } });
  const layers = [spatialLayer({ rotation: track(20) }, 'group', '.button'), spatialLayer({ rotation: track(20) }, 'specific', '.primary')];
  const before = JSON.stringify({ layers, animationContext }); const resolved = plan(layers, animationContext);
  expect(resolved.diagnostics).toEqual([]);
  expect(resolved.evaluate(51)[0].properties).toHaveLength(1);
  expect(resolved.sample('specific', 'rotation', 51)).toEqual({ status: 'value', value: number(20) });
  expect(JSON.stringify({ layers, animationContext })).toBe(before);
});

test('refuses conflicting aliases of one physical component within the same layer without an unusable layer choice', () => {
  const element = spatialElement(); element.className = 'button';
  const animationContext: IHtmlAnimationContext = { version: 1, bindings: { group: {
    rotation: { kind: 'spatial', projectionId: 'a', component: 'rotation', unit: 'deg' },
    alias: { kind: 'spatial', projectionId: 'b', component: 'rotation', unit: 'deg' }
  } }, spatial: { group: [spatialDefinition({ id: 'a' }), spatialDefinition({ id: 'b' })] } };
  const resolved = plan([spatialLayer({ rotation: track(20), alias: track(80) }, 'group', '.button')], animationContext);
  expect(resolved.diagnostics).toEqual([expect.objectContaining({ code: 'priority-conflict', blocking: true, choices: [] })]);
  expect(resolved.evaluate(51)[0].properties).toEqual([]);
});

test.each([false, true])('captures a winning component only when its physical source matches the requested channel (differentSource=%s)', (differentSource) => {
  const element = spatialElement(); element.className = 'button';
  const layers = [spatialLayer({ rotation: track(20) }, 'group', '.button'), spatialLayer({ rotation: track(80) }, 'specific', '#box')];
  const resolved = plan(layers, rotationContext(differentSource ? { sourceTransform: 'translateX(200px)' } : {}));
  expect(resolved.diagnostics).toEqual([]);
  expect(resolved.sample('specific', 'rotation', 51)).toEqual({ status: 'value', value: number(80) });
  if (differentSource) expect(resolved.sample('group', 'rotation', 51)).toMatchObject({ status: 'refused', code: 'unavailable' });
  else expect(resolved.sample('group', 'rotation', 51)).toEqual({ status: 'value', value: number(80) });
});

test('uses the compatible underlying rotation before the specific first key while retaining another component', () => {
  const element = spatialElement(); element.className = 'button';
  const animationContext = context({
    rotation: { kind: 'spatial', projectionId: 'a', component: 'rotation', unit: 'deg' },
    offset: { kind: 'spatial', projectionId: 'a', component: 'translateX', unit: 'px' }
  }, { rotation: { kind: 'spatial', projectionId: 'b', component: 'rotation', unit: 'deg' } });
  const layers = [spatialLayer({ offset: track(30), rotation: { initialValue: number(0), keys: [
    { frame: 1, value: number(20) }, { frame: 20, value: number(40) }
  ] } }, 'group', '.button'), spatialLayer({ rotation: { initialValue: number(0), keys: [
    { frame: 50, value: number(80) }, { frame: 101, value: number(100) }
  ] } }, 'specific', '#box')];
  const unresolved = plan(layers, animationContext);
  const diagnostic = unresolved.diagnostics.find((issue) => issue.code === 'before-first-conflict');
  expect(diagnostic).toBeDefined(); if (diagnostic === undefined) throw new Error('Expected before-first decision');
  const resolvedContext = resolveHtmlConflict(animationContext, diagnostic, 'specific', 'underlying');
  const resolved = plan(layers, resolvedContext); expect(resolved.diagnostics).toEqual([]);
  expect(resolved.trajectories()[0].properties.find((property) => property.property === 'rotation')).toMatchObject({
    layerId: 'specific', before: { until: 50, policy: 'underlying', underlying: { layerId: 'group' } }
  });
  const stage = createHtmlStage({ mode: 'frame', animationContext: resolvedContext }); const host = createHost([stage]);
  try {
    host.load(docOf(layers, 101));
    for (const [frame, angle, owner] of [[1, 20, 'group'], [20, 40, 'group'], [49.5, 40, 'group'], [50, 80, 'specific'], [75, 80, 'specific']] as const) {
      host.render(timeAt(frame));
      expect(stage.diagnostics).toEqual([]);
      expect(resolved.evaluate(frame)[0].properties.find((property) => property.property === 'rotation')).toMatchObject({ layerId: owner, value: number(angle) });
      expect(element.style.transform).toBe(`translate(30px, 0px) rotate(${angle}deg) scale(1, 1) translateX(100px)`);
    }
  } finally { host.destroy(); }
});

test('reports a global projection conflict when an underlying alternative actually coexists with an incompatible component', () => {
  const element = spatialElement(); element.className = 'button';
  const animationContext = context({ rotation: { kind: 'spatial', projectionId: 'a', component: 'rotation', unit: 'deg' } }, {
    rotation: { kind: 'spatial', projectionId: 'b', component: 'rotation', unit: 'deg' },
    offset: { kind: 'spatial', projectionId: 'b', component: 'translateX', unit: 'px' }
  }, { sourceTransform: 'translateX(200px)' });
  const layers = [spatialLayer({ rotation: { initialValue: number(0), keys: [
    { frame: 1, value: number(20) }, { frame: 20, value: number(40) }
  ] } }, 'group', '.button'), spatialLayer({ offset: track(30), rotation: { initialValue: number(0), keys: [
    { frame: 50, value: number(80) }, { frame: 101, value: number(100) }
  ] } }, 'specific', '#box')];
  const unresolved = plan(layers, animationContext);
  const prefix = unresolved.diagnostics.find((issue) => issue.code === 'before-first-conflict');
  expect(prefix).toBeDefined(); if (prefix === undefined) throw new Error('Expected before-first decision');
  const resolvedContext = resolveHtmlConflict(animationContext, prefix, 'specific', 'underlying');
  const resolved = plan(layers, resolvedContext);
  expect(resolved.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
    code: 'composition-conflict', blocking: true, fromFrame: 1, toFrame: 101, choices: ['group', 'specific']
  })]));
  expect(resolved.evaluate(25)[0].properties).toEqual([]);
  expect(resolved.evaluate(75)[0].properties).toEqual([]);
  expect(resolved.sample('specific', 'rotation', 25)).toMatchObject({ status: 'refused' });
});

test('permits different physical sources in mutually exclusive before-first alternatives of one component', () => {
  const element = spatialElement(); element.className = 'button';
  const animationContext = rotationContext({ sourceTransform: 'translateX(200px)' });
  const layers = [spatialLayer({ rotation: { initialValue: number(0), keys: [
    { frame: 1, value: number(20) }, { frame: 20, value: number(40) }
  ] } }, 'group', '.button'), spatialLayer({ rotation: { initialValue: number(0), keys: [
    { frame: 50, value: number(80) }, { frame: 101, value: number(100) }
  ] } }, 'specific', '#box')];
  const before = plan(layers, animationContext).diagnostics.find((issue) => issue.code === 'before-first-conflict');
  expect(before).toBeDefined(); if (before === undefined) throw new Error('Expected before-first decision');
  const resolvedContext = resolveHtmlConflict(animationContext, before, 'specific', 'underlying');
  const resolved = plan(layers, resolvedContext); expect(resolved.diagnostics).toEqual([]);
  expect(resolved.sample('specific', 'rotation', 25)).toMatchObject({ status: 'refused', code: 'unavailable' });
  expect(resolved.sample('specific', 'rotation', 75)).toEqual({ status: 'value', value: number(80) });
  const stage = createHtmlStage({ mode: 'frame', animationContext: resolvedContext }); const host = createHost([stage]);
  try {
    host.load(docOf(layers, 101)); host.render(timeAt(25));
    expect(stage.diagnostics).toEqual([]); expect(element.style.transform).toContain('rotate(40deg) scale(1, 1) translateX(100px)');
    host.render(timeAt(75));
    expect(stage.diagnostics).toEqual([]); expect(element.style.transform).toContain('rotate(80deg) scale(1, 1) translateX(200px)');
  } finally { host.destroy(); }
});

test('does not collapse equal numeric underlying prefixes whose physical sources differ', () => {
  const element = spatialElement(); element.className = 'left right';
  const rotation = (projectionId: string): HtmlPropertyBinding => ({ kind: 'spatial', projectionId, component: 'rotation', unit: 'deg' });
  const animationContext: IHtmlAnimationContext = { version: 1,
    bindings: { left: { rotation: rotation('a') }, right: { rotation: rotation('b') }, specific: { rotation: rotation('c') } },
    spatial: { left: [spatialDefinition({ id: 'a' })], right: [spatialDefinition({ id: 'b', sourceTransform: 'translateX(200px)' })],
      specific: [spatialDefinition({ id: 'c' })] } };
  const held = { initialValue: number(0), keys: [{ frame: 1, value: number(20) }] };
  const layers = [spatialLayer({ rotation: held }, 'left', '.left'), spatialLayer({ rotation: held }, 'right', '.right'),
    spatialLayer({ rotation: { initialValue: number(0), keys: [{ frame: 50, value: number(80) }, { frame: 101, value: number(100) }] } }, 'specific', '#box')];
  const initial = plan(layers, animationContext);
  const prefix = initial.diagnostics.find((issue) => issue.code === 'before-first-conflict');
  expect(prefix).toBeDefined(); if (prefix === undefined) throw new Error('Expected before-first decision');
  const selected = resolveHtmlConflict(animationContext, prefix, 'specific', 'underlying');
  const resolved = plan(layers, selected);
  expect(resolved.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({
    code: 'priority-conflict', blocking: true, choices: ['left', 'right']
  })]));
  expect(resolved.evaluate(25)[0].properties).toEqual([]);
  expect(resolved.evaluate(75)[0].properties).toEqual([expect.objectContaining({ layerId: 'specific', value: number(80) })]);
});
