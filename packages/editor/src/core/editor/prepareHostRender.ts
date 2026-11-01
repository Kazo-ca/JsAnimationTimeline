// packages/editor/src/core/editor/prepareHostRender.ts
import { cloneHtmlAnimationContext } from '@kazo-ca/timeline-runtime';
import type { IStage, ITimelineDocument, ITransportTime, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import { getHtmlStageAtomicAccess } from '@kazo-ca/timeline-runtime';
import { FrameSampler } from '../playback/FrameSampler';
import type { HtmlContexts } from './atomicCandidate';
import { deepFreezeValue } from './freezeDocument';
import type { HostRenderCause, IEditorHostRenderer } from './hostRendererTypes';
import type { IPreparedHostChange } from './transactionTypes';

export function assertSynchronousHostChange(value: unknown): void {
  if ((typeof value === 'object' && value !== null || typeof value === 'function') && 'then' in value) {
    throw new Error('Les effets hôtes doivent être synchrones.');
  }
}

export function validatePreparedHostChange(prepared: IPreparedHostChange): IPreparedHostChange {
  assertSynchronousHostChange(prepared);
  if (prepared === null || typeof prepared !== 'object' || typeof prepared.changed !== 'boolean' ||
    typeof prepared.apply !== 'function' || typeof prepared.rollback !== 'function') {
    throw new Error('L’effet hôte préparé est invalide.');
  }
  return prepared;
}

/** Snapshot-only public boundary: no mutable coordinator, stage or context is exposed. */
export function prepareHostRender(renderer: IEditorHostRenderer, document: ITimelineDocument,
  contexts: HtmlContexts, stages: readonly IStage[], registry: PropertyRegistry, time: ITransportTime,
  cause: HostRenderCause): IPreparedHostChange {
  const htmlContexts = stages.flatMap((stage) => {
    const access = getHtmlStageAtomicAccess(stage);
    const context = access === undefined ? undefined : contexts.get(access);
    return context === undefined ? [] : [{ stageId: stage.id, context: cloneHtmlAnimationContext(context) }];
  });
  deepFreezeValue(htmlContexts);
  const snapshotTime = Object.freeze({ ...time });
  const sample = new FrameSampler(registry).sample(document, snapshotTime);
  // Eager evaluation keeps deferred reads independent from subsequent registry or host activity.
  void sample.layers;
  return validatePreparedHostChange(renderer.prepare(Object.freeze({ document, htmlContexts,
    time: snapshotTime, sample, cause })));
}
