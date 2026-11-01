// demo/editor/src/spatialProjectionGroup.ts
import { createHtmlStage, createManualClock, createPlayer } from '@kazo-ca/timeline-runtime';
import { createExample } from './spatialProjectionScene';

export interface ISpatialGroupProbe {
  readonly source: 'inline' | 'stylesheet'; readonly initial: readonly string[];
  readonly rendered: readonly string[]; readonly resized: readonly string[];
  readonly editable: boolean; readonly reason?: string; readonly diagnostics: readonly string[];
}
/** A real DOM regression: equal matrices at 200px do not prove equal source expressions. */
export function probeSpatialGroup(owner: Document, source: 'inline' | 'stylesheet'): ISpatialGroupProbe {
  const root = owner.createElement('div'); root.className = 'JsTimeLine';
  const style = owner.createElement('style');
  style.textContent = '.JsTimeLine .member{position:relative;width:200px;height:80px;background:#1c897b;color:white;margin:12px 0;box-sizing:border-box}';
  if (source === 'stylesheet') style.textContent += '.JsTimeLine .member{transform:translateX(50%);transform-origin:50% 50% 7px}.JsTimeLine #second{transform:translateX(100px)}';
  root.append(style);
  const members = ['first', 'second'].map((id, index) => {
    const element = owner.createElement('div'); element.id = id; element.className = 'member';
    element.textContent = index === 0 ? 'Source : 50 %' : 'Source : 100 px';
    if (source === 'inline') { element.style.transform = index === 0 ? 'translateX(50%)' : 'translateX(100px)'; element.style.transformOrigin = '50% 50% 7px'; }
    root.append(element); return element;
  });
  owner.body.replaceChildren(root);
  const read = () => members.map((element) => owner.defaultView!.getComputedStyle(element).transform);
  const initial = read(); const example = createExample('rotation');
  const definition = example.context.spatial!.box[0];
  const context = { ...example.context, spatial: { box: [{ ...definition, sourceTransform: 'translateX(50%)',
    origin: { ...definition.origin, x: { value: 50, unit: '%' as const }, y: { value: 50, unit: '%' as const } },
    provenance: { transform: { kind: 'authored' as const, authoredValue: 'translateX(50%)', computedValue: initial[0] },
      origin: { kind: 'authored' as const, authoredValue: '50% 50% 7px', computedValue: '100px 40px 7px' } }
  }] } };
  const document = { ...example.document, layers: example.document.layers.map((layer) => ({ ...layer, target: { selector: '.member' } })) };
  const stage = createHtmlStage({ root, mode: 'frame', animationContext: context });
  const player = createPlayer(document, { stage, clock: createManualClock() });
  try {
    player.seek(51);
    const inspection = stage.inspectProperty({ selector: '.member' }, 'rotation', { layerId: 'box' });
    const rendered = read(); const diagnostics = stage.diagnostics.map((issue) => issue.message);
    members.forEach((element) => { element.style.width = '300px'; });
    stage.refresh(); player.seek(52);
    return { source, initial, rendered, resized: read(), editable: inspection.editable, reason: inspection.reason, diagnostics };
  } finally { player.destroy(); }
}
