// packages/editor/src/core/editor/atomicCandidate.ts
import { getHtmlStageAtomicAccess, validateDocument } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic, IHtmlStageAtomicAccess, ITargetInfo, ITargetPropertyInfo, ITimelineDocument, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import { applyPropertyTimelineOperation } from '../../model/propertyTimelines/operations';
import type { PropertyTimelineOperation } from '../../model/propertyTimelines/types';
import type { IPropertyEditContext } from '../../model/properties/targetProperties';
import { requireEditableLayer } from '../../model/spans/layerAccess';
import type { EditorStageHost } from '../stage/EditorStageHost';
import { routeOf } from '../stage/targetInfo';
import { freezeAtomicDocument as freezeDocument } from './atomicDocument';

export type HtmlContexts = ReadonlyMap<IHtmlStageAtomicAccess, IHtmlAnimationContext>;
export type HtmlDiagnostics = ReadonlyMap<IHtmlStageAtomicAccess, readonly IHtmlResolutionDiagnostic[]>;

/** Owned JSON values compare independently of object insertion order. */
export function sameAtomicData(a: unknown, b: unknown): boolean {
  const key = (value: unknown): string => {
    if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined';
    if (Array.isArray(value)) return `[${value.map(key).join(',')}]`;
    return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([x], [y]) => x.localeCompare(y))
      .map(([name, child]) => `${JSON.stringify(name)}:${key(child)}`).join(',')}}`;
  };
  return a === b || key(a) === key(b);
}

export class AtomicCandidate {
  private baseline = new Map<IHtmlStageAtomicAccess, readonly IHtmlResolutionDiagnostic[]>();
  constructor(private readonly stages: EditorStageHost, private readonly registry: PropertyRegistry) {}

  captureBaseline(doc: ITimelineDocument, contexts: HtmlContexts): void {
    this.baseline = new Map([...contexts].map(([access, context]) => [access, access.validate(doc, context)]));
  }

  /** Exact previously present issues may be restored by undo of an explicit resolution. */
  conflictBaseline(access: IHtmlStageAtomicAccess, id: string): HtmlDiagnostics {
    const issues = (this.baseline.get(access) ?? []).filter((issue) => issue.id === id || issue.id === `html-stale:${id}`);
    return new Map([[access, issues]]);
  }

  apply(doc: ITimelineDocument, operations: readonly PropertyTimelineOperation[], contexts: HtmlContexts): ITimelineDocument {
    let candidate = doc;
    for (const operation of operations) {
      const current = candidate;
      candidate = applyPropertyTimelineOperation(current, operation, this.editContext(current, operation, contexts));
    }
    return candidate;
  }

  editContext(current: ITimelineDocument, operation: PropertyTimelineOperation, contexts: HtmlContexts): IPropertyEditContext {
    return { registry: this.registry,
        describe: () => {
          const info = this.describe(current, operation, contexts);
          if (info?.properties === undefined) return info;
          // Cross-property and cross-key constraints belong to the complete paired candidate.
          return { ...info, properties: info.properties.map((property) => {
            if (typeof property === 'string') return property;
            return { ...property, validate: undefined };
          }) };
        }
      };
  }

  validate(doc: ITimelineDocument, operations: readonly PropertyTimelineOperation[], contexts: HtmlContexts,
    permissions = true, restored: HtmlDiagnostics = new Map()): void {
    const issues = validateDocument(doc, { allowLiveTargets: false });
    if (issues.length > 0) throw new Error(`Le document proposé est invalide : ${issues[0].path} (${issues[0].code}).`);
    freezeDocument(doc);
    if (permissions) this.validatePermissions(doc, operations, contexts);
    for (const [access, context] of contexts) {
      const previousIssues = [...(this.baseline.get(access) ?? []), ...(restored.get(access) ?? [])];
      const blocking = access.validate(doc, context).find((issue) => issue.blocking && !previousIssues.some(
        (old) => sameAtomicData(old, issue)));
      if (blocking !== undefined) throw new Error(blocking.message);
    }
  }

  validatePermissions(doc: ITimelineDocument, operations: readonly PropertyTimelineOperation[], contexts: HtmlContexts): void {
    freezeDocument(doc);
    for (const operation of operations) {
      const layer = requireEditableLayer(doc, operation.layerId);
      const info = this.describe(doc, operation, contexts);
      const properties = info?.properties;
      if (properties === undefined) continue;
      const raw = properties.find((property) => (typeof property === 'string' ? property : property.name) === operation.property);
      if (raw === undefined) throw new Error(`La propriété « ${operation.property} » n’est pas autorisée pour cette cible.`);
      const capability: ITargetPropertyInfo = typeof raw === 'string' ? { name: raw } : raw;
      if (capability.editable === false) throw new Error(capability.reason ?? 'La propriété ne peut pas être modifiée.');
      const track = layer.propertyTimelines?.[operation.property];
      if ((track?.transitions?.length ?? 0) > 0 && capability.interpolable === false) throw new Error(capability.reason ?? 'La propriété ne peut pas être interpolée.');
      const errors = capability.validate?.(layer.id, track)?.filter((issue) => issue.severity === 'error');
      if (errors !== undefined && errors.length > 0) throw new Error(errors[0].message);
    }
  }

  private describe(doc: ITimelineDocument, operation: PropertyTimelineOperation, contexts: HtmlContexts): ITargetInfo | undefined {
    const layer = requireEditableLayer(doc, operation.layerId);
    if (layer.target === undefined) return undefined;
    const stage = routeOf(this.stages.stages, layer.target);
    const access = stage === undefined ? undefined : getHtmlStageAtomicAccess(stage);
    if (access === undefined) return this.stages.describeForEdit(layer.target);
    const kind = 'value' in operation ? operation.value.kind : 'initialValue' in operation ? operation.initialValue?.kind : undefined;
    const property = access.inspect(doc, contexts.get(access) ?? access.context, layer.id, operation.property, kind);
    return { target: layer.target, label: layer.name, properties: [property] };
  }
}
