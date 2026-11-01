// packages/editor/src/core/stage/EditorStageHost.ts
/**
 * Scènes de l'éditeur : enveloppe le `StageHost` du runtime (cycle de vie,
 * routage, cache des `resolve`, avertissements) et le branche sur le noyau.
 *
 * - Chaque document annoncé par le Store (commande, annuler / rétablir,
 *   `load`) est chargé tout de suite : calques supprimés ou dont la cible a
 *   changé relâchés (`release`), nouvelles cibles résolues, puis `update`.
 *   Les scènes sont rendues aussitôt à l'instant courant (une scène HTML en
 *   mode `frame` remet ses styles d'origine dans `update` : sans ce rendu, une
 *   commande lancée depuis une image d'animation laisserait peindre une image
 *   non animée). Le rendu regroupé de la lecture suit à la prochaine image.
 * - Une scène qui refuse un document de commande (`StageDocumentError`)
 *   garde le document précédent ; l'erreur va à `onError`, le Store garde le
 *   nouveau. Seul le document initial, refusé, fait échouer `createEditor()`.
 * - Un document annoncé pendant un chargement ou pendant le rendu qui le suit
 *   (une scène ou un gestionnaire de `stage:report` qui exécute une commande)
 *   est chargé juste après, même si `onError` lève ; seul le dernier compte.
 *   `refreshTargets` lève pendant un chargement.
 * - `IStageLayerState.editorVisible` suit l'œil du calque et de ses dossiers
 *   parents dans le document que montrent les scènes (`StageHost.document` :
 *   le précédent pendant le retour arrière d'un document refusé).
 * - `stage:report` n'émet que les avertissements absents du document
 *   précédent, y compris ceux relevés après son chargement (erreur de
 *   `render` ou de `sync`), et ceux-là sont reportés jusqu'au prochain passage
 *   `sync` puis `render` réel (plusieurs documents dans une même image, ou
 *   pendant toute une retenue du rendu) ; les avertissements de chargement ne
 *   sont jamais reportés ; ceux qui existent à `editor:ready` sont émis à ce moment-là
 *   (voir `StageReportFeed`).
 * - `stage:targetsChanged` est émis quand le contenu de `missingTargets`
 *   change : après un document (accepté ou refusé), et après une nouvelle
 *   tentative du `StageHost` (`refreshTargets`, `targets.subscribe` d'une
 *   scène, signalé par `onTargetsChanged`). Une annonce demandée pendant une
 *   annonce (un gestionnaire qui appelle `refreshTargets`) part juste après,
 *   pour que tous les gestionnaires reçoivent la même liste.
 * - Sans scène (`stage: false`), rien n'est routé : aucune cible manquante,
 *   aucun avertissement.
 * - `destroy` relâche chaque calque puis détache chaque scène, même si un
 *   désabonnement lève ; les objets restent au développeur.
 * - `hold()` retient `sync` et `render` hors lecture (y compris le rendu qui
 *   suit un chargement) ; `flush()` et la dernière libération rattrapent
 *   l'image courante. L'arrêt de la lecture passe outre, pour laisser les
 *   scènes sur l'image d'arrêt. `destroy` abandonne les retenues sans rendu.
 */

import { StageHost } from '@kazo-ca/timeline-runtime';
import type {
  IStage,
  IStageHostClock,
  IStageReport,
  ITargetInfo,
  ITimelineDocument,
  ITransportSyncState,
  ITransportTime,
  LayerTarget,
  PropertyRegistry
} from '@kazo-ca/timeline-runtime';
import type { EventBus } from '../events/EventBus';
import { isLayerEditorVisible } from '../playback/FrameSampler';
import type { IStageRenderer } from '../playback/PlaybackController';
import type { Store } from '../store/Store';
import { StageReportFeed } from './reportFeed';
import { readTargetInfo } from './targetInfo';
// Import pour effet : garde l'augmentation de TimelineEventMap visible ici.
import './stageEvents';
import type { IStageHold, StageErrorHandler } from './types';

/** Pièces dont les scènes ont besoin. */
export interface IEditorStageHostOptions {
  readonly bus: EventBus;
  readonly store: Store;
  readonly stages: readonly IStage[];
  /** Registre figé de l'éditeur (propriétés des scènes comprises). */
  readonly registry: PropertyRegistry;
  readonly onError: StageErrorHandler;
  /** Position et état de lecture courants (rendu après un chargement, réapplication après `refreshTargets`). */
  readonly now: () => IStageHostClock;
}

const NO_REPORTS: readonly IStageReport[] = Object.freeze([]);

/** Retenue inerte (sans scène, ou après la destruction). */
const INERT_HOLD: IStageHold = Object.freeze({ active: false, flush: () => {}, release: () => {} });
const NO_LAYERS: readonly string[] = Object.freeze([]);

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** Scènes branchées sur le noyau de l'éditeur ; interne (les plugins voient `IEditorStage`). */
export class EditorStageHost implements IStageRenderer {
  readonly stages: readonly IStage[];
  /** `null` sans scène (`stage: false`). */
  private readonly host: StageHost | null;
  private readonly bus: EventBus;
  private readonly onError: StageErrorHandler;
  private readonly now: () => IStageHostClock;
  private readonly feed: StageReportFeed;
  private readonly unsubscribes: (() => void)[];
  private destroyed = false;
  private loading = false;
  /** Dernier document annoncé pendant un chargement, chargé ensuite. */
  private queued: ITimelineDocument | null = null;
  /** `missingTargets` à la dernière annonce (`stage:targetsChanged`). */
  private announcedMissing: readonly string[] = NO_LAYERS;
  private announcing = false;
  private announceAgain = false;
  /** Un `sync` a vraiment eu lieu depuis le dernier chargement (le `render` réel qui suit termine un passage complet). */
  private syncedSinceLoad = false;
  /** Vrai pendant host.load : les avertissements relevés alors sont recalculés à chaque document. */
  private inHostLoad = false;
  /** Retenues actives (`hold`). */
  private readonly holds = new Set<object>();
  /** Un `sync` / un `render` ont été retenus depuis le dernier rattrapage. */
  private syncMissed = false;
  private renderMissed = false;
  /** État de lecture du dernier `sync` transmis aux scènes. */
  private lastSyncPlaying = false;
  /** Retenues abandonnées (`editor:destroying`) : plus aucune retenue ni rattrapage. */
  private dropped = false;
  /** L'arrêt de la lecture passe outre la retenue : le rendu qui suit aussi. */
  private stopPassThrough = false;
  private atomicErrors: unknown[] | undefined;

  /** Charge le document courant du Store ; lève l'erreur d'une scène qui le refuse (après avoir tout relâché). */
  constructor(options: IEditorStageHostOptions) {
    const { bus, store } = options;
    this.bus = bus;
    this.stages = Object.freeze(options.stages.slice());
    this.onError = options.onError;
    this.now = options.now;
    this.feed = new StageReportFeed((report) => bus.emit('stage:report', report));
    this.host = this.stages.length === 0 ? null : new StageHost({
      stages: this.stages,
      registry: options.registry,
      onError: (error) => {
        if (this.atomicErrors !== undefined) this.atomicErrors.push(error);
        else options.onError(error);
      },
      onReport: (report) => this.feed.add(report, this.inHostLoad),
      onTargetsChanged: () => this.announceMissing(),
      isEditorVisible: (layerId) => isLayerEditorVisible(this.host?.document ?? store.document, layerId),
      now: options.now
    });
    this.unsubscribes = [
      bus.on('document:changed', ({ document }) => this.load(document)),
      bus.on('document:loaded', ({ document }) => this.load(document)),
      bus.once('editor:ready', () => this.feed.start(this.warnings)),
      // Dès l'annonce de la destruction (avant celle des plugins) : retenues abandonnées, sans rendu.
      bus.on('editor:destroying', () => this.dropHolds())
    ];
    try {
      this.loadNow(store.document);
    } catch (error) {
      this.destroy();
      throw error;
    }
    this.announcedMissing = this.missingTargets;
    this.flushQueued();
  }

  get missingTargets(): readonly string[] {
    return this.host?.missingTargets ?? NO_LAYERS;
  }

  get warnings(): readonly IStageReport[] {
    return this.host?.warnings ?? NO_REPORTS;
  }

  sync(time: ITransportTime, state: ITransportSyncState): void {
    if (this.destroyed || this.host === null) return;
    const stopping = this.lastSyncPlaying && !state.playing;
    if (this.isHeld(state.playing) && !stopping) {
      this.syncMissed = true;
      return;
    }
    this.syncMissed = false;
    this.lastSyncPlaying = state.playing;
    // Avant le sync : une commande lancée pendant le sync recharge un document, qui remet le drapeau à faux.
    this.syncedSinceLoad = true;
    this.host.sync(time, state);
    // Arrêt de la lecture pendant une retenue : les scènes restent sur l'image d'arrêt.
    this.stopPassThrough = stopping && this.holds.size > 0;
  }

  render(time: ITransportTime): void {
    if (this.destroyed || this.host === null) return;
    const passThrough = this.stopPassThrough;
    this.stopPassThrough = false;
    if (!passThrough && this.isHeld(this.now().state.playing)) {
      this.renderMissed = true;
      return;
    }
    this.renderMissed = false;
    this.host.render(time);
    // Un passage complet (sync puis render réels, pas retenus) : les avertissements précédents ne sont plus reportés.
    if (this.syncedSinceLoad) this.feed.completePass();
  }

  /** Nouvelle retenue du rendu (voir `IEditorStage.hold`) ; inerte sans scène ou après la destruction. */
  hold(): IStageHold {
    if (this.destroyed || this.dropped || this.host === null) return INERT_HOLD;
    const token = {};
    this.holds.add(token);
    const isActive = (): boolean => !this.destroyed && !this.dropped && this.holds.has(token);
    return Object.freeze({
      get active(): boolean {
        return isActive();
      },
      flush: (): void => {
        if (isActive()) this.catchUp();
      },
      release: (): void => {
        if (!isActive()) return;
        this.holds.delete(token);
        if (this.holds.size === 0) this.catchUp();
      }
    });
  }

  refreshTargets(layerId?: string): void {
    this.host?.refresh(layerId);
  }

  listTargets(): readonly ITargetInfo[] {
    return Object.freeze(this.stages.flatMap((stage) => this.guard(() => stage.targets?.list() ?? [], [])));
  }

  describe(target: LayerTarget): ITargetInfo | undefined {
    return this.guard(() => readTargetInfo(this.stages, target), undefined);
  }

  /** Internal edit query: report failures without treating them as absent capabilities. */
  describeForEdit(target: LayerTarget): ITargetInfo | undefined {
    try { return readTargetInfo(this.stages, target); }
    catch (error) { this.onError(error); throw error; }
  }

  /** @internal Atomic commits require a synchronous accepted stage document and rendered frame. */
  installAtomic(doc: ITimelineDocument): void {
    const errors: unknown[] = [];
    this.atomicErrors = errors;
    try {
      this.loadNow(doc);
      this.host?.render(this.now().time);
      if (errors.length > 0) throw errors[0];
      this.announceMissing();
    } finally { this.atomicErrors = undefined; }
  }

  /** Se désabonne, puis relâche chaque calque et détache chaque scène, quoi qu'il arrive. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.dropHolds();
    try {
      this.unsubscribes.forEach((unsubscribe) => this.guard(unsubscribe, undefined));
    } finally {
      this.host?.destroy();
    }
  }

  private load(doc: ITimelineDocument): void {
    if (this.destroyed) return;
    if (this.host?.document === doc) return;
    if (this.loading) {
      this.queued = doc;
      return;
    }
    try {
      this.loadNow(doc);
      // Un document en attente sera chargé, puis rendu, juste après.
      if (this.queued === null) this.renderNow();
    } catch (error) {
      this.onError(error);
    } finally {
      // Un document refusé peut aussi changer les cibles manquantes (retour arrière).
      if (this.queued === null) this.announceMissing();
      this.flushQueued();
    }
  }

  /** Charge `doc` dans les scènes ; lève l'erreur d'une scène qui le refuse (elles gardent le précédent). */
  private loadNow(doc: ITimelineDocument): void {
    const host = this.host;
    if (host === null) return;
    this.loading = true;
    this.syncedSinceLoad = false;
    this.feed.beginLoad(host.warnings);
    this.inHostLoad = true;
    try {
      host.load(doc);
    } finally {
      this.inHostLoad = false;
      this.loading = false;
    }
  }

  /**
   * Rendu des scènes à l'instant courant, juste après un chargement (pour les
   * scènes en mode `frame`, qui remettent leurs styles d'origine dans
   * `update`). Pas de `sync` : il suit avec le rendu regroupé de la lecture.
   * Un document annoncé pendant ce rendu est mis en attente comme pendant un
   * chargement.
   */
  private renderNow(): void {
    if (this.destroyed || this.host === null) return;
    this.stopPassThrough = false;
    if (this.isHeld(this.now().state.playing)) {
      this.renderMissed = true;
      return;
    }
    this.renderMissed = false;
    this.loading = true;
    try {
      this.host.render(this.now().time);
    } finally {
      this.loading = false;
    }
  }

  /** Abandonne toutes les retenues sans rattrapage (destruction de l'éditeur). */
  private dropHolds(): void {
    this.dropped = true;
    this.holds.clear();
    this.syncMissed = false;
    this.renderMissed = false;
  }

  /** Vrai si une retenue s'applique (au moins une retenue, hors lecture). */
  private isHeld(playing: boolean): boolean {
    return this.holds.size > 0 && !playing;
  }

  /**
   * Rattrape ce qui a été retenu, à l'instant courant : `sync` s'il en manque
   * un, puis `render`. Sans effet si rien n'a été retenu, ni pendant un
   * chargement ou un rendu en cours (appel depuis une scène ou un
   * gestionnaire de `stage:report`) : le rattrapage attend alors le prochain
   * `flush` ou `release`. Un document annoncé pendant ce rendu est mis en
   * attente comme pendant un chargement, et une liste de cibles manquantes
   * changée pendant le rendu est annoncée ensuite.
   */
  private catchUp(): void {
    if (this.destroyed || this.host === null || this.loading) return;
    if (!this.syncMissed && !this.renderMissed) return;
    const { time, state } = this.now();
    const needsSync = this.syncMissed;
    this.syncMissed = false;
    this.renderMissed = false;
    this.stopPassThrough = false;
    this.loading = true;
    try {
      if (needsSync) {
        this.lastSyncPlaying = state.playing;
        this.syncedSinceLoad = true;
        this.host.sync(time, state);
      }
      this.host.render(time);
      if (this.syncedSinceLoad) this.feed.completePass();
    } finally {
      this.loading = false;
      if (this.queued === null) this.announceMissing();
      this.flushQueued();
    }
  }

  /** Émet `stage:targetsChanged` si le contenu de `missingTargets` a changé depuis la dernière annonce. */
  private announceMissing(): void {
    // Pendant un chargement (nouvelles tentatives en fin de `load`), l'annonce part après, depuis `load` ou le constructeur.
    if (this.destroyed || this.loading) return;
    if (this.announcing) {
      this.announceAgain = true;
      return;
    }
    this.announcing = true;
    try {
      do {
        this.announceAgain = false;
        const current = this.missingTargets;
        if (!sameList(current, this.announcedMissing)) {
          this.announcedMissing = current;
          this.bus.emit('stage:targetsChanged', { missingTargets: current });
        }
      } while (this.announceAgain && !this.destroyed);
    } finally {
      this.announcing = false;
    }
  }

  private flushQueued(): void {
    const next = this.queued;
    this.queued = null;
    if (next !== null) this.load(next);
  }

  /** Exécute une méthode de scène hors cycle de vie ; son erreur va à `onError`. */
  private guard<R>(action: () => R, fallback: R): R {
    try {
      return action();
    } catch (error) {
      this.onError(error);
      return fallback;
    }
  }
}
