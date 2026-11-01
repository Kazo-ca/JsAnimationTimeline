// packages/editor/src/core/editor/createEditorTransactions.ts
import { cloneHtmlAnimationContext, getHtmlStageAtomicAccess } from '@kazo-ca/timeline-runtime';
import type { IHtmlStageAtomicAccess, ITimelineDocument } from '@kazo-ca/timeline-runtime';
import { flattenHistory, isHostEntry } from '../commands/atomicHistory';
import type { HistoryEntry, IAtomicHistoryCoordinator, IHostHistoryEntry } from '../commands/atomicHistory';
import type { ICommand } from '../commands/ICommand';
import { CANCELLED_REASON } from '../commands/commandEvents';
import { clonePropertyOperation } from '../../model/propertyTimelines/values';
import { PropertyTimelineCommand } from '../../model/propertyTimelines/PropertyTimelineCommand';
import type { PropertyTimelineOperation } from '../../model/propertyTimelines/types';
import type { IEditorParts } from './Editor';
import { AtomicCandidate, sameAtomicData } from './atomicCandidate';
import type { HtmlContexts } from './atomicCandidate';
import { freezeAtomicDocument as freezeDocument } from './atomicDocument';
import type { EditorTransactionResult, IEditorTransactionRequest, IEditorTransactions, IHostHistoryEffect,
  IPreparedHostChange, ITransactionFault, TransactionChangedEvent, TransactionDirection } from './transactionTypes';

type Parts = Pick<IEditorParts, 'bus' | 'store' | 'commands' | 'stageHost' | 'registry' | 'lifecycle'>;
interface AtomicRecord {
  readonly id: string;
  readonly label: string;
  readonly before: ITimelineDocument;
  readonly after: ITimelineDocument;
  readonly beforeContexts: HtmlContexts;
  readonly afterContexts: HtmlContexts;
  readonly properties: readonly PropertyTimelineOperation[];
  readonly commands: readonly ICommand[];
  readonly commandAfter: ITimelineDocument;
  readonly effect?: IHostHistoryEffect;
  readonly applied?: IPreparedHostChange;
}
interface AppliedParticipant { readonly id: string; readonly change: IPreparedHostChange }
interface PreparedTransaction {
  readonly document: ITimelineDocument;
  readonly contexts: HtmlContexts;
  readonly label: string;
  readonly id: string;
  readonly groupToken?: object;
  commit(): void;
}
const BUSY = 'Une transaction atomique est en cours : réessayez après sa notification.';
const STALE = 'Le contexte a changé : la transaction a été annulée.';

/** Compatibility for internal hand-built contexts without a transaction coordinator. */
export function unavailableEditorTransactions(assertActive: (operation: string) => void): IEditorTransactions {
  return Object.freeze({ get fault() { return undefined; }, execute: () => {
    assertActive('transactions.execute');
    return { status: 'refused' as const, reason: 'Les transactions atomiques sont indisponibles.' };
  } });
}

/** One coordinator participates in CommandStack; it never owns an alternate undo stack. */
class AtomicTransactions implements IAtomicHistoryCoordinator {
  private readonly records = new WeakMap<object, AtomicRecord>();
  private readonly html: readonly IHtmlStageAtomicAccess[];
  private readonly candidate: AtomicCandidate;
  private readonly revisions = new Map<IHtmlStageAtomicAccess, number>();
  private readonly groupIds = new WeakMap<object, string>();
  private busy = false;
  private failure: ITransactionFault | undefined;
  private revision = 0;
  private sequence = 0;

  constructor(private readonly parts: Parts) {
    this.html = parts.stageHost.stages.flatMap((stage) => {
      const access = getHtmlStageAtomicAccess(stage); return access === undefined ? [] : [access];
    });
    this.candidate = new AtomicCandidate(parts.stageHost, parts.registry);
    for (const access of this.html) {
      this.revisions.set(access, access.revision);
      access.guard(() => { const reason = this.refusal(); if (reason !== undefined) throw new Error(reason); });
    }
    parts.commands.attachAtomic(this);
    parts.bus.once('editor:destroying', () => this.html.forEach((access) => access.guard(() => {})));
  }

  facade(): IEditorTransactions {
    const readFault = (): ITransactionFault | undefined => this.failure;
    return Object.freeze({ get fault() { return readFault(); }, execute: (request: IEditorTransactionRequest) => this.execute(request) });
  }
  refusal(): string | undefined { return this.busy ? BUSY : this.failure?.message; }
  get faulted(): boolean { return this.failure !== undefined; }
  assertHealthy(): void { if (this.failure !== undefined) throw new Error(this.failure.message); }
  allowFaultedDestroy(): boolean { return !this.busy && this.failure !== undefined; }

  execute(input: IEditorTransactionRequest): EditorTransactionResult {
    this.parts.lifecycle.assertActive('transactions.execute');
    if (this.failure !== undefined) return { status: 'faulted', fault: this.failure };
    if (this.busy) return { status: 'refused', reason: BUSY };
    return this.run('execute', (before, contexts, applied) => {
      if (typeof input.label !== 'string' || input.label.trim() === '') throw new Error('La transaction doit avoir un libellé.');
      this.assertCurrent(input.isCurrent);
      const properties = (input.properties ?? []).map(clonePropertyOperation);
      const commands = [...(input.commands ?? [])];
      // The existing cancellable command channel also guards a property/context/effect-only batch.
      const intent = { label: input.label, do: (doc: ITimelineDocument) => doc, undo: (doc: ITimelineDocument) => doc };
      if (!this.parts.bus.emitCancellable('command:before', { command: intent, document: before })) throw new Error(CANCELLED_REASON);
      const nextContexts = new Map(contexts);
      if (input.htmlContext !== undefined) {
        const stage = this.parts.stageHost.stages.find((entry) => entry.id === input.htmlContext!.stageId);
        const access = stage === undefined ? undefined : getHtmlStageAtomicAccess(stage);
        if (access === undefined) throw new Error('La scène HTML demandée est indisponible.');
        nextContexts.set(access, cloneHtmlAnimationContext(input.htmlContext.context));
      }
      const effect = input.effect;
      const prepared = effect === undefined ? undefined : this.prepareEffect(effect, 'execute');
      if (prepared?.changed) this.applyParticipant(applied, 'host-effect', prepared);
      let next = before;
      const commandProperties: PropertyTimelineOperation[] = [];
      for (const command of commands) {
        if (!this.parts.bus.emitCancellable('command:before', { command, document: next })) throw new Error(CANCELLED_REASON);
        if (command instanceof PropertyTimelineCommand) {
          const operation = command.atomicOperation;
          next = command.doWithContext(freezeDocument(next), this.candidate.editContext(next, operation, nextContexts));
          commandProperties.push(operation);
        } else next = command.do(freezeDocument(next));
      }
      const commandAfter = freezeDocument(next);
      next = this.candidate.apply(next, properties, nextContexts);
      const allProperties = [...commandProperties, ...properties];
      this.candidate.validate(next, allProperties, nextContexts);
      this.assertCurrent(input.isCurrent);
      this.assertRevisions();
      const contextChanged = this.html.some((access) => !sameAtomicData(contexts.get(access), nextContexts.get(access)));
      if (sameAtomicData(next, before)) next = before;
      if (next === before && !contextChanged && prepared?.changed !== true) return undefined;
      const record: AtomicRecord = { id: `host-transaction-${++this.sequence}`, label: input.label,
        before, after: freezeDocument(next), beforeContexts: contexts, afterContexts: nextContexts,
        properties: allProperties, commands, commandAfter, effect, applied: prepared };
      const token = Object.freeze({});
      const entry: IHostHistoryEntry = { kind: 'host', label: input.label, token };
      return { document: record.after, contexts: nextContexts, label: input.label, id: record.id,
        commit: () => { this.records.set(token, record); this.parts.commands.recordAtomic(entry); } };
    });
  }

  replay(entry: HistoryEntry, direction: 'undo' | 'redo' | 'cancel', commit: () => void, groupToken?: object): boolean {
    if (this.refusal() !== undefined) return false;
    try { this.assertRevisions(); } catch { return false; }
    const ordered = flattenHistory([entry]);
    const entries = direction === 'redo' ? ordered : [...ordered].reverse();
    const cause = direction === 'cancel' ? 'group-cancel' : direction;
    const result = this.run(cause, (before, contexts, applied) => {
      let next = before;
      let nextContexts = new Map(contexts);
      const operations: PropertyTimelineOperation[] = [];
      let id = '';
      for (const item of entries) {
        if (!isHostEntry(item)) {
          if (direction === 'undo' && item instanceof PropertyTimelineCommand) {
            this.candidate.validatePermissions(next, [item.atomicOperation], nextContexts);
          }
          if (direction === 'redo' && item instanceof PropertyTimelineCommand) {
            const operation = item.atomicOperation;
            next = item.doWithContext(freezeDocument(next), this.candidate.editContext(next, operation, nextContexts));
            operations.push(operation);
          } else next = direction === 'redo' ? item.do(freezeDocument(next)) : item.undo(freezeDocument(next));
          freezeDocument(next);
          continue;
        }
        const record = this.records.get(item.token);
        if (record === undefined) throw new Error('Cette entrée atomique est périmée.');
        id ||= record.id;
        const expected = direction === 'redo' ? record.before : record.after;
        const expectedContexts = direction === 'redo' ? record.beforeContexts : record.afterContexts;
        if (!sameAtomicData(next, expected) || this.html.some((access) => !sameAtomicData(nextContexts.get(access), expectedContexts.get(access)))) throw new Error(STALE);
        if (direction === 'undo') this.candidate.validatePermissions(next, record.properties, nextContexts);
        if (record.effect !== undefined) {
          let prepared = this.prepareEffect(record.effect, direction === 'redo' ? 'redo' : 'undo');
          if (direction === 'cancel' && record.applied !== undefined) {
            const snapshot = prepared;
            prepared = { changed: record.applied.changed, apply: () => record.applied!.rollback(), rollback: () => snapshot.rollback() };
          }
          if (prepared.changed) this.applyParticipant(applied, record.id, prepared);
        }
        this.revalidateCommands(record, direction);
        next = direction === 'redo' ? record.after : record.before;
        nextContexts = new Map(direction === 'redo' ? record.afterContexts : record.beforeContexts);
        if (direction === 'redo') operations.push(...record.properties);
      }
      this.candidate.validate(next, operations, nextContexts, direction === 'redo');
      this.assertRevisions();
      return { document: next, contexts: nextContexts, label: entry.label, id, commit, groupToken };
    });
    if (result.status === 'faulted') throw new Error(result.fault.message);
    return result.status === 'changed';
  }

  finishGroup(token: object, label: string, commit: () => void): void {
    this.busy = true;
    const batch = this.parts.bus.beginBatch();
    try {
      commit();
      this.parts.bus.emit('transaction:changed', { transactionId: this.groupId(token), label,
        revision: ++this.revision, phase: 'commit', cause: 'execute', groupId: this.groupId(token) });
      batch.commit();
    } finally { batch.discard(); this.busy = false; }
  }

  private run(cause: TransactionChangedEvent['cause'], prepare: (before: ITimelineDocument, contexts: HtmlContexts,
    applied: AppliedParticipant[]) => PreparedTransaction | undefined): EditorTransactionResult {
    const { bus, store, commands } = this.parts;
    const before = store.document;
    const contexts = new Map(this.html.map((access) => [access, access.context]));
    this.html.forEach((access) => this.revisions.set(access, access.revision));
    const applied: AppliedParticipant[] = [];
    let installed = false;
    let compensated = false;
    let committed = false;
    this.busy = true;
    const batch = bus.beginBatch();
    try {
      const prepared = this.withSources(() => {
        try {
          this.candidate.captureBaseline(before, contexts);
          const result = prepare(before, contexts, applied);
          if (result === undefined) return undefined;
          installed = true;
          this.install(result.document, result.contexts);
          return result;
        } catch (error) {
          this.compensate(applied, before, contexts, installed, cause); compensated = true;
          throw error;
        }
      });
      if (prepared === undefined) { batch.discard(); return { status: 'noop' }; }
      prepared.commit();
      committed = true;
      const groupToken = prepared.groupToken ?? commands.groupToken;
      const revision = ++this.revision;
      store.publishAtomic(before, { cause, label: prepared.label, groupToken });
      commands.notifyAtomicHistory();
      const phase = cause === 'group-cancel' ? 'cancel' : commands.isGrouping ? 'preview' : 'commit';
      bus.emit('transaction:changed', { transactionId: prepared.id, label: prepared.label, revision, phase, cause,
        ...(groupToken === undefined ? {} : { groupId: this.groupId(groupToken) }) });
      batch.commit();
      return { status: 'changed', revision };
    } catch (error) {
      if (!committed && !compensated) this.compensate(applied, before, contexts, installed, cause);
      batch.discard();
      if (this.failure !== undefined) return { status: 'faulted', fault: this.failure };
      return { status: 'refused', reason: error instanceof Error ? error.message : 'La transaction a été refusée.' };
    } finally {
      batch.discard();
      this.html.forEach((access) => this.revisions.set(access, access.revision));
      this.busy = false;
    }
  }

  private install(document: ITimelineDocument, contexts: HtmlContexts): void {
    for (const [access, context] of contexts) if (!sameAtomicData(access.context, context)) access.installContext(context);
    this.parts.store.installAtomic(freezeDocument(document));
    this.parts.stageHost.installAtomic(document);
  }

  private revalidateCommands(record: AtomicRecord, direction: 'undo' | 'redo' | 'cancel'): void {
    if (direction === 'cancel') return;
    let doc = direction === 'redo' ? record.before : record.commandAfter;
    const entries = direction === 'redo' ? record.commands : [...record.commands].reverse();
    for (const command of entries) {
      if (direction === 'undo') doc = command.undo(freezeDocument(doc));
      else if (command instanceof PropertyTimelineCommand) doc = command.doWithContext(freezeDocument(doc),
        this.candidate.editContext(doc, command.atomicOperation, record.afterContexts));
      else doc = command.do(freezeDocument(doc));
    }
    freezeDocument(doc);
    if (!sameAtomicData(doc, direction === 'redo' ? record.commandAfter : record.before)) throw new Error(STALE);
  }

  private compensate(applied: readonly AppliedParticipant[], before: ITimelineDocument, contexts: HtmlContexts,
    installed: boolean, cause: TransactionChangedEvent['cause']): void {
    const faults: string[] = [];
    for (const participant of [...applied].reverse()) {
      try { this.assertSynchronous(participant.change.rollback()); } catch { faults.push(participant.id); }
    }
    try { if (installed) this.install(before, contexts); }
    catch { faults.push('timeline-state'); }
    if (faults.length > 0) this.failure = Object.freeze({
      message: 'La compensation a échoué. Restaurez le document hôte puis recréez l’éditeur.',
      phase: cause === 'group-cancel' ? 'cancel' : 'rollback', participantIds: Object.freeze(faults)
    });
  }

  private applyParticipant(journal: AppliedParticipant[], id: string, change: IPreparedHostChange): void {
    journal.push({ id, change });
    this.assertSynchronous(change.apply());
  }
  private prepareEffect(effect: IHostHistoryEffect, direction: TransactionDirection): IPreparedHostChange {
    const prepared = effect.prepare(direction);
    this.assertSynchronous(prepared);
    if (prepared === null || typeof prepared !== 'object' || typeof prepared.changed !== 'boolean' ||
      typeof prepared.apply !== 'function' || typeof prepared.rollback !== 'function') throw new Error('L’effet hôte préparé est invalide.');
    return prepared;
  }
  private assertSynchronous(value: unknown): void {
    if (typeof value === 'object' && value !== null && 'then' in value) throw new Error('Les effets hôtes doivent être synchrones.');
  }
  private assertCurrent(check?: () => boolean): void { if (check !== undefined && check() !== true) throw new Error(STALE); }
  private assertRevisions(): void {
    if (this.html.some((access) => access.revision !== this.revisions.get(access))) throw new Error(STALE);
  }
  private withSources<T>(action: () => T, index = 0): T {
    return index >= this.html.length ? action() : this.html[index].source(() => this.withSources(action, index + 1));
  }
  private groupId(token: object): string {
    let id = this.groupIds.get(token);
    if (id === undefined) { id = `host-group-${++this.sequence}`; this.groupIds.set(token, id); }
    return id;
  }
}

export function createEditorTransactions(parts: Parts): IEditorTransactions { return new AtomicTransactions(parts).facade(); }
