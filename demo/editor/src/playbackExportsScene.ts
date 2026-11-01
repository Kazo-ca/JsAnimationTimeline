// demo/editor/src/playbackExportsScene.ts
import { composeHtmlDeclarations } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlGradientDefinition, IPropertyTimeline, ITimelineDocument,
  TimelinePropertyValue } from '@kazo-ca/timeline-runtime';

const n = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const held = (initial: number, frame: number, value: number): IPropertyTimeline => ({ initialValue: n(initial), keys: [{ frame, value: n(value) }] });
export const gradient: IHtmlGradientDefinition = { id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
  centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
    { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, opacity: 1, position: 0, present: true },
    { id: 'middle', color: { kind: 'color', r: 0, g: 1, b: 0, a: 1 }, opacity: .6, position: 50, present: false },
    { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, opacity: 1, position: 100, present: true }
  ] };
export const htmlContext: IHtmlAnimationContext = { version: 1, gradients: { gradient: [gradient] }, bindings: {
  gradient: {
    angle: { kind: 'gradient', gradientId: 'fill', component: 'angle' },
    middlePresent: { kind: 'gradient', gradientId: 'fill', stopId: 'middle', component: 'present' },
    middleOpacity: { kind: 'gradient', gradientId: 'fill', stopId: 'middle', component: 'opacity' },
    rightPosition: { kind: 'gradient', gradientId: 'fill', stopId: 'right', component: 'position' }
  }
} };

/** Deliberately hostile metadata stays data throughout JSON and JS serialization. */
export const animation: ITimelineDocument = { version: '2.0.0', settings: { fps: 24, totalFrames: 100 }, layers: [
  { id: 'buttons', type: 'layer', name: '.button "groupe"\n</script><script>window.ha5Injected=true</script>\u2028\u2029',
    target: { selector: '.button' }, spans: [], propertyTimelines: { opacity: held(1, 1, .5) } },
  { id: 'specific', type: 'layer', name: '#button-2', target: { selector: '#button-2' }, spans: [], propertyTimelines: { opacity: held(1, 50, .8) } },
  { id: 'transform', type: 'layer', name: 'Carré incliné', target: { selector: '#transform-box' }, spans: [], propertyTimelines: {
    x: { initialValue: n(12), keys: [{ frame: 1, value: n(12) }, { frame: 100, value: n(100) }],
      transitions: [{ id: 'elastic-x', fromFrame: 1, toFrame: 100,
        easing: { kind: 'effect', family: 'elastic', mode: 'out', parameters: { oscillations: 3, springiness: 4 } } }] }
  } },
  { id: 'gradient', type: 'layer', name: 'Dégradé', target: { selector: '#gradient-box' }, spans: [], propertyTimelines: {
    angle: { initialValue: n(90), keys: [{ frame: 1, value: n(90) }, { frame: 100, value: n(270) }],
      transitions: [{ id: 'angle-motion', fromFrame: 1, toFrame: 100, easing: { kind: 'effect', family: 'sine', mode: 'in-out' } }] },
    middlePresent: { initialValue: { kind: 'boolean', value: false }, keys: [
      { frame: 30, value: { kind: 'boolean', value: true } }, { frame: 75, value: { kind: 'boolean', value: false } }
    ] },
    middleOpacity: { initialValue: n(.6), keys: [{ frame: 30, value: n(.6) }, { frame: 70, value: n(.25) }],
      transitions: [{ id: 'middle-opacity-motion', fromFrame: 30, toFrame: 70 }] },
    rightPosition: { initialValue: n(100), keys: [{ frame: 30, value: n(100) }, { frame: 70, value: n(0) }],
      transitions: [{ id: 'right-position-motion', fromFrame: 30, toFrame: 70 }] }
  } }
] };

export const genericAnimation: ITimelineDocument = { version: '2.0.0', settings: animation.settings, layers: [
  { id: 'instrument', type: 'layer', name: 'Objet simple', target: { ref: 'instrument', stage: 'objects' }, spans: [], propertyTimelines: {
    gain: { initialValue: n(.2), keys: [{ frame: 10, value: n(.2) }, { frame: 90, value: n(.9) }],
      transitions: [{ id: 'gain-bounce', fromFrame: 10, toFrame: 90, easing: { kind: 'effect', family: 'bounce', mode: 'out', parameters: { bounces: 3 } } }] },
    playing: { initialValue: { kind: 'boolean', value: false }, keys: [{ frame: 20, value: { kind: 'boolean', value: true } }] },
    label: { initialValue: { kind: 'text', value: 'Prêt' }, keys: [{ frame: 50, value: { kind: 'text', value: 'Signal « bleu »' } }] }
  } }
] };

export const sceneCss = `.JsTimeLine.export-scene { margin: 0; padding: 14px; background: #f7f9f5; color: #203432; font: 14px/1.45 'Segoe UI', sans-serif; }
.JsTimeLine.export-scene .button-group { display:flex; flex-wrap:wrap; gap:8px; min-height:84px; align-items:flex-start; }
.JsTimeLine.export-scene .button { opacity:1!important; padding:8px 10px; color:white; background:#0b786c; border:0; border-radius:4px; }
.JsTimeLine.export-scene #button-2 { margin-top:12px; }
.JsTimeLine.export-scene .transform-area { height:104px; overflow:hidden; background:#e6ede5; margin:8px 0; border-radius:4px; }
.JsTimeLine.export-scene #transform-box { width:48px; height:48px; display:grid; place-items:center; color:white; background:#c65c32; transform:matrix(.8660254037844387,.5,-.5,.8660254037844387,12,15); }
.JsTimeLine.export-scene #gradient-box { height:64px; margin:10px 3px; }
.JsTimeLine.export-scene p { font-size:12px; margin:8px 0; }`;

/** Use the same DOM and CSS sources for all three independent roots. */
export function createScene(owner: Document): HTMLElement {
  const root = owner.createElement('div'); root.className = 'JsTimeLine export-scene';
  const style = owner.createElement('style'); style.textContent = sceneCss; root.append(style);
  const group = owner.createElement('div'); group.className = 'button-group';
  for (let index = 1; index <= 4; index++) {
    const button = owner.createElement('button'); button.className = 'button'; button.id = `button-${index}`;
    button.type = 'button'; button.textContent = `B${index}`; group.append(button);
  }
  const area = owner.createElement('div'); area.className = 'transform-area';
  const box = owner.createElement('div'); box.id = 'transform-box'; box.textContent = '30°'; area.append(box);
  const fill = owner.createElement('div'); fill.id = 'gradient-box'; fill.setAttribute('aria-label', 'Dégradé animé');
  fill.style.outline = '3px solid rgb(30, 60, 45)';
  const initial = composeHtmlDeclarations(fill, { angle: n(90) }, {
    angle: { binding: { kind: 'gradient', gradientId: 'fill', component: 'angle' }, valueKind: 'number' }
  }, [gradient]);
  fill.style.backgroundImage = initial.declarations['background-image'];
  const label = owner.createElement('p'); label.textContent = 'Groupe 50 % · exception 80 % · mouvement élastique · croisement des points du dégradé à l’image 50';
  root.append(group, area, fill, label); return root;
}

export interface ISceneSnapshot {
  readonly buttons: readonly string[]; readonly transform: string; readonly gradient: string; readonly outline: string;
}
export function readScene(root: ParentNode): ISceneSnapshot {
  const read = (selector: string): CSSStyleDeclaration => {
    const element = root.querySelector(selector);
    if (element === null || element.ownerDocument.defaultView === null) throw new Error(`Scene element missing: ${selector}`);
    return element.ownerDocument.defaultView.getComputedStyle(element);
  };
  return { buttons: [1, 2, 3, 4].map((index) => read(`#button-${index}`).opacity), transform: read('#transform-box').transform,
    gradient: read('#gradient-box').backgroundImage, outline: read('#gradient-box').outlineWidth };
}
