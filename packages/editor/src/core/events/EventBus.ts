// packages/editor/src/core/events/EventBus.ts
/**
 * Bus d'événements typé de l'éditeur. Les noms et les charges utiles sont
 * vérifiés à la compilation grâce à une carte d'événements (par défaut
 * `TimelineEventMap`, enrichie par les plugins).
 *
 * Sémantique :
 * - les gestionnaires s'exécutent de façon synchrone, dans l'ordre d'abonnement ;
 * - la liste des gestionnaires est figée au début de chaque émission : un
 *   gestionnaire inscrit pendant une émission n'est appelé qu'à partir de
 *   l'émission suivante ;
 * - en revanche, un retrait est immédiat (comme `EventTarget` du DOM) : une
 *   inscription retirée pendant une émission (`off`, fonction de
 *   désabonnement, `clear`) n'est plus appelée, même par l'émission en cours.
 *   Un plugin détruit pendant `editor:destroying` ne reçoit donc plus rien ;
 * - un gestionnaire `once` est appelé au plus une fois, y compris lors d'une
 *   émission réentrante : c'est la première émission qui l'atteint qui le consomme ;
 * - un gestionnaire qui lève une erreur est signalé à `onError` et n'empêche pas
 *   les suivants de s'exécuter. Si `onError` lève à son tour, les deux erreurs
 *   sont écrites avec `console.error` et l'émission continue ;
 * - un même gestionnaire inscrit deux fois est appelé deux fois, et `off` ne
 *   retire qu'une inscription ;
 * - chaque nom d'événement a deux canaux séparés : `on`/`once`/`emit` d'un côté,
 *   `onCancellable`/`emitCancellable` de l'autre. `emit` n'appelle jamais les
 *   gestionnaires annulables et `emitCancellable` n'appelle jamais ceux de `on` ;
 * - canal annulable « fail-closed » : un gestionnaire annulable qui lève une
 *   erreur annule l'événement (en plus d'être signalé). Une validation ou une
 *   vérification de verrou qui plante bloque donc l'opération au lieu de la
 *   laisser passer.
 */

import { CancellableEvent } from './CancellableEvent';
import type { ICancellableEvent } from './CancellableEvent';
import { HandlerRegistry } from './HandlerRegistry';
import type { TimelineEventMap } from './TimelineEventMap';

/** Gestionnaire d'un événement ordinaire. */
export type EventHandler<P> = (payload: P) => void;

/** Gestionnaire d'un événement annulable. */
export type CancellableHandler<P> = (event: ICancellableEvent<P>) => void;

/** Noms d'événements (clés textuelles) d'une carte d'événements. */
export type EventName<M> = keyof M & string;

/** Options du bus. */
export interface EventBusOptions {
  /**
   * Reçoit les erreurs levées par les gestionnaires. Par défaut, elles sont
   * écrites avec `console.error`, préfixées de `ERROR_PREFIX`.
   *
   * Contrat : ne doit pas lever. Si elle lève malgré tout, le bus écrit
   * l'erreur d'origine et celle de `onError` avec `console.error`, puis
   * continue l'émission (les gestionnaires suivants sont appelés et
   * `emitCancellable` retourne normalement).
   */
  readonly onError?: (error: unknown, eventName: string) => void;
}

/** Préfixe du message écrit par le rapporteur d'erreurs par défaut. */
export const ERROR_PREFIX = '[EventBus]';

function reportToConsole(error: unknown, eventName: string): void {
  console.error(
    `${ERROR_PREFIX} Un gestionnaire de l'événement « ${eventName} » a levé une erreur :`,
    error
  );
}

function reportFailedReporter(error: unknown, reporterError: unknown, eventName: string): void {
  console.error(
    `${ERROR_PREFIX} onError a levé une erreur en signalant celle d'un gestionnaire de « ${eventName} » :`,
    reporterError,
    error
  );
}

/** Bus d'événements typé ; `M` est la carte nom -> charge utile. */
export class EventBus<M extends object = TimelineEventMap> {
  private readonly handlers = new HandlerRegistry<EventHandler<never>>();
  private readonly cancellableHandlers = new HandlerRegistry<CancellableHandler<never>>();
  private readonly reportError: (error: unknown, eventName: string) => void;
  private batch: (() => void)[] | undefined;

  /** @internal Defers observations until the complete atomic state is installed. */
  beginBatch(): { commit(): void; discard(): void } {
    if (this.batch !== undefined) throw new Error('Une publication atomique est déjà en cours.');
    const pending: (() => void)[] = [];
    this.batch = pending;
    return {
      commit: () => {
        if (this.batch !== pending) return;
        this.batch = undefined;
        pending.forEach((notify) => notify());
      },
      discard: () => { if (this.batch === pending) this.batch = undefined; }
    };
  }

  /** @internal Queues the complete guarded publication, preserving batch commit/discard semantics. */
  enqueuePublication(publish: () => void): void {
    if (this.batch !== undefined) this.batch.push(publish);
    else publish();
  }

  /** @internal Protects post-commit observers with the same error policy as ordinary event listeners. */
  observeCommitted(action: () => void, eventName: string): void {
    try { action(); } catch (error) { this.report(error, eventName); }
  }

  constructor(options: EventBusOptions = {}) {
    this.reportError = options.onError ?? reportToConsole;
  }

  /** S'abonne à `name` ; retourne la fonction de désabonnement. */
  on<K extends EventName<M>>(name: K, handler: EventHandler<M[K]>): () => void {
    return this.handlers.add(name, handler, false);
  }

  /** S'abonne à la prochaine émission de `name` seulement. */
  once<K extends EventName<M>>(name: K, handler: EventHandler<M[K]>): () => void {
    return this.handlers.add(name, handler, true);
  }

  /**
   * Retire une inscription de `handler` pour `name` : d'abord dans le canal
   * ordinaire, sinon dans le canal annulable. Sans effet si elle est absente.
   * Le retrait vaut aussi pour une émission en cours.
   */
  off<K extends EventName<M>>(
    name: K,
    handler: EventHandler<M[K]> | CancellableHandler<M[K]>
  ): void {
    if (!this.handlers.remove(name, handler)) this.cancellableHandlers.remove(name, handler);
  }

  /** Émet `name` vers les gestionnaires ordinaires. */
  emit<K extends EventName<M>>(name: K, payload: M[K]): void {
    if (this.batch !== undefined) { this.batch.push(() => this.emit(name, payload)); return; }
    this.dispatch(this.handlers, name, (handler) => (handler as EventHandler<M[K]>)(payload));
  }

  /** S'abonne aux émissions annulables de `name` ; retourne la fonction de désabonnement. */
  onCancellable<K extends EventName<M>>(
    name: K,
    handler: CancellableHandler<M[K]>
  ): () => void {
    return this.cancellableHandlers.add(name, handler, false);
  }

  /**
   * Émet `name` vers les gestionnaires annulables. Tous s'exécutent, même
   * après une annulation (ils peuvent lire `event.cancelled`).
   *
   * Fail-closed : un gestionnaire qui lève une erreur est signalé à `onError`
   * ET annule l'événement ; les gestionnaires suivants voient `cancelled` à vrai.
   * @returns `true` si aucun gestionnaire n'a annulé l'événement ni levé d'erreur.
   */
  emitCancellable<K extends EventName<M>>(name: K, payload: M[K]): boolean {
    const event = new CancellableEvent<M[K]>(payload);
    this.dispatch(this.cancellableHandlers, name, (handler) => {
      try {
        (handler as CancellableHandler<M[K]>)(event);
      } catch (error) {
        event.cancel();
        throw error;
      }
    });
    return !event.cancelled;
  }

  /** Nombre d'inscriptions (les deux canaux) pour `name`, ou au total si absent. */
  listenerCount(name?: EventName<M>): number {
    return this.handlers.count(name) + this.cancellableHandlers.count(name);
  }

  /** Retire toutes les inscriptions (les deux canaux) de `name`, ou toutes si absent. */
  clear(name?: EventName<M>): void {
    this.handlers.clear(name);
    this.cancellableHandlers.clear(name);
  }

  private dispatch<H>(registry: HandlerRegistry<H>, name: string, invoke: (handler: H) => void): void {
    for (const registration of registry.snapshot(name)) {
      if (!registry.claim(name, registration)) continue;
      try {
        invoke(registration.handler);
      } catch (error) {
        this.report(error, name);
      }
    }
  }

  private report(error: unknown, name: string): void {
    try {
      this.reportError(error, name);
    } catch (reporterError) {
      reportFailedReporter(error, reporterError, name);
    }
  }
}
