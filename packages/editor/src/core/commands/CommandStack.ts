// packages/editor/src/core/commands/CommandStack.ts
/**
 * Pile de commandes : seule voie de modification du document. Elle exécute
 * les commandes, tient l'historique annuler / rétablir (plafonné) et
 * regroupe les commandes d'un glisser-déposer en une seule entrée.
 *
 * Création : `store.createCommandStack(options)` (le Store lui confie son
 * `IDocumentWriter` interne). Le constructeur est interne (`@internal`) et
 * l'index du module n'exporte la classe que comme type : un plugin ne peut
 * pas créer sa propre pile.
 *
 * `execute(command)` :
 * 1. émet `command:before` (annulable) ; en cas de veto (ou d'un gestionnaire
 *    qui lève), émet `command:refused` { reason: CANCELLED_REASON } et
 *    retourne `false` ;
 * 2. relit le document courant (un gestionnaire de `command:before` a pu
 *    exécuter une autre commande ou charger un document : la commande
 *    s'applique alors au document à jour, sans perte de modification) puis
 *    appelle `command.do(doc)` ; une `CommandRefusedError` émet
 *    `command:refused` { reason } et retourne `false` ; toute autre erreur est
 *    propagée (document et historique inchangés) ;
 * 3. si le document ou l'historique a changé pendant `do`, refuse la
 *    commande périmée sans annuler les effets imbriqués ;
 * 4. si `do` retourne la même référence, c'est un no-op : `false`, rien n'est
 *    enregistré ;
 * 5. sinon l'historique est mis à jour (la pile « rétablir » est vidée), le
 *    document est écrit (`document:changed`, cause `execute`), puis
 *    `history:changed` est émis. Les deux états sont à jour avant la
 *    première émission. Un gestionnaire de `document:changed` peut donc
 *    exécuter une autre commande : elle est appliquée et enregistrée après
 *    la première.
 *
 * `undo()` / `redo()` n'émettent pas `command:before` ; ils émettent
 * `document:changed` (cause `undo` / `redo`, si le document change) puis
 * `history:changed`. Une `CommandRefusedError` levée par `undo` / `do` est
 * traitée comme pour `execute` (refus, historique inchangé).
 *
 * Regroupement (glisser) : entre `beginGroup(label)` et `endGroup()`, chaque
 * commande est appliquée tout de suite (le glisser est visible) mais n'est
 * enregistrée qu'à `endGroup`, sous la forme d'UNE `CompositeCommand`
 * portant le libellé du groupe. `cancelGroup()` restaure le document d'avant
 * `beginGroup` (équivalent à annuler chaque commande en ordre inverse, le
 * document étant immuable) et n'enregistre rien. Un `beginGroup` imbriqué,
 * ainsi que `undo` / `redo` pendant un regroupement, lèvent une erreur ;
 * `endGroup` / `cancelGroup` sans regroupement aussi. La pile « rétablir »
 * n'est vidée qu'au moment où le groupe est enregistré.
 *
 * Pendant un regroupement, l'historique est indisponible : `canUndo` /
 * `canRedo` valent `false` et `undoLabel` / `redoLabel` `undefined`.
 * `beginGroup`, `endGroup` et `cancelGroup` émettent `history:changed`, ce
 * qui désactive puis réactive les boutons annuler / rétablir. Un raccourci
 * (Ctrl+Z…) doit tester `canUndo` / `canRedo` (ou `isGrouping`) avant
 * d'appeler `undo()` / `redo()`.
 *
 * `clear()` vide l'historique et abandonne un regroupement en cours sans
 * toucher au document (utilisé par `Store.load`).
 */

import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';
import type { EventBus } from '../events/EventBus';
// Import pour effet : garde l'augmentation de TimelineEventMap dans CommandStack.d.ts.
import './commandEvents';
import { CANCELLED_REASON } from './commandEvents';
import type { HistoryChangedEvent } from './commandEvents';
import { CommandRefusedError } from './CommandRefusedError';
import { CompositeCommand } from './CompositeCommand';
import type { DocumentChangeCause, IDocumentWriter } from './documentChange';
import type { ICommand } from './ICommand';
import { hasHostEntry, isHistoryGroup, isHostEntry } from './atomicHistory';
import type { HistoryEntry, IHostHistoryEntry, IAtomicHistoryCoordinator } from './atomicHistory';

/** Options de la pile de commandes. */
export interface CommandStackOptions {
  /** Nombre maximal d'entrées annulables ; entier >= 1, 100 par défaut. */
  readonly limit?: number;
}

/** Plafond par défaut de l'historique. */
export const DEFAULT_HISTORY_LIMIT = 100;

/** Regroupement en cours. */
interface IGroupState {
  readonly token: object;
  readonly label: string;
  /** Document avant `beginGroup`, restauré par `cancelGroup`. */
  readonly snapshot: ITimelineDocument;
  readonly commands: readonly HistoryEntry[];
}

function resolveLimit(options: CommandStackOptions): number {
  const limit = options.limit ?? DEFAULT_HISTORY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `CommandStack : « limit » doit être un entier supérieur ou égal à 1 (reçu : ${String(limit)}).`
    );
  }
  return limit;
}

function lastOf(entries: readonly HistoryEntry[]): HistoryEntry | undefined {
  return entries.length === 0 ? undefined : entries[entries.length - 1];
}

/** Historique annuler / rétablir et exécution des commandes. */
export class CommandStack {
  private readonly limit: number;
  private undoEntries: readonly HistoryEntry[] = [];
  private redoEntries: readonly HistoryEntry[] = [];
  private atomic: IAtomicHistoryCoordinator | undefined;
  private group: IGroupState | undefined;
  private generation = 0;
  private lifecycleGeneration = 0;

  /**
   * @internal Réservé à `Store.createCommandStack()`, qui fournit le
   * `writer` ; ne pas appeler depuis un plugin.
   */
  constructor(
    private readonly bus: EventBus,
    private readonly writer: IDocumentWriter,
    options: CommandStackOptions = {}
  ) {
    this.limit = resolveLimit(options);
  }

  /** Vrai si `undo()` est possible (toujours faux pendant un regroupement). */
  get canUndo(): boolean {
    return !this.atomic?.faulted && !this.isGrouping && this.undoEntries.length > 0;
  }

  /** Vrai si `redo()` est possible (toujours faux pendant un regroupement). */
  get canRedo(): boolean {
    return !this.atomic?.faulted && !this.isGrouping && this.redoEntries.length > 0;
  }

  /** Libellé de la commande que `undo()` annulerait (`undefined` pendant un regroupement). */
  get undoLabel(): string | undefined {
    return this.isGrouping ? undefined : lastOf(this.undoEntries)?.label;
  }

  /** Libellé de la commande que `redo()` rétablirait (`undefined` pendant un regroupement). */
  get redoLabel(): string | undefined {
    return this.isGrouping ? undefined : lastOf(this.redoEntries)?.label;
  }

  /** Vrai entre `beginGroup` et `endGroup` / `cancelGroup`. */
  get isGrouping(): boolean {
    return this.group !== undefined;
  }

  /** @internal Stable identity across commands; stale transaction handles cannot close another group. */
  get groupToken(): object | undefined {
    return this.group?.token;
  }

  /** @internal Synchronous status for result facades while observer events are deferred. */
  get mutationRefusalReason(): string | undefined {
    this.atomic?.assertHealthy();
    return this.atomic?.refusal();
  }

  /** Exécute `command` ; retourne `true` si le document a changé. */
  execute(command: ICommand): boolean {
    const refusal = this.mutationRefusalReason;
    if (refusal !== undefined) { this.bus.emit('command:refused', { command, reason: refusal }); return false; }
    if (this.atomic?.routesCommands) return this.atomic.executeCommand!(command);
    const lifecycleGeneration = this.lifecycleGeneration;
    if (!this.bus.emitCancellable('command:before', { command, document: this.writer.document })) {
      this.bus.emit('command:refused', { command, reason: CANCELLED_REASON });
      return false;
    }
    if (lifecycleGeneration !== this.lifecycleGeneration) {
      this.bus.emit('command:refused', { command, reason: 'La commande a été annulée car l’éditeur a été détruit.' });
      return false;
    }
    // Relu après le veto : un gestionnaire a pu modifier le document (réentrance).
    const current = this.writer.document;
    const next = this.apply(command, () => command.do(current));
    if (next === undefined || next === current) return false;
    if (this.group !== undefined) {
      this.generation++;
      this.group = { ...this.group, commands: [...this.group.commands, command] };
      this.writer.commit(next, { cause: 'execute', label: command.label, groupToken: this.group.token });
      return true;
    }
    this.record(command);
    this.commitAndNotify(next, 'execute', command.label);
    return true;
  }

  /** Annule la dernière entrée ; retourne `false` s'il n'y en a pas ou si elle est refusée. */
  undo(): boolean {
    this.atomic?.assertHealthy();
    if (this.atomic?.refusal() !== undefined) return false;
    this.assertNotGrouping('undo');
    const command = lastOf(this.undoEntries);
    if (command === undefined) return false;
    if (hasHostEntry(command)) return this.atomic!.replay(command, 'undo', () => {
      this.generation++; this.undoEntries = this.undoEntries.slice(0, -1); this.redoEntries = [...this.redoEntries, command];
    });
    if (isHostEntry(command) || isHistoryGroup(command)) return false;
    const next = this.apply(command, () => command.undo(this.writer.document));
    if (next === undefined) return false;
    this.generation++;
    this.undoEntries = this.undoEntries.slice(0, -1);
    this.redoEntries = [...this.redoEntries, command];
    this.commitAndNotify(next, 'undo', command.label);
    return true;
  }

  /** Rétablit la dernière entrée annulée ; retourne `false` s'il n'y en a pas ou si elle est refusée. */
  redo(): boolean {
    this.atomic?.assertHealthy();
    if (this.atomic?.refusal() !== undefined) return false;
    this.assertNotGrouping('redo');
    const command = lastOf(this.redoEntries);
    if (command === undefined) return false;
    if (hasHostEntry(command)) return this.atomic!.replay(command, 'redo', () => {
      this.generation++; this.redoEntries = this.redoEntries.slice(0, -1); this.undoEntries = this.capped([...this.undoEntries, command]);
    });
    if (isHostEntry(command) || isHistoryGroup(command)) return false;
    const next = this.apply(command, () => command.do(this.writer.document));
    if (next === undefined) return false;
    this.generation++;
    this.redoEntries = this.redoEntries.slice(0, -1);
    this.undoEntries = this.capped([...this.undoEntries, command]);
    this.commitAndNotify(next, 'redo', command.label);
    return true;
  }

  /** @internal Invalide les transformations en cours sans modifier l'historique. */
  invalidatePending(): void {
    this.lifecycleGeneration++;
    this.generation++;
  }

  /** Vide l'historique, abandonne un regroupement en cours et émet `history:changed`. */
  clear(): void {
    this.assertMutable();
    this.clearAtomic();
    this.emitHistoryChanged();
  }

  /** @internal Reset only after the prepared load has applied successfully. */
  clearAtomic(): void {
    this.generation++;
    this.undoEntries = [];
    this.redoEntries = [];
    this.group = undefined;
  }

  /** Démarre un regroupement (émet `history:changed`) ; lève si un regroupement est déjà en cours. */
  beginGroup(label: string): object {
    this.assertMutable();
    if (this.group !== undefined) {
      throw new Error(
        `CommandStack : impossible de démarrer le regroupement « ${label} », « ${this.group.label} » est déjà en cours.`
      );
    }
    this.generation++;
    const token = Object.freeze({});
    this.group = { token, label, snapshot: this.writer.document, commands: [] };
    this.emitHistoryChanged();
    return token;
  }

  /**
   * Termine le regroupement (émet `history:changed`) ; retourne `true` si une
   * entrée a été enregistrée.
   */
  endGroup(): boolean {
    this.assertMutable();
    const active = this.group;
    if (active !== undefined && active.commands.some(hasHostEntry)) {
      this.atomic!.finishGroup(active.token, active.label, () => {
        this.takeGroup('endGroup');
        this.record({ kind: 'group', label: active.label, entries: active.commands });
        this.emitHistoryChanged();
      });
      return true;
    }
    const group = this.takeGroup('endGroup');
    const pushed = group.commands.length > 0;
    if (pushed) this.record(new CompositeCommand(group.label, group.commands as readonly ICommand[]));
    this.emitHistoryChanged();
    return pushed;
  }

  /**
   * Annule le regroupement : restaure le document d'avant `beginGroup`
   * (`document:changed`, cause `group-cancel`), n'enregistre rien, puis émet
   * `history:changed`.
   */
  cancelGroup(): void {
    this.assertMutable();
    const active = this.group;
    if (active !== undefined && active.commands.some(hasHostEntry)) {
      const accepted = this.atomic!.replay({ kind: 'group', label: active.label, entries: active.commands }, 'cancel', () => {
        this.takeGroup('cancelGroup');
      }, active.token);
      if (!accepted) throw new Error('Le regroupement n’a pas pu être compensé.');
      return;
    }
    const group = this.takeGroup('cancelGroup');
    this.commitAndNotify(group.snapshot, 'group-cancel', group.label, group.token);
  }

  /** Refuse une transformation périmée et traduit une `CommandRefusedError`. */
  private apply(command: ICommand, transform: () => ITimelineDocument): ITimelineDocument | undefined {
    const generation = this.generation;
    try {
      const next = transform();
      const reason = this.writer.refusalReason?.(next);
      if (reason !== undefined) throw new CommandRefusedError(command.label, reason);
      if (generation !== this.generation) {
        this.bus.emit('command:refused', { command, reason: 'La commande a été annulée car le document ou son historique a changé.' });
        return undefined;
      }
      return next;
    } catch (error) {
      if (!(error instanceof CommandRefusedError)) throw error;
      this.bus.emit('command:refused', { command, reason: error.reason });
      return undefined;
    }
  }

  /** Ajoute une entrée annulable (plafonnée) et vide la pile « rétablir ». */
  private record(command: HistoryEntry): void {
    this.generation++;
    this.undoEntries = this.capped([...this.undoEntries, command]);
    this.redoEntries = [];
  }

  private capped(entries: readonly HistoryEntry[]): readonly HistoryEntry[] {
    return entries.length > this.limit ? entries.slice(entries.length - this.limit) : entries;
  }

  private commitAndNotify(next: ITimelineDocument, cause: DocumentChangeCause, label: string, groupToken?: object): void {
    if (next !== this.writer.document) this.writer.commit(next, { cause, label, ...(groupToken === undefined ? {} : { groupToken }) });
    this.emitHistoryChanged();
  }

  private emitHistoryChanged(): void {
    const payload: HistoryChangedEvent = {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
      undoLabel: this.undoLabel,
      redoLabel: this.redoLabel
    };
    this.bus.emit('history:changed', payload);
  }

  private takeGroup(operation: string): IGroupState {
    const group = this.group;
    if (group === undefined) {
      throw new Error(`CommandStack : « ${operation} » appelé sans regroupement en cours (beginGroup).`);
    }
    this.generation++;
    this.group = undefined;
    return group;
  }

  private assertNotGrouping(operation: string): void {
    if (this.group !== undefined) {
      throw new Error(
        `CommandStack : « ${operation} » est interdit pendant le regroupement « ${this.group.label} » ; appelez endGroup ou cancelGroup d'abord.`
      );
    }
  }

  /** @internal Installs the one coordinator on the existing history. */
  attachAtomic(coordinator: IAtomicHistoryCoordinator): void { this.atomic = coordinator; }
  /** @internal Registers an already prepared atomic entry before observers are published. */
  recordAtomic(entry: IHostHistoryEntry): void {
    if (this.group === undefined) this.record(entry);
    else { this.generation++; this.group = { ...this.group, commands: [...this.group.commands, entry] }; }
  }
  /** @internal Atomic publication owns the notification boundary. */
  notifyAtomicHistory(): void { this.emitHistoryChanged(); }
  /** @internal Load/destroy must compensate active host participants first. */
  prepareLifecycle(destroy = false): void {
    if (destroy && this.atomic?.allowFaultedDestroy()) return;
    this.assertMutable();
    if (this.group?.commands.some(hasHostEntry)) this.cancelGroup();
    if (destroy) this.atomic?.prepareDestroy?.();
  }
  /** @internal Initialization failure and normal teardown share renderer cleanup. */
  releaseAtomicRenderer(): void { this.atomic?.prepareDestroy?.(); }
  private assertMutable(): void {
    const reason = this.atomic?.refusal();
    if (reason !== undefined) throw new Error(reason);
  }
}
