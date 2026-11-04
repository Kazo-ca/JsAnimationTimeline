// demo/editor/src/conformance/scenes/html.ts
import type { IHtmlAnimationContext, ILayer, IPropertyTimeline, ITimelineDocument, PropertyEasing, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';

/** Frozen HTML scenes of the TL-C cases: `main` (reference case 59 plus a tween and a hold) and `conflict`. */
export type HtmlSceneKind = 'main' | 'conflict';
export type HtmlDocumentName = 'reference' | 'full' | 'elastic' | 'conflict';

export const HTML_FPS = 24;
export const HTML_TOTAL_FRAMES = 100;
export const HTML_ROOT_ID = 'html-scene';

const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
const color = (r: number, g: number, b: number): TimelinePropertyValue => ({ kind: 'color', r: r / 255, g: g / 255, b: b / 255, a: 1 });
const held = (initial: number, frame: number, value: number): IPropertyTimeline => ({ initialValue: number(initial), keys: [{ frame, value: number(value) }] });

const mainContext: IHtmlAnimationContext = { version: 1, bindings: {
  motion: { left: { kind: 'style', cssName: 'left', unit: 'px' } },
  held: { fill: { kind: 'style', cssName: 'background-color' }, border: { kind: 'style', cssName: 'border-style' } }
} };

/** The saved HTML context that goes with a scene. */
export function htmlContextFor(kind: HtmlSceneKind): IHtmlAnimationContext {
  return kind === 'main' ? mainContext : { version: 1 };
}

const ELASTIC: PropertyEasing = { kind: 'effect', family: 'elastic', mode: 'out', parameters: { oscillations: 3, springiness: 4 } };

const buttonLayers = (): ILayer[] => [
  { id: 'buttons', type: 'layer' as const, name: '.button', target: { selector: '.button' }, spans: [], propertyTimelines: { opacity: held(1, 1, 0.5) } },
  { id: 'specific', type: 'layer' as const, name: '#button-2', target: { selector: '#button-2' }, spans: [], propertyTimelines: { opacity: held(1, 50, 0.8) } }
];

function tweenAndHoldLayers(easing: PropertyEasing | undefined): ILayer[] {
  return [
    { id: 'motion', type: 'layer' as const, name: 'Opacité et position', target: { selector: '#motion-tile' }, spans: [], propertyTimelines: {
      opacity: { initialValue: number(1), keys: [{ frame: 10, value: number(0.2) }, { frame: 80, value: number(0.9) }],
        transitions: [{ id: 'fade', fromFrame: 10, toFrame: 80, ...(easing === undefined ? {} : { easing }) }] },
      left: { initialValue: number(8), keys: [{ frame: 20, value: number(8) }, { frame: 65, value: number(100) }],
        transitions: [{ id: 'position', fromFrame: 20, toFrame: 65 }] }
    } },
    { id: 'held', type: 'layer' as const, name: 'Changement sans interpolation', target: { selector: '#held-tile' }, spans: [], propertyTimelines: {
      fill: { initialValue: color(26, 104, 168), keys: [{ frame: 40, value: color(187, 76, 42) }] },
      border: { initialValue: { kind: 'text', value: 'solid' }, keys: [{ frame: 40, value: { kind: 'text', value: 'dashed' } }] }
    } }
  ];
}

/** A fresh document for each call: the cases mutate their own copy only. */
export function htmlDocument(name: HtmlDocumentName): ITimelineDocument {
  const settings = { fps: HTML_FPS, totalFrames: HTML_TOTAL_FRAMES };
  if (name === 'reference') return { version: '2.0.0', settings, layers: buttonLayers() };
  if (name === 'full') return { version: '2.0.0', settings, layers: [...buttonLayers(), ...tweenAndHoldLayers(undefined)] };
  if (name === 'elastic') return { version: '2.0.0', settings, layers: [...buttonLayers(), ...tweenAndHoldLayers(ELASTIC)] };
  return { version: '2.0.0', settings, layers: [
    { id: 'first', type: 'layer', name: '.first', target: { selector: '.first' }, spans: [], propertyTimelines: { opacity: held(1, 1, 0.3) } },
    { id: 'second', type: 'layer', name: '.second', target: { selector: '.second' }, spans: [], propertyTimelines: { opacity: held(1, 1, 0.7) } }
  ] };
}

const MAIN_CSS = `.tl-html-scene { box-sizing:border-box; margin:0; padding:14px; min-height:320px; color:#203432; background:#f5f7ef; font:14px/1.45 'Segoe UI',sans-serif; }
.tl-html-scene .button-group { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px; }
.tl-html-scene .button { opacity:1; min-height:0; font:inherit; padding:8px 10px; border:0; border-radius:4px; color:white; background:#176e62; }
.tl-html-scene .motion-area { height:76px; position:relative; overflow:hidden; background:#e3eadf; margin:10px 0; }
.tl-html-scene #motion-tile { position:absolute; left:8px; top:15px; width:108px; height:44px; display:grid; place-items:center; background:#176e62; color:white; opacity:1; }
.tl-html-scene #held-tile { margin-top:12px; padding:10px; color:white; background-color:rgb(26,104,168); border:4px solid #203432; outline:2px solid #d5b57d; }`;
const CONFLICT_CSS = `.tl-html-scene { box-sizing:border-box; margin:0; padding:14px; background:#f5f7ef; font:14px/1.45 'Segoe UI',sans-serif; }
.tl-html-scene #target { opacity:1; padding:10px; color:white; background:#176e62; }`;

/** The scene is rebuilt in any owner document, so the CSS output never inherits preview styles. */
export function createHtmlScene(owner: Document, kind: HtmlSceneKind): HTMLElement {
  const root = owner.createElement('div');
  root.id = HTML_ROOT_ID;
  root.className = 'tl-html-scene';
  const style = owner.createElement('style');
  style.textContent = kind === 'main' ? MAIN_CSS : CONFLICT_CSS;
  root.append(style);
  if (kind === 'conflict') {
    const target = owner.createElement('div');
    target.id = 'target';
    target.className = 'first second';
    target.textContent = 'Cible en conflit';
    root.append(target);
    return root;
  }
  const group = owner.createElement('div');
  group.className = 'button-group';
  for (let index = 1; index <= 4; index++) {
    const button = owner.createElement('button');
    button.className = 'button';
    button.id = `button-${index}`;
    button.type = 'button';
    button.textContent = `B${index}`;
    group.append(button);
  }
  const area = owner.createElement('div');
  area.className = 'motion-area';
  const tile = owner.createElement('div');
  tile.id = 'motion-tile';
  tile.textContent = 'Opacité et position';
  area.append(tile);
  const heldTile = owner.createElement('div');
  heldTile.id = 'held-tile';
  heldTile.textContent = 'Couleur et bordure à l’image 40';
  root.append(group, area, heldTile);
  return root;
}

/** Computed values of the scene, as strings keyed `<element>.<property>`; the same keys serve every output. */
export type HtmlSceneSnapshot = Readonly<Record<string, string>>;

const READ_MAIN: readonly (readonly [string, string, string])[] = [
  ...[1, 2, 3, 4].map((index) => [`button-${index}.opacity`, `#button-${index}`, 'opacity'] as const),
  ['tile.opacity', '#motion-tile', 'opacity'], ['tile.left', '#motion-tile', 'left'],
  ['held.color', '#held-tile', 'background-color'], ['held.border', '#held-tile', 'border-top-style']
];
const READ_CONFLICT: readonly (readonly [string, string, string])[] = [['target.opacity', '#target', 'opacity']];

export function readHtmlScene(root: ParentNode, kind: HtmlSceneKind): HtmlSceneSnapshot {
  const entries = (kind === 'main' ? READ_MAIN : READ_CONFLICT).map(([key, selector, property]) => {
    const element = root.querySelector(selector);
    const view = element?.ownerDocument.defaultView;
    if (element === null || element === undefined || view === null || view === undefined) throw new Error(`Élément de scène manquant : ${selector}`);
    return [key, view.getComputedStyle(element).getPropertyValue(property)] as const;
  });
  return Object.fromEntries(entries);
}

/** Snapshot key for a resolved `(element id, property)` pair, or undefined when the case does not observe it. */
export function snapshotKey(elementId: string, property: string): string | undefined {
  if (elementId.startsWith('button-') && property === 'opacity') return `${elementId}.opacity`;
  if (elementId === 'motion-tile' && (property === 'opacity' || property === 'left')) return `tile.${property}`;
  if (elementId === 'held-tile' && property === 'fill') return 'held.color';
  if (elementId === 'held-tile' && property === 'border') return 'held.border';
  if (elementId === 'target' && property === 'opacity') return 'target.opacity';
  return undefined;
}
