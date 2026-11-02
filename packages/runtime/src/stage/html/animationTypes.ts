// packages/runtime/src/stage/html/animationTypes.ts
import type { ITimelineDocument } from '../../model/document';
import type { ILayer } from '../../model/layer';
import type { IPropertyTimeline, TimelinePropertyValue } from '../../model/propertyTimeline';
import type { PropertyDescriptor } from '../../properties/types';
import type { LayerTarget } from '../../model/target';
import type { HtmlPropertyBinding, IHtmlGradientDefinition, IHtmlResolvedBinding } from './cssTypes';

/** Saved alongside the generic timeline, never mixed into its temporal model. */
export interface IHtmlAnimationContext {
  readonly version: 1;
  readonly bindings?: Readonly<Record<string, Readonly<Record<string, HtmlPropertyBinding>>>>;
  readonly gradients?: Readonly<Record<string, readonly IHtmlGradientDefinition[]>>;
  readonly resolutions?: readonly IHtmlConflictResolution[];
}

/** An explicit choice is usable only while its complete conflict signature matches. */
export interface IHtmlConflictResolution {
  readonly conflictId: string;
  readonly signature: string;
  readonly winnerLayerId: string;
  readonly beforeFirst?: HtmlBeforeFirstPolicy;
}

export type HtmlBeforeFirstPolicy = 'initial' | 'first-key' | 'underlying';

export interface IHtmlResolvedLayer {
  readonly layerId: string;
  readonly layer: ILayer;
  readonly target: LayerTarget;
  readonly elements: readonly Element[];
}

export interface IHtmlResolvedProperty {
  readonly layerId: string;
  readonly property: string;
  readonly binding: IHtmlResolvedBinding;
  readonly value: TimelinePropertyValue;
}

export interface IHtmlResolvedElementState {
  readonly element: Element;
  readonly properties: readonly IHtmlResolvedProperty[];
}

export type HtmlResolutionDiagnosticCode = 'priority-conflict' | 'unsupported-specificity' |
  'unsupported-binding' | 'stale-resolution' | 'composition-conflict' | 'before-first-conflict';

/** Serializable diagnostic; target names describe bindings, not fragile DOM paths. */
export interface IHtmlResolutionDiagnostic {
  readonly code: HtmlResolutionDiagnosticCode;
  readonly id: string;
  readonly signature: string;
  readonly property: string;
  readonly layerIds: readonly string[];
  /** HA10: exact temporal channels participating in a resolvable conflict. */
  readonly contributions?: readonly { readonly layerId: string; readonly property: string }[];
  readonly targets: readonly string[];
  readonly fromFrame: number;
  readonly toFrame: number;
  readonly toFrameExclusive?: boolean;
  readonly choices: readonly string[];
  readonly policies?: readonly HtmlBeforeFirstPolicy[];
  readonly blocking: boolean;
  readonly message: string;
}

export type HtmlResolvedSample =
  | { readonly status: 'value'; readonly value: TimelinePropertyValue }
  | { readonly status: 'refused'; readonly code: 'unrecorded' | 'unavailable'; readonly reason: string };

/** Exact selected provenance for exporters; no curve is reconstructed from samples. */
export interface IHtmlResolvedTrajectory {
  readonly layerId: string;
  readonly property: string;
  readonly binding: IHtmlResolvedBinding;
  readonly timeline?: IPropertyTimeline;
  readonly descriptor?: PropertyDescriptor;
  readonly before?: {
    readonly until: number;
    readonly policy?: HtmlBeforeFirstPolicy;
    readonly underlying?: IHtmlResolvedTrajectory;
  };
}

export interface IHtmlResolvedElementTrajectories {
  readonly element: Element;
  readonly properties: readonly IHtmlResolvedTrajectory[];
}

/** Immutable prepared inputs. Each evaluation returns fresh values and arrays. */
export interface IHtmlResolutionPlan {
  readonly document: ITimelineDocument;
  readonly diagnostics: readonly IHtmlResolutionDiagnostic[];
  evaluate(frame: number): readonly IHtmlResolvedElementState[];
  trajectories(): readonly IHtmlResolvedElementTrajectories[];
  sample(layerId: string, property: string, frame: number, initialValue?: TimelinePropertyValue): HtmlResolvedSample;
}
