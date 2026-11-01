// packages/editor/src/core/editor/index.ts
/**
 * Point d'entrée de la création de l'éditeur v2 : `createEditor()`, le jeu
 * de plugins par défaut, le document vide et les types publics.
 */

export { EDITOR_ROOT_CLASS, createEditor } from './createEditor';
export { defaultPlugins } from './defaultPlugins';
export { DEFAULT_FPS, DEFAULT_TOTAL_FRAMES, createEmptyDocument } from './emptyDocument';
export type { EditorOptions, IEditor, SetPropertyOptions } from './types';
export type {
  IEditorPropertyTimelines, IPropertyTimelineTransaction, PropertyChangedEvent,
  PropertyTimelineEditOptions, PropertyTimelineMutationResult
} from './propertyTimelineTypes';
export type {
  IEditorTransactions, IEditorTransactionRequest, EditorTransactionResult,
  ITransactionFault, IHostHistoryEffect, IPreparedHostChange, IHtmlContextChange,
  TransactionChangedEvent, TransactionDirection
} from './transactionTypes';
export type { PropertyTimelineOperation } from '../../model/propertyTimelines/types';
export type { HostRenderCause, IEditorHostRenderer, IHostRenderCandidate } from './hostRendererTypes';
