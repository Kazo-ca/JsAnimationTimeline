// packages/runtime/src/stage/html/__tests__/spatialResolution.test.ts
import { createHtmlStage, defaultPropertyRegistry, prepareHtmlResolution, resolveHtmlConflict } from '../../../index';
import type { IHtmlAnimationContext, IHtmlSpatialDefinition, ILayer, IPropertyTimeline } from '../../../index';
import { createHost, docOf, timeAt } from '../../__tests__/fakeStage';
import { spatialContext, spatialDefinition, spatialElement, spatialLayer, text, track } from './spatialFixtures';

afterEach(() => { document.body.replaceChildren(); document.head.replaceChildren(); });

function equalComputedSpatialStyles() {
  const read = window.getComputedStyle.bind(window);
  return jest.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const computed = read(element, pseudo);
    if (!(element instanceof HTMLElement) || !element.classList.contains('group')) return computed;
    const captured = document.createElement('div').style;
    captured.cssText = computed.cssText;
    captured.transform = 'matrix(1,0,0,1,100,0)'; captured.transformOrigin = '100px 100px 7px';
    return captured;
  });
}

function plan(layers: readonly ILayer[], context: IHtmlAnimationContext) {
  return prepareHtmlResolution(docOf(layers, 101), layers.map((layer) => ({ layerId: layer.id, layer,
    target: layer.target!, elements: [document.getElementById('box')!] })), context, defaultPropertyRegistry);
}

function overlappingContext(definition = spatialDefinition()): IHtmlAnimationContext {
  const base = spatialContext();
  return { version: 1, bindings: { first: base.bindings!.box, second: base.bindings!.box },
    spatial: { first: [definition], second: [spatialDefinition()] } };
}

test.each<Partial<IHtmlSpatialDefinition>>([
  { sourceTransform: 'translateX(200px)' },
  { origin: { ...spatialDefinition().origin, x: { value: 30, unit: '%' } } },
  { provenance: { ...spatialDefinition().provenance,
    transform: { kind: 'computed', computedValue: 'matrix(1,0,0,1,100,0)' } } },
  { conversions: [{ id: 'source-conversion', property: 'rotation', confirmedAtFrame: 40,
    originalValue: 'var(--rotation)', replacementValue: '0deg', reason: 'source-unavailable', consent: 'explicit' }] }
])('invalidates a saved conflict decision when any spatial definition input changes', (change) => {
  const element = spatialElement(); element.className = 'first second';
  const layers = [spatialLayer({ rotation: track(20) }, 'first', '.first'),
    spatialLayer({ rotation: track(80) }, 'second', '.second')];
  const context = overlappingContext(); const before = JSON.stringify({ layers, context });
  const original = plan(layers, context).diagnostics.find((issue) => issue.code === 'priority-conflict');
  expect(original).toBeDefined(); if (original === undefined) throw new Error('Expected conflict fixture');
  const saved = resolveHtmlConflict(context, original, 'second');
  expect(plan(layers, saved).diagnostics).toEqual([]);
  const changed = { ...saved, spatial: { ...saved.spatial, first: [spatialDefinition(change)] } };
  const diagnostics = plan(layers, changed).diagnostics;
  expect(diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'stale-resolution', blocking: true })]));
  expect(diagnostics.find((issue) => issue.id === original.id)?.signature).not.toBe(original.signature);
  expect(JSON.stringify({ layers, context })).toBe(before);
});

test('reports raw transform and spatial components as an explicit composition conflict', () => {
  spatialElement();
  const raw: IPropertyTimeline = { initialValue: text('translateX(100px)'), keys: [{ frame: 1, value: text('rotate(90deg)') }] };
  const context = spatialContext({ ...spatialContext().bindings!.box, raw: { kind: 'style', cssName: 'transform' } });
  const result = plan([spatialLayer({ rotation: track(45), raw })], context);
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'composition-conflict', blocking: true })]));
  expect(result.evaluate(51)[0].properties).toEqual([]);
});

test('refuses incompatible physical projections for the same CSS transform', () => {
  spatialElement();
  const context: IHtmlAnimationContext = { ...spatialContext({
    rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
    alternate: { kind: 'spatial', projectionId: 'other', component: 'translateX', unit: 'px' }
  }), spatial: { box: [spatialDefinition(), spatialDefinition({ id: 'other', sourceTransform: 'translateX(200px)' })] } };
  const result = plan([spatialLayer({ rotation: track(45), alternate: track(10) })], context);
  expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'composition-conflict', blocking: true })]));
});

test('refuses source-dependent group editing when the selected elements have different source transforms', () => {
  const first = spatialElement(); first.className = 'group';
  const second = document.createElement('div'); second.id = 'other'; second.className = 'group';
  second.style.transform = 'translateX(200px)'; second.style.transformOrigin = '10% 20% 7px'; document.body.append(second);
  const before = document.body.innerHTML;
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext() }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation: track(45) }, 'box', '.group')], 101)); host.render(timeAt(51));
    expect(stage.inspectProperty({ selector: '.group' }, 'rotation', { layerId: 'box' })).toMatchObject({ editable: false });
    expect(stage.diagnostics.some((issue) => issue.blocking)).toBe(true);
    expect(document.body.innerHTML).toBe(before);
  } finally { host.destroy(); }
});

test('preserves coherent groups without treating independent pivots as duplicate destinations', () => {
  const first = spatialElement(); first.className = 'group';
  const second = first.cloneNode(true) as HTMLElement; second.id = 'other'; document.body.append(second);
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext({
    x: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' },
    y: { kind: 'spatial', projectionId: 'geometry', component: 'pivotY', unit: '%' }
  }) }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ x: track(25), y: track(75) }, 'box', '.group')], 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    expect(first.style.transformOrigin).toBe('25% 75% 7px');
    expect(second.style.transformOrigin).toBe(first.style.transformOrigin);
  } finally { host.destroy(); }
});

test.each([['transform', 'inline'], ['origin', 'inline'], ['transform', 'stylesheet'], ['origin', 'stylesheet']] as const)(
  'refuses authored %s sources from %s that only coincide at the current element size', (channel, source) => {
  const first = spatialElement('translateX(50%)'); first.className = 'group';
  first.style.width = '200px'; first.style.height = '200px'; first.style.transformOrigin = '50% 50% 7px';
  const second = first.cloneNode(true) as HTMLElement; second.id = 'other';
  if (channel === 'transform') second.style.transform = 'translateX(100px)';
  else second.style.transformOrigin = '100px 100px 7px';
  document.body.append(second);
  if (source === 'stylesheet') {
    first.style.removeProperty('transform'); second.style.removeProperty('transform');
    first.style.removeProperty('transform-origin'); second.style.removeProperty('transform-origin');
    const stylesheet = document.createElement('style');
    stylesheet.textContent = `.group { transform: translateX(50%); transform-origin: 50% 50% 7px; } #other { ${channel === 'transform' ? 'transform: translateX(100px)' : 'transform-origin: 100px 100px 7px'}; }`;
    document.head.append(stylesheet);
  }
  const computed = equalComputedSpatialStyles(); const before = document.body.innerHTML;
  const context = spatialContext(undefined, spatialDefinition({ sourceTransform: 'translateX(50%)',
    origin: { x: { value: 50, unit: '%' }, y: { value: 50, unit: '%' }, z: { value: 7, unit: 'px' } },
    provenance: { transform: { kind: 'authored', authoredValue: 'translateX(50%)', computedValue: 'matrix(1,0,0,1,100,0)' },
      origin: { kind: 'authored', authoredValue: '50% 50% 7px', computedValue: '100px 100px 7px' } } }));
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation: track(45) }, 'box', '.group')], 101)); host.render(timeAt(51));
    expect(stage.inspectProperty({ selector: '.group' }, 'rotation', { layerId: 'box' })).toMatchObject({ editable: false });
    expect(stage.diagnostics.some((issue) => issue.blocking)).toBe(true);
    expect(document.body.innerHTML).toBe(before);
    first.style.width = '300px'; second.style.width = '300px'; stage.refresh(); host.render(timeAt(51));
    expect(first.style.transform).toBe(source === 'inline' ? 'translateX(50%)' : '');
    expect(second.style.transform).toBe(source === 'inline' ? channel === 'transform' ? 'translateX(100px)' : 'translateX(50%)' : '');
  } finally { host.destroy(); computed.mockRestore(); }
});

test('refuses identical group var expressions whose custom property values hide different source units', () => {
  const first = spatialElement('translateX(var(--offset))'); first.className = 'group'; first.style.setProperty('--offset', '50%');
  const second = first.cloneNode(true) as HTMLElement; second.id = 'other'; second.style.setProperty('--offset', '100px');
  document.body.append(second);
  const before = document.body.innerHTML; const computed = equalComputedSpatialStyles();
  const context = spatialContext(undefined, spatialDefinition({ sourceTransform: 'translateX(var(--offset))',
    provenance: { ...spatialDefinition().provenance,
      transform: { kind: 'authored', authoredValue: 'translateX(var(--offset))', computedValue: 'matrix(1,0,0,1,100,0)' } } }));
  const stage = createHtmlStage({ mode: 'frame', animationContext: context }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation: track(45) }, 'box', '.group')], 101)); host.render(timeAt(51));
    expect(stage.inspectProperty({ selector: '.group' }, 'rotation', { layerId: 'box' })).toMatchObject({ editable: false });
    expect(stage.diagnostics.some((issue) => issue.blocking)).toBe(true); expect(document.body.innerHTML).toBe(before);
  } finally { host.destroy(); computed.mockRestore(); }
});

test('accepts a group with the same winning plain stylesheet source for both elements', () => {
  const first = document.createElement('div'); first.id = 'box'; first.className = 'group';
  const second = first.cloneNode(true) as HTMLElement; second.id = 'other'; document.body.append(first, second);
  const stylesheet = document.createElement('style');
  stylesheet.textContent = '.group { transform: translateX(100px); transform-origin: 10% 20% 7px; }'; document.head.append(stylesheet);
  const before = document.body.innerHTML; const computed = equalComputedSpatialStyles();
  const stage = createHtmlStage({ mode: 'frame', animationContext: spatialContext() }); const host = createHost([stage]);
  try {
    host.load(docOf([spatialLayer({ rotation: track(45) }, 'box', '.group')], 101)); host.render(timeAt(51));
    expect(stage.diagnostics).toEqual([]);
    expect(stage.inspectProperty({ selector: '.group' }, 'rotation', { layerId: 'box' })).toMatchObject({ editable: true });
    expect(first.style.transform).toBe('translate(0px, 0px) rotate(45deg) scale(1, 1) translateX(100px)');
    expect(second.style.transform).toBe(first.style.transform);
  } finally { host.destroy(); computed.mockRestore(); }
  expect(document.body.innerHTML).toBe(before);
});
