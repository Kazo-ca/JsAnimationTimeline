// packages/runtime/src/stage/html/animationRenderer.ts
import type { ITimelineDocument } from '../../model/document';
import { collectLayers } from '../../evaluate/evaluateDocument';
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { LayerTarget } from '../../model/target';
import type { PropertyRegistry } from '../../properties/PropertyRegistry';
import { sameTarget } from '../routing';
import type { IStageLayer, IStageLayerState, ITargetPropertyInfo } from '../types';
import type { IHtmlAnimationContext, IHtmlResolvedLayer, IHtmlResolutionDiagnostic, IHtmlResolutionPlan } from './animationTypes';
import { cloneHtmlAnimationContext } from './animationContext';
import { htmlGradientValueKind } from './cssBindings';
import type { HtmlElements } from './elements';
import { InlineStyleKeeper } from './inlineStyles';
import { HtmlPropertyInspection } from './propertyInspection';
import type { IHtmlInspectPropertyOptions, IHtmlPropertyInspection } from './propertyInspection';
import { composeHtmlAnimationFrame, prepareHtmlAnimation } from './preparedAnimation';
import { validateHtmlSpatialRebinding } from './spatialRebinding';

/** Candidate and live inspection use the same binding-aware kind and textual fallback. */
function inspectHtmlProperty(inspection: HtmlPropertyInspection, elements: readonly Element[], property: string,
  layerId: string | undefined, knownKind: TimelinePropertyValue['kind'] | undefined, context: IHtmlAnimationContext,
  registry: PropertyRegistry): IHtmlPropertyInspection {
  const binding = layerId === undefined ? undefined : context.bindings?.[layerId]?.[property];
  const kind = knownKind ?? (binding?.kind === 'gradient' ? htmlGradientValueKind(binding.component)
    : binding?.kind === 'spatial' ? binding.component === 'sourceTransform' ? 'text' : 'number'
    : /color$/i.test(binding?.kind === 'style' ? binding.cssName : property) ? 'color' : 'number');
  const info = inspection.inspect(elements, property, layerId, kind, context, registry);
  return !info.editable && knownKind === undefined && kind === 'number' && binding?.kind === 'style' && binding.unit === undefined
    ? inspection.inspect(elements, property, layerId, 'text', context, registry) : info;
}

/** Exact HTML rendering shared by seeking and playback, independent of editor selection. */
export class HtmlAnimationRenderer {
  private readonly keeper = new InlineStyleKeeper();
  private readonly inspection = new HtmlPropertyInspection();
  private context: IHtmlAnimationContext;
  private doc: ITimelineDocument | undefined;
  private layers: readonly IHtmlResolvedLayer[] = [];
  private plan: IHtmlResolutionPlan | undefined;
  private held = new Set<Element>();
  private written = new Map<Element, ReadonlySet<string>>();
  private frame = 1;
  private visible = new Map<string, boolean>();
  private active = new Map<string, boolean>();
  private issues: readonly IHtmlResolutionDiagnostic[] = [];
  private renderIssues: readonly IHtmlResolutionDiagnostic[] = [];
  private metadata = new Map<string, ReadonlyMap<string, IHtmlPropertyInspection>>();
  private sourceDepth = 0;

  constructor(private readonly elements: HtmlElements, private readonly registry: () => PropertyRegistry,
    context: IHtmlAnimationContext = { version: 1 }, private readonly inspectOnly?: <T>(read: () => T) => T) {
    this.context = cloneHtmlAnimationContext(context);
  }

  get animationContext(): IHtmlAnimationContext { return cloneHtmlAnimationContext(this.context); }
  /** Installs only the paired context; the coordinator immediately updates and renders the final document. */
  installContext(context: IHtmlAnimationContext): void { this.context = cloneHtmlAnimationContext(context); this.inspection.reset(); }

  inspectCandidate(doc: ITimelineDocument, context: IHtmlAnimationContext, layerId: string, property: string,
    valueKind?: TimelinePropertyValue['kind']): IHtmlPropertyInspection {
    return this.withOriginals(() => {
      const layer = collectLayers(doc).find((entry) => entry.id === layerId);
      if (layer?.target === undefined) throw new Error('La cible de la propriété est absente.');
      const knownKind = valueKind ?? layer.propertyTimelines?.[property]?.initialValue.kind;
      const info = inspectHtmlProperty(new HtmlPropertyInspection(), this.elements.resolveElements(layer.target), property,
        layerId, knownKind, context, this.registry());
      return { ...info, sample: (sampleLayerId, frame) => this.withOriginals(() => {
        const plan = prepareHtmlAnimation(doc, this.candidateLayers(doc), context, this.registry(), new HtmlPropertyInspection()).plan;
        const result = plan.sample(sampleLayerId, property, frame, info.initialValue);
        if (result.status === 'value') return result.value;
        if (result.code === 'unrecorded' && info.initialValue !== undefined) return { ...info.initialValue };
        throw new Error(result.reason);
      }) };
    });
  }

  validateCandidate(doc: ITimelineDocument, context: IHtmlAnimationContext): readonly IHtmlResolutionDiagnostic[] {
    return this.withOriginals(() => {
      return prepareHtmlAnimation(doc, this.candidateLayers(doc), context, this.registry(), new HtmlPropertyInspection()).diagnostics;
    });
  }

  private candidateLayers(doc: ITimelineDocument): readonly IHtmlResolvedLayer[] {
    return collectLayers(doc).flatMap((layer) => layer.target === undefined || 'ref' in layer.target && layer.target.stage !== 'html'
      ? [] : [{ layerId: layer.id, layer, target: layer.target, elements: this.elements.resolveElements(layer.target) }]);
  }
  get diagnostics(): readonly IHtmlResolutionDiagnostic[] { return [...this.issues, ...this.renderIssues].map((issue) => ({ ...issue,
    ...(issue.policies === undefined ? {} : { policies: [...issue.policies] }),
    ...(issue.contributions === undefined ? {} : { contributions: issue.contributions.map((entry) => ({ ...entry })) }),
    layerIds: [...issue.layerIds], targets: [...issue.targets], choices: [...issue.choices] })); }

  setContext(context: IHtmlAnimationContext): void {
    const next = cloneHtmlAnimationContext(context);
    const refusal = this.doc === undefined ? undefined : validateHtmlSpatialRebinding(this.doc, this.context, this.doc, next);
    if (refusal !== undefined) throw new Error(refusal);
    const previous = this.context;
    this.context = next;
    try { if (this.doc !== undefined) this.withOriginals(() => this.prepare(this.doc!, this.layers)); }
    catch (error) { this.context = previous; throw error; }
    this.draw();
  }

  update(doc: ITimelineDocument, layers: readonly IStageLayer<Element>[]): void {
    const resolved: IHtmlResolvedLayer[] = layers.map(({ layerId, layer, target }) => ({
      layerId, layer, target, elements: this.elements.resolveElements(target)
    }));
    this.withOriginals(() => this.prepare(doc, resolved));
    if (this.inspectOnly !== undefined) return;
    const next = new Set(resolved.flatMap((layer) => [...layer.elements]));
    for (const element of next) if (!this.held.has(element)) this.keeper.acquire(element);
    for (const element of this.held) if (!next.has(element)) { this.keeper.release(element); this.written.delete(element); }
    this.held = next;
  }

  refresh(): void {
    this.withOriginals(() => {
      this.inspection.reset();
      if (this.doc !== undefined) this.prepare(this.doc, this.layers);
    });
    this.draw();
  }

  withSourceStyles<T>(action: () => T): T {
    return this.withOriginals(() => {
      try { return action(); }
      finally {
        this.inspection.reset();
        if (this.doc !== undefined) this.prepare(this.doc, this.layers);
      }
    });
  }

  inspect(target: LayerTarget, property: string, options: IHtmlInspectPropertyOptions = {}): IHtmlPropertyInspection {
    return this.withOriginals(() => {
      const layer = options.layerId === undefined ? this.layers.find((entry) => sameTarget(entry.target, target))
        : this.layers.find((entry) => entry.layerId === options.layerId && sameTarget(entry.target, target));
      const layerId = options.layerId ?? layer?.layerId;
      const knownKind = options.valueKind ?? layer?.layer.propertyTimelines?.[property]?.initialValue.kind;
      const elements = this.elements.resolveElements(target);
      return inspectHtmlProperty(this.inspection, elements, property, layerId, knownKind, this.context, this.registry());
    });
  }

  properties(target: LayerTarget): readonly ITargetPropertyInfo[] {
    const layers = this.layers.filter((entry) => sameTarget(entry.target, target));
    const names = new Set(this.registry().list().filter((descriptor) => descriptor.kind !== 'value').map((descriptor) => descriptor.name));
    for (const layer of layers) {
      Object.keys(layer.layer.propertyTimelines ?? {}).forEach((name) => names.add(name));
      Object.keys(this.context.bindings?.[layer.layerId] ?? {}).forEach((name) => names.add(name));
    }
    return [...names].map((name) => {
      const recorded = layers.find((entry) => entry.layer.propertyTimelines?.[name] !== undefined) ?? layers[0];
      const info = recorded === undefined ? this.inspect(target, name)
        : this.metadata.get(recorded.layerId)?.get(name) ?? this.inspect(target, name, { layerId: recorded.layerId });
      return { ...info,
        sample: (layerId, frame) => this.withOriginals(() => {
          const result = this.plan?.sample(layerId, name, frame, info.initialValue);
          if (result?.status === 'value') return result.value;
          if (result?.status === 'refused' && result.code === 'unrecorded' && info.initialValue !== undefined) return { ...info.initialValue };
          throw new Error(result?.reason ?? 'La propriété ne peut pas être évaluée pour cette cible.');
        }),
        validate: (layerId, timeline) => this.withOriginals(() => {
          const layer = this.layers.find((entry) => entry.layerId === layerId);
          if (layer === undefined) return [{ severity: 'error' as const, message: 'La cible de la propriété est indisponible.' }];
          const reason = this.inspection.validate(layer, name, timeline, this.context, this.registry());
          return reason === undefined ? [] : [{ severity: 'error' as const, property: name, message: reason }];
        })
      };
    });
  }

  render(frame: number, states: readonly IStageLayerState<Element>[]): void {
    this.frame = frame;
    this.visible = new Map(states.map((state) => [state.layerId, state.editorVisible]));
    this.active = new Map(states.map((state) => [state.layerId, state.active]));
    this.draw();
  }

  release(layerId: string): void {
    const released = this.layers.find((layer) => layer.layerId === layerId);
    this.layers = this.layers.filter((layer) => layer.layerId !== layerId);
    for (const element of released?.elements ?? []) if (!this.layers.some((layer) => layer.elements.includes(element))) {
      this.keeper.release(element); this.held.delete(element); this.written.delete(element);
    }
  }

  detach(): void {
    this.keeper.restoreAll(); this.held.clear(); this.written.clear(); this.layers = []; this.doc = undefined;
    this.plan = undefined; this.metadata.clear(); this.issues = []; this.renderIssues = []; this.inspection.reset();
  }

  private withOriginals<T>(read: () => T): T {
    if (this.inspectOnly !== undefined) return this.inspectOnly(read);
    if (this.sourceDepth++ === 0) this.keeper.restoreOriginals();
    try { return read(); }
    finally {
      if (--this.sourceDepth === 0) { this.written.clear(); this.draw(); }
    }
  }

  private prepare(doc: ITimelineDocument, layers: readonly IHtmlResolvedLayer[]): void {
    const prepared = prepareHtmlAnimation(doc, layers, this.context, this.registry(), this.inspection);
    this.doc = doc; this.layers = layers; this.metadata = new Map(prepared.metadata); this.plan = prepared.plan;
    this.issues = prepared.diagnostics;
  }

  private draw(): void {
    if (this.inspectOnly !== undefined) return;
    if (this.sourceDepth > 0 || this.plan === undefined || this.doc === undefined) return;
    const frame = composeHtmlAnimationFrame(this.doc, this.layers, this.plan, this.context, this.inspection,
      this.frame, this.visible, this.active);
    for (const element of this.held) {
      const declarations = frame.elements.get(element) ?? {};
      const previous = this.written.get(element) ?? new Set<string>();
      for (const name of previous) if (!(name in declarations)) this.keeper.restore(element, name);
      for (const [name, value] of Object.entries(declarations)) this.keeper.write(element, name, value, 'important');
      this.written.set(element, new Set(Object.keys(declarations)));
    }
    this.renderIssues = frame.diagnostics;
  }
}
