// demo/editor/src/conformance/factories.ts
import { createEditor, createPropertiesPanelPlugin } from '@kazo-ca/timeline-editor';
import type { PropertyChangedEvent } from '@kazo-ca/timeline-editor';
import { collectLayers, createManualClock, createObjectStage, createPropertyRegistry } from '@kazo-ca/timeline-runtime';
import type {
  IObjectStageEntry, IPropertyTimeline, ITargetPropertyDiagnostic, ITargetPropertyInfo, ITimelineDocument,
  PropertyDescriptor, TimelinePropertyValues
} from '@kazo-ca/timeline-runtime';
import { uiDocument } from './scenes/ui';
import type { HostProfile, IConformanceHandle, IGenericEditorOptions, SerializableDescriptor } from './types';

type HostObject = { readonly id: string };

/** Unclamped linear interpolation: a custom registry interpolator that never saturates. */
const unclampedLinear = (a: number, b: number, t: number): number => a + (b - a) * t;

function toDescriptor(source: SerializableDescriptor): PropertyDescriptor {
  const { interpolator, ...rest } = source;
  return interpolator === 'unclamped-linear' ? { ...rest, interpolate: unclampedLinear } : { ...rest };
}

/** Everything a tween of the initial timeline needs to stay valid: its keys and its span. */
function tweenGuard(property: string, initial: IPropertyTimeline): (layerId: string, proposed: IPropertyTimeline | undefined) => readonly ITargetPropertyDiagnostic[] {
  const transitions = initial.transitions ?? [];
  return (_layerId, proposed) => {
    const broken = transitions.find((transition) => {
      const keys = [transition.fromFrame, transition.toFrame].map((frame) => ({
        initial: initial.keys.find((key) => key.frame === frame),
        proposed: proposed?.keys.find((key) => key.frame === frame)
      }));
      const kept = proposed?.transitions?.some((candidate) => candidate.fromFrame === transition.fromFrame && candidate.toFrame === transition.toFrame);
      return kept !== true || keys.some(({ initial: before, proposed: after }) => JSON.stringify(before) !== JSON.stringify(after));
    });
    return broken === undefined ? [] : [{
      severity: 'error', property, fromFrame: broken.fromFrame, toFrame: broken.toFrame,
      message: `La transition de « ${property} » entre les images ${broken.fromFrame} et ${broken.toFrame} ne peut pas être modifiée.`
    }];
  };
}

const NON_INTERPOLABLE_REASON = 'Cette propriété est déclarée non interpolable par l’hôte.';
const HOST_WARNING = 'Avertissement de l’hôte : valeur proche de la limite.';

/** Properties whose capability is read at every `describe`, so the host may change it after the tween exists. */
function declaredProperties(timelines: Record<string, IPropertyTimeline>, nonInterpolable: ReadonlySet<string>): ITargetPropertyInfo[] {
  return Object.keys(timelines).map((name) => nonInterpolable.has(name)
    ? { name, interpolable: false, reason: NON_INTERPOLABLE_REASON } : { name });
}

function entriesFor(
  document: ITimelineDocument, host: HostProfile, objects: Map<string, HostObject>, nonInterpolable: ReadonlySet<string>
): IObjectStageEntry<HostObject>[] {
  return collectLayers(document).flatMap((layer): IObjectStageEntry<HostObject>[] => {
    if (layer.target === undefined || !('ref' in layer.target)) return [];
    const object: HostObject = { id: layer.id };
    objects.set(layer.id, object);
    const timelines = layer.propertyTimelines ?? {};
    const base = { id: layer.target.ref, label: layer.name, object };
    if (host === 'declared') return [{ ...base, get properties() { return declaredProperties(timelines, nonInterpolable); } }];
    if (host === 'warn') {
      return [{ ...base, properties: Object.keys(timelines).map((name) => ({ name, validate: () => [{ severity: 'warning' as const, message: HOST_WARNING, property: name }] })) }];
    }
    const properties: ITargetPropertyInfo[] | undefined = host === 'open' ? undefined
      : Object.entries(timelines).map(([name, timeline]) => (timeline.transitions?.length ?? 0) > 0
        ? { name, validate: tweenGuard(name, timeline) } : { name });
    return [{ ...base, ...(properties === undefined ? {} : { properties }) }];
  });
}

function observe(editor: IConformanceHandle['editor']): PropertyChangedEvent[] {
  const events: PropertyChangedEvent[] = [];
  editor.on('property:changed', (event) => { events.push(event); });
  return events;
}

/** A generic editor on an object stage and a manual clock, without UI plugins. */
export function createGenericHandle(options: IGenericEditorOptions): IConformanceHandle {
  const host = document.createElement('div');
  host.hidden = true;
  document.body.append(host);
  const clock = createManualClock();
  const values = new Map<string, TimelinePropertyValues>();
  const objects = new Map<string, HostObject>();
  const nonInterpolable = new Set<string>();
  const stage = createObjectStage<HostObject>({
    id: 'conformance-objects', unscoped: true,
    objects: entriesFor(options.document, options.host ?? 'open', objects, nonInterpolable),
    apply: (object, _numeric, state) => { values.set(object.id, state.propertyValues ?? {}); }
  });
  const registry = createPropertyRegistry((options.extraProperties ?? []).map(toDescriptor));
  const editor = createEditor(host, { data: options.document, stage, registry, clock, defaultPlugins: false });
  return {
    handleKind: 'generic', editor, clock, events: observe(editor), objectValues: (layerId) => values.get(layerId),
    declareNonInterpolable: (property) => { nonInterpolable.add(property); },
    dispose: () => { try { if (!editor.isDestroyed) editor.destroy(); } finally { host.remove(); } }
  };
}

/** An editor with the default UI plugins and the properties panel, mounted in `#ui-host`. */
export function createUiHandle(): IConformanceHandle {
  const host = document.getElementById('ui-host');
  if (host === null) throw new Error('Hôte #ui-host manquant.');
  const clock = createManualClock();
  const values = new Map<string, TimelinePropertyValues>();
  const stage = createObjectStage<HostObject>({
    id: 'conformance-ui-objects', unscoped: true,
    objects: [{ id: 'card', label: 'Carte', object: { id: 'card' } }, { id: 'orb', label: 'Orbe', object: { id: 'orb' } }],
    apply: (object, _numeric, state) => { values.set(object.id, state.propertyValues ?? {}); }
  });
  const editor = createEditor(host, { data: uiDocument(), stage, clock, plugins: [createPropertiesPanelPlugin()] });
  return {
    handleKind: 'ui', editor, clock, events: observe(editor), objectValues: (layerId) => values.get(layerId),
    dispose: () => { if (!editor.isDestroyed) editor.destroy(); }
  };
}
