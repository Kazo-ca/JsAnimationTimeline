// packages/editor/src/core/commands/atomicHistory.ts
import type { ICommand } from './ICommand';

/** Internal entries carry identities, never impure ICommand implementations. */
export interface IHostHistoryEntry { readonly kind: 'host'; readonly label: string; readonly token: object }
export interface IGroupedHistoryEntry { readonly kind: 'group'; readonly label: string; readonly entries: readonly HistoryEntry[] }
export type HistoryEntry = ICommand | IHostHistoryEntry | IGroupedHistoryEntry;

/** ICommand is structural: hosts may legally add their own kind/token/entries metadata. */
function isCommand(entry: HistoryEntry): entry is ICommand {
  return 'do' in entry && typeof entry.do === 'function' && 'undo' in entry && typeof entry.undo === 'function';
}

export function isHostEntry(entry: HistoryEntry): entry is IHostHistoryEntry {
  return !isCommand(entry) && 'kind' in entry && entry.kind === 'host';
}
export function isHistoryGroup(entry: HistoryEntry): entry is IGroupedHistoryEntry {
  return !isCommand(entry) && 'kind' in entry && entry.kind === 'group';
}
export function hasHostEntry(entry: HistoryEntry): boolean {
  return isHostEntry(entry) || isHistoryGroup(entry) && entry.entries.some(hasHostEntry);
}
export function flattenHistory(entries: readonly HistoryEntry[]): readonly (ICommand | IHostHistoryEntry)[] {
  return entries.flatMap((entry) => isHistoryGroup(entry) ? flattenHistory(entry.entries) : [entry]);
}
export interface IAtomicHistoryCoordinator {
  readonly faulted: boolean;
  assertHealthy(): void;
  allowFaultedDestroy(): boolean;
  refusal(): string | undefined;
  readonly routesCommands?: boolean;
  executeCommand?(command: ICommand): boolean;
  prepareDestroy?(): void;
  replay(entry: HistoryEntry, direction: 'undo' | 'redo' | 'cancel', commit: () => void, groupToken?: object): boolean;
  finishGroup(token: object, label: string, commit: () => void): void;
}
