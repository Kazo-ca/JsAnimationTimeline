// packages/editor/src/core/context/IEditorContext.ts
/**
 * Contexte de l'éditeur transmis à `init` de chaque plugin : c'est le
 * contrat entre le noyau et tous les plugins.
 *
 * Le contexte ne donne que des façades : les événements sans `clear`, le
 * document en lecture seule, l'historique sans `clear` ni `load`, les
 * emplacements de rendu, l'élément racine de l'éditeur, la lecture (posée
 * sur le `Transport` du runtime), le registre de propriétés figé et le
 * registre des services entre plugins. Le Store, la `CommandStack`,
 * l'`EventBus` et le `Transport` bruts restent la propriété de
 * `createEditor()`. Le contexte ne donne aucune racine DOM de recherche des
 * cibles : la timeline peut animer autre chose que du HTML (voir
 * `doc/v2/scene-developpeur.md`).
 *
 * Après `editor.destroy()`, les méthodes qui agissent (abonnement, émission,
 * exécution, fourniture d'un service) lèvent une erreur ; les lectures, `off`
 * et les fonctions de désabonnement restent utilisables (nettoyage tardif).
 *
 * Événements réservés au noyau (`CoreEventName`) : un plugin peut s'y
 * abonner, mais pas les émettre (`emit` / `emitCancellable` les refusent au
 * typage et lèvent une erreur à l'exécution). Seul le noyau annonce un
 * changement de document, d'historique ou de cycle de vie.
 *
 * Document : il est figé en profondeur (`Object.freeze`) par
 * `createEditor()` (document initial, documents chargés et produits par les
 * commandes) ; le modifier en place lève une `TypeError`. Seules les
 * commandes le changent.
 */

import type { ITimelineDocument, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import type { ICommand } from '../commands/ICommand';
import type { IEditorTransactions } from '../editor/transactionTypes';
import type { CancellableHandler, EventHandler, EventName } from '../events/EventBus';
import type { TimelineEventMap } from '../events/TimelineEventMap';
import type { IEditorPlayback } from '../playback/types';
import type { IEditorPropertyTimelines } from '../editor/propertyTimelineTypes';
import type { IPlugin } from '../plugin/IPlugin';
import type { IEditorStage } from '../stage/types';
import type { SlotRegistry } from '../plugin/SlotRegistry';
// Import pour effet : garde les augmentations de TimelineEventMap (Store,
// CommandStack et lecture) visibles pour tout fichier qui importe le contexte.
import '../store/storeEvents';
import '../commands/commandEvents';
import '../playback/playbackEvents';
import '../stage/stageEvents';
import '../editor/propertyTimelineTypes';

/** Nom d'un événement de l'éditeur (clé de `TimelineEventMap`). */
export type EditorEventName = EventName<TimelineEventMap>;

/**
 * Événements émis par le noyau seul (Store, `CommandStack`, `createEditor()`).
 * Les plugins s'y abonnent mais ne peuvent pas les émettre : une fausse
 * annonce (`document:changed` sans changement, `editor:destroying` alors que
 * l'éditeur vit) désynchroniserait les autres plugins.
 */
export type CoreEventName =
  | 'editor:ready'
  | 'editor:destroying'
  | 'document:loaded'
  | 'document:changed'
  | 'property:changed'
  | 'transaction:changed'
  | 'command:before'
  | 'command:refused'
  | 'history:changed'
  | 'playhead:changed'
  | 'frame:render'
  | 'playback:play'
  | 'playback:pause'
  | 'playback:loop'
  | 'playback:complete'
  | 'stage:report'
  | 'stage:targetsChanged';

/** Événement qu'un plugin peut émettre : tout événement de l'éditeur sauf ceux du noyau. */
export type PluginEventName = Exclude<EditorEventName, CoreEventName>;

/**
 * Événements de l'éditeur vus par un plugin : la sémantique est celle de
 * l'`EventBus` (synchrone, deux canaux ordinaire / annulable, annulable
 * « fail-closed »), sans `clear` ni `listenerCount`.
 */
export interface IEditorEvents {
  /** S'abonne à `name` ; retourne la fonction de désabonnement. */
  on<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): () => void;
  /** S'abonne à la prochaine émission de `name` seulement. */
  once<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): () => void;
  /** Retire une inscription de `handler` (canal ordinaire, sinon annulable). */
  off<K extends EditorEventName>(
    name: K,
    handler: EventHandler<TimelineEventMap[K]> | CancellableHandler<TimelineEventMap[K]>
  ): void;
  /**
   * Émet `name` vers les gestionnaires ordinaires. Lève une erreur pour un
   * événement du noyau (`CoreEventName`).
   */
  emit<K extends PluginEventName>(name: K, payload: TimelineEventMap[K]): void;
  /** S'abonne au canal annulable de `name` (veto possible avec `event.cancel()`). */
  onCancellable<K extends EditorEventName>(
    name: K,
    handler: CancellableHandler<TimelineEventMap[K]>
  ): () => void;
  /**
   * Émet `name` sur le canal annulable ; `true` si personne n'a annulé.
   * Lève une erreur pour un événement du noyau (`CoreEventName`).
   */
  emitCancellable<K extends PluginEventName>(name: K, payload: TimelineEventMap[K]): boolean;
}

/**
 * Historique vu par un plugin : exécution des commandes, annuler / rétablir
 * et regroupement (glisser), sans `clear` ni `load`. Sémantique : celle de
 * la `CommandStack` (voir `core/commands/CommandStack.ts`).
 */
export interface IEditorCommands {
  /** Exécute `command` ; `true` si le document a changé. */
  execute(command: ICommand): boolean;
  /** Annule la dernière entrée ; lève pendant un regroupement. */
  undo(): boolean;
  /** Rétablit la dernière entrée annulée ; lève pendant un regroupement. */
  redo(): boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly undoLabel: string | undefined;
  readonly redoLabel: string | undefined;
  /** Vrai entre `beginGroup` et `endGroup` / `cancelGroup`. */
  readonly isGrouping: boolean;
  /** Démarre un regroupement (une seule entrée d'historique à `endGroup`). */
  beginGroup(label: string): void;
  /** Termine le regroupement ; `true` si une entrée a été enregistrée. */
  endGroup(): boolean;
  /** Annule le regroupement et restaure le document d'avant `beginGroup`. */
  cancelGroup(): void;
}

/**
 * Carte identifiant de service -> API publiée par un plugin pour les autres.
 *
 * Le noyau ne déclare aucun service : chaque plugin ajoute le sien par
 * fusion de déclarations, sans toucher à ce fichier. Par exemple, depuis
 * `packages/editor/src/plugins/layers/list/LayerListPlugin.ts` (Y1), pour que
 * les plugins de Y2 à Y4 ajoutent leurs contrôles sur chaque ligne :
 *
 * ```ts
 * declare module '../../../core/context/IEditorContext' {
 *   interface EditorServiceMap {
 *     'layers.list': {
 *       addRowControl(control: ILayerRowControl): () => void;
 *     };
 *   }
 * }
 *
 * // Dans init du plugin layers.list :
 * ctx.services.provide('layers.list', { addRowControl: (c) => this.add(c) });
 * // Dans init de layers.lock (qui dépend de layers.list) :
 * ctx.services.require('layers.list').addRowControl(lockControl);
 * ```
 *
 * Le chemin du `declare module` est relatif au fichier qui déclare
 * l'augmentation et doit désigner ce module. Convention : l'identifiant du
 * service est celui du plugin qui le fournit ; le plugin consommateur
 * déclare ce plugin dans ses `dependencies` (le service est alors fourni
 * avant son `init`).
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- remplie par fusion de déclarations (un service par plugin)
export interface EditorServiceMap {}

/** Identifiant d'un service déclaré dans `EditorServiceMap`. */
export type EditorServiceId = keyof EditorServiceMap & string;

/** Registre typé des API que les plugins se fournissent entre eux. */
export interface IEditorServices {
  /**
   * Publie `api` sous `id`. Lève une erreur si `id` est déjà fourni ou si
   * `api` vaut `undefined`.
   *
   * @returns La fonction qui retire ce service (sans effet s'il a déjà été retiré).
   */
  provide<K extends EditorServiceId>(id: K, api: EditorServiceMap[K]): () => void;
  /** API publiée sous `id`, ou `undefined` si aucun plugin ne la fournit. */
  get<K extends EditorServiceId>(id: K): EditorServiceMap[K] | undefined;
  /** API publiée sous `id` ; lève une erreur si aucun plugin ne la fournit. */
  require<K extends EditorServiceId>(id: K): EditorServiceMap[K];
}

/** Contexte reçu par `init` de chaque plugin de l'éditeur. */
export interface IEditorContext {
  /** Événements de l'éditeur (sans `clear` ; ceux du noyau en écoute seule). */
  readonly events: IEditorEvents;
  /**
   * Document courant, toujours à jour : lire la propriété à chaque usage. Il
   * est figé en profondeur : le modifier en place lève une `TypeError` ;
   * passer par `commands.execute`.
   */
  readonly document: ITimelineDocument;
  /** Exécution des commandes et historique (sans `clear` ni `load`). */
  readonly commands: IEditorCommands;
  /** Independent property editing; shared with the public editor facade. */
  readonly propertyTimelines: IEditorPropertyTimelines;
  readonly transactions: IEditorTransactions;
  /** Emplacements de rendu nommés ; `ROOT_SLOT` désigne `container`. */
  readonly slots: SlotRegistry;
  /** Élément racine de l'éditeur (classe `JsTimeLine`), enfant du conteneur hôte. */
  readonly container: HTMLElement;
  /**
   * Lecture : tête de lecture, play / pause / seek, boucle, vitesse et
   * échantillons. Rendu regroupé une fois par image d'affichage
   * (`playhead:changed`, `frame:render`).
   */
  readonly playback: IEditorPlayback;
  /**
   * Scènes animées (HTML par défaut, celles du développeur, ou aucune) :
   * cibles proposées, cibles manquantes, avertissements, `refreshTargets`.
   */
  readonly stage: IEditorStage;
  /**
   * Registre de propriétés de l'éditeur, figé : copie de `options.registry`
   * (ou du registre par défaut), construite avant le Store. `register` et
   * `unregister` lèvent une erreur.
   */
  readonly registry: PropertyRegistry;
  /** Services entre plugins (API typées par `EditorServiceMap`). */
  readonly services: IEditorServices;
}

/** Plugin de l'éditeur : un `IPlugin` dont `init` reçoit le contexte de l'éditeur. */
export type EditorPlugin = IPlugin<IEditorContext>;
