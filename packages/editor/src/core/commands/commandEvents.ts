// packages/editor/src/core/commands/commandEvents.ts
/**
 * Événements de la `CommandStack`, ajoutés à `TimelineEventMap` par fusion
 * de déclarations :
 * - `command:before` (canal annulable) : avant chaque `execute` ; un
 *   gestionnaire annulable peut opposer un veto (`event.cancel()`), et un
 *   gestionnaire qui lève annule aussi (EventBus « fail-closed ») ;
 * - `command:refused` : la commande a été refusée (veto ou
 *   `CommandRefusedError`) ; le document et l'historique sont inchangés ;
 * - `history:changed` : l'état de l'historique (annuler / rétablir) a changé.
 *
 * Ce module est importé (types) par `CommandStack.ts` et réexporté par
 * l'index : l'augmentation est donc visible partout où la pile est importée.
 */

import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';
import type { ICommand } from './ICommand';

/** Raison transmise dans `command:refused` quand `command:before` a été annulé. */
export const CANCELLED_REASON = 'cancelled';

/** Charge utile de `command:before` (canal annulable). */
export interface CommandBeforeEvent {
  readonly command: ICommand;
  /** Document sur lequel la commande va s'appliquer. */
  readonly document: ITimelineDocument;
}

/** Charge utile de `command:refused`. */
export interface CommandRefusedEvent {
  /** Original ordinary command; host/group entries use a stable inert descriptor with their label. */
  readonly command: ICommand;
  /** CANCELLED_REASON for a veto, exact CommandRefusedError.reason, or another failure's message. */
  readonly reason: string;
}

/** Charge utile de `history:changed`. */
export interface HistoryChangedEvent {
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
}

declare module '../events/TimelineEventMap' {
  interface TimelineEventMap {
    'command:before': CommandBeforeEvent;
    'command:refused': CommandRefusedEvent;
    'history:changed': HistoryChangedEvent;
  }
}
