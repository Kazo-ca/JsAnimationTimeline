// packages/runtime/src/stage/html/resolution.ts
import { collectLayerProperties, evaluateLayer } from '../../evaluate/evaluateLayer';
import { evaluatePropertyTimeline } from '../../evaluate/propertyTimeline';
import type { ITimelineDocument } from '../../model/document';
import { isSelectorTarget, isRefTarget } from '../../model/guards';
import type { IPropertyTimeline, TimelinePropertyValue } from '../../model/propertyTimeline';
import type { LayerTarget } from '../../model/target';
import type { PropertyRegistry } from '../../properties/PropertyRegistry';
import { boundTimelineValue } from '../../properties/timelineValues';
import type { PropertyDescriptor } from '../../properties/types';
import type {
  HtmlResolutionDiagnosticCode, IHtmlAnimationContext, IHtmlResolvedElementState, IHtmlResolvedLayer,
  IHtmlResolutionDiagnostic, IHtmlResolutionPlan, HtmlResolvedSample, HtmlBeforeFirstPolicy, IHtmlConflictResolution,
  IHtmlResolvedTrajectory
} from './animationTypes';
import { canonicalHtmlData, cloneHtmlAnimationContext } from './animationContext';
import { htmlBindingDestination, resolveHtmlBinding } from './cssBindings';
import type { IHtmlResolvedBinding } from './cssTypes';
import { compareHtmlSpecificity, htmlTargetSpecificity } from './specificity';
import type { HtmlSpecificity } from './specificity';

interface IContribution {
  readonly source: IHtmlResolvedLayer;
  readonly property: string;
  readonly destination: string;
  readonly binding: IHtmlResolvedBinding;
  readonly track?: IPropertyTimeline;
  readonly signature: string;
  readonly equivalence: string;
}

interface IElementContribution extends IContribution {
  readonly specificity?: HtmlSpecificity;
}

interface IChosenProperty {
  readonly contribution: IContribution;
  readonly useFirstKey: boolean;
  readonly before?: { readonly until: number; readonly policy?: HtmlBeforeFirstPolicy; readonly underlying?: IChosenProperty };
}

function targetName(target: LayerTarget): string {
  if (isSelectorTarget(target)) return target.selector;
  if (isRefTarget(target)) return `ref:${target.stage ?? 'html'}:${target.ref}`;
  return 'élément direct';
}

function timelineData(track: IPropertyTimeline): unknown {
  const constant = heldConstant(track);
  if (constant !== undefined && (track.keys[0].frame === 1 || track.beforeFirst === 'first-key' || sameValue(track.initialValue, constant))) {
    return { constant };
  }
  return { initialValue: track.initialValue, beforeFirst: track.beforeFirst ?? 'initial', keys: track.keys,
    transitions: (track.transitions ?? []).map(({ fromFrame, toFrame, easing, source }) => ({ fromFrame, toFrame, easing, source })) };
}

function contributionData(item: IContribution): unknown {
  return { layerId: item.source.layerId, property: item.property, target: targetName(item.source.target),
    binding: item.binding, timeline: item.signature };
}

function compareContributions(a: IContribution, b: IContribution): number {
  const left = canonicalHtmlData([a.source.layerId, a.property]);
  const right = canonicalHtmlData([b.source.layerId, b.property]);
  return left < right ? -1 : left > right ? 1 : 0;
}

function sameValue(a: TimelinePropertyValue, b: TimelinePropertyValue): boolean {
  return canonicalHtmlData(a) === canonicalHtmlData(b);
}

function bindingData(binding: IHtmlResolvedBinding): unknown {
  return binding.binding.kind === 'style' ? { ...binding, binding: { ...binding.binding, unit: binding.binding.unit ?? '' } } : binding;
}

/** A held constant can have repeated captures without changing the rule. */
function heldConstant(track: IPropertyTimeline | undefined): TimelinePropertyValue | undefined {
  if (track === undefined || track.keys.length === 0 || (track.transitions?.length ?? 0) > 0) return undefined;
  const first = track.keys[0].value;
  return track.keys.every((key) => sameValue(key.value, first)) ? first : undefined;
}

/** A later edit does not make a previously constant prefix ambiguous. */
function constantBefore(track: IPropertyTimeline | undefined, until: number): TimelinePropertyValue | undefined {
  if (track === undefined || track.keys.length === 0 || track.keys[0].frame !== 1 && track.beforeFirst !== 'first-key') return undefined;
  if (track.transitions?.some((transition) => transition.fromFrame < until)) return undefined;
  const first = track.keys[0].value;
  return track.keys.filter((key) => key.frame < until).every((key) => sameValue(key.value, first)) ? first : undefined;
}

function equivalent(a: IElementContribution, b: IElementContribution, registry: PropertyRegistry): boolean {
  const leftDescriptor = registry.get(a.property);
  const rightDescriptor = registry.get(b.property);
  return a.equivalence === b.equivalence && canonicalHtmlData(bindingData(a.binding)) === canonicalHtmlData(bindingData(b.binding)) &&
    leftDescriptor?.interpolate === rightDescriptor?.interpolate && leftDescriptor?.min === rightDescriptor?.min &&
    leftDescriptor?.max === rightDescriptor?.max;
}

function diagnostic(
  code: HtmlResolutionDiagnosticCode, destination: string, candidates: readonly IContribution[], totalFrames: number, message: string
): IHtmlResolutionDiagnostic {
  const ordered = [...candidates].sort(compareContributions);
  const layerIds = [...new Set(ordered.map((item) => item.source.layerId))];
  const targets = [...new Set(ordered.map((item) => targetName(item.source.target)))];
  const identity = [code, destination, ordered.map((item) => [item.source.layerId, item.property, targetName(item.source.target)])];
  // Choosing an object cannot disambiguate two different aliases inside it.
  const choices = code === 'unsupported-binding' ? [] : code === 'composition-conflict' ? layerIds :
    layerIds.filter((id) => ordered.filter((item) => item.source.layerId === id).length === 1);
  return { code, id: `html-conflict:${canonicalHtmlData(identity)}`,
    signature: canonicalHtmlData({ destination, totalFrames, candidates: ordered.map(contributionData) }),
    property: ordered[0]?.property ?? destination, layerIds,
    contributions: ordered.map((item) => ({ layerId: item.source.layerId, property: item.property })),
    targets, fromFrame: 1, toFrame: totalFrames,
    choices, blocking: true, message };
}

function collectContributions(
  layers: readonly IHtmlResolvedLayer[], context: IHtmlAnimationContext, registry: PropertyRegistry,
  totalFrames: number, diagnostics: Map<string, IHtmlResolutionDiagnostic>
): IContribution[] {
  const result: IContribution[] = [];
  for (const source of layers) {
    for (const property of collectLayerProperties(source.layer)) {
      const track = source.layer.propertyTimelines?.[property];
      if (track?.keys.length === 0) continue;
      const binding = resolveHtmlBinding(property, track?.initialValue.kind ?? 'number', registry, context.bindings?.[source.layerId]?.[property]);
      if (binding.status !== 'value') {
        const id = `html-binding:${canonicalHtmlData([source.layerId, property])}`;
        diagnostics.set(id, { code: 'unsupported-binding', id, signature: id, property, layerIds: [source.layerId],
          targets: [targetName(source.target)], fromFrame: 1, toFrame: totalFrames, choices: [], blocking: true, message: binding.reason });
        continue;
      }
      const history = track === undefined ? source.layer.spans.map(({ start, end, kind, tracks, easing }) =>
        ({ start, end, kind, easing, track: tracks?.[property] })) : timelineData(track);
      const gradientBinding = binding.value.binding.kind === 'gradient' ? binding.value.binding : undefined;
      const gradient = gradientBinding === undefined ? undefined : context.gradients?.[source.layerId]?.find((item) => item.id === gradientBinding.gradientId);
      result.push({ source, property, track, binding: binding.value, destination: htmlBindingDestination(binding.value.binding),
        equivalence: canonicalHtmlData({ history, gradient }),
        signature: canonicalHtmlData({ history: track === undefined ? history : {
          initialValue: track.initialValue, beforeFirst: track.beforeFirst ?? 'initial', keys: track.keys, transitions: track.transitions ?? []
        }, gradient }) });
    }
  }
  return result;
}

interface IResolutionState {
  readonly context: IHtmlAnimationContext;
  readonly registry: PropertyRegistry;
  readonly totalFrames: number;
  readonly diagnostics: Map<string, IHtmlResolutionDiagnostic>;
  readonly usedResolutions: Set<string>;
}

function savedChoice(state: IResolutionState, conflict: IHtmlResolutionDiagnostic): IHtmlConflictResolution | undefined {
  const saved = state.context.resolutions?.find((item) => item.conflictId === conflict.id);
  const policyValid = conflict.code === 'before-first-conflict' ? saved?.beforeFirst !== undefined && conflict.policies?.includes(saved.beforeFirst) : saved?.beforeFirst === undefined;
  if (saved !== undefined && saved.signature === conflict.signature && conflict.choices.includes(saved.winnerLayerId) && policyValid) {
    state.usedResolutions.add(saved.conflictId);
    return saved;
  }
  state.diagnostics.set(conflict.id, conflict);
  return undefined;
}

function explicitChoice(state: IResolutionState, conflict: IHtmlResolutionDiagnostic): string | undefined {
  return savedChoice(state, conflict)?.winnerLayerId;
}

function highestCandidates(candidates: readonly IElementContribution[]): readonly IElementContribution[] {
  const highest = candidates.reduce((max, item) => compareHtmlSpecificity(item.specificity!, max) > 0 ? item.specificity! : max, candidates[0].specificity!);
  return candidates.filter((item) => compareHtmlSpecificity(item.specificity!, highest) === 0);
}

function chooseBeforeFirst(
  winner: IElementContribution, ordered: readonly IElementContribution[], state: IResolutionState, horizon: number
): IChosenProperty {
  const chosen: IChosenProperty = { contribution: winner, useFirstKey: false };
  const first = winner.track?.keys[0];
  if (first === undefined || first.frame === 1 || winner.track?.beforeFirst === 'first-key') return chosen;
  const lower = ordered.filter((item) => compareHtmlSpecificity(item.specificity!, winner.specificity!) < 0);
  if (lower.length === 0) return chosen;
  const underneath = highestCandidates(lower);
  const prefix = constantBefore(underneath[0].track, first.frame);
  if (heldConstant(winner.track) !== undefined && prefix !== undefined && underneath.every((item) => {
    const value = constantBefore(item.track, first.frame);
    return value !== undefined && sameValue(prefix, value);
  })) return { ...chosen, useFirstKey: true };
  const until = Math.min(first.frame, horizon);
  const base = diagnostic('before-first-conflict', winner.destination, [winner, ...underneath], state.totalFrames,
    'Plusieurs règles se recouvrent avant la première clé de l’objet prioritaire. Choisissez explicitement la valeur à appliquer sur cette période.');
  const conflict: IHtmlResolutionDiagnostic = { ...base, toFrame: until, toFrameExclusive: true,
    choices: [winner.source.layerId], policies: ['initial', 'first-key', 'underlying'],
    signature: canonicalHtmlData({ signature: base.signature, until }) };
  const saved = savedChoice(state, conflict);
  const underlying = saved?.beforeFirst === 'underlying' ? chooseProperty(lower, state, until) : undefined;
  return { ...chosen, before: { until, ...(saved?.beforeFirst === undefined ? {} : { policy: saved.beforeFirst }),
    ...(underlying === undefined ? {} : { underlying }) } };
}

function chooseProperty(candidates: readonly IElementContribution[], state: IResolutionState, horizon = state.totalFrames + 1): IChosenProperty | undefined {
  const ordered = [...candidates].sort(compareContributions);
  let top = ordered;
  const known = ordered.every((item) => item.specificity !== undefined);
  if (known) top = [...highestCandidates(ordered)];
  let winner = top[0];
  const prefix = constantBefore(top[0].track, horizon);
  const samePrefix = horizon <= state.totalFrames && prefix !== undefined && top.every((item) => {
    const value = constantBefore(item.track, horizon);
    return value !== undefined && sameValue(prefix, value);
  });
  if (top.length > 1 && !samePrefix && !top.every((item) => equivalent(top[0], item, state.registry))) {
    const conflict = diagnostic(known ? 'priority-conflict' : 'unsupported-specificity', top[0].destination, top, state.totalFrames,
      known ? 'Plusieurs objets de même spécificité définissent cette propriété. Choisissez explicitement celui à utiliser.' :
        'La priorité de ces sélecteurs ne peut pas être déterminée. Choisissez explicitement l’objet à utiliser.');
    const chosen = explicitChoice(state, conflict);
    if (chosen === undefined) return undefined;
    winner = top.find((item) => item.source.layerId === chosen)!;
    return { contribution: winner, useFirstKey: false };
  }
  return known ? chooseBeforeFirst(winner, ordered, state, horizon) : { contribution: winner, useFirstKey: false };
}

/** A before-first decision never replaces the priority after the first key. */
function choiceAt(chosen: IChosenProperty | undefined, frame: number): IChosenProperty | undefined {
  if (chosen === undefined || chosen.before === undefined || frame >= chosen.before.until) return chosen;
  if (chosen.before.policy === undefined) return undefined;
  if (chosen.before.policy === 'underlying') return choiceAt(chosen.before.underlying, frame);
  return { contribution: chosen.contribution, useFirstKey: chosen.before.policy === 'first-key' };
}

/** Distinct gradient structures cannot be merged by iterating CSS declarations. */
function filterGradientComposition(candidates: readonly IElementContribution[], state: IResolutionState): readonly IElementContribution[] {
  const background = candidates.filter((item) => item.binding.binding.kind === 'gradient' ||
    item.binding.binding.kind === 'style' && item.binding.binding.cssName === 'background-image');
  if (!background.some((item) => item.binding.binding.kind === 'gradient')) return candidates;
  const structures = new Set(background.map((item) => {
    const binding = item.binding.binding;
    return binding.kind !== 'gradient' ? 'style' : canonicalHtmlData(state.context.gradients?.[item.source.layerId]?.find((entry) => entry.id === binding.gradientId));
  }));
  if (structures.size <= 1) return candidates;
  const conflict = diagnostic('composition-conflict', 'background-image', background, state.totalFrames,
    'Ces objets composent des fonds incompatibles. Choisissez le fond à appliquer à leur intersection.');
  const chosen = explicitChoice(state, conflict);
  const blocked = new Set(background.filter((item) => item.source.layerId !== chosen));
  return candidates.filter((item) => !blocked.has(item));
}

const SIDES = ['top', 'right', 'bottom', 'left'];
const BORDER_PARTS = ['width', 'style', 'color'];
const SHORTHANDS: Readonly<Record<string, readonly string[]>> = {
  margin: SIDES.map((side) => `margin-${side}`), padding: SIDES.map((side) => `padding-${side}`),
  inset: SIDES, 'border-radius': ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'],
  border: SIDES.flatMap((side) => BORDER_PARTS.map((part) => `border-${side}-${part}`)),
  ...Object.fromEntries(SIDES.map((side) => [`border-${side}`, BORDER_PARTS.map((part) => `border-${side}-${part}`)])),
  ...Object.fromEntries(BORDER_PARTS.map((part) => [`border-${part}`, SIDES.map((side) => `border-${side}-${part}`)])),
  background: ['background-image', 'background-color', 'background-position', 'background-size', 'background-repeat', 'background-origin', 'background-clip', 'background-attachment'],
  font: ['font-family', 'font-size', 'font-style', 'font-weight', 'font-stretch', 'font-variant', 'line-height'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'], 'flex-flow': ['flex-direction', 'flex-wrap'],
  gap: ['row-gap', 'column-gap'], overflow: ['overflow-x', 'overflow-y'],
  outline: ['outline-color', 'outline-style', 'outline-width'],
  'text-decoration': ['text-decoration-line', 'text-decoration-color', 'text-decoration-style', 'text-decoration-thickness']
};

function footprint(item: IContribution): readonly string[] {
  const binding = item.binding.binding;
  if (binding.kind === 'gradient') return ['css:background-image'];
  if (binding.kind === 'transform') return [`transform:${binding.component}`];
  if (binding.cssName === 'transform') return ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'].map((part) => `transform:${part}`);
  return (SHORTHANDS[binding.cssName] ?? [binding.cssName]).map((name) => `css:${name}`);
}

function compositionOverlap(a: IContribution, b: IContribution): boolean {
  if (a.destination === b.destination) return false;
  if (a.binding.binding.kind === 'gradient' && b.binding.binding.kind === 'gradient') return false;
  const left = footprint(a);
  return footprint(b).some((name) => left.includes(name));
}

/** A whole shorthand cannot silently erase a separately animated longhand. */
function filterComposition(candidates: readonly IElementContribution[], state: IResolutionState): readonly IElementContribution[] {
  const remaining = filterGradientComposition(candidates, state);
  const visited = new Set<IElementContribution>();
  const blocked = new Set<IElementContribution>();
  for (const first of remaining) {
    if (visited.has(first)) continue;
    const group = [first];
    visited.add(first);
    for (let index = 0; index < group.length; index++) {
      for (const item of remaining) {
        if (visited.has(item) || !compositionOverlap(group[index], item)) continue;
        group.push(item);
        visited.add(item);
      }
    }
    if (group.length < 2) continue;
    const destination = canonicalHtmlData([...new Set(group.flatMap(footprint))].sort());
    const conflict = diagnostic('composition-conflict', destination, group, state.totalFrames,
      'Une déclaration CSS complète recouvre une autre propriété animée. Choisissez l’objet à appliquer ou utilisez des propriétés CSS distinctes.');
    const safeChoices = conflict.choices.filter((id) => {
      const own = group.filter((item) => item.source.layerId === id);
      return !own.some((a, index) => own.slice(index + 1).some((b) => compositionOverlap(a, b)));
    });
    const chosen = explicitChoice(state, { ...conflict, choices: safeChoices });
    group.filter((item) => item.source.layerId !== chosen).forEach((item) => blocked.add(item));
  }
  return remaining.filter((item) => !blocked.has(item));
}

function staleDiagnostics(state: IResolutionState): void {
  for (const saved of state.context.resolutions ?? []) {
    if (state.usedResolutions.has(saved.conflictId)) continue;
    const id = `html-stale:${saved.conflictId}`;
    state.diagnostics.set(id, { code: 'stale-resolution', id, signature: saved.signature, property: '',
      layerIds: [saved.winnerLayerId], targets: [], fromFrame: 1, toFrame: state.totalFrames, choices: [], blocking: true,
      message: 'Une résolution enregistrée ne correspond plus aux objets, propriétés ou clés actuels. Examinez-la à nouveau.' });
  }
}

/** HTML constraints augment, but never replace, a custom numeric interpolator. */
function evaluationDescriptor(item: IContribution, registry: PropertyRegistry): PropertyDescriptor | undefined {
  const descriptor = registry.get(item.property);
  const binding = item.binding.binding;
  const opacity = binding.kind === 'gradient' && binding.component === 'opacity' ||
    binding.kind === 'style' && ['opacity', 'fill-opacity', 'stroke-opacity', 'stop-opacity'].includes(binding.cssName);
  const radius = binding.kind === 'gradient' && ['radiusX', 'radiusY'].includes(binding.component);
  if ((!opacity && !radius) || item.binding.valueKind !== 'number') return descriptor;
  const max = opacity ? binding.kind === 'style' && binding.unit === '%' ? 100 : 1 : undefined;
  const min = Math.max(0, descriptor?.min ?? 0);
  return { ...(descriptor ?? { name: item.property, kind: 'value', unit: '', defaultValue: 0 }),
    min, ...(max === undefined ? {} : { max: Math.min(max, descriptor?.max ?? max) }) };
}

function sampleValue(chosen: IChosenProperty, frame: number, registry: PropertyRegistry): TimelinePropertyValue {
  const { contribution: item, useFirstKey } = chosen;
  const descriptor = evaluationDescriptor(item, registry);
  if (item.track !== undefined) return evaluatePropertyTimeline(useFirstKey ? { ...item.track, beforeFirst: 'first-key' } : item.track,
    frame, descriptor);
  return boundTimelineValue({ kind: 'number', value: evaluateLayer(item.source.layer, frame, { registry }).values[item.property] }, descriptor);
}

/**
 * Resolve typed HTML contributions per element/property without touching DOM or
 * adding keys. Exact curves come from the existing timeline evaluator. Ambiguous
 * priorities omit only the affected destination and expose a saved-choice ticket.
 */
export function prepareHtmlResolution(
  doc: ITimelineDocument, layers: readonly IHtmlResolvedLayer[], input: IHtmlAnimationContext, registry: PropertyRegistry
): IHtmlResolutionPlan {
  const context = cloneHtmlAnimationContext(input);
  const diagnostics = new Map<string, IHtmlResolutionDiagnostic>();
  const state: IResolutionState = { context, registry, totalFrames: doc.settings.totalFrames, diagnostics, usedResolutions: new Set() };
  const contributions = collectContributions(layers, context, registry, state.totalFrames, diagnostics);
  const byElement = new Map<Element, IElementContribution[]>();
  layers.forEach((source) => source.elements.forEach((element) => { if (!byElement.has(element)) byElement.set(element, []); }));
  for (const item of contributions) {
    for (const element of item.source.elements) {
      byElement.get(element)!.push({ ...item, specificity: htmlTargetSpecificity(item.source.target, element) });
    }
  }
  const chosen = new Map<Element, readonly IChosenProperty[]>();
  byElement.forEach((items, element) => {
    const byDestination = new Map<string, IElementContribution[]>();
    filterComposition(items, state).forEach((item) => {
      byDestination.set(item.destination, [...(byDestination.get(item.destination) ?? []), item]);
    });
    chosen.set(element, Array.from(byDestination.values()).flatMap((candidates) => {
      const winner = chooseProperty(candidates, state);
      return winner === undefined ? [] : [winner];
    }));
  });
  staleDiagnostics(state);
  const frameAt = (frame: number): number => {
    if (!Number.isFinite(frame)) throw new Error('L’image doit être un nombre fini.');
    return Math.max(1, Math.min(doc.settings.totalFrames, frame));
  };
  const evaluate = (frame: number): readonly IHtmlResolvedElementState[] => {
    const at = frameAt(frame);
    return Array.from(chosen, ([element, properties]) => ({ element, properties: properties.flatMap((candidate) => {
      const item = choiceAt(candidate, at);
      return item === undefined ? [] : [{ layerId: item.contribution.source.layerId, property: item.contribution.property,
        binding: item.contribution.binding, value: sampleValue(item, at, registry) }];
    }) }));
  };
  const sample = (layerId: string, property: string, frame: number, initialValue?: TimelinePropertyValue): HtmlResolvedSample => {
    const recorded = contributions.find((item) => item.source.layerId === layerId && item.property === property);
    const source = recorded?.source ?? layers.find((item) => item.layerId === layerId);
    const bindingResult = resolveHtmlBinding(property, initialValue?.kind ?? 'number', registry, context.bindings?.[layerId]?.[property]);
    const binding = recorded?.binding ?? (bindingResult.status === 'value' ? bindingResult.value : undefined);
    if (source === undefined || source.elements.length === 0 || binding === undefined) {
      return { status: 'refused', code: 'unavailable', reason: 'Cette propriété ne possède aucune cible HTML disponible.' };
    }
    const destination = htmlBindingDestination(binding.binding);
    const relevant = source.elements.flatMap((element) => byElement.get(element)?.filter((item) => item.destination === destination) ?? []);
    if (relevant.length === 0) return { status: 'refused', code: 'unrecorded', reason: 'Aucune valeur temporelle ne pilote encore cette propriété.' };
    const values: TimelinePropertyValue[] = [];
    for (const element of source.elements) {
      const item = choiceAt(chosen.get(element)?.find((entry) => entry.contribution.destination === destination), frameAt(frame));
      if (item === undefined) return { status: 'refused', code: 'unavailable', reason: 'Résolvez le conflit ou les valeurs différentes de cette propriété avant de capturer une clé.' };
      if (canonicalHtmlData(bindingData(item.contribution.binding)) !== canonicalHtmlData(bindingData(binding))) {
        return { status: 'refused', code: 'unavailable', reason: 'La propriété prioritaire utilise un type ou une unité différente. Harmonisez les associations avant de capturer une clé.' };
      }
      values.push(sampleValue(item, frameAt(frame), registry));
    }
    if (!values.every((value) => sameValue(values[0], value))) {
      return { status: 'refused', code: 'unavailable', reason: 'Les éléments du groupe affichent des valeurs différentes. Utilisez leurs identifiants individuels pour cette propriété.' };
    }
    return { status: 'value', value: values[0] };
  };
  const trajectory = (item: IChosenProperty): IHtmlResolvedTrajectory => ({
    layerId: item.contribution.source.layerId, property: item.contribution.property, binding: item.contribution.binding,
    ...(item.contribution.track === undefined ? {} : { timeline: { ...item.contribution.track,
      ...(item.useFirstKey ? { beforeFirst: 'first-key' as const } : {}) } }),
    descriptor: evaluationDescriptor(item.contribution, registry),
    ...(item.before === undefined ? {} : { before: { until: item.before.until, policy: item.before.policy,
      ...(item.before.underlying === undefined ? {} : { underlying: trajectory(item.before.underlying) }) } })
  });
  const trajectories = () => Array.from(chosen, ([element, properties]) => ({ element, properties: properties.map(trajectory) }));
  return { document: doc, diagnostics: [...diagnostics.values()], evaluate, sample, trajectories };
}
