// packages/editor/src/core/editor/__tests__/hostTransactionFixtures.ts
import { createManualClock } from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlGradientDefinition, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import { createEditor } from '../createEditor';
import type { EditorOptions, IEditor } from '../types';
import type { IEditorTransactionRequest, IHostHistoryEffect, TransactionChangedEvent, TransactionDirection } from '../transactionTypes';
import { createEditorHtmlStage } from '../../stage/editorHtmlStage';
import { createDoc, layer, layerOf } from '../../../model/spans/__tests__/fixtures';
import { cleanBody, createContainer } from './fixtures';

export const number = (value: number): TimelinePropertyValue => ({ kind: 'number', value });
export const boolean = (value: boolean): TimelinePropertyValue => ({ kind: 'boolean', value });
const editors: IEditor[] = [];

export function setupHost(options: Partial<EditorOptions> = {}, animationContext?: IHtmlAnimationContext) {
  const root = document.createElement('main');
  const element = document.createElement('div'); element.id = 'gradient';
  const orphan = document.createElement('div'); orphan.style.opacity = '0.8';
  root.append(element, orphan); document.body.append(root);
  const gradient: IHtmlGradientDefinition = { id: 'fill', cssName: 'background-image', type: 'linear', angle: 90,
    centerX: 50, centerY: 50, radiusX: 50, radiusY: 50, stops: [
      { id: 'left', color: { kind: 'color', r: 1, g: 0, b: 0, a: 1 }, position: 0, opacity: 1, present: true },
      { id: 'right', color: { kind: 'color', r: 0, g: 0, b: 1, a: 1 }, position: 100, opacity: 1, present: true }
    ] };
  const context: IHtmlAnimationContext = { version: 1, gradients: { gradient: [gradient] }, bindings: { gradient: {
    leftPresent: { kind: 'gradient', gradientId: 'fill', component: 'present', stopId: 'left' },
    rightPresent: { kind: 'gradient', gradientId: 'fill', component: 'present', stopId: 'right' },
    rightPosition: { kind: 'gradient', gradientId: 'fill', component: 'position', stopId: 'right' }
  } } };
  const container = createContainer();
  const stage = createEditorHtmlStage(container, { root, animationContext: animationContext ?? context });
  const clock = createManualClock();
  const errors: unknown[] = [];
  const editor = createEditor(container, { data: createDoc([layer('gradient', [], { target: { selector: '#gradient' } })], 100),
    stage, clock, defaultPlugins: false, onStageError: (error) => errors.push(error), ...options });
  editors.push(editor);
  const seek = (frame: number) => { editor.playback.seek(frame); clock.advance(1); };
  return { editor, stage, seek, element, orphan, root, errors };
}
export type HostFixture = ReturnType<typeof setupHost>;

export function cleanupHosts(): void {
  for (const editor of editors.splice(0)) if (!editor.isDestroyed) editor.destroy();
  cleanBody();
}

export function contextWithStop(context: IHtmlAnimationContext, id = 'middle'): IHtmlAnimationContext {
  const gradient = context.gradients?.gradient?.[0];
  if (gradient === undefined) throw new Error('Missing gradient fixture');
  return { ...context, gradients: { ...context.gradients, gradient: [{ ...gradient, stops: [...gradient.stops,
    { id, color: { kind: 'color', r: 0, g: 1, b: 0, a: 1 }, position: 50, opacity: 1, present: false }
  ] }] }, bindings: { ...context.bindings, gradient: { ...context.bindings?.gradient,
    [`${id}Present`]: { kind: 'gradient', gradientId: 'fill', component: 'present', stopId: id },
    [`${id}Position`]: { kind: 'gradient', gradientId: 'fill', component: 'position', stopId: id }
  } } };
}

export function addStopRequest(fixture: HostFixture, effect?: IHostHistoryEffect): IEditorTransactionRequest {
  return { label: 'Add gradient stop', htmlContext: { stageId: fixture.stage.id, context: contextWithStop(fixture.stage.animationContext) },
    properties: [
      { kind: 'set', layerId: 'gradient', property: 'middlePresent', frame: 50, value: boolean(true), initialValue: boolean(false) },
      { kind: 'set', layerId: 'gradient', property: 'middlePosition', frame: 50, value: number(60), initialValue: number(50) }
    ], ...(effect === undefined ? {} : { effect }) };
}

export function positionRequest(value: number): IEditorTransactionRequest {
  return { label: 'Move gradient stop', properties: [
    { kind: 'set', layerId: 'gradient', property: 'rightPosition', frame: 50, value: number(value), initialValue: number(100) }
  ] };
}

export function track(fixture: HostFixture, property: string) {
  return layerOf(fixture.editor.document, 'gradient').propertyTimelines?.[property];
}
export function state(fixture: HostFixture) {
  return { document: fixture.editor.document, context: fixture.stage.animationContext,
    dom: fixture.root.innerHTML, canUndo: fixture.editor.canUndo, canRedo: fixture.editor.canRedo };
}

export function observeTransactions(editor: IEditor): TransactionChangedEvent[] {
  const events: TransactionChangedEvent[] = [];
  editor.on('transaction:changed', (event) => events.push(event));
  return events;
}

export interface IHostJournalEntry {
  readonly fullXPath: string;
  readonly attribute: string;
  readonly oldValue: string | null;
  readonly newValue: string | null;
}
export interface IEffectOptions {
  readonly attribute?: string;
  readonly value?: string;
  readonly fullXPath?: string;
  readonly name?: string;
  readonly trace?: string[];
  readonly afterApply?: (direction: TransactionDirection) => void;
  readonly beforeRollback?: (direction: TransactionDirection) => void;
}

/** The host owns compensation of its journal and event buffer, as well as the DOM. */
export function attributeEffect(element: HTMLElement, options: IEffectOptions = {}) {
  const attribute = options.attribute ?? 'data-designer';
  const value = options.value ?? 'edited';
  const original = element.getAttribute(attribute);
  const journal: IHostJournalEntry[] = [];
  const pending: IHostJournalEntry[] = [];
  const write = (next: string | null) => { if (next === null) element.removeAttribute(attribute); else element.setAttribute(attribute, next); };
  const effect: IHostHistoryEffect = { prepare(direction) {
    const before = element.getAttribute(attribute);
    const previousJournal = [...journal];
    const previousPending = [...pending];
    const target = direction === 'undo' ? original : value;
    return { changed: target !== before,
      apply() {
        options.trace?.push(`${options.name ?? attribute}:${direction}:apply`);
        write(target);
        const delta = { fullXPath: options.fullXPath ?? '/html/body/main/div[1]', attribute, oldValue: original, newValue: target };
        journal.splice(0, journal.length, ...(target === original ? [] : [delta]));
        pending.push({ ...delta, oldValue: before });
        options.afterApply?.(direction);
      },
      rollback() {
        options.trace?.push(`${options.name ?? attribute}:${direction}:rollback`);
        options.beforeRollback?.(direction);
        write(before); journal.splice(0, journal.length, ...previousJournal); pending.splice(0, pending.length, ...previousPending);
      }
    };
  } };
  return { effect, journal, pending };
}
