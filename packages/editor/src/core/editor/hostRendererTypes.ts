// packages/editor/src/core/editor/hostRendererTypes.ts
import type { ITimelineDocument, ITransportTime } from '@kazo-ca/timeline-runtime';
import type { IFrameSample } from '../playback/types';
import type { IHtmlContextChange, IPreparedHostChange } from './transactionTypes';

export type HostRenderCause = 'initialize' | 'execute' | 'undo' | 'redo' | 'group-cancel'
  | 'load' | 'refresh' | 'seek' | 'playback' | 'destroy';

/** Immutable final candidate. Preparation must not mutate the DOM or Timeline. */
export interface IHostRenderCandidate {
  readonly document: ITimelineDocument;
  readonly htmlContexts: readonly IHtmlContextChange[];
  readonly time: ITransportTime;
  readonly sample: IFrameSample;
  readonly cause: HostRenderCause;
}

/** Optional sole host preview writer, used with an HTML inspection stage. */
export interface IEditorHostRenderer {
  /** Synchronous preparation; apply is journaled and compensated before observers. */
  prepare(candidate: IHostRenderCandidate): IPreparedHostChange;
}
