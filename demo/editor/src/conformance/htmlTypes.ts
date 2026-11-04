// demo/editor/src/conformance/htmlTypes.ts
import type { EditorTransactionResult } from '@kazo-ca/timeline-editor';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic, IHtmlStage, ITimelineDocument } from '@kazo-ca/timeline-runtime';
import type { HtmlDocumentName, HtmlSceneKind, HtmlSceneSnapshot } from './scenes/html';
import type { IConformanceHandle } from './types';

/** An editor on a live HTML scene: the default UI plugins, an HTML stage in frame mode and a manual clock. */
export interface IHtmlHandle extends IConformanceHandle {
  readonly handleKind: 'html';
  readonly stage: IHtmlStage;
  readonly scene: HTMLElement;
  readonly kind: HtmlSceneKind;
  /** Replaces the layer selection (an editor-only state) and returns the resulting selection. */
  selectLayers(ids: readonly string[]): readonly string[];
}

export interface IHtmlOpenOptions {
  readonly scene: HtmlSceneKind;
  /** A frozen document by name, or a document saved earlier (for example after a JSON round-trip). */
  readonly document: HtmlDocumentName | ITimelineDocument;
  /** Saved HTML context; the frozen context of the scene when absent. */
  readonly context?: IHtmlAnimationContext;
}

/** What each output shows, per frame; the frame is the key. */
export interface IRecordedFrames {
  readonly records: Readonly<Record<string, HtmlSceneSnapshot>>;
  /** Frames in the order they were recorded. */
  readonly frames: readonly number[];
}

export interface IRefusedOutput {
  readonly status: 'refused';
  readonly css: string;
  readonly alternatives: readonly string[];
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly [field: string]: unknown }[];
}

export interface ITrackedOutput<T> {
  readonly status: 'exported';
  readonly data: T;
  readonly diagnostics: readonly unknown[];
}

/** A confirmation of an HTML priority conflict, as the dialog would send it. */
export interface IConflictAttempt {
  readonly winner: string;
  /** Announced key (opacity of the winner), created only with the decision. */
  readonly key?: { readonly frame: number; readonly value: number };
  /** The host guard answers false: the confirmation expired before it was applied. */
  readonly expired?: boolean;
}

/** Everything a confirmation may change, as plain JSON. */
export interface IConflictState {
  readonly document: ITimelineDocument;
  readonly context: IHtmlAnimationContext;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly blocking: readonly string[];
  readonly events: number;
}

export type ITrackFn = <T extends IConformanceHandle>(handle: T) => T;

export interface IHtmlConformance {
  /** Most recent HTML editor opened by `open`. */
  readonly current: IHtmlHandle | undefined;
  readonly documents: Readonly<Record<HtmlDocumentName, () => ITimelineDocument>>;
  context(kind: HtmlSceneKind): IHtmlAnimationContext;
  open(options: IHtmlOpenOptions): IHtmlHandle;
  /** Direct seeks on the live preview, one read per frame. */
  seekRecords(frames: readonly number[]): IRecordedFrames;
  /** Linear playback on the manual clock, one read per frame from 1 to the last. */
  linearRecords(): IRecordedFrames;
  /** `compileHtmlPlayback` output as plain JSON, or its refusal. */
  playbackData(): ITrackedOutput<unknown> | IRefusedOutput;
  /** `compileHtmlPlayback` + `parseHtmlPlayback` + player, on a fresh copy of the scene. */
  jsonRecords(frames: readonly number[]): Promise<IRecordedFrames | IRefusedOutput>;
  /** `exportHtmlJavascript` imported from a Blob URL, on a fresh copy of the scene. */
  scriptRecords(frames: readonly number[]): Promise<IRecordedFrames | IRefusedOutput>;
  /** `exportHtmlCss` with paused animations of a fresh copy of the scene. */
  cssRecords(frames: readonly number[]): Promise<(IRecordedFrames & { readonly css: string }) | IRefusedOutput>;
  /** Resolution engine values at any frame, the reference of the continuous CSS. */
  resolvedRecords(frames: readonly number[]): IRecordedFrames;
  /** Document, saved HTML context, history flags, blocking diagnostics and event count. */
  state(): IConflictState;
  /** The blocking priority conflict of the stage, if any. */
  conflict(): IHtmlResolutionDiagnostic | undefined;
  /** `editor.transactions.resolveHtmlConflict` with a fresh ticket; the ticket is kept for `retryLastResolution`. */
  resolve(attempt: IConflictAttempt): EditorTransactionResult;
  /** Sends the previous ticket again, unchanged. */
  retryLastResolution(): EditorTransactionResult;
}
