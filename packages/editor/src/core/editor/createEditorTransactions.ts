// packages/editor/src/core/editor/createEditorTransactions.ts
import { cloneHtmlAnimationContext, getHtmlStageAtomicAccess, validateHtmlSpatialRebinding } from '@kazo-ca/timeline-runtime';
import type { IHtmlResolutionDiagnostic, IHtmlStageAtomicAccess, ITimelineDocument, ITransportTime } from '@kazo-ca/timeline-runtime';
import { flattenHistory, isHistoryGroup, isHostEntry } from '../commands/atomicHistory';
import type { HistoryEntry, IAtomicHistoryCoordinator, IHostHistoryEntry } from '../commands/atomicHistory';
import type { ICommand } from '../commands/ICommand';
import { CommandRefusedError } from '../commands/CommandRefusedError';
import { CANCELLED_REASON } from '../commands/commandEvents';
import { clonePropertyOperation } from '../../model/propertyTimelines/values';
import { PropertyTimelineCommand } from '../../model/propertyTimelines/PropertyTimelineCommand';
import type { PropertyTimelineOperation } from '../../model/propertyTimelines/types';
import type { IEditorParts } from './Editor';
import { AtomicCandidate, sameAtomicData } from './atomicCandidate';
import type { HtmlContexts, HtmlDiagnostics } from './atomicCandidate';
import { prepareAtomicHtmlConflict, resolveAtomicHtmlConflict, snapshotHtmlConflictRequest } from './atomicHtmlConflict';
import { freezeAtomicDocument as freezeDocument } from './atomicDocument';
import { assertSynchronousHostChange, prepareHostRender, validatePreparedHostChange } from './prepareHostRender';
import type { HostRenderCause, IEditorHostRenderer } from './hostRendererTypes';
import type { EditorTransactionResult, IEditorTransactionRequest, IEditorTransactions, IHtmlConflictTransactionRequest, IHostHistoryEffect,
  IPreparedHostChange, ITransactionFault, TransactionChangedEvent, TransactionDirection } from './transactionTypes';

type Parts = Pick<IEditorParts, 'bus' | 'store' | 'commands' | 'stageHost' | 'registry' | 'lifecycle' | 'playback'>;
interface AtomicInput {
  readonly input: IEditorTransactionRequest;
  readonly resolution?: IHtmlConflictTransactionRequest;
}
interface AtomicRecord {
  readonly id: string;
  readonly label: string;
  readonly before: ITimelineDocument;
  readonly after: ITimelineDocument;
  readonly beforeContexts: HtmlContexts;
  readonly afterContexts: HtmlContexts;
  readonly properties: readonly PropertyTimelineOperation[];
  readonly commands: readonly ICommand[];
  readonly notificationCommand: ICommand;
  readonly commandAfter: ITimelineDocument;
  readonly effect?: IHostHistoryEffect;
  readonly applied?: IPreparedHostChange;
  readonly restoredDiagnostics?: HtmlDiagnostics;
}
interface AppliedParticipant { readonly id: string; readonly change: IPreparedHostChange }
interface PreparedTransaction {
  readonly document: ITimelineDocument;
  readonly contexts: HtmlContexts;
  readonly label: string;
  readonly id: string;
  readonly groupToken?: object;
  readonly isCurrent?: () => boolean;
  commit(): void;
}
const BUSY = 'Une transaction atomique est en cours : réessayez après sa notification.';
const STALE = 'Le contexte a changé : la transaction a été annulée.';
const RELEASED = 'Le rendu hôte a été libéré : les modifications sont interdites pendant la destruction.';

function refusalReason(error: unknown): string {
  return error instanceof CommandRefusedError ? error.reason
    : error instanceof Error ? error.message : 'La transaction a été refusée.';
}

/** Describes a host/composite entry without giving observers impure history callbacks. */
function describeHistory(label: string): ICommand {
  return Object.freeze({ label, do: (doc: ITimelineDocument) => doc, undo: (doc: ITimelineDocument) => doc });
}

/** Compatibility for internal hand-built contexts without a transaction coordinator. */
export function unavailableEditorTransactions(assertActive: (operation: string) => void): IEditorTransactions {
  const execute = (): EditorTransactionResult => {
    assertActive('transactions.execute');
    return { status: 'refused' as const, reason: 'Les transactions atomiques sont indisponibles.' };
  };
  return Object.freeze({ get fault() { return undefined; }, execute, resolveHtmlConflict: execute });
}

/** One coordinator participates in CommandStack; it never owns an alternate undo stack. */
class AtomicTransactions implements IAtomicHistoryCoordinator {
  private readonly records = new WeakMap<object, AtomicRecord>();
  private readonly html: readonly IHtmlStageAtomicAccess[];
  private readonly candidate: AtomicCandidate;
  private readonly revisions = new Map<IHtmlStageAtomicAccess, number>();
  private readonly groupIds = new WeakMap<object, string>();
  private readonly historyNotifications = new WeakMap<object, ICommand>();
  private busy = false;
  private refusalNotification = false;
  private failure: ITransactionFault | undefined;
  private revision = 0;
  private sequence = 0;
  private rendererReleased = false;

  constructor(private readonly parts: Parts, private readonly renderer?: IEditorHostRenderer) {
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
    if (renderer !== undefined) {
      parts.playback.attachHostRendering(() => this.assertMutable(), (time, cause, draw, publish) => {
        if (this.refusal() !== undefined || this.rendererReleased) return;
        this.renderOnly(cause, time, draw, publish);
      });
      parts.stageHost.attachAtomicRefresh((layerId) => this.renderOnly('refresh', parts.playback.time,
        () => parts.stageHost.refreshAtomic(layerId)));
      parts.store.attachAtomicLoad((document) => this.load(document));
      this.renderOnly('initialize', parts.playback.time);
    }
  }

  facade(): IEditorTransactions {
    const readFault = (): ITransactionFault | undefined => this.failure;
    return Object.freeze({ get fault() { return readFault(); }, execute: (request: IEditorTransactionRequest) => this.execute(() => ({ input: request })),
      resolveHtmlConflict: (request: IHtmlConflictTransactionRequest) => this.execute(() => {
        const resolution = snapshotHtmlConflictRequest(request);
        return { input: resolution, resolution };
      }) });
  }
  refusal(): string | undefined { return this.busy ? BUSY : this.failure?.message ?? (this.rendererReleased ? RELEASED : undefined); }
  get faulted(): boolean { return this.failure !== undefined; }
  assertHealthy(): void { if (this.failure !== undefined) throw new Error(this.failure.message); }
  allowFaultedDestroy(): boolean { return !this.busy && (this.failure !== undefined || this.rendererReleased); }
  get routesCommands(): boolean { return this.renderer !== undefined; }
  executeCommand(command: ICommand): boolean {
    const result = this.execute(() => ({ input: { label: command.label, commands: [command] } }), true);
    if (result.status === 'faulted') throw new Error(result.fault.message);
    if (result.status === 'refused') this.notifyRefusal(command, result.reason);
    return result.status === 'changed';
  }

  prepareDestroy(): void {
    if (this.renderer === undefined || this.rendererReleased) return;
    // A faulted preview remains untouched so teardown cannot hide failed compensation.
    if (this.failure === undefined) this.renderOnly('destroy', this.parts.playback.time);
    this.rendererReleased = true;
  }

  execute(readInput: () => AtomicInput, ordinaryCommand = false): EditorTransactionResult {
    this.parts.lifecycle.assertActive('transactions.execute');
    if (this.failure !== undefined) return { status: 'faulted', fault: this.failure };
    const refusal = this.refusal();
    if (refusal !== undefined) return { status: 'refused', reason: refusal };
    return this.run('execute', (before, contexts, applied) => {
      // Read JavaScript getters only after the refusal and reentrancy boundary is active.
      const { input, resolution } = readInput();
      if (typeof input.label !== 'string' || input.label.trim() === '') throw new Error('La transaction doit avoir un libellé.');
      const assertConfirmation = (): void => {
        if (resolution === undefined) this.assertCurrent(input.isCurrent);
        else this.withConfirmationSources(() => this.assertCurrent(input.isCurrent));
      };
      assertConfirmation();
      const properties = (input.properties ?? []).map(clonePropertyOperation);
      const commands = [...(input.commands ?? [])];
      const conflict = resolution === undefined ? undefined
        : prepareAtomicHtmlConflict(resolution, before, contexts, this.parts.stageHost, properties);
      // The existing cancellable command channel also guards a property/context/effect-only batch.
      const intent = { label: input.label, do: (doc: ITimelineDocument) => doc, undo: (doc: ITimelineDocument) => doc };
      if (!ordinaryCommand && !this.parts.bus.emitCancellable('command:before', { command: intent, document: before })) throw new Error(CANCELLED_REASON);
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
      if (conflict !== undefined) resolveAtomicHtmlConflict(conflict, next, nextContexts, properties);
      const allProperties = [...commandProperties, ...properties];
      for (const [access, context] of nextContexts) {
        const refusal = validateHtmlSpatialRebinding(before, contexts.get(access) ?? access.context, next, context);
        if (refusal !== undefined) throw new Error(refusal);
      }
      this.candidate.validate(next, allProperties, nextContexts);
      assertConfirmation();
      this.assertRevisions();
      const contextChanged = this.html.some((access) => !sameAtomicData(contexts.get(access), nextContexts.get(access)));
      if (sameAtomicData(next, before)) next = before;
      if (next === before && !contextChanged && prepared?.changed !== true) return undefined;
      const record: AtomicRecord = { id: `host-transaction-${++this.sequence}`, label: input.label,
        before, after: freezeDocument(next), beforeContexts: contexts, afterContexts: nextContexts,
        properties: allProperties, commands, commandAfter, effect, applied: prepared,
        notificationCommand: ordinaryCommand ? commands[0] : describeHistory(input.label),
        ...(conflict === undefined ? {} : { restoredDiagnostics: this.candidate.conflictBaseline(conflict.access, conflict.diagnostic.id) }) };
      const token = Object.freeze({});
      const entry: IHostHistoryEntry = { kind: 'host', label: input.label, token };
      return { document: record.after, contexts: nextContexts, label: input.label, id: record.id,
        ...(resolution === undefined ? {} : { isCurrent: input.isCurrent }),
        commit: () => { this.records.set(token, record); this.parts.commands.recordAtomic(entry); } };
    });
  }

  replay(entry: HistoryEntry, direction: 'undo' | 'redo' | 'cancel', commit: () => void, groupToken?: object): boolean {
    if (this.refusal() !== undefined) return false;
    const ordered = flattenHistory([entry]);
    // HA10 rechecks the actual context and capabilities after a source refresh.
    // A refresh is not itself a stale confirmation: history has no original UI ticket.
    const restoresConflict = ordered.some((item) => isHostEntry(item) && this.records.get(item.token)?.restoredDiagnostics !== undefined);
    if (!restoresConflict) {
      try { this.assertRevisions(); }
      catch (error) { this.notifyRefusal(this.historyCommand(entry, groupToken), refusalReason(error)); return false; }
    }
    const entries = direction === 'redo' ? ordered : [...ordered].reverse();
    const cause = direction === 'cancel' ? 'group-cancel' : direction;
    const result = this.run(cause, (before, contexts, applied) => {
      let next = before;
      let nextContexts = new Map(contexts);
      const operations: PropertyTimelineOperation[] = [];
      const restoredDiagnostics = new Map<IHtmlStageAtomicAccess, readonly IHtmlResolutionDiagnostic[]>();
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
        else for (const [access, issues] of record.restoredDiagnostics ?? []) {
          restoredDiagnostics.set(access, [...(restoredDiagnostics.get(access) ?? []), ...issues]);
        }
      }
      this.candidate.validate(next, operations, nextContexts, direction === 'redo', restoredDiagnostics);
      this.assertRevisions();
      return { document: next, contexts: nextContexts, label: entry.label, id, commit, groupToken };
    });
    if (result.status === 'faulted') throw new Error(result.fault.message);
    if (result.status === 'refused') this.notifyRefusal(this.historyCommand(entry, groupToken), result.reason);
    return result.status === 'changed';
  }

  private historyCommand(entry: HistoryEntry, groupToken?: object): ICommand {
    if (isHostEntry(entry)) {
      const original = this.records.get(entry.token)?.notificationCommand;
      if (original !== undefined) return original;
    } else if (!isHistoryGroup(entry)) return entry;
    const identity = groupToken ?? entry;
    let command = this.historyNotifications.get(identity);
    if (command === undefined) {
      command = describeHistory(entry.label);
      this.historyNotifications.set(identity, command);
    }
    return command;
  }

  /** History refusals arrive after rollback; busy refusals share the same callback guard. */
  notifyRefusal(command: ICommand, reason: string): void {
    if (this.refusalNotification) return;
    this.parts.bus.enqueuePublication(() => {
      if (this.refusalNotification) return;
      const wasBusy = this.busy;
      this.busy = true;
      this.refusalNotification = true;
      try { this.parts.bus.emit('command:refused', { command, reason }); }
      finally { this.refusalNotification = false; this.busy = wasBusy; }
    });
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

  private run(cause: TransactionChangedEvent['cause'] | 'load', prepare: (before: ITimelineDocument, contexts: HtmlContexts,
    applied: AppliedParticipant[]) => PreparedTransaction | undefined): EditorTransactionResult {
    const { bus, store, commands } = this.parts;
    const before = store.document;
    const contexts = new Map(this.html.map((access) => [access, access.context]));
    this.html.forEach((access) => this.revisions.set(access, access.revision));
    const applied: AppliedParticipant[] = [];
    let installed = false;
    let compensated = false;
    let committed = false;
    const renderVersion = this.parts.playback.renderVersion;
    let candidateTime = this.parts.playback.time;
    this.busy = true;
    const batch = bus.beginBatch();
    try {
      const prepared = this.withSources(() => {
        try {
          this.candidate.captureBaseline(before, contexts);
          const result = prepare(before, contexts, applied);
          if (result === undefined) return undefined;
          candidateTime = this.renderer === undefined ? this.parts.playback.time : this.parts.playback.timeForDocument(result.document);
          this.assertRenderVersion(renderVersion);
          installed = true;
          this.install(result.document, result.contexts, candidateTime);
          return result;
        } catch (error) {
          this.compensate(applied, before, contexts, installed, cause); compensated = true;
          throw error;
        }
      });
      if (prepared === undefined) { batch.discard(); return { status: 'noop' }; }
      this.html.forEach((access) => this.revisions.set(access, access.revision));
      // Source inspection has ended; its restoration must never overwrite the host's new preview.
      const assertConfirmation = (): void => {
        if (prepared.isCurrent !== undefined) this.withConfirmationSources(() => this.assertCurrent(prepared.isCurrent));
      };
      assertConfirmation();
      this.applyRender(prepared.document, prepared.contexts, candidateTime, cause, applied, renderVersion, assertConfirmation);
      if (this.renderer !== undefined) this.parts.playback.commitDocumentTiming(prepared.document, candidateTime, () => {
        this.assertRenderVersion(renderVersion);
        this.assertRevisions();
        assertConfirmation();
      });
      prepared.commit();
      committed = true;
      const groupToken = prepared.groupToken ?? commands.groupToken;
      const revision = ++this.revision;
      if (cause === 'load') store.publishAtomicLoad(before);
      else store.publishAtomic(before, { cause, label: prepared.label, groupToken });
      commands.notifyAtomicHistory();
      const phase = cause === 'group-cancel' ? 'cancel' : commands.isGrouping ? 'preview' : 'commit';
      if (cause !== 'load') bus.emit('transaction:changed', { transactionId: prepared.id, label: prepared.label, revision, phase, cause,
        ...(groupToken === undefined ? {} : { groupId: this.groupId(groupToken) }) });
      batch.commit();
      return { status: 'changed', revision };
    } catch (error) {
      if (!committed && !compensated) this.compensate(applied, before, contexts, installed, cause);
      batch.discard();
      if (this.failure !== undefined) return { status: 'faulted', fault: this.failure };
      return { status: 'refused', reason: refusalReason(error) };
    } finally {
      batch.discard();
      this.html.forEach((access) => this.revisions.set(access, access.revision));
      this.busy = false;
    }
  }

  private install(document: ITimelineDocument, contexts: HtmlContexts, time?: ITransportTime): void {
    for (const [access, context] of contexts) if (!sameAtomicData(access.context, context)) access.installContext(context);
    this.parts.store.installAtomic(freezeDocument(document));
    this.parts.stageHost.installAtomic(document, time);
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
    installed: boolean, cause: HostRenderCause): void {
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
    return validatePreparedHostChange(effect.prepare(direction));
  }
  private assertSynchronous(value: unknown): void { assertSynchronousHostChange(value); }
  private assertMutable(): void { const reason = this.refusal(); if (reason !== undefined) throw new Error(reason); }
  private assertRenderVersion(version: number): void {
    if (this.renderer !== undefined && this.parts.playback.renderVersion !== version) throw new Error(STALE);
  }
  private applyRender(document: ITimelineDocument, contexts: HtmlContexts, time: ITransportTime,
    cause: HostRenderCause, applied: AppliedParticipant[], version: number, assertConfirmation?: () => void): void {
    if (this.renderer === undefined) return;
    if (this.rendererReleased) throw new Error(RELEASED);
    const prepared = prepareHostRender(this.renderer, document, contexts, this.parts.stageHost.stages, this.parts.registry, time, cause);
    this.assertRenderVersion(version);
    this.assertRevisions();
    assertConfirmation?.();
    if (prepared.changed) this.applyParticipant(applied, 'host-renderer', prepared);
    this.assertRenderVersion(version);
    this.assertRevisions();
    assertConfirmation?.();
  }
  private load(document: ITimelineDocument): void {
    this.assertMutable();
    const result = this.run('load', (_before, contexts) => {
      this.candidate.validate(document, [], contexts, false);
      return { document: freezeDocument(document), contexts, label: 'Charger le document', id: '',
        commit: () => this.parts.commands.clearAtomic() };
    });
    if (result.status === 'refused') throw new Error(result.reason);
    if (result.status === 'faulted') throw new Error(result.fault.message);
  }

  /** Navigation and lifecycle use the same journal, without adding an undo entry. */
  private renderOnly(cause: HostRenderCause, time: ITransportTime, beforeRender?: () => void, publish?: () => void): void {
    this.assertMutable();
    const before = this.parts.store.document;
    const contexts = new Map(this.html.map((access) => [access, access.context]));
    this.html.forEach((access) => this.revisions.set(access, access.revision));
    const version = this.parts.playback.renderVersion;
    const applied: AppliedParticipant[] = [];
    const batch = this.parts.bus.beginBatch();
    this.busy = true;
    try {
      this.withSources(() => beforeRender?.());
      this.applyRender(before, contexts, time, cause, applied, version);
      publish?.();
      batch.commit();
    } catch (error) {
      this.compensate(applied, before, contexts, false, cause);
      batch.discard();
      throw this.failure === undefined ? error : new Error(this.failure.message);
    } finally {
      batch.discard();
      this.html.forEach((access) => this.revisions.set(access, access.revision));
      this.busy = false;
    }
  }
  private assertCurrent(check?: () => boolean): void { if (check !== undefined && check() !== true) throw new Error(STALE); }
  private assertRevisions(): void {
    if (this.html.some((access) => access.revision !== this.revisions.get(access))) throw new Error(STALE);
  }
  private withSources<T>(action: () => T, index = 0): T {
    return index >= this.html.length ? action() : this.html[index].source(() => this.withSources(action, index + 1));
  }
  private withConfirmationSources<T>(read: () => T, index = 0): T {
    return index >= this.html.length ? read() : this.html[index].readSource(() => this.withConfirmationSources(read, index + 1));
  }
  private groupId(token: object): string {
    let id = this.groupIds.get(token);
    if (id === undefined) { id = `host-group-${++this.sequence}`; this.groupIds.set(token, id); }
    return id;
  }
}

export function createEditorTransactions(parts: Parts, renderer?: IEditorHostRenderer): IEditorTransactions {
  return new AtomicTransactions(parts, renderer).facade();
}
