// packages/runtime/src/stage/html/spatialTypes.ts
import type { TimelinePropertyValue } from '../../model/propertyTimeline';

export type HtmlSpatialLengthUnit = 'px' | '%' | 'em' | 'rem' | 'vw' | 'vh';
export type HtmlSpatialAngleUnit = 'deg' | 'rad' | 'turn';
export type HtmlSpatialCoordinate<U extends string = HtmlSpatialLengthUnit> =
  | { readonly value: number; readonly unit: U }
  | { readonly css: string };

export type HtmlSpatialBinding =
  | { readonly kind: 'spatial'; readonly projectionId: string; readonly component: 'translateX' | 'translateY' | 'pivotX' | 'pivotY'; readonly unit: HtmlSpatialLengthUnit }
  | { readonly kind: 'spatial'; readonly projectionId: string; readonly component: 'rotation'; readonly unit: HtmlSpatialAngleUnit }
  | { readonly kind: 'spatial'; readonly projectionId: string; readonly component: 'scaleX' | 'scaleY' | 'sourceTransform' };

export interface IHtmlSpatialSourceCapture {
  readonly kind: 'authored' | 'computed';
  readonly authoredValue?: string;
  readonly computedValue: string;
}

export interface IHtmlSpatialConversion {
  readonly id: string;
  readonly property: string;
  readonly confirmedAtFrame: number;
  readonly originalValue: string;
  readonly replacementValue: string;
  readonly reason: 'source-unavailable' | 'unit-replacement';
  readonly consent: 'explicit';
}

/** Source-relative CSS projection, independent of HA4 absolute transform components. */
export interface IHtmlSpatialDefinition {
  readonly id: string;
  readonly version: 1;
  readonly composition: 'prepend-trs';
  readonly sourceTransform: string;
  readonly origin: {
    readonly x: HtmlSpatialCoordinate;
    readonly y: HtmlSpatialCoordinate;
    readonly z: HtmlSpatialCoordinate<Exclude<HtmlSpatialLengthUnit, '%'>>;
  };
  readonly provenance: {
    readonly transform: IHtmlSpatialSourceCapture;
    readonly origin: IHtmlSpatialSourceCapture;
  };
  readonly conversions?: readonly IHtmlSpatialConversion[];
}

export interface IHtmlSpatialChange {
  readonly binding: HtmlSpatialBinding;
  readonly value: TimelinePropertyValue;
}
