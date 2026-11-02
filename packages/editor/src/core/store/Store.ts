// packages/editor/src/core/store/Store.ts
/**
 * Store de l'éditeur : contient le document JSON v2 (immuable). Seules les
 * commandes le modifient, et chaque modification émet un événement.
 *
 * Accès en écriture : le Store n'expose aucun setter public. Il crée lui-même
 * son unique `CommandStack` (`createCommandStack`) et lui confie un
 * `IDocumentWriter` privé ; un plugin ne peut donc modifier le document
 * qu'en exécutant une commande sur cette pile. `load` est la seule autre
 * voie : elle remplace le document entier (import, migration).
 *
 * Propriété (contrat pour C4) : le Store n'est PAS destiné aux plugins.
 * `createCommandStack` ne sert qu'une fois (le premier appelant choisit
 * `limit`) et `load` contourne les commandes et vide l'historique. Le noyau
 * (`createEditor()`) crée donc la pile lui-même, juste après le Store, et ne
 * donne aux plugins qu'une façade : `document` en lecture, `execute` /
 * `undo` / `redo` / état de l'historique et abonnements aux événements, sans
 * `load` ni le Store brut.
 *
 * Validation : le document initial et chaque document chargé passent par
 * `validateDocument` du runtime avec `allowLiveTargets: false` ; un document
 * invalide lève une `StoreError`. Les cibles vivantes `{ element }` sont donc
 * refusées : le document est gelé en profondeur, ce qui gèlerait un nœud DOM
 * ou un objet three.js. Les pistes dont le nom est inconnu du registre sont
 * signalées à `onWarning` (par défaut `console.warn`), ou refusées avec
 * `strictProperties`. Commands involving independent property tracks also
 * validate the resulting schema before changing history.
 *
 * Événements : `document:changed` à chaque écriture d'une commande ;
 * `load` vide l'historique (`history:changed`) puis émet `document:loaded`.
 */

import { collectLayers, defaultPropertyRegistry, validateDocument } from '@kazo-ca/timeline-runtime';
import type { ITimelineDocument, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import { CommandStack } from '../commands/CommandStack';
import type { CommandStackOptions } from '../commands/CommandStack';
import type { IDocumentChange, IDocumentWriter } from '../commands/documentChange';
import type { EventBus } from '../events/EventBus';
// Import pour effet : garde l'augmentation de TimelineEventMap dans Store.d.ts.
import './storeEvents';
import type { DocumentChangedEvent } from './storeEvents';
import { StoreError } from './StoreError';
import { findUnknownTracks } from './unknownTracks';
import type { IUnknownPropertyIssue } from './unknownTracks';

/** Reçoit les pistes inconnues d'un document accepté. */
export type StoreWarningHandler = (issues: readonly IUnknownPropertyIssue[]) => void;

/** Options du Store. */
export interface StoreOptions {
  /** Registre où chercher les noms de pistes. Par défaut : `defaultPropertyRegistry`. */
  readonly registry?: PropertyRegistry;
  /**
   * Refuse (`StoreError`) un document qui a une piste inconnue du registre, au
   * lieu d'avertir. Contrôle fait au chargement seulement (document initial et
   * `load`). Modern command results are schema-validated separately.
   */
  readonly strictProperties?: boolean;
  /** Reçoit les pistes inconnues d'un document accepté. Par défaut : `console.warn`. */
  readonly onWarning?: StoreWarningHandler;
}

const warnInConsole: StoreWarningHandler = (issues) => {
  const lines = issues.map((issue) => `- ${issue.path} : ${issue.message}`);
  console.warn(`Pistes inconnues du registre de l'éditeur (ignorées au rendu) :\n${lines.join('\n')}`);
};

/** Internal post-commit observer, called after document subscribers finish. */
type CommitObserver = (event: DocumentChangedEvent, groupToken?: object) => void;

/** Conteneur du document v2 courant. */
export class Store {
  private readonly commitObservers = new Set<CommitObserver>();
  private pendingCommits: { event: DocumentChangedEvent; groupToken?: object; atomic?: boolean }[] = [];
  private commitDepth = 0;
  private notifyingCommits = false;
  private current: ITimelineDocument;
  private stack: CommandStack | undefined;
  private readonly registry: PropertyRegistry;
  private readonly strictProperties: boolean;
  private readonly onWarning: StoreWarningHandler;

  constructor(
    private readonly bus: EventBus,
    initial: ITimelineDocument,
    options: StoreOptions = {}
  ) {
    this.registry = options.registry ?? defaultPropertyRegistry;
    this.strictProperties = options.strictProperties ?? false;
    this.onWarning = options.onWarning ?? warnInConsole;
    this.accept(initial);
    this.current = initial;
  }

  /** Document courant (immuable : ne jamais le modifier). */
  get document(): ITimelineDocument {
    return this.current;
  }

  /**
   * Remplace le document après validation (lève `StoreError` s'il est
   * invalide, sans rien changer). Vide l'historique et le regroupement en
   * cours (`history:changed`), puis émet `document:loaded`.
   */
  load(doc: ITimelineDocument): void {
    this.accept(doc);
    this.stack?.prepareLifecycle();
    if (this.atomicLoad !== undefined) { this.atomicLoad(doc); return; }
    this.pendingCommits = [];
    const previous = this.current;
    this.current = doc;
    this.stack?.clear();
    this.bus.emit('document:loaded', { document: doc, previous });
  }

  /**
   * Crée la pile de commandes de ce Store, seule à pouvoir écrire le
   * document. Ne peut être appelée qu'une fois (un seul historique par
   * document) ; lève ensuite une erreur.
   */
  createCommandStack(options: CommandStackOptions = {}): CommandStack {
    if (this.stack !== undefined) {
      throw new Error('Store : la pile de commandes a déjà été créée ; réutilisez-la.');
    }
    this.stack = new CommandStack(this.bus, this.createWriter(), options);
    return this.stack;
  }

  /** @internal For core notifications; plugins receive neither this Store nor this hook. */
  observeCommits(observer: CommitObserver): () => void {
    this.commitObservers.add(observer);
    return () => { this.commitObservers.delete(observer); };
  }

  /** @internal Silent candidate installation, compensated before any public publication on failure. */
  installAtomic(doc: ITimelineDocument): void { this.current = doc; }
  private atomicLoad: ((document: ITimelineDocument) => void) | undefined;
  /** @internal Opt-in host rendering owns the load's prepare/apply/publication boundary. */
  attachAtomicLoad(load: (document: ITimelineDocument) => void): void { this.atomicLoad = load; }
  /** @internal Publish only after the prepared renderer and history reset have succeeded. */
  publishAtomicLoad(previous: ITimelineDocument): void {
    this.pendingCommits = [];
    this.bus.emit('document:loaded', { document: this.current, previous });
  }
  /** @internal Publishes an already installed, fully rendered atomic document. */
  publishAtomic(previous: ITimelineDocument, change: IDocumentChange): void {
    if (previous === this.current) return;
    const payload: DocumentChangedEvent = { document: this.current, previous, cause: change.cause, label: change.label };
    this.pendingCommits.push({ event: payload, groupToken: change.groupToken, atomic: true });
    this.bus.emit('document:changed', payload);
    this.flushCommits();
  }

  /** Valide `doc` (lève `StoreError`), puis signale ou refuse ses pistes inconnues. */
  private accept(doc: ITimelineDocument): void {
    const issues = validateDocument(doc, { allowLiveTargets: false });
    if (issues.length > 0) throw new StoreError(issues);
    const unknown = findUnknownTracks(doc, this.registry);
    if (unknown.length === 0) return;
    if (this.strictProperties) throw new StoreError(unknown);
    this.onWarning(Object.freeze(unknown));
  }

  private createWriter(): IDocumentWriter {
    const read = (): ITimelineDocument => this.current;
    const commit = (next: ITimelineDocument, change: IDocumentChange): void => this.commit(next, change);
    return Object.freeze({
      get document(): ITimelineDocument {
        return read();
      },
      commit,
      refusalReason: (next: ITimelineDocument): string | undefined => {
        const hasModern = (doc: ITimelineDocument): boolean => collectLayers(doc)
          .some((layer) => layer.propertyTimelines !== undefined);
        if (!hasModern(this.current) && !hasModern(next)) return undefined;
        const issues = validateDocument(next, { allowLiveTargets: false });
        return issues.length === 0 ? undefined : `La commande produirait un document invalide : ${issues[0].path} (${issues[0].code}).`;
      }
    });
  }

  private commit(next: ITimelineDocument, change: IDocumentChange): void {
    const payload: DocumentChangedEvent = { document: next, previous: this.current, cause: change.cause, label: change.label };
    this.current = next;
    this.pendingCommits.push({ event: payload, groupToken: change.groupToken });
    this.commitDepth++;
    try { this.bus.emit('document:changed', payload); }
    finally {
      this.commitDepth--;
      this.flushCommits();
    }
  }

  /** Nested commands append behind the entire current commit, never between its properties. */
  private flushCommits(): void {
    if (this.commitDepth !== 0 || this.notifyingCommits) return;
    this.notifyingCommits = true;
    try {
      while (this.pendingCommits.length > 0) {
        const next = this.pendingCommits.shift()!;
        for (const observer of this.commitObservers) {
          if (next.atomic) this.bus.observeCommitted(() => observer(next.event, next.groupToken), 'document:changed');
          else observer(next.event, next.groupToken);
        }
      }
    } finally { this.notifyingCommits = false; }
  }
}
