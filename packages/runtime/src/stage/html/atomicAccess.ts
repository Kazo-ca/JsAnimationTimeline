// packages/runtime/src/stage/html/atomicAccess.ts
import type { ITimelineDocument } from '../../model/document';
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { IStage } from '../types';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic } from './animationTypes';
import type { IHtmlPropertyInspection } from './propertyInspection';

/** @internal Bridge used by the editor's single atomic history coordinator. */
export interface IHtmlStageAtomicAccess {
  readonly revision: number;
  readonly context: IHtmlAnimationContext;
  installContext(context: IHtmlAnimationContext): void;
  inspect(document: ITimelineDocument, context: IHtmlAnimationContext, layerId: string,
    property: string, kind?: TimelinePropertyValue['kind']): IHtmlPropertyInspection;
  validate(document: ITimelineDocument, context: IHtmlAnimationContext): readonly IHtmlResolutionDiagnostic[];
  source<T>(action: () => T): T;
  /** Read-only confirmation against source styles, including host-owned previews. */
  readSource<T>(read: () => T): T;
  guard(check: () => void): void;
}

const accesses = new WeakMap<IStage, IHtmlStageAtomicAccess>();
/** @internal Stages remain ordinary public objects; mutation machinery is not on their facade. */
export function registerHtmlStageAtomicAccess(stage: IStage, access: IHtmlStageAtomicAccess): void {
  accesses.set(stage, access);
}
/** @internal Undefined for non-HTML and third-party stages. */
export function getHtmlStageAtomicAccess(stage: IStage): IHtmlStageAtomicAccess | undefined {
  return accesses.get(stage);
}
