// packages/runtime/src/stage/html/cssTypes.ts
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { HtmlSpatialBinding } from './spatialTypes';

export type HtmlTransformComponent = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY' | 'skewX' | 'skewY';
export type HtmlGradientComponent = 'type' | 'angle' | 'centerX' | 'centerY' | 'radiusX' | 'radiusY'
  | 'color' | 'position' | 'opacity' | 'present';

/** Serializable association; CSS knowledge stays outside generic timeline values. */
export type HtmlPropertyBinding =
  | HtmlSpatialBinding
  | { readonly kind: 'style'; readonly cssName: string; readonly unit?: string }
  | { readonly kind: 'transform'; readonly component: HtmlTransformComponent }
  | { readonly kind: 'gradient'; readonly gradientId: string; readonly component: HtmlGradientComponent; readonly stopId?: string };

/** Source RGB has alpha 1; the independent opacity property is the single alpha owner. */
export interface IHtmlGradientStop {
  readonly id: string;
  readonly color: Extract<TimelinePropertyValue, { kind: 'color' }>;
  readonly opacity: number;
  /** Percentage; conic gradients use the same 0..100 turn convention. */
  readonly position: number;
  readonly present: boolean;
}

/** Geometry uses degrees and percentages; stop identity does not depend on array position. */
export interface IHtmlGradientDefinition {
  readonly id: string;
  readonly cssName: 'background-image';
  readonly type: 'linear' | 'radial' | 'conic';
  readonly angle: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly stops: readonly IHtmlGradientStop[];
}

export interface IHtmlResolvedBinding {
  readonly binding: HtmlPropertyBinding;
  readonly valueKind: TimelinePropertyValue['kind'];
}

export type HtmlReadResult<T> = { readonly status: 'value'; readonly value: T }
  | { readonly status: 'unsupported'; readonly reason: string };
export type HtmlTransformValues = Readonly<Record<HtmlTransformComponent, number>>;
export interface IHtmlCssDiagnostic { readonly property: string; readonly reason: string }
export interface IHtmlCssComposition {
  readonly declarations: Readonly<Record<string, string>>;
  readonly diagnostics: readonly IHtmlCssDiagnostic[];
}
