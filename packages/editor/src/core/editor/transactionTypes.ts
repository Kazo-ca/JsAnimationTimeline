// packages/editor/src/core/editor/transactionTypes.ts
import type { IHtmlAnimationContext } from '@kazo-ca/timeline-runtime';
import type { ICommand } from '../commands/ICommand';
import type { PropertyTimelineOperation } from '../../model/propertyTimelines/types';

export type TransactionDirection = 'execute' | 'undo' | 'redo';

/** A prepared synchronous local effect. Rollback must also undo a partial apply. */
export interface IPreparedHostChange {
  readonly changed: boolean;
  apply(): void;
  rollback(): void;
}
export interface IHostHistoryEffect {
  /** Read-only preparation; capture the state needed for exact compensation. */
  prepare(direction: TransactionDirection): IPreparedHostChange;
}
export interface IHtmlContextChange {
  readonly stageId: string;
  readonly context: IHtmlAnimationContext;
}
export interface IEditorTransactionRequest {
  readonly label: string;
  readonly commands?: readonly ICommand[];
  readonly properties?: readonly PropertyTimelineOperation[];
  readonly htmlContext?: IHtmlContextChange;
  readonly effect?: IHostHistoryEffect;
  /** Initial confirmation only. Undo/redo revalidate capabilities, not this UI ticket. */
  readonly isCurrent?: () => boolean;
}
export interface ITransactionFault {
  readonly message: string;
  readonly phase: 'apply' | 'rollback' | 'undo' | 'redo' | 'cancel';
  readonly participantIds: readonly string[];
}
export type EditorTransactionResult =
  | { readonly status: 'changed'; readonly revision: number }
  | { readonly status: 'noop' }
  | { readonly status: 'refused'; readonly reason: string }
  | { readonly status: 'faulted'; readonly fault: ITransactionFault };
export interface IEditorTransactions {
  readonly fault: ITransactionFault | undefined;
  execute(request: IEditorTransactionRequest): EditorTransactionResult;
}
export interface TransactionChangedEvent {
  readonly transactionId: string;
  readonly label: string;
  readonly revision: number;
  readonly phase: 'preview' | 'commit' | 'cancel';
  readonly cause: TransactionDirection | 'group-cancel';
  readonly groupId?: string;
}
declare module '../events/TimelineEventMap' {
  interface TimelineEventMap {
    'transaction:changed': TransactionChangedEvent;
  }
}
