// packages/editor/src/core/context/createEditorContext.ts
/**
 * Construit le contexte transmis aux plugins (`IEditorContext`) à partir des
 * pièces du noyau. Chaque façade est un objet figé de fermetures : elle ne
 * porte aucune référence vers le Store, la `CommandStack` ou l'`EventBus`
 * bruts, qu'un plugin ne peut donc pas atteindre (ni `load`, ni
 * `createCommandStack`, ni `clear`).
 *
 * `assertActive(operation)` est appelé avant chaque action (abonnement,
 * émission, exécution, fourniture d'un service) : après la destruction de
 * l'éditeur, il lève une erreur. Les lectures, `off` et `services.get` /
 * `require` n'y sont pas soumis.
 *
 * `emit` / `emitCancellable` refusent aussi les événements du noyau
 * (`assertPluginEvent`) : le typage les exclut déjà, la garde couvre les
 * appels non typés (JavaScript, transtypage).
 */

import type { ITimelineDocument, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import type { CommandStack } from '../commands/CommandStack';
import type { EventBus } from '../events/EventBus';
import type { IEditorPlayback } from '../playback/types';
import type { IEditorPropertyTimelines } from '../editor/propertyTimelineTypes';
import type { IEditorTransactions } from '../editor/transactionTypes';
import { unavailableEditorTransactions } from '../editor/createEditorTransactions';
import type { SlotRegistry } from '../plugin/SlotRegistry';
import type { IEditorStage } from '../stage/types';
import type { Store } from '../store/Store';
import { assertPluginEvent } from './coreEvents';
import type { IEditorCommands, IEditorContext, IEditorEvents, IEditorServices } from './IEditorContext';

/** Vérifie que l'éditeur est encore utilisable avant l'action `operation`. */
export type AssertActive = (operation: string) => void;

/** Pièces du noyau à partir desquelles le contexte est construit. */
export interface IEditorContextSources {
  readonly bus: EventBus;
  readonly store: Store;
  readonly commands: CommandStack;
  readonly propertyTimelines: IEditorPropertyTimelines;
  readonly transactions?: IEditorTransactions;
  readonly slots: SlotRegistry;
  readonly services: IEditorServices;
  readonly container: HTMLElement;
  /** Façade de la lecture, déjà gardée par `assertActive` (`createPlaybackFacade`). */
  readonly playback: IEditorPlayback;
  /** Façade des scènes, déjà gardée par `assertActive` (`createStageFacade`). */
  readonly stage: IEditorStage;
  /** Registre figé de l'éditeur. */
  readonly registry: PropertyRegistry;
  readonly assertActive: AssertActive;
}

/**
 * Façade des événements : l'`EventBus` sans `clear` ni `listenerCount`, et
 * sans émission des événements du noyau.
 */
export function createEventsFacade(bus: EventBus, assertActive: AssertActive): IEditorEvents {
  return Object.freeze<IEditorEvents>({
    on: (name, handler) => {
      assertActive('events.on');
      return bus.on(name, handler);
    },
    once: (name, handler) => {
      assertActive('events.once');
      return bus.once(name, handler);
    },
    off: (name, handler) => bus.off(name, handler),
    emit: (name, payload) => {
      assertActive('events.emit');
      assertPluginEvent(name, 'events.emit');
      bus.emit(name, payload);
    },
    onCancellable: (name, handler) => {
      assertActive('events.onCancellable');
      return bus.onCancellable(name, handler);
    },
    emitCancellable: (name, payload) => {
      assertActive('events.emitCancellable');
      assertPluginEvent(name, 'events.emitCancellable');
      return bus.emitCancellable(name, payload);
    }
  });
}

/** Façade de l'historique : la `CommandStack` sans `clear`. */
export function createCommandsFacade(stack: CommandStack, assertActive: AssertActive): IEditorCommands {
  const guarded =
    <A extends unknown[], R>(operation: string, action: (...args: A) => R) =>
    (...args: A): R => {
      assertActive(`commands.${operation}`);
      return action(...args);
    };
  return Object.freeze<IEditorCommands>({
    execute: guarded('execute', (command) => stack.execute(command)),
    undo: guarded('undo', () => stack.undo()),
    redo: guarded('redo', () => stack.redo()),
    get canUndo(): boolean {
      return stack.canUndo;
    },
    get canRedo(): boolean {
      return stack.canRedo;
    },
    get undoLabel(): string | undefined {
      return stack.undoLabel;
    },
    get redoLabel(): string | undefined {
      return stack.redoLabel;
    },
    get isGrouping(): boolean {
      return stack.isGrouping;
    },
    beginGroup: guarded('beginGroup', (label: string) => stack.beginGroup(label)),
    endGroup: guarded('endGroup', () => stack.endGroup()),
    cancelGroup: guarded('cancelGroup', () => stack.cancelGroup())
  });
}

/** Façade des services : `provide` / `get` / `require`, sans `clear`. */
export function createServicesFacade(services: IEditorServices, assertActive: AssertActive): IEditorServices {
  return Object.freeze<IEditorServices>({
    provide: (id, api) => {
      assertActive('services.provide');
      return services.provide(id, api);
    },
    get: (id) => services.get(id),
    require: (id) => services.require(id)
  });
}

/** Construit le contexte figé transmis à `init` de chaque plugin. */
export function createEditorContext(sources: IEditorContextSources): IEditorContext {
  const { store, assertActive } = sources;
  const events = createEventsFacade(sources.bus, assertActive);
  const commands = createCommandsFacade(sources.commands, assertActive);
  const services = createServicesFacade(sources.services, assertActive);
  return Object.freeze<IEditorContext>({
    events,
    get document(): ITimelineDocument {
      return store.document;
    },
    commands,
    propertyTimelines: sources.propertyTimelines,
    transactions: sources.transactions ?? unavailableEditorTransactions(assertActive),
    slots: sources.slots,
    container: sources.container,
    playback: sources.playback,
    stage: sources.stage,
    registry: sources.registry,
    services
  });
}
