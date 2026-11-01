// packages/export-css/src/continuous/__tests__/spatial.browser.test.ts
import type { HtmlPropertyBinding, IHtmlAnimationContext, IHtmlSpatialDefinition, IPropertyTimeline,
  ITimelineDocument } from '@kazo-ca/timeline-runtime';
import { exportHtmlCss } from '../../exportHtmlCss';
import { groupCssTargets } from '../htmlTargets';
import type { IHtmlCssTarget } from '../htmlScene';

const number = (value: number) => ({ kind: 'number' as const, value });
const text = (value: string) => ({ kind: 'text' as const, value });
function tween(from: number, to: number, first = 1, last = 101): IPropertyTimeline {
  return { initialValue: number(from), keys: [{ frame: first, value: number(from) }, { frame: last, value: number(to) }],
    transitions: [{ id: 'move', fromFrame: first, toFrame: last }] };
}
function definition(sourceTransform = 'translateX(100px)'): IHtmlSpatialDefinition {
  return { id: 'geometry', version: 1, composition: 'prepend-trs', sourceTransform,
    origin: { x: { value: 10, unit: '%' }, y: { value: 20, unit: '%' }, z: { value: 7, unit: 'px' } },
    provenance: { transform: { kind: 'authored', authoredValue: sourceTransform, computedValue: 'matrix(1, 0, 0, 1, 100, 0)' },
      origin: { kind: 'authored', authoredValue: '10% 20% 7px', computedValue: '20px 20px 7px' } } };
}
function fixture(tracks: Readonly<Record<string, IPropertyTimeline>>, bindings: Readonly<Record<string, HtmlPropertyBinding>>,
  source = definition()): { readonly root: HTMLElement; readonly doc: ITimelineDocument; readonly context: IHtmlAnimationContext } {
  document.head.innerHTML = '';
  document.body.innerHTML = '<main id="scene"><div id="box"></div></main>';
  const element = document.querySelector<HTMLElement>('#box')!;
  element.style.transform = source.sourceTransform;
  element.style.transformOrigin = '10% 20% 7px';
  element.style.width = '200px'; element.style.height = '100px';
  return { root: document.querySelector<HTMLElement>('main')!,
    doc: { version: '2.0.0', settings: { fps: 25, totalFrames: 101 }, layers: [{ type: 'layer', id: 'object', name: 'Object',
      target: { selector: '#box' }, spans: [], propertyTimelines: Object.fromEntries(Object.entries(tracks).map(([property, timeline]) => [property,
        { ...timeline, ...(timeline.transitions === undefined ? {} : { transitions: timeline.transitions.map((transition) => ({ ...transition, id: `${property}-${transition.id}` })) }) }])) }] },
    context: { version: 1, bindings: { object: bindings }, spatial: { object: [source] } } };
}

describe('continuous spatial CSS export', () => {
  it('preserves the ordered source function list instead of interpolating flattened endpoint matrices', () => {
    const { root, doc, context } = fixture({ rotation: tween(0, 90) }, {
      rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' }
    });
    const result = exportHtmlCss(doc, { root, animationContext: context });
    expect(result.status).toBe('exported');
    if (result.status !== 'exported') throw new Error(JSON.stringify(result));
    expect(result.fidelity).toBe('continuous');
    expect(result.css).toContain('translate(0px, 0px) rotate(0deg) scale(1, 1) translateX(100px)');
    expect(result.css).toContain('translate(0px, 0px) rotate(90deg) scale(1, 1) translateX(100px)');
    expect(result.css).not.toContain('matrix(');
  });

  it('composes independent pivots and keeps untouched source coordinates including z', () => {
    const { root, doc, context } = fixture({ pivotX: tween(10, 75) }, {
      pivotX: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' }
    });
    const result = exportHtmlCss(doc, { root, animationContext: context });
    expect(result.status).toBe('exported');
    if (result.status !== 'exported') throw new Error(JSON.stringify(result));
    expect(result.css).toContain('transform-origin: 10% 20% 7px');
    expect(result.css).toContain('transform-origin: 75% 20% 7px');
  });

  it('refuses the entire export when a source hold change overlaps a changing adjustment', () => {
    const { root, doc, context } = fixture({ rotation: tween(0, 90), source: {
      initialValue: text('translateX(100px)'), keys: [{ frame: 51, value: text('translateX(200px)') }]
    } }, {
      rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
      source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' }
    });
    expect(exportHtmlCss(doc, { root, animationContext: context })).toMatchObject({ status: 'refused', css: '', html: '',
      alternatives: ['javascript', 'json'], diagnostics: [expect.objectContaining({ code: 'incompatible-transform-timing' })] });
  });

  it('keeps relative translation units and accepts zero and negative evaluated scale', () => {
    const { root, doc, context } = fixture({ translateX: tween(0, 50), scaleX: tween(1, -1) }, {
      translateX: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: '%' },
      scaleX: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }
    }, definition('rotate(30deg)'));
    const result = exportHtmlCss(doc, { root, animationContext: context });
    if (result.status !== 'exported') throw new Error(JSON.stringify(result));
    expect(result.status).toBe('exported');
    expect(result.css).toContain('translate(50%, 0px) rotate(0deg) scale(-1, 1) rotate(30deg)');
    expect(result.css).toContain('animation-timing-function: linear');
  });

  it('keeps independent timing for pivot and transform destinations', () => {
    const rotation = { ...tween(0, 90), transitions: [{ id: 'rotate', fromFrame: 1, toFrame: 101,
      easing: { kind: 'bezier' as const, x1: 0.42, y1: 0, x2: 1, y2: 1 } }] };
    const { root, doc, context } = fixture({ rotation, pivotX: tween(10, 75, 20, 60) }, {
      rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
      pivotX: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' }
    });
    const result = exportHtmlCss(doc, { root, animationContext: context });
    expect(result.status).toBe('exported');
    if (result.status !== 'exported') throw new Error(JSON.stringify(result));
    expect(result.css).toContain('transform-origin: 75% 20% 7px');
    expect(result.css).toContain('animation-timing-function: cubic-bezier(0.42, 0, 1, 1)');
  });

  it('refuses incompatible spatial component easing instead of averaging the curves', () => {
    const rotation = { ...tween(0, 90), transitions: [{ id: 'rotate', fromFrame: 1, toFrame: 101,
      easing: { kind: 'bezier' as const, x1: 0.42, y1: 0, x2: 1, y2: 1 } }] };
    const { root, doc, context } = fixture({ rotation, translateX: tween(0, 50) }, {
      rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
      translateX: { kind: 'spatial', projectionId: 'geometry', component: 'translateX', unit: 'em' }
    });
    expect(exportHtmlCss(doc, { root, animationContext: context })).toMatchObject({ status: 'refused', css: '', html: '',
      alternatives: ['javascript', 'json'], diagnostics: [expect.objectContaining({ code: 'incompatible-transform-timing' })] });
  });

  it('accepts a held source suffix change without interpolating its function list', () => {
    const { root, doc, context } = fixture({ source: { initialValue: text('translateX(100px)'),
      keys: [{ frame: 51, value: text('rotate(45deg) translateX(200px)') }] } }, {
      source: { kind: 'spatial', projectionId: 'geometry', component: 'sourceTransform' }
    });
    const result = exportHtmlCss(doc, { root, animationContext: context });
    expect(result.status).toBe('exported');
    if (result.status !== 'exported') throw new Error(JSON.stringify(result));
    expect(result.css).toContain('scale(1, 1) translateX(100px); animation-timing-function: steps(1, end)');
    expect(result.css).toContain('scale(1, 1) rotate(45deg) translateX(200px)');
  });

  it('preserves Bézier overshoot on scale without imposing the Designer handle constraint', () => {
    const scale = { ...tween(1, -1), transitions: [{ id: 'scale', fromFrame: 1, toFrame: 101,
      easing: { kind: 'bezier' as const, x1: 0.2, y1: -1, x2: 0.8, y2: 2 } }] };
    const { root, doc, context } = fixture({ scaleX: scale }, {
      scaleX: { kind: 'spatial', projectionId: 'geometry', component: 'scaleX' }
    });
    const result = exportHtmlCss(doc, { root, animationContext: context });
    expect(result.status).toBe('exported');
    if (result.status !== 'exported') throw new Error(JSON.stringify(result));
    expect(result.css).toContain('cubic-bezier(0.2, -1, 0.8, 2)');
  });

  it('checks the actual transform-origin cascade before exporting a pivot track', () => {
    const { root, doc, context } = fixture({ pivotX: tween(10, 75) }, {
      pivotX: { kind: 'spatial', projectionId: 'geometry', component: 'pivotX', unit: '%' }
    });
    document.head.innerHTML = '<style>#box { transform-origin: 50% 50% !important }</style>';
    expect(exportHtmlCss(doc, { root, animationContext: context })).toMatchObject({ status: 'refused', css: '', html: '' });
  });

  it('does not silently combine raw transform CSS with spatial adjustments', () => {
    const { root, doc, context } = fixture({ rotation: tween(0, 90), raw: {
      initialValue: text('translateX(100px)'), keys: [{ frame: 51, value: text('none') }]
    } }, {
      rotation: { kind: 'spatial', projectionId: 'geometry', component: 'rotation', unit: 'deg' },
      raw: { kind: 'style', cssName: 'transform' }
    });
    expect(exportHtmlCss(doc, { root, animationContext: context })).toMatchObject({ status: 'refused', css: '', html: '' });
  });
});

describe('CSS target spatial identity', () => {
  it.each(['source', 'provenance'] as const)('does not group different %s definitions sharing a projection ID', (difference) => {
    document.body.innerHTML = '<main id="scene"><div id="one" class="box"></div><div id="two" class="box"></div></main>';
    const root = document.querySelector<HTMLElement>('main')!;
    const first = definition();
    const second = difference === 'source' ? definition('translateX(200px)') : { ...first,
      provenance: { ...first.provenance, transform: { ...first.provenance.transform, authoredValue: 'translate(100px, 0px)' } } };
    const target = (id: string, spatial: IHtmlSpatialDefinition): IHtmlCssTarget => ({ selector: '',
      element: root.querySelector(`#${id}`)!, gradients: [], spatial: [spatial], trajectories: [] });
    const result = groupCssTargets(root, '#scene ', ['.box'], [target('one', first), target('two', second)]);
    expect(result).toHaveLength(2);
    result.forEach((entry) => expect([...document.querySelectorAll(entry.selector)]).toEqual([entry.element]));
  });
});
