// packages/runtime/src/stage/html/preparedAnimation.ts
import type { ITimelineDocument } from '../../model/document';
import type { IPropertyTimeline, TimelinePropertyValue } from '../../model/propertyTimeline';
import type { PropertyRegistry } from '../../properties/PropertyRegistry';
import type { IHtmlAnimationContext, IHtmlResolvedLayer, IHtmlResolutionDiagnostic, IHtmlResolutionPlan } from './animationTypes';
import { composeHtmlDeclarations } from './cssCompose';
import type { IHtmlGradientDefinition, IHtmlResolvedBinding } from './cssTypes';
import { needsVisibility } from './keyframes';
import type { HtmlPropertyInspection, IHtmlPropertyInspection } from './propertyInspection';
import { prepareHtmlResolution } from './resolution';
import { resolveHtmlSpatialBindings } from './spatial';

export interface IPreparedHtmlAnimation {
  readonly plan: IHtmlResolutionPlan;
  readonly metadata: ReadonlyMap<string, ReadonlyMap<string, IHtmlPropertyInspection>>;
  readonly diagnostics: readonly IHtmlResolutionDiagnostic[];
}
export interface IHtmlDeclarationFrame {
  readonly elements: ReadonlyMap<Element, Readonly<Record<string, string>>>;
  readonly diagnostics: readonly IHtmlResolutionDiagnostic[];
}

function capabilityDiagnostic(layer: IHtmlResolvedLayer, property: string, message: string, totalFrames: number): IHtmlResolutionDiagnostic {
  return { code: 'unsupported-binding', id: JSON.stringify(['capability', layer.layerId, property]),
    signature: JSON.stringify(layer.layer.propertyTimelines?.[property]), property, layerIds: [layer.layerId],
    targets: ['selector' in layer.target ? layer.target.selector : layer.layerId], fromFrame: 1, toFrame: totalFrames,
    choices: [], blocking: true, message };
}

/** Shared capability checks: an exporter must never accept a track omitted by preview. */
export function prepareHtmlAnimation(doc: ITimelineDocument, layers: readonly IHtmlResolvedLayer[], context: IHtmlAnimationContext,
  registry: PropertyRegistry, inspection: HtmlPropertyInspection): IPreparedHtmlAnimation {
  const issues: IHtmlResolutionDiagnostic[] = [];
  const metadata = new Map<string, ReadonlyMap<string, IHtmlPropertyInspection>>();
  const accepted = layers.map((layer) => {
    const infos = new Map<string, IHtmlPropertyInspection>();
    const tracks: Record<string, IPropertyTimeline> = {};
    for (const [name, track] of Object.entries(layer.layer.propertyTimelines ?? {})) {
      let info = inspection.inspect(layer.elements, name, layer.layerId, track.initialValue.kind, context, registry);
      const reason = !info.editable || !info.interpolable && (track.transitions?.length ?? 0) > 0 ? info.reason
        : inspection.validate(layer, name, track, context, registry);
      if (reason !== undefined) {
        info = { ...info, reason };
        issues.push(capabilityDiagnostic(layer, name, reason, doc.settings.totalFrames));
      } else tracks[name] = track;
      infos.set(name, info);
    }
    metadata.set(layer.layerId, infos);
    return { ...layer, layer: { ...layer.layer, propertyTimelines: tracks } };
  });
  const plan = prepareHtmlResolution(doc, accepted, context, registry);
  return { plan, metadata, diagnostics: [...issues, ...plan.diagnostics] };
}

/** Pure CSS snapshots shared by live preview and compiled HTML playback. */
export function composeHtmlAnimationFrame(doc: ITimelineDocument, layers: readonly IHtmlResolvedLayer[], plan: IHtmlResolutionPlan,
  context: IHtmlAnimationContext, inspection: HtmlPropertyInspection, frame: number,
  visible: ReadonlyMap<string, boolean>, active: ReadonlyMap<string, boolean>): IHtmlDeclarationFrame {
  const diagnostics: IHtmlResolutionDiagnostic[] = [];
  const declarationsByElement = new Map<Element, Readonly<Record<string, string>>>();
  const evaluated = plan.evaluate(Math.max(1, Math.min(doc.settings.totalFrames, frame)));
  const elements = new Set(layers.flatMap((layer) => [...layer.elements]));
  const states = [...evaluated, ...[...elements].filter((element) => !evaluated.some((state) => state.element === element))
    .map((element) => ({ element, properties: [] }))];
  for (const state of states) {
    const values: Record<string, TimelinePropertyValue> = {};
    const bindings: Record<string, IHtmlResolvedBinding> = {};
    const gradients = new Map<string, IHtmlGradientDefinition>();
    const spatial = resolveHtmlSpatialBindings(context, state.properties);
    state.properties.forEach((property, index) => {
      const name = `value-${index}`;
      values[name] = property.value; bindings[name] = spatial.bindings[index];
      for (const gradient of context.gradients?.[property.layerId] ?? []) gradients.set(gradient.id, gradient);
    });
    const transform = inspection.transform(state.element);
    const css = composeHtmlDeclarations(state.element, values, bindings, [...gradients.values()],
      transform.status === 'value' ? transform.value : undefined, spatial.definitions);
    for (const issue of css.diagnostics) {
      const property = state.properties[Number(issue.property.slice('value-'.length))];
      const layer = layers.find((entry) => entry.layerId === property?.layerId);
      if (layer !== undefined && property !== undefined) diagnostics.push(capabilityDiagnostic(layer, property.property, issue.reason, doc.settings.totalFrames));
    }
    const declarations: Record<string, string> = { ...css.declarations };
    const owners = layers.filter((layer) => layer.elements.includes(state.element));
    const managed = owners.filter((layer) => layer.layer.spans.length > 0 && needsVisibility(layer.layer, doc.settings.totalFrames));
    if (owners.some((layer) => visible.get(layer.layerId) === false) || managed.some((layer) => active.get(layer.layerId) === false)) declarations.visibility = 'hidden';
    else if (managed.length > 0) declarations.visibility = 'visible';
    declarationsByElement.set(state.element, declarations);
  }
  return { elements: declarationsByElement, diagnostics: [...new Map(diagnostics.map((issue) => [issue.id, issue])).values()] };
}
