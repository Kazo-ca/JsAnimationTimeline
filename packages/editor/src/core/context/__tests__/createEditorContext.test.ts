// packages/editor/src/core/context/__tests__/createEditorContext.test.ts
/**
 * Tests des façades du contexte des plugins : délégation au bus, au Store et
 * à la pile, objets figés sans référence vers les pièces brutes, garde
 * après destruction, événements du noyau en écoute seule, et (tests de typage `@ts-expect-error`) impossibilité
 * d'atteindre `load`, `createCommandStack` ou `clear` par le contexte.
 */

import { createManualClock, defaultPropertyRegistry } from '@kazo-ca/timeline-runtime';
import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';
import { createDocument, renameLayer } from '../../commands/__tests__/fixtures';
import { EventBus } from '../../events/EventBus';
import { PlaybackController } from '../../playback/PlaybackController';
import { createPlaybackFacade } from '../../playback/playbackFacade';
import { EditorStageHost } from '../../stage/EditorStageHost';
import { createStageFacade } from '../../stage/stageFacade';
import { SlotRegistry } from '../../plugin/SlotRegistry';
import { Store } from '../../store/Store';
import { EditorLifecycle } from '../../editor/EditorLifecycle';
import { createPropertyTimelines } from '../../editor/createPropertyTimelines';
import { catchError, createCounter } from '../../editor/__tests__/fixtures';
import { CORE_EVENT_NAMES } from '../coreEvents';
import { createEditorContext } from '../createEditorContext';
import type { IEditorContext } from '../IEditorContext';
import { ServiceRegistry } from '../ServiceRegistry';

interface IContextHarness {
  readonly ctx: IEditorContext;
  readonly bus: EventBus;
  readonly store: Store;
  readonly services: ServiceRegistry;
  readonly kill: () => void;
}

function createHarness(): IContextHarness {
  const bus = new EventBus();
  const store = new Store(bus, createDocument());
  const commands = store.createCommandStack();
  const services = new ServiceRegistry();
  const container = document.createElement('div');
  let alive = true;
  const assertActive = (operation: string): void => {
    if (!alive) throw new Error(`détruit : ${operation}`);
  };
  const registry = defaultPropertyRegistry;
  const controller = new PlaybackController({ bus, store, registry, clock: createManualClock() });
  const lifecycle = new EditorLifecycle();
  const stageHost = new EditorStageHost({ bus, store, registry, stages: [], onError: () => undefined, now: () => controller.now });
  const playback = createPlaybackFacade(controller, assertActive);
  const ctx = createEditorContext({
    bus, store, commands, services, container, assertActive, registry,
    propertyTimelines: createPropertyTimelines({ bus, store, commands, registry, lifecycle, stageHost, playbackFacade: playback }),
    slots: new SlotRegistry(),
    playback,
    stage: createStageFacade(stageHost, assertActive)
  });
  return { ctx, bus, store, services, kill: () => { alive = false; lifecycle.beginDestroy(); lifecycle.finishDestroy(); } };
}

describe('createEditorContext facades', () => {
  it('reads the current document from the store on every access', () => {
    // Arrange
    const { ctx } = createHarness();
    const before = ctx.document;

    // Act
    ctx.commands.execute(renameLayer('l1', 'Titre', 'Logo'));

    // Assert
    expect(ctx.document).not.toBe(before);
    expect(ctx.document.layers[0]?.name).toBe('Titre');
  });

  it('delegates every events method to the bus', () => {
    // Arrange
    const { ctx, bus } = createHarness();
    const seen: string[] = [];
    const handler = (): void => void seen.push('on');
    ctx.events.on('test:ping', handler);
    ctx.events.once('test:ping', () => seen.push('once'));
    ctx.events.onCancellable('test:ping', (event) => event.cancel());

    // Act
    ctx.events.emit('test:ping', { value: 1 });
    ctx.events.off('test:ping', handler);
    bus.emit('test:ping', { value: 2 });
    const allowed = ctx.events.emitCancellable('test:ping', { value: 3 });

    // Assert
    expect(seen).toEqual(['on', 'once']);
    expect(allowed).toBe(false);
  });

  it('lets plugins listen to core events but refuses to emit them', () => {
    // Arrange
    const { ctx, bus } = createHarness();
    const seen: string[] = [];
    ctx.events.on('editor:destroying', () => seen.push('destroying'));
    ctx.events.on('document:changed', () => seen.push('changed'));
    const emitUntyped = ctx.events.emit as (name: string, payload: unknown) => void;
    const emitCancellableUntyped = ctx.events.emitCancellable as (name: string, payload: unknown) => boolean;

    // Act
    const errors = CORE_EVENT_NAMES.flatMap((name) => [
      catchError(() => emitUntyped(name, {})),
      catchError(() => emitCancellableUntyped(name, {}))
    ]);
    bus.emit('editor:destroying', {});

    // Assert
    expect(errors).toHaveLength(CORE_EVENT_NAMES.length * 2);
    expect((errors[0] as Error).message).toBe(
      "events.emit : « editor:ready » est un événement du noyau ; un plugin peut s'y abonner mais pas l'émettre."
    );
    expect((errors[1] as Error).message).toMatch(/^events\.emitCancellable : « editor:ready »/);
    expect(seen).toEqual(['destroying']);
  });

  it('excludes core events from emit and emitCancellable (types)', () => {
    // Arrange
    const { ctx } = createHarness();

    // Act
    const forge = (): unknown[] => [
      // @ts-expect-error un plugin ne peut pas annoncer un changement de document
      ctx.events.emit('document:changed', { document: ctx.document, previous: ctx.document, cause: 'execute', label: 'x' }),
      // @ts-expect-error un plugin ne peut pas annoncer la destruction de l'éditeur
      ctx.events.emit('editor:destroying', {}),
      // @ts-expect-error un plugin ne peut pas émettre command:before
      ctx.events.emitCancellable('command:before', { command: renameLayer('l1', 'A', 'Logo'), document: ctx.document }),
      ctx.events.emit('test:ping', { value: 1 })
    ];

    // Assert
    expect(typeof forge).toBe('function');
  });

  it('exposes the history state and grouping through ctx.commands', () => {
    // Arrange
    const { ctx } = createHarness();

    // Act
    ctx.commands.beginGroup('Glisser');
    const grouping = ctx.commands.isGrouping;
    ctx.commands.execute(renameLayer('l1', 'A', 'Logo'));
    ctx.commands.endGroup();
    const afterGroup = { canUndo: ctx.commands.canUndo, label: ctx.commands.undoLabel };
    ctx.commands.undo();

    // Assert
    expect(grouping).toBe(true);
    expect(afterGroup).toEqual({ canUndo: true, label: 'Glisser' });
    expect(ctx.commands.canRedo).toBe(true);
    expect(ctx.commands.redoLabel).toBe('Glisser');
    expect(ctx.commands.redo()).toBe(true);
    ctx.commands.beginGroup('Annulé');
    ctx.commands.execute(renameLayer('l1', 'B', 'A'));
    ctx.commands.cancelGroup();
    expect(ctx.document.layers[0]?.name).toBe('A');
  });

  it('delegates services to the registry', () => {
    // Arrange
    const { ctx, services } = createHarness();
    const counter = createCounter();

    // Act
    ctx.services.provide('test.counter', counter);

    // Assert
    expect(services.get('test.counter')).toBe(counter);
    expect(ctx.services.get('test.counter')).toBe(counter);
    expect(ctx.services.require('test.counter')).toBe(counter);
  });

  it('freezes every facade and holds no raw core object', () => {
    // Arrange
    const { ctx, bus, store, services } = createHarness();
    const values: unknown[] = [
      ...Object.values(ctx),
      ...Object.values(ctx.events),
      ...Object.values(ctx.commands),
      ...Object.values(ctx.services)
    ];

    // Assert
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.events)).toBe(true);
    expect(Object.isFrozen(ctx.commands)).toBe(true);
    expect(Object.isFrozen(ctx.services)).toBe(true);
    expect(values).not.toContain(bus);
    expect(values).not.toContain(store);
    expect(values).not.toContain(services);
    expect('clear' in ctx.events).toBe(false);
    expect('clear' in ctx.commands).toBe(false);
    expect('load' in ctx.commands).toBe(false);
    expect('clear' in ctx.services).toBe(false);
    expect(Object.keys(ctx).sort()).toEqual([
      'commands', 'container', 'document', 'events', 'playback', 'propertyTimelines', 'registry', 'services', 'slots', 'stage', 'transactions'
    ]);
  });

  it('refuses actions once the editor is destroyed but keeps reads and off', () => {
    // Arrange
    const { ctx, kill } = createHarness();
    const handler = (): void => undefined;
    ctx.events.on('editor:ready', handler);
    kill();

    // Act
    const errors = [
      catchError(() => ctx.events.on('editor:ready', handler)),
      catchError(() => ctx.events.once('editor:ready', handler)),
      catchError(() => ctx.events.emit('test:ping', { value: 1 })),
      catchError(() => ctx.events.onCancellable('editor:ready', handler)),
      catchError(() => ctx.events.emitCancellable('test:ping', { value: 1 })),
      catchError(() => ctx.commands.execute(renameLayer('l1', 'A', 'Logo'))),
      catchError(() => ctx.commands.undo()),
      catchError(() => ctx.commands.redo()),
      catchError(() => ctx.commands.beginGroup('G')),
      catchError(() => ctx.commands.endGroup()),
      catchError(() => ctx.commands.cancelGroup()),
      catchError(() => ctx.services.provide('test.counter', createCounter()))
    ];

    // Assert
    expect(errors.map((error) => (error as Error).message)).toEqual([
      'détruit : events.on', 'détruit : events.once', 'détruit : events.emit',
      'détruit : events.onCancellable', 'détruit : events.emitCancellable',
      'détruit : commands.execute', 'détruit : commands.undo', 'détruit : commands.redo',
      'détruit : commands.beginGroup', 'détruit : commands.endGroup', 'détruit : commands.cancelGroup',
      'détruit : services.provide'
    ]);
    expect(() => ctx.events.off('editor:ready', handler)).not.toThrow();
    expect(ctx.document.layers).toHaveLength(2);
    expect(ctx.commands.canUndo).toBe(false);
    expect(ctx.services.get('test.counter')).toBeUndefined();
  });

  it('keeps the raw store, the stack factory and bus.clear out of reach (types)', () => {
    // Arrange
    const { ctx } = createHarness();
    const doc: ITimelineDocument = createDocument();

    // Act
    const reach = (): unknown[] => [
      // @ts-expect-error le contexte n'expose pas le Store brut
      ctx.store,
      // @ts-expect-error le contexte n'expose pas Store.load
      ctx.load(doc),
      // @ts-expect-error l'historique n'expose pas load
      ctx.commands.load(doc),
      // @ts-expect-error l'historique n'expose pas createCommandStack
      ctx.commands.createCommandStack(),
      // @ts-expect-error l'historique n'expose pas clear
      ctx.commands.clear(),
      // @ts-expect-error les événements n'exposent pas clear
      ctx.events.clear(),
      // @ts-expect-error les événements n'exposent pas listenerCount
      ctx.events.listenerCount(),
      // @ts-expect-error les services n'exposent pas clear
      ctx.services.clear()
    ];
    const assign = (): void => {
      // @ts-expect-error le document est en lecture seule
      ctx.document = doc;
    };

    // Assert
    expect(typeof reach).toBe('function');
    expect(typeof assign).toBe('function');
  });
});
