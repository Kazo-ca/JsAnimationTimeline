// demo/editor/src/conformance/types.ts
import type * as editorModule from '@kazo-ca/timeline-editor';
import type * as exportCssModule from '@kazo-ca/timeline-export-css';
import type * as runtimeModule from '@kazo-ca/timeline-runtime';
import type { IEditor, PropertyChangedEvent } from '@kazo-ca/timeline-editor';
import type { ITimelineDocument, IManualClock, TimelinePropertyValues } from '@kazo-ca/timeline-runtime';

/**
 * Host capability profile of the generic objects.
 * `open`: no capability metadata. `tween-guard`: every explicit transition present in the
 * initial document is protected by a host `validate` that refuses any edit invalidating it.
 */
export type HostProfile = 'open' | 'tween-guard';

export interface IGenericEditorOptions {
  readonly document: ITimelineDocument;
  readonly host?: HostProfile;
  /** Extra registry descriptors; a descriptor may carry a custom `interpolate`. */
  readonly extraProperties?: readonly SerializableDescriptor[];
}

/** Descriptor that can cross `page.evaluate`: the interpolator is picked by name. */
export interface SerializableDescriptor {
  readonly name: string;
  readonly kind: 'value';
  readonly unit: string;
  readonly defaultValue: number;
  readonly interpolator?: 'unclamped-linear';
}

/** What a conformance case keeps of a live editor. */
export interface IConformanceHandle {
  readonly editor: IEditor;
  readonly clock: IManualClock;
  /** Every `property:changed` event, in order. */
  readonly events: readonly PropertyChangedEvent[];
  /** Values received by the host object of a layer at the last rendered frame. */
  objectValues(layerId: string): TimelinePropertyValues | undefined;
  dispose(): void;
}

export interface ITlConformance {
  readonly ready: true;
  readonly runtime: typeof runtimeModule;
  readonly editor: typeof editorModule;
  readonly exportCss: typeof exportCssModule;
  /** Most recent editor created by a factory. */
  readonly current: IConformanceHandle | undefined;
  createGenericEditor(options: IGenericEditorOptions): IConformanceHandle;
  /** Editor with the default UI plugins and the properties panel, mounted in `#ui-host`. */
  createUiEditor(): IConformanceHandle;
  /** Frozen copies of the scenes. */
  scenes: { emptyGeneric(totalFrames?: number): ITimelineDocument; ui(): ITimelineDocument };
  dispose(): void;
}

declare global { interface Window { tlConformance?: ITlConformance; } }
