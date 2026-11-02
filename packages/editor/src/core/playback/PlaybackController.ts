// packages/editor/src/core/playback/PlaybackController.ts
/**
 * Lecture de l'éditeur : possède le `Transport` du runtime (horloge
 * injectable), suit les fps et la durée du document, et regroupe le rendu.
 *
 * Regroupement (une image d'affichage = un rendu) :
 * - `seek` et chaque changement du document (commande, annuler / rétablir,
 *   `load`) marquent le rendu en attente et demandent une image à l'horloge,
 *   une seule fois ; plusieurs `seek` et commandes pendant un glisser ne
 *   donnent donc qu'une évaluation ;
 * - pendant la lecture, le `tick` du transport arrive déjà dans une image
 *   d'horloge : le rendu se fait tout de suite et remplace celui en attente
 *   (un rendu en attente qui passe avant le `tick` de la même image ne rend
 *   rien : le `tick` s'en charge) ;
 * - `play` et `pause` demandent aussi un rendu : la pause fige une image qui
 *   a pu avancer depuis le dernier `tick`, et `play` en fin de timeline
 *   repart de l'image 1.
 *
 * Un rendu fait, dans l'ordre : `playhead:changed` (si l'image entière a
 * changé depuis le rendu précédent), `sync` des scènes (si le temps a sauté,
 * si l'état de lecture ou le document a changé depuis le rendu précédent), `render` des
 * scènes, puis `frame:render` avec l'échantillon. Le premier rendu est
 * demandé à la création. Comme le rendu, `sync` est donc regroupé une fois
 * par image d'affichage pendant un glisser.
 *
 * Fps ou durée changés par le document : l'image entière courante est
 * gardée (bornée à la nouvelle durée), pas le temps en millisecondes ; en
 * lecture, le temps repart donc du début de cette image. Des réglages
 * invalides (une commande n'est pas revalidée par le Store) sont ignorés par
 * le transport, qui garde les précédents ; le rendu est quand même demandé.
 */

import { createTransport } from '@kazo-ca/timeline-runtime';
import type {
  IPlayerClock,
  IStageHostClock,
  ITimelineDocument,
  ITransportSyncState,
  ITransportTime,
  PropertyRegistry,
  Transport
} from '@kazo-ca/timeline-runtime';
import type { EventBus } from '../events/EventBus';
import type { Store } from '../store/Store';
import { FrameSampler } from './FrameSampler';
// Import pour effet : garde l'augmentation de TimelineEventMap visible ici.
import './playbackEvents';
import type { PlaybackStateEvent } from './playbackEvents';
import type { IFrameSample } from './types';

const NO_PAYLOAD: PlaybackStateEvent = Object.freeze({});

/** Mêmes règles que le transport : fps fini > 0, durée entière ≥ 1. */
function isValidTimeline(fps: number, totalFrames: number): boolean {
  return Number.isFinite(fps) && fps > 0 && Number.isInteger(totalFrames) && totalFrames >= 1;
}

/** Scènes rendues par la lecture (voir `EditorStageHost`). */
export interface IStageRenderer {
  sync(time: ITransportTime, state: ITransportSyncState): void;
  render(time: ITransportTime): void;
}

/** Pièces dont la lecture a besoin. */
export interface IPlaybackControllerOptions {
  readonly bus: EventBus;
  readonly store: Store;
  readonly registry: PropertyRegistry;
  readonly clock: IPlayerClock;
}

/** Lecture et rendu regroupé de l'éditeur ; interne au noyau (les plugins voient `IEditorPlayback`). */
export class PlaybackController {
  private readonly bus: EventBus;
  private readonly store: Store;
  private readonly clock: IPlayerClock;
  private readonly transport: Transport;
  private readonly sampler: FrameSampler;
  private readonly unsubscribes: (() => void)[] = [];
  /** Image d'horloge demandée pour le rendu en attente. */
  private pendingHandle: number | null = null;
  /** Vrai pendant un déplacement demandé par l'éditeur (le `tick` qui suit ne rend pas tout de suite). */
  private moving = false;
  private lastPlayhead: number;
  private destroyed = false;
  private stage: IStageRenderer | null = null;
  /** Le temps a sauté ou l'état de lecture a changé depuis le dernier `sync` des scènes. */
  private syncPending = true;
  private mutationGuard: (() => void) | undefined;
  private hostFrame: ((time: ITransportTime, cause: 'seek' | 'playback', draw: () => void, publish: () => void) => void) | undefined;
  private nextRenderCause: 'seek' | 'playback' = 'playback';
  private mutationVersion = 0;
  /** Atomic timing installation must not call the host clock after changing transport state. */
  private reconciliationNow: number | undefined;

  constructor(options: IPlaybackControllerOptions) {
    this.bus = options.bus;
    this.store = options.store;
    this.clock = options.clock;
    this.sampler = new FrameSampler(options.registry);
    const { fps, totalFrames } = this.store.document.settings;
    this.transport = createTransport({
      clock: {
        now: () => this.reconciliationNow ?? this.clock.now(),
        requestFrame: (callback) => this.clock.requestFrame(callback),
        cancelFrame: (handle) => this.clock.cancelFrame(handle)
      },
      fps,
      totalFrames,
      onSync: () => {
        this.syncPending = true;
      }
    });
    this.lastPlayhead = this.transport.frame;
    this.listen();
    this.schedule();
  }

  get frame(): number {
    return this.transport.frame;
  }

  get time(): ITransportTime {
    return this.transport.time;
  }

  get playing(): boolean {
    return this.transport.playing;
  }

  get fps(): number {
    return this.transport.fps;
  }

  get totalFrames(): number {
    return this.transport.totalFrames;
  }

  get loop(): boolean {
    return this.transport.loop;
  }

  set loop(value: boolean) {
    this.beforeMutation();
    this.transport.loop = value;
  }

  get speed(): number {
    return this.transport.speed;
  }

  set speed(value: number) {
    this.beforeMutation();
    this.transport.speed = value;
  }

  play(): void {
    this.beforeMutation();
    this.transport.play();
    this.schedule();
  }

  pause(): void {
    this.beforeMutation();
    this.transport.pause();
    this.schedule();
  }

  toggle(): void {
    if (this.transport.playing) this.pause();
    else this.play();
  }

  /** Instant de l'horloge de l'éditeur, en millisecondes. */
  clockNow(): number {
    return this.clock.now();
  }

  seek(frame: number): void {
    this.beforeMutation();
    this.nextRenderCause = 'seek';
    this.move(() => this.transport.seek(frame));
    this.schedule();
  }

  /** Position et état de lecture courants (pour les scènes). */
  get now(): IStageHostClock {
    return { time: this.transport.time, state: this.syncState() };
  }

  /** Branche les scènes : `sync` puis `render` à chaque rendu, à partir du prochain. */
  attachStage(stage: IStageRenderer): void {
    this.stage = stage;
    this.syncPending = true;
    this.schedule();
  }

  /** @internal Host preparation and commit notifications must not permit time mutations. */
  attachHostRendering(guard: () => void,
    render: (time: ITransportTime, cause: 'seek' | 'playback', draw: () => void, publish: () => void) => void): void {
    this.mutationGuard = guard;
    this.hostFrame = render;
  }

  /** @internal Detect a synchronous clock tick re-entering host preparation. */
  get renderVersion(): number { return this.mutationVersion; }

  /** @internal Reuse document reconciliation: changed timing preserves the integer playhead. */
  timeForDocument(doc: ITimelineDocument): ITransportTime {
    return doc.settings.fps === this.fps && doc.settings.totalFrames === this.totalFrames
      ? this.transport.time : FrameSampler.timeAt(doc, Math.min(this.frame, doc.settings.totalFrames));
  }

  private beforeMutation(): void { this.mutationGuard?.(); this.mutationVersion++; }

  /** Échantillon synchrone à `frame`, ou à la position courante. */
  sample(frame?: number): IFrameSample {
    const doc = this.store.document;
    const time = frame === undefined ? this.transport.time : FrameSampler.timeAt(doc, frame);
    return this.sampler.sample(doc, time);
  }

  /** Arrête la lecture, annule le rendu en attente et se désabonne. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelPending();
    this.unsubscribes.forEach((unsubscribe) => unsubscribe());
    this.transport.destroy();
  }

  private listen(): void {
    const { transport, bus } = this;
    this.unsubscribes.push(
      transport.on('tick', this.onTick),
      transport.on('play', () => bus.emit('playback:play', NO_PAYLOAD)),
      transport.on('pause', () => bus.emit('playback:pause', NO_PAYLOAD)),
      transport.on('loop', () => bus.emit('playback:loop', NO_PAYLOAD)),
      transport.on('complete', () => bus.emit('playback:complete', NO_PAYLOAD)),
      bus.on('document:changed', ({ document }) => this.onDocument(document)),
      bus.on('document:loaded', ({ document }) => this.onDocument(document))
    );
  }

  /** `tick` hors d'un déplacement de l'éditeur : il vient de la boucle de lecture, déjà dans une image. */
  private readonly onTick = (): void => {
    if (this.moving) return;
    this.mutationVersion++;
    this.cancelPending();
    this.render();
  };

  private onDocument(doc: ITimelineDocument): void { this.reconcileDocument(doc); }

  /** @internal Install accepted timing without invoking a fallible host callback after mutation. */
  commitDocumentTiming(doc: ITimelineDocument, time: ITransportTime, assertCurrent: () => void): void {
    const changed = doc.settings.fps !== this.fps || doc.settings.totalFrames !== this.totalFrames;
    // A failed clock read leaves the transport untouched. Requests for another frame are deferred
    // to document publication, where EventBus reports observer errors without undoing a commit.
    const now = changed ? this.clock.now() : undefined;
    // The clock is host code: it may synchronously advance playback while being read.
    // Reject the now-stale candidate before touching transport settings or its anchor.
    assertCurrent();
    this.reconciliationNow = now;
    try { this.reconcileTiming(doc, time.integerFrame); }
    finally { this.reconciliationNow = undefined; }
  }

  /** Legacy reconciliation; atomic commits have already installed the document's timing. */
  reconcileDocument(doc: ITimelineDocument): void {
    this.reconcileTiming(doc);
    this.schedule();
  }

  private reconcileTiming(doc: ITimelineDocument, candidateFrame?: number): void {
    // Contrat `IStage.sync` : aussi appelé à chaque changement de document.
    this.syncPending = true;
    const { fps, totalFrames } = doc.settings;
    const changed = fps !== this.transport.fps || totalFrames !== this.transport.totalFrames;
    if (changed && isValidTimeline(fps, totalFrames)) {
      const frame = candidateFrame ?? this.transport.frame;
      this.move(() => {
        this.transport.setTimeline({ fps, totalFrames });
        this.transport.seek(Math.min(frame, totalFrames));
      });
    }
  }

  private move(action: () => void): void {
    this.moving = true;
    try {
      action();
    } finally {
      this.moving = false;
    }
  }

  private schedule(): void {
    if (this.pendingHandle !== null || this.destroyed) return;
    this.pendingHandle = this.clock.requestFrame(this.onScheduledFrame);
  }

  private cancelPending(): void {
    if (this.pendingHandle === null) return;
    this.clock.cancelFrame(this.pendingHandle);
    this.pendingHandle = null;
  }

  private readonly onScheduledFrame = (): void => {
    this.pendingHandle = null;
    // En lecture, le `tick` de cette image rend déjà.
    if (!this.destroyed && !this.transport.playing) this.render();
  };

  private render(): void {
    const time = this.transport.time;
    const hostFrame = this.hostFrame;
    const cause = this.nextRenderCause;
    this.nextRenderCause = 'playback';
    if (hostFrame !== undefined) {
      hostFrame(time, cause, () => this.renderStage(time), () => this.publishFrame(time));
      return;
    }
    this.publishFrame(time, () => this.renderStage(time));
  }

  private publishFrame(time: ITransportTime, draw?: () => void): void {
    if (time.integerFrame !== this.lastPlayhead) {
      const previous = this.lastPlayhead;
      this.lastPlayhead = time.integerFrame;
      this.bus.emit('playhead:changed', { frame: time.integerFrame, previous });
      // Un gestionnaire a pu détruire l'éditeur.
      if (this.destroyed) return;
    }
    draw?.();
    if (this.destroyed) return;
    const sample = this.sampler.sample(this.store.document, time);
    this.bus.emit('frame:render', { sample });
  }

  private renderStage(time: ITransportTime): void {
    const stage = this.stage;
    if (stage === null) return;
    if (this.syncPending) {
      this.syncPending = false;
      stage.sync(time, this.syncState());
    }
    stage.render(time);
  }

  private syncState(): ITransportSyncState {
    return { playing: this.transport.playing, speed: this.transport.speed };
  }
}
