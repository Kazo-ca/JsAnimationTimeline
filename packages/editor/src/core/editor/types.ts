// packages/editor/src/core/editor/types.ts
/**
 * Types publics de l'éditeur v2 : les options de `createEditor()` et l'API
 * `IEditor` qu'il retourne à l'application hôte.
 */

import type { IPlayerClock, ITimelineDocument, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import type { ICommand } from '../commands/ICommand';
import type {
  EditorEventName,
  EditorPlugin,
  EditorServiceId,
  EditorServiceMap
} from '../context/IEditorContext';
import type { EventHandler } from '../events/EventBus';
import type { TimelineEventMap } from '../events/TimelineEventMap';
import type { FrameListener, IEditorPlayback, IFrameSample } from '../playback/types';
import type { EditorStageOption, IEditorStage, StageErrorHandler } from '../stage/types';
import type { StoreWarningHandler } from '../store/Store';
import type { IEditorPropertyTimelines } from './propertyTimelineTypes';
import type { IEditorTransactions } from './transactionTypes';

/** Options for a property edit. */
export interface SetPropertyOptions {
  /** Absolute integer frame in 1..totalFrames; defaults to the current integer frame. */
  readonly frame?: number;
}

/** Options de `createEditor()`. */
export interface EditorOptions {
  /**
   * Document v2 initial, validé par le Store (`StoreError` s'il est
   * invalide). Par défaut : un document vide (`createEmptyDocument()`).
   * Les fichiers v1 sont convertis par le plugin `persistence.json` (S2)
   * ou par `migrateToV2` du runtime avant d'être donnés ici.
   *
   * Gardé par référence puis gelé en profondeur (`Object.freeze`, en place)
   * une fois validé : l'objet donné ne peut plus être modifié. Passer une
   * copie (`structuredClone(data)`) pour garder un original modifiable.
   */
  readonly data?: ITimelineDocument;
  /**
   * Racine de la scène HTML par défaut. Par défaut : le document du
   * conteneur. Interdite avec `stage`. Les plugins passent par `ctx.stage`.
   */
  readonly root?: ParentNode;
  /**
   * Scènes animées par l'éditeur. Absente : scène HTML en mode `frame` sur
   * `root`, qui n'anime jamais l'éditeur lui-même ; `false` : timeline
   * seule ; une scène ou un tableau combiné (voir `EditorStageOption`). Les
   * `properties` des scènes entrent dans le registre de l'éditeur. L'éditeur
   * ne détruit jamais une scène fournie : il relâche les calques puis la détache.
   */
  readonly stage?: EditorStageOption;
  /** Reçoit les erreurs levées par les scènes. Par défaut : `console.error` (la lecture continue). */
  readonly onStageError?: StageErrorHandler;
  /**
   * Registre de propriétés. L'éditeur en garde une copie figée, construite
   * avant le Store (`ctx.registry`) : un `registerProperty()` fait après
   * `createEditor()` n'y entre pas. Par défaut : `defaultPropertyRegistry`.
   */
  readonly registry?: PropertyRegistry;
  /**
   * Horloge de la lecture (`now`, `requestFrame`, `cancelFrame`). Par défaut :
   * celle du navigateur (`performance.now`, `requestAnimationFrame`). Une
   * horloge manuelle (`createManualClock()`) sert aux boucles de jeu et aux tests.
   */
  readonly clock?: IPlayerClock;
  /**
   * Refuse (`StoreError`) un document dont une piste a un nom inconnu du
   * registre, au lieu d'avertir. Faux par défaut. Contrôle fait au chargement
   * (`data`, `load`). Modern command results are schema-validated separately.
   */
  readonly strictProperties?: boolean;
  /** Reçoit les pistes inconnues du registre d'un document accepté. Par défaut : `console.warn`. */
  readonly onWarning?: StoreWarningHandler;
  /** Plugins ajoutés après le jeu par défaut (l'ordre d'init suit les dépendances). */
  readonly plugins?: readonly EditorPlugin[];
  /**
   * Jeu de plugins par défaut : `true` (par défaut) utilise `defaultPlugins()`,
   * `false` n'en charge aucun, un tableau le remplace.
   */
  readonly defaultPlugins?: boolean | readonly EditorPlugin[];
  /** Nombre maximal d'entrées annulables (entier >= 1, 100 par défaut). */
  readonly historyLimit?: number;
}

/**
 * API publique d'un éditeur créé par `createEditor()`.
 *
 * Après `destroy()`, tout autre membre que `destroy` et `isDestroyed` lève
 * une erreur. (Les fonctions de désabonnement rendues par `on` / `once`
 * restent sans danger.)
 */
export interface IEditor {
  /** Élément racine de l'éditeur (classe `JsTimeLine`), ajouté au conteneur hôte. */
  readonly container: HTMLElement;
  /** Document courant, gelé en profondeur (le modifier en place lève une `TypeError`). */
  readonly document: ITimelineDocument;
  /** Vrai si `undo()` est possible. */
  readonly canUndo: boolean;
  /** Vrai si `redo()` est possible. */
  readonly canRedo: boolean;
  /** Vrai une fois `destroy()` terminé. */
  readonly isDestroyed: boolean;
  /** Lecture (même façade que `ctx.playback`). */
  readonly playback: IEditorPlayback;
  /** Registre de propriétés figé de l'éditeur (même objet que `ctx.registry`). */
  readonly registry: PropertyRegistry;
  /** Scènes animées (même façade que `ctx.stage`). */
  readonly stage: IEditorStage;
  /** Typed property tracks, explicit transitions and shared undo transactions. */
  readonly propertyTimelines: IEditorPropertyTimelines;
  readonly transactions: IEditorTransactions;

  /** S'abonne à un événement de l'éditeur ; retourne la fonction de désabonnement. */
  on<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): () => void;
  /** S'abonne à la prochaine émission d'un événement seulement. */
  once<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): () => void;
  /** Retire une inscription de `handler`. */
  off<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): void;

  /** Exécute une commande (voie de modification du document) ; `true` si le document a changé. */
  execute(command: ICommand): boolean;
  /**
   * Edits one registered property through an undoable command, with or without plugins.
   * Tween spans receive a key at the requested frame; static spans use span.start.
   * Existing identical keys return false; a new explicit key is a document change
   * even when it equals the evaluated value. Business refusals return false and
   * emit command:refused (invalid input, blank/missing content, locks or target policy).
   * Values are stored verbatim; runtime bounds and nonlinear time easing still apply.
   */
  setProperty(layerId: string, name: string, value: number, options?: SetPropertyOptions): boolean;
  /** Annule la dernière entrée de l'historique ; `false` s'il n'y en a pas. */
  undo(): boolean;
  /** Rétablit la dernière entrée annulée ; `false` s'il n'y en a pas. */
  redo(): boolean;

  /** Document courant, sérialisable avec `JSON.stringify` (même référence que `document`). */
  toJSON(): ITimelineDocument;
  /**
   * Remplace le document (validé, `StoreError` sinon) et vide l'historique.
   * Comme `options.data`, `doc` est gelé en profondeur (en place) une fois validé.
   */
  load(doc: ITimelineDocument): void;
  /**
   * Valeurs de chaque calque à l'image `frame` (fractionnaire permise,
   * bornée), ou à la position courante. Synchrone, sans événement.
   */
  sample(frame?: number): IFrameSample;
  /**
   * Réessaie les cibles que les scènes n'ont pas pu résoudre (du calque
   * `layerId` seulement s'il est donné) : modèle chargé plus tard, élément
   * ajouté à la page... Même effet que `ctx.stage.refreshTargets`.
   */
  refreshTargets(layerId?: string): void;
  /**
   * Appelé une fois par image rendue (après chaque `frame:render`), avec
   * l'échantillon. Retourne la fonction de désabonnement.
   */
  onFrame(listener: FrameListener): () => void;
  /** API d'un service fourni par un plugin, ou `undefined`. */
  getService<K extends EditorServiceId>(id: K): EditorServiceMap[K] | undefined;

  /**
   * Détruit l'éditeur : émet `editor:destroying`, détruit les plugins en
   * ordre inverse, vide les abonnements et les services, puis retire
   * l'élément racine. Idempotent.
   *
   * @param reason Raison facultative, transmise dans `editor:destroying`.
   */
  destroy(reason?: string): void;
}
