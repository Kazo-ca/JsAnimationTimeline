// packages/editor/src/core/editor/Editor.ts
/**
 * Implémentation de `IEditor` : délègue au Store, à la `CommandStack`, à
 * l'`EventBus`, à la lecture et au registre des services créés par
 * `createEditor()`, et gère la destruction (ordre : `editor:destroying`,
 * `destroy` des plugins en ordre inverse, lecture, scènes, services, abonnements,
 * emplacement racine, élément racine).
 *
 * Interne au noyau : l'application ne reçoit que le type `IEditor`.
 */

import type { ITimelineDocument, PropertyRegistry } from '@kazo-ca/timeline-runtime';
import type { CommandStack } from '../commands/CommandStack';
import type { ICommand } from '../commands/ICommand';
import type {
  EditorEventName,
  EditorServiceId,
  EditorServiceMap,
  IEditorContext
} from '../context/IEditorContext';
import type { ServiceRegistry } from '../context/ServiceRegistry';
import type { EventBus, EventHandler } from '../events/EventBus';
import type { EditorDestroyingEvent, TimelineEventMap } from '../events/TimelineEventMap';
import type { PlaybackController } from '../playback/PlaybackController';
import type { FrameListener, IEditorPlayback, IFrameSample } from '../playback/types';
import type { PluginHost } from '../plugin/PluginHost';
import type { EditorStageHost } from '../stage/EditorStageHost';
import type { IEditorStage } from '../stage/types';
import { ROOT_SLOT } from '../plugin/SlotRegistry';
import type { Store } from '../store/Store';
import { SetPropertyCommand } from '../../model/properties/SetPropertyCommand';
import { PropertyOperationError } from '../../model/properties/propertyValue';
import type { EditorLifecycle } from './EditorLifecycle';
import type { IEditor, SetPropertyOptions } from './types';
import type { IEditorPropertyTimelines } from './propertyTimelineTypes';
import type { IEditorTransactions } from './transactionTypes';

/** Pièces d'un éditeur, créées par `createEditor()`. */
export interface IEditorParts {
  readonly bus: EventBus;
  readonly store: Store;
  readonly commands: CommandStack;
  readonly host: PluginHost<IEditorContext>;
  readonly services: ServiceRegistry;
  /** Registre de propriétés figé. */
  readonly registry: PropertyRegistry;
  /** Lecture et rendu regroupé. */
  readonly playback: PlaybackController;
  /** Façade de la lecture (`ctx.playback`, `editor.playback`). */
  readonly playbackFacade: IEditorPlayback;
  /** Scènes branchées. */
  readonly stageHost: EditorStageHost;
  /** Façade des scènes (`ctx.stage`, `editor.stage`). */
  readonly stageFacade: IEditorStage;
  /** Élément racine (classe `JsTimeLine`), défini comme `ROOT_SLOT`. */
  readonly element: HTMLElement;
  readonly lifecycle: EditorLifecycle;
  readonly propertyFacade: IEditorPropertyTimelines;
  readonly transactionFacade: IEditorTransactions;
}

/**
 * Libère ce que l'éditeur a mis en place hors des plugins : lecture,
 * scènes (chaque calque relâché, puis chaque scène détachée), services, abonnements, emplacement racine et élément racine. Sert à
 * `destroy` et à l'annulation d'un démarrage raté.
 */
export function releaseEditorParts(parts: IEditorParts): void {
  parts.commands.invalidatePending();
  parts.playback.destroy();
  parts.stageHost.destroy();
  parts.services.clear();
  parts.bus.clear();
  parts.host.slots.remove(ROOT_SLOT);
  parts.element.remove();
}

/** Éditeur v2 retourné par `createEditor()`. */
export class Editor implements IEditor {
  constructor(private readonly parts: IEditorParts) {}

  get transactions(): IEditorTransactions {
    this.assertActive('transactions');
    return this.parts.transactionFacade;
  }

  get propertyTimelines(): IEditorPropertyTimelines {
    this.assertActive('propertyTimelines');
    return this.parts.propertyFacade;
  }

  get isDestroyed(): boolean {
    return this.parts.lifecycle.isDestroyed;
  }

  get container(): HTMLElement {
    this.assertActive('container');
    return this.parts.element;
  }

  get document(): ITimelineDocument {
    this.assertActive('document');
    return this.parts.store.document;
  }

  get playback(): IEditorPlayback {
    this.assertActive('playback');
    return this.parts.playbackFacade;
  }

  get stage(): IEditorStage {
    this.assertActive('stage');
    return this.parts.stageFacade;
  }

  get registry(): PropertyRegistry {
    this.assertActive('registry');
    return this.parts.registry;
  }

  get canUndo(): boolean {
    this.assertActive('canUndo');
    return this.parts.commands.canUndo;
  }

  get canRedo(): boolean {
    this.assertActive('canRedo');
    return this.parts.commands.canRedo;
  }

  on<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): () => void {
    this.assertActive('on');
    return this.parts.bus.on(name, handler);
  }

  once<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): () => void {
    this.assertActive('once');
    return this.parts.bus.once(name, handler);
  }

  off<K extends EditorEventName>(name: K, handler: EventHandler<TimelineEventMap[K]>): void {
    this.assertActive('off');
    this.parts.bus.off(name, handler);
  }

  execute(command: ICommand): boolean {
    this.assertActive('execute');
    return this.parts.commands.execute(command);
  }

  setProperty(layerId: string, name: string, value: number, options: SetPropertyOptions = {}): boolean {
    this.assertActive('setProperty');
    const { registry, stageHost, playbackFacade, commands } = this.parts;
    const frame = options.frame === undefined ? playbackFacade.frame : options.frame;
    return commands.execute(new SetPropertyCommand(layerId, name, value, frame, {
      registry,
      describe: (target) => {
        try { return stageHost.describeForEdit(target); }
        catch { throw new PropertyOperationError('Les propriétés de la cible sont indisponibles.'); }
      }
    }));
  }

  undo(): boolean {
    this.assertActive('undo');
    return this.parts.commands.undo();
  }

  redo(): boolean {
    this.assertActive('redo');
    return this.parts.commands.redo();
  }

  toJSON(): ITimelineDocument {
    this.assertActive('toJSON');
    return this.parts.store.document;
  }

  load(doc: ITimelineDocument): void {
    this.assertActive('load');
    this.parts.store.load(doc);
  }

  sample(frame?: number): IFrameSample {
    this.assertActive('sample');
    return this.parts.playback.sample(frame);
  }

  refreshTargets(layerId?: string): void {
    this.assertActive('refreshTargets');
    this.parts.stageHost.refreshTargets(layerId);
  }

  onFrame(listener: FrameListener): () => void {
    this.assertActive('onFrame');
    return this.parts.bus.on('frame:render', ({ sample }) => listener(sample));
  }

  getService<K extends EditorServiceId>(id: K): EditorServiceMap[K] | undefined {
    this.assertActive('getService');
    return this.parts.services.get(id);
  }

  destroy(reason?: string): void {
    const { lifecycle, bus, host } = this.parts;
    if (!lifecycle.isDestroyed) this.parts.commands.prepareLifecycle(true);
    if (!lifecycle.beginDestroy()) return;
    const payload: EditorDestroyingEvent = reason === undefined ? {} : { reason };
    try {
      bus.emit('editor:destroying', payload);
      host.destroy();
    } finally {
      releaseEditorParts(this.parts);
      lifecycle.finishDestroy();
    }
  }

  private assertActive(operation: string): void {
    this.parts.lifecycle.assertActive(operation);
  }
}
