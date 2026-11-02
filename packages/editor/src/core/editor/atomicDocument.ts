// packages/editor/src/core/editor/atomicDocument.ts
import { checkDocumentShape } from '@kazo-ca/timeline-runtime';
import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';
import { freezeDocument } from './freezeDocument';

const safeDocuments = new WeakSet<ITimelineDocument>();

/** Check serializable document shape before deep freeze can touch caller-owned live targets. */
export function freezeAtomicDocument(document: ITimelineDocument): ITimelineDocument {
  if (safeDocuments.has(document)) return document;
  const issues = checkDocumentShape(document, { allowLiveTargets: false });
  if (issues.length > 0) throw new Error(`Le document proposé n’est pas sérialisable : ${issues[0].path} (${issues[0].code}).`);
  freezeDocument(document);
  safeDocuments.add(document);
  return document;
}
