// demo/editor/src/conformance/html.ts
import { createEditor, createEditorHtmlStage } from '@kazo-ca/timeline-editor';
import type { EditorTransactionResult, IHtmlConflictTransactionRequest, PropertyChangedEvent } from '@kazo-ca/timeline-editor';
import { exportHtmlCss } from '@kazo-ca/timeline-export-css';
import {
  collectLayers, compileHtmlPlayback, createHtmlPlaybackPlayer, createManualClock, defaultPropertyRegistry,
  exportHtmlJavascript, parseHtmlPlayback, prepareHtmlResolution
} from '@kazo-ca/timeline-runtime';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic, IHtmlResolvedLayer, ITimelineDocument, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import {
  createHtmlScene, htmlContextFor, htmlDocument, HTML_ROOT_ID, readHtmlScene, snapshotKey
} from './scenes/html';
import type { HtmlDocumentName, HtmlSceneKind, HtmlSceneSnapshot } from './scenes/html';
import type {
  IConflictAttempt, IConflictState, IHtmlConformance, IHtmlHandle, IHtmlOpenOptions, IRecordedFrames, IRefusedOutput, ITrackedOutput, ITrackFn
} from './htmlTypes';

/** Step of the linear playback: one frame plus a hair, so floating point never lands under an integer frame. */
const LINEAR_EPSILON_MS = 1e-6;
/**
 * Nudge added to `currentTime` of the CSS animations. The exporter writes the duration as 4.166666666666667s, so the 39 % keyframe
 * of a hold sits 2e-13 ms after (frame - 1) * 1000 / fps; a read exactly on that instant still shows the previous value.
 * One nanosecond puts the read on the right side of the jump without moving any interpolated value.
 */
const CSS_BOUNDARY_NUDGE_MS = 1e-6;

function node(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Hôte #${id} manquant.`);
  return found;
}

function openHtml(options: IHtmlOpenOptions, track: ITrackFn): IHtmlHandle {
  const kind: HtmlSceneKind = options.scene;
  const document = typeof options.document === 'string' ? htmlDocument(options.document) : options.document;
  const sceneHost = node('html-scene-host');
  const scene = createHtmlScene(sceneHost.ownerDocument, kind);
  sceneHost.append(scene);
  const editorHost = node('html-ui-host');
  const clock = createManualClock();
  const stage = createEditorHtmlStage(editorHost, { root: scene, animationContext: options.context ?? htmlContextFor(kind) });
  const editor = createEditor(editorHost, { data: document, stage, clock });
  const events: PropertyChangedEvent[] = [];
  editor.on('property:changed', (event) => { events.push(event); });
  const handle: IHtmlHandle = {
    editor, clock, events, stage, scene, kind,
    objectValues: () => undefined,
    selectLayers(ids) {
      const selection = editor.getService('layers.selection');
      if (selection === undefined) throw new Error('Service layers.selection absent.');
      selection.select(ids, 'replace');
      return selection.selected();
    },
    dispose: () => { editor.destroy(); scene.remove(); }
  };
  return track(handle) as IHtmlHandle;
}

async function openFrameScene(kind: HtmlSceneKind): Promise<{ root: HTMLElement; dispose(): void }> {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:absolute;left:-10000px;top:0;width:640px;height:480px;border:0';
  document.body.append(frame);
  await new Promise<void>((resolve, reject) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.addEventListener('error', () => reject(new Error('La scène isolée ne peut pas être chargée.')), { once: true });
    frame.srcdoc = '<!doctype html><html lang="fr"><head><meta charset="utf-8"></head><body style="margin:0"></body></html>';
  });
  const owner = frame.contentDocument;
  if (owner === null) throw new Error('La scène isolée est inaccessible.');
  const root = createHtmlScene(owner, kind);
  owner.body.append(root);
  return { root, dispose: () => { frame.remove(); } };
}

function requireHandle(current: IHtmlHandle | undefined): IHtmlHandle {
  if (current === undefined) throw new Error('Aucun éditeur HTML ouvert.');
  return current;
}

function recordKey(frame: number): string { return String(frame); }

function seekRecords(handle: IHtmlHandle, frames: readonly number[]): IRecordedFrames {
  const records: Record<string, HtmlSceneSnapshot> = {};
  handle.editor.playback.pause();
  for (const frame of frames) {
    handle.editor.playback.seek(frame);
    handle.clock.advance(0);
    records[recordKey(frame)] = readHtmlScene(handle.scene, handle.kind);
  }
  return { records, frames: [...frames] };
}

/** Plays at real speed on the manual clock, one frame per step, and reads the scene after every step. */
function linearRecords(handle: IHtmlHandle): IRecordedFrames {
  const { fps, totalFrames } = handle.editor.document.settings;
  const step = 1000 / fps + LINEAR_EPSILON_MS;
  const records: Record<string, HtmlSceneSnapshot> = {};
  const seen: number[] = [];
  handle.editor.playback.seek(1);
  handle.editor.playback.play();
  for (let index = 0; index < totalFrames; index++) {
    handle.clock.advance(index === 0 ? 0 : step);
    const frame = handle.editor.playback.frame;
    seen.push(frame);
    records[recordKey(frame)] = readHtmlScene(handle.scene, handle.kind);
  }
  handle.editor.playback.pause();
  return { records, frames: seen };
}

function refusal(result: { diagnostics: readonly unknown[]; css?: string; alternatives?: readonly string[] }): IRefusedOutput {
  return {
    status: 'refused', css: result.css ?? '', alternatives: result.alternatives === undefined ? [] : [...result.alternatives],
    diagnostics: JSON.parse(JSON.stringify(result.diagnostics)) as IRefusedOutput['diagnostics']
  };
}

function compileFor(handle: IHtmlHandle) {
  return compileHtmlPlayback(handle.editor.document, {
    root: handle.scene, animationContext: handle.stage.animationContext, sourceStage: handle.stage
  });
}

function playbackData(handle: IHtmlHandle): ITrackedOutput<unknown> | IRefusedOutput {
  const result = compileFor(handle);
  if (result.status === 'refused') return refusal(result);
  return { status: 'exported', data: JSON.parse(JSON.stringify(result.data)) as unknown, diagnostics: [] };
}

/** HA5 JSON: compile, serialize, parse again and drive the player on a fresh copy of the scene. */
async function jsonRecords(handle: IHtmlHandle, frames: readonly number[]): Promise<IRecordedFrames | IRefusedOutput> {
  const compiled = compileFor(handle);
  if (compiled.status === 'refused') return refusal(compiled);
  const parsed = parseHtmlPlayback(JSON.parse(JSON.stringify(compiled.data)));
  const copy = await openFrameScene(handle.kind);
  const player = createHtmlPlaybackPlayer(parsed, { root: copy.root });
  try {
    const records: Record<string, HtmlSceneSnapshot> = {};
    for (const frame of frames) { player.seek(frame); records[recordKey(frame)] = readHtmlScene(copy.root, handle.kind); }
    return { records, frames: [...frames] };
  } finally { player.destroy(); copy.dispose(); }
}

interface IStandalonePlayer { seek(frame: number): void; destroy(): void }

/** HA5 JavaScript: the generated module is imported from a Blob URL and drives a fresh copy of the scene. */
async function scriptRecords(handle: IHtmlHandle, frames: readonly number[]): Promise<IRecordedFrames | IRefusedOutput> {
  const compiled = compileFor(handle);
  if (compiled.status === 'refused') return refusal(compiled);
  const url = URL.createObjectURL(new Blob([exportHtmlJavascript(compiled.data)], { type: 'text/javascript' }));
  const copy = await openFrameScene(handle.kind);
  try {
    const module = await import(/* @vite-ignore */ url) as { createPlayer(options: { root: ParentNode }): IStandalonePlayer };
    const player = module.createPlayer({ root: copy.root });
    try {
      const records: Record<string, HtmlSceneSnapshot> = {};
      for (const frame of frames) { player.seek(frame); records[recordKey(frame)] = readHtmlScene(copy.root, handle.kind); }
      return { records, frames: [...frames] };
    } finally { player.destroy(); }
  } finally { URL.revokeObjectURL(url); copy.dispose(); }
}

/** Continuous CSS: paused animations of a fresh copy, moved to `currentTime = (frame - 1) * 1000 / fps`. */
async function cssRecords(handle: IHtmlHandle, frames: readonly number[]): Promise<(IRecordedFrames & { css: string }) | IRefusedOutput> {
  const result = exportHtmlCss(handle.editor.document, {
    root: handle.scene, rootSelector: `#${HTML_ROOT_ID}`, animationContext: handle.stage.animationContext, sourceStage: handle.stage
  });
  if (result.status === 'refused') return refusal(result);
  const copy = await openFrameScene(handle.kind);
  try {
    const owner = copy.root.ownerDocument;
    const stylesheet = owner.createElement('style');
    stylesheet.textContent = result.css;
    owner.head.append(stylesheet);
    const animations = copy.root.getAnimations({ subtree: true });
    animations.forEach((animation) => { animation.pause(); });
    const { fps } = handle.editor.document.settings;
    const records: Record<string, HtmlSceneSnapshot> = {};
    for (const frame of frames) {
      animations.forEach((animation) => { animation.currentTime = (frame - 1) * 1000 / fps + CSS_BOUNDARY_NUDGE_MS; });
      records[recordKey(frame)] = readHtmlScene(copy.root, handle.kind);
    }
    animations.forEach((animation) => { animation.cancel(); });
    return { records, frames: [...frames], css: result.css };
  } finally { copy.dispose(); }
}

function layersOf(document: ITimelineDocument, root: ParentNode): IHtmlResolvedLayer[] {
  return collectLayers(document).flatMap((layer) => {
    if (layer.target === undefined || !('selector' in layer.target)) return [];
    const { selector } = layer.target;
    return [{ layerId: layer.id, layer, target: { selector }, elements: Array.from(root.querySelectorAll(selector)) }];
  });
}

function formatResolved(property: string, value: TimelinePropertyValue): string {
  if (value.kind === 'number') return property === 'left' ? `${value.value}px` : String(value.value);
  if (value.kind === 'color') return `rgb(${Math.round(value.r * 255)}, ${Math.round(value.g * 255)}, ${Math.round(value.b * 255)})`;
  return value.kind === 'text' ? value.value : String(value.kind);
}

/** The resolution engine evaluated at (possibly fractional) frames: the reference of the continuous CSS output. */
function resolvedRecords(handle: IHtmlHandle, frames: readonly number[]): IRecordedFrames {
  return handle.stage.withSourceStyles(() => {
    const document = handle.editor.document;
    const plan = prepareHtmlResolution(document, layersOf(document, handle.scene), handle.stage.animationContext, defaultPropertyRegistry);
    const records: Record<string, HtmlSceneSnapshot> = {};
    for (const frame of frames) {
      const entries: [string, string][] = [];
      for (const state of plan.evaluate(frame)) {
        for (const resolved of state.properties) {
          const key = snapshotKey(state.element.id, resolved.property);
          if (key !== undefined) entries.push([key, formatResolved(resolved.property, resolved.value)]);
        }
      }
      records[recordKey(frame)] = Object.fromEntries(entries);
    }
    return { records, frames: [...frames] };
  });
}

function conflictDiagnostic(handle: IHtmlHandle): IHtmlResolutionDiagnostic | undefined {
  return handle.stage.diagnostics.find((entry) => entry.code === 'priority-conflict');
}

function conflictState(handle: IHtmlHandle): IConflictState {
  return JSON.parse(JSON.stringify({
    document: handle.editor.document, context: handle.stage.animationContext,
    canUndo: handle.editor.canUndo, canRedo: handle.editor.canRedo,
    blocking: handle.stage.diagnostics.filter((entry) => entry.blocking).map((entry) => entry.code),
    events: handle.events.length
  })) as IConflictState;
}

/** The ticket the dialog would hold: the diagnostic read now, the choice, the announced key and a membership guard. */
function conflictRequest(handle: IHtmlHandle, attempt: IConflictAttempt): IHtmlConflictTransactionRequest {
  const diagnostic = conflictDiagnostic(handle);
  if (diagnostic === undefined) throw new Error('Aucun conflit de priorité à résoudre.');
  const membership = layersOf(handle.editor.document, handle.scene);
  const sameMembership = (): boolean => layersOf(handle.editor.document, handle.scene).every((layer, index) => {
    const before = membership[index].elements;
    return layer.elements.length === before.length && layer.elements.every((element, position) => element === before[position]);
  });
  return {
    label: 'Confirmer la priorité HTML', stageId: handle.stage.id,
    confirmation: { id: diagnostic.id, signature: diagnostic.signature }, winnerLayerId: attempt.winner,
    properties: attempt.key === undefined ? [] : [{
      kind: 'set', layerId: attempt.winner, property: 'opacity', frame: attempt.key.frame, value: { kind: 'number', value: attempt.key.value }
    }],
    isCurrent: () => attempt.expired !== true && sameMembership()
  };
}

/** Everything the HTML cases need from the page; every object is created from the built packages. */
export function createHtmlConformance(track: ITrackFn, currentHtml: () => IHtmlHandle | undefined): IHtmlConformance {
  let lastRequest: IHtmlConflictTransactionRequest | undefined;
  const documents: Record<HtmlDocumentName, () => ITimelineDocument> = {
    reference: () => htmlDocument('reference'), full: () => htmlDocument('full'),
    elastic: () => htmlDocument('elastic'), conflict: () => htmlDocument('conflict')
  };
  const context = (kind: HtmlSceneKind): IHtmlAnimationContext => htmlContextFor(kind);
  return {
    get current() { return currentHtml(); },
    documents, context,
    open: (options) => openHtml(options, track),
    seekRecords: (frames) => seekRecords(requireHandle(currentHtml()), frames),
    linearRecords: () => linearRecords(requireHandle(currentHtml())),
    playbackData: () => playbackData(requireHandle(currentHtml())),
    jsonRecords: (frames) => jsonRecords(requireHandle(currentHtml()), frames),
    scriptRecords: (frames) => scriptRecords(requireHandle(currentHtml()), frames),
    cssRecords: (frames) => cssRecords(requireHandle(currentHtml()), frames),
    resolvedRecords: (frames) => resolvedRecords(requireHandle(currentHtml()), frames),
    state: () => conflictState(requireHandle(currentHtml())),
    conflict: () => {
      const diagnostic = conflictDiagnostic(requireHandle(currentHtml()));
      return diagnostic === undefined ? undefined : JSON.parse(JSON.stringify(diagnostic)) as IHtmlResolutionDiagnostic;
    },
    resolve: (attempt): EditorTransactionResult => {
      const handle = requireHandle(currentHtml());
      lastRequest = conflictRequest(handle, attempt);
      return handle.editor.transactions.resolveHtmlConflict(lastRequest);
    },
    retryLastResolution: (): EditorTransactionResult => {
      if (lastRequest === undefined) throw new Error('Aucune confirmation à rejouer.');
      return requireHandle(currentHtml()).editor.transactions.resolveHtmlConflict(lastRequest);
    }
  };
}
