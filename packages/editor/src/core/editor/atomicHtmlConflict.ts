// packages/editor/src/core/editor/atomicHtmlConflict.ts
import { getHtmlStageAtomicAccess, removeHtmlConflictResolution, resolveHtmlConflict } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic, IHtmlStageAtomicAccess, ITimelineDocument } from '@kazo-ca/timeline-runtime';
import type { EditorStageHost } from '../stage/EditorStageHost';
import type { PropertyTimelineOperation } from '../../model/propertyTimelines/types';
import { clonePropertyOperation } from '../../model/propertyTimelines/values';
import type { HtmlContexts } from './atomicCandidate';
import type { IHtmlConflictTransactionRequest } from './transactionTypes';

export interface IPreparedHtmlConflict {
  readonly access: IHtmlStageAtomicAccess;
  readonly context: IHtmlAnimationContext;
  readonly diagnostic: IHtmlResolutionDiagnostic;
  readonly winnerLayerId: string;
  readonly beforeFirst: IHtmlConflictTransactionRequest['beforeFirst'];
}

const STALE = 'Le conflit HTML confirmé a changé : examinez de nouveau les choix proposés.';

/** Own every permitted field once, before callbacks can change the caller's request. */
export function snapshotHtmlConflictRequest(request: IHtmlConflictTransactionRequest): IHtmlConflictTransactionRequest {
  const label = request.label;
  const stageId = request.stageId;
  const ticket = request.confirmation;
  const confirmation = { id: ticket.id, signature: ticket.signature };
  const winnerLayerId = request.winnerLayerId;
  const beforeFirst = request.beforeFirst;
  const properties = request.properties?.map((operation) => {
    const copy = clonePropertyOperation(operation);
    if (copy.kind !== 'set') throw new Error('La résolution accepte uniquement les écritures de clés annoncées.');
    return copy;
  });
  const isCurrent = request.isCurrent;
  if (typeof isCurrent !== 'function') throw new Error('La résolution exige une garde de confirmation actuelle.');
  return { label, stageId, confirmation, winnerLayerId, beforeFirst, properties, isCurrent };
}

/** Inspect a genuine current conflict, without applying a provisional priority choice. */
export function prepareAtomicHtmlConflict(request: IHtmlConflictTransactionRequest, document: ITimelineDocument,
  contexts: HtmlContexts, stages: EditorStageHost, operations: readonly PropertyTimelineOperation[]): IPreparedHtmlConflict {
  if (typeof request.isCurrent !== 'function') throw new Error('La résolution exige une garde de confirmation actuelle.');
  const stage = stages.stages.find((entry) => entry.id === request.stageId);
  const access = stage === undefined ? undefined : getHtmlStageAtomicAccess(stage);
  if (access === undefined) throw new Error('La scène HTML demandée est indisponible.');
  const original = contexts.get(access);
  if (original === undefined) throw new Error('Le contexte HTML demandé est indisponible.');
  const confirmation = request.confirmation;
  if (typeof confirmation?.id !== 'string' || typeof confirmation.signature !== 'string') throw new Error(STALE);
  const diagnostic = access.validate(document, original).find((issue) => issue.id === confirmation.id);
  if (diagnostic === undefined || diagnostic.signature !== confirmation.signature) throw new Error(STALE);
  const context = original.resolutions?.some((entry) => entry.conflictId === confirmation.id)
    ? removeHtmlConflictResolution(original, confirmation.id) : original;
  // The runtime validates the confirmed winner and policy against its actual diagnostic.
  resolveHtmlConflict(context, diagnostic, request.winnerLayerId, request.beforeFirst);
  if (operations.some((operation) => operation.kind !== 'set')) {
    throw new Error('La résolution accepte uniquement les écritures de clés annoncées.');
  }
  if (operations.some((operation) => !diagnostic.contributions?.some((entry) => entry.layerId === operation.layerId
    && entry.property === operation.property))) {
    throw new Error('Une écriture annoncée ne fait pas partie du conflit confirmé.');
  }
  return { access, context, diagnostic, winnerLayerId: request.winnerLayerId, beforeFirst: request.beforeFirst };
}

/** Resolve only the final real diagnostic; never transplant an earlier signature. */
export function resolveAtomicHtmlConflict(prepared: IPreparedHtmlConflict, document: ITimelineDocument,
  contexts: Map<IHtmlStageAtomicAccess, IHtmlAnimationContext>, operations: readonly PropertyTimelineOperation[]): void {
  const { access, context, diagnostic, winnerLayerId, beforeFirst } = prepared;
  const finalDiagnostic = access.validate(document, context).find((issue) => issue.id === diagnostic.id);
  if (finalDiagnostic === undefined) {
    if (operations.length === 0) throw new Error(STALE);
    contexts.set(access, context);
    return;
  }
  contexts.set(access, resolveHtmlConflict(context, finalDiagnostic, winnerLayerId, beforeFirst));
}
