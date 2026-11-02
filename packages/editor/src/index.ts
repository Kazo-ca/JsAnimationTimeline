// packages/editor/src/index.ts
/** Point d'entrée public de l'éditeur v2 et de ses plugins. */

// Éditeur v2 : création et API publique.
export {
  DEFAULT_FPS,
  DEFAULT_TOTAL_FRAMES,
  EDITOR_ROOT_CLASS,
  createEditor,
  createEmptyDocument,
  defaultPlugins
} from './core/editor';
export type { EditorOptions, IEditor, SetPropertyOptions } from './core/editor';
export type { HostRenderCause, IEditorHostRenderer, IHostRenderCandidate } from './core/editor';
export type {
  IEditorTransactions, IEditorTransactionRequest, IHtmlConflictTransactionRequest, EditorTransactionResult,
  ITransactionFault, IHostHistoryEffect, IPreparedHostChange, IHtmlContextChange,
  TransactionChangedEvent, TransactionDirection, PropertyTimelineOperation
} from './core/editor';
export type {
  IEditorPropertyTimelines, IPropertyTimelineTransaction, PropertyChangedEvent,
  PropertyTimelineEditOptions, PropertyTimelineMutationResult
} from './core/editor';

// Contrat des plugins.
export type {
  CoreEventName,
  EditorEventName,
  EditorPlugin,
  EditorServiceId,
  EditorServiceMap,
  IEditorCommands,
  IEditorContext,
  IEditorEvents,
  IEditorServices,
  PluginEventName
} from './core/context';
export { PluginError, ROOT_SLOT } from './core/plugin';
export type { IPlugin, PluginErrorCode, SlotRegistry } from './core/plugin';

// Événements.
export type {
  CancellableHandler,
  EditorDestroyingEvent,
  EditorReadyEvent,
  EventHandler,
  EventName,
  ICancellableEvent,
  TimelineEventMap
} from './core/events';

// Commandes et document.
export {
  CANCELLED_REASON,
  CommandRefusedError,
  CompositeCommand,
  DEFAULT_HISTORY_LIMIT,
  createCommand
} from './core/commands';
export type {
  CommandBeforeEvent,
  CommandRefusedEvent,
  DocumentTransform,
  HistoryChangedEvent,
  ICommand
} from './core/commands';
export { StoreError, UNKNOWN_PROPERTY } from './core/store';
export type {
  DocumentChangeCause,
  DocumentChangedEvent,
  DocumentLoadedEvent,
  IUnknownPropertyIssue,
  StoreIssue,
  StoreWarningHandler
} from './core/store';

// Lecture : tête de lecture sur le Transport du runtime, échantillons et rendu.
export type {
  FrameListener,
  FrameRenderEvent,
  IEditorPlayback,
  IFrameSample,
  ILayerSample,
  PlaybackStateEvent,
  PlayheadChangedEvent
} from './core/playback';

// Scènes : option `stage`, façade `IEditorStage` (`ctx.stage`, `editor.stage`) et `stage:report`.
export { createEditorHtmlStage } from './core/stage';
export type {
  EditorStageOption,
  IEditorHtmlStageOptions,
  IEditorStage,
  IStageHold,
  StageErrorHandler,
  StageReportEvent,
  StageTargetsChangedEvent
} from './core/stage';

// Plugins de mise en page (epic `layout`) : coquille, emplacements, défilement, règle et tête de lecture.
export {
  LAYOUT_SLOTS,
  LAYOUT_ZONES,
  LayoutPlugin,
  LayoutShellPlugin,
  PlayheadPlugin,
  RulerPlugin,
  ScrollSyncPlugin,
  ZoomPlugin
} from './plugins/layout';
export type {
  IFrameScheduler,
  ILayoutShellApi,
  IPlayheadApi,
  IScrollPosition,
  IScrollState,
  IRulerApi,
  IScrollSyncApi,
  IZoomApi,
  IZoomRange,
  LayoutOptions,
  LayoutZone,
  PlayheadScrubEvent,
  RulerOptions,
  ScrollSyncOptions,
  ZoomAnchor,
  ZoomChangedEvent,
  ZoomOptions
} from './plugins/layout';

// Plugins des calques (epic `layers`) : liste des calques, contrôles de ligne et sélection.
export {
  LAYERS_GROUPS_PLUGIN_ID,
  LAYERS_COLOR_PLUGIN_ID,
  LAYERS_ICON_PLUGIN_ID,
  LAYERS_LIST_PLUGIN_ID,
  LAYER_LIST_CLASSES,
  LAYERS_SELECTION_PLUGIN_ID,
  LAYERS_TOOLBAR_PLUGIN_ID,
  LAYER_ROW_CLASSES,
  LayerGroupsPlugin,
  LayerColorPlugin,
  LayerIconPlugin,
  LayerListPlugin,
  LayerSelectionPlugin,
  LayerToolbarPlugin,
  LayersPlugin,
  LAYERS_REORDER_PLUGIN_ID,
  LayerReorderPlugin,
  SELECTED_ROW_CLASS,
  NAME_EDITING_ATTRIBUTE,
  createSetCollapsedCommand,
  createToggleCollapsedCommand,
  createMoveLayersCommand,
  detachNodes,
  findNodeLocation,
  insertNodes,
  moveNodes,
  topMostIds,
  updateLayerNode
} from './plugins/layers';
export type {
  ILayerGroupsService,
  ILayerDropTarget,
  ILayerColorService,
  ILayerIconService,
  ILayerListService,
  ILayerReorderService,
  ILayerRow,
  ILayerRowControl,
  ILayerSelectionService,
  ILayerToolbarService,
  LayerNodeUpdater,
  LayerRowsChangedEvent,
  LayerSelectionChangedEvent,
  SelectionMode,
  SelectOptions
} from './plugins/layers';

// Plugins des images (epic `frames`) : grille des plages et des images clés.
export {
  FRAME_CLIP_FORMAT,
  FRAME_CLIP_VERSION,
  FRAMES_CLIPBOARD_PLUGIN_ID,
  FramesClipboardIds,
  FramesClipboardKeys,
  FRAMES_GRID_CLASSES,
  FRAMES_GRID_PLUGIN_ID,
  FRAMES_KEYFRAMES_CLASSES,
  FRAMES_KEYFRAMES_PLUGIN_ID,
  FRAMES_SELECTION_CLASSES,
  FRAMES_SELECTION_PLUGIN_ID,
  FramesClipboardPlugin,
  FramesGridPlugin,
  FramesKeyframesPlugin,
  FramesPlugin,
  FramesSelectionPlugin
} from './plugins/frames';
export type {
  FramesClipboardChangedEvent,
  FramesGridRenderedEvent,
  FramesSelectionChangedEvent,
  IClipRow,
  IClipRun,
  IClipSpan,
  IFrameCell,
  IFrameClip,
  IFramesClipboardService,
  IFramesSelectionService,
  ISelectedKeyframe,
  ISelectedPropertyKeyframe,
  IPropertyFrameCell,
  SelectedKeyframeKind,
  GridMarkKind,
  GridSegmentKind,
  IFrameRange,
  IFramesGridService,
  IFramesKeyframesService,
  IGridCell,
  IGridMark,
  IGridSegment,
  IGridWindow,
  IRowRange
} from './plugins/frames';

// Epic tweens : interpolations de mouvement (tweens.motion), opérations pures, commandes et erreurs.
export {
  MOTION_TWEEN_PLUGIN_ID,
  MotionTweenCodes,
  MotionTweenCommandLabels,
  MotionTweenError,
  MotionTweenMessages,
  MotionTweenPlugin,
  TweensPlugin,
  createMotionTween,
  createMotionTweenBetween,
  createMotionTweenCommands,
  createMotionTweenFromSpan,
  removeMotionTween,
  removeMotionTweens,
  resolveCreateTarget,
  resolveRemoveTargets
} from './plugins/tweens';
export type {
  IMotionTarget,
  IMotionTweenAvailability,
  IMotionTweenCommands,
  IMotionTweenService,
  IRemoveTarget,
  MotionAvailabilityChangedEvent,
  MotionTweenCode,
  MotionTweenCommandKind,
  MotionTweenEvent,
  PropertyMotionTweenEvent,
  MotionTweenRefusal,
  IResolutionRefusal,
  IResolved,
  Resolution
} from './plugins/tweens';

// Plugin interaction.shortcuts (raccourcis clavier déclarés par les plugins).
export { SHORTCUTS_PLUGIN_ID, ShortcutError, createShortcutsPlugin } from './plugins/interaction/shortcuts';
export type {
  IShortcutDefinition,
  IShortcutInfo,
  IShortcutsOptions,
  IShortcutsService,
  ShortcutErrorCode,
  ShortcutTriggeredEvent,
  ShortcutsPlugin
} from './plugins/interaction/shortcuts';

// Epic toolbar : barre d'outils principale (zone « Scène 1 », boutons et contrôles des plugins).
export {
  DEFAULT_SCENE_NAME,
  DEFAULT_TOOLBAR_GROUP,
  TOOLBAR_MAIN_PLUGIN_ID,
  ToolbarError,
  ToolbarGroupOrders,
  ToolbarMainPlugin,
  ToolbarPlugin,
  createToolbarMainPlugin
} from './plugins/toolbar';

// Plugin toolbar.timeSettings : cadence et durée, en commandes annulables.
export {
  MAX_FPS,
  MIN_FPS,
  MAX_TOTAL_FRAMES,
  MIN_TOTAL_FRAMES,
  TIME_SETTINGS_PLUGIN_ID,
  TimeSettingsLabels,
  TimeSettingsPlugin,
  createSetFpsCommand,
  createSetTotalFramesCommand,
  createTimeSettingsPlugin
} from './plugins/toolbar';
export type {
  IToolbarButtonDefinition,
  IToolbarControlDefinition,
  IToolbarItemDefinition,
  IToolbarItemInfo,
  IToolbarMainOptions,
  IToolbarMainService,
  ToolbarErrorCode,
  ToolbarOptions
} from './plugins/toolbar';

// Plugin persistence.json (import / export JSON, fichiers v1 migrés).
export { PERSISTENCE_JSON_PLUGIN_ID, PersistenceError, createPersistenceJsonPlugin } from './plugins/persistence/json';
export type {
  IImportResult,
  IPersistenceJsonOptions,
  IPersistenceJsonService,
  IReadResult,
  IWriteOptions,
  PersistenceErrorCode,
  PersistenceExportedEvent,
  PersistenceImportedEvent,
  PersistenceJsonPlugin
} from './plugins/persistence/json';

// Epic history : annuler / rétablir (boutons et raccourcis).
export {
  HistoryPlugin,
  UNDO_REDO_PLUGIN_ID,
  UndoRedoIds,
  UndoRedoKeys,
  UndoRedoPlugin,
  createUndoRedoPlugin
} from './plugins/history';

// Epic playback : lire, pause, boucle et vitesse dans la barre d'outils.
export {
  PLAYBACK_CONTROLS_PLUGIN_ID,
  PLAYBACK_SPEEDS,
  PLAYBACK_TOGGLE_KEYS,
  PlaybackControlsPlugin,
  PlaybackPlugin,
  createPlaybackControlsPlugin
} from './plugins/playback';

// Plugin toolbar.zoomControl : liste et curseur du zoom de la règle.
export {
  FIT_OPTION_VALUE,
  ZOOM_CONTROL_PLUGIN_ID,
  ZoomControlPlugin,
  createZoomControlPlugin
} from './plugins/toolbar';

// Plugin playback.livePreview : aperçu de la scène pendant le glisser de la tête de lecture.
export {
  DEFAULT_PREVIEW_MAX_FPS,
  LIVE_PREVIEW_MODES,
  LIVE_PREVIEW_PLUGIN_ID,
  LivePreviewPlugin,
  createLivePreviewPlugin
} from './plugins/playback';
export type { ILivePreviewApi, ILivePreviewOptions, LivePreviewMode, PreviewChangedEvent } from './plugins/playback';

// Plugin toolbar.keyframeActions : les boutons d'images clés de la barre d'outils.
export {
  KEYFRAME_ACTIONS_PLUGIN_ID,
  KeyframeActionsPlugin,
  createKeyframeActionsPlugin
} from './plugins/toolbar';
export type { ToolbarEditKeyframeEvent } from './plugins/toolbar';

// Context menus for existing frame and layer commands.
export { CONTEXT_MENU_PLUGIN_ID, ContextMenuPlugin } from './plugins/interaction/contextMenu/ContextMenuPlugin';
export type { ContextMenuTarget, IContextMenuAction, IMenuPosition } from './plugins/interaction/contextMenu/types';
// Tween easing presets and their undoable command.
export { EASING_PLUGIN_ID, EasingPlugin, createEasingPlugin, createSetEasingCommand, setSpanEasing } from './plugins/tweens/easing';
export type { IEasingAvailability, IEasingService, IPropertyEasingTarget } from './plugins/tweens/easing';
export type { IVisibleRow, INodeVisibleRow, IPropertyVisibleRow } from './model/rows';
// Core property-writing contract, usable without UI plugins.
export { SetPropertyCommand } from './model/properties/SetPropertyCommand';
export { applyPropertyValue, PropertyOperationError } from './model/properties/propertyValue';
export { getTargetPropertyNames } from './model/properties/targetProperties';
export type { IPropertyEditContext, ITargetPropertyQuery } from './model/properties/targetProperties';

// Property-keyframe controls share the core property-edit command.
export { PROPERTY_KEYFRAMES_PLUGIN_ID, PropertyKeyframesPlugin } from './plugins/tweens/propertyKeyframes';
export type { IPropertyKeyframesService } from './plugins/tweens/propertyKeyframes';

// Optional property inspector, backed by the property-keyframe service.
export { PROPERTIES_PANEL_PLUGIN_ID, PropertiesPanelPlugin, createPropertiesPanelPlugin } from './plugins/properties/panel';
export type { IPropertiesPanelService } from './plugins/properties/panel';
