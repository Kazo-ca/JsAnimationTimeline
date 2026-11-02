// packages/runtime/src/stage/html/createHtmlStage.ts
/**
 * Scène HTML, scène par défaut du lecteur : anime les éléments sous `root`.
 * - Mode `waapi` (défaut du lecteur) : Web Animations, réalignées sur `sync`.
 * - Mode `frame` (défaut de l'éditeur) : styles en ligne écrits à chaque
 *   `render` par le même `computeCssDeclarations`.
 * Aux images entières, les deux modes donnent les mêmes styles. Entre deux
 * images, un calque échantillonné image par image (accélération avec images
 * clés au milieu, interpolateur personnalisé, bornes) peut différer en mode
 * `waapi`, parce que le navigateur interpole en ligne droite entre deux
 * échantillons, alors que le mode `frame` évalue la courbe exacte.
 * Cibles : `{ selector }`, `{ element }` et `{ ref, stage: 'html' }` (jamais
 * un `{ ref }` sans `stage`, qui appartient aux autres scènes).
 */

import type { ITimelineDocument } from '../../model/document';
import { isRefTarget } from '../../model/guards';
import type { LayerTarget } from '../../model/target';
import type { PropertyRegistry } from '../../properties/PropertyRegistry';
import { defaultPropertyRegistry } from '../../properties/PropertyRegistry';
import { StageReportCodes } from '../reports';
import { sameTarget } from '../routing';
import type { IStage, IStageContext, IStageLayer, IStageLayerState, IStageTargets } from '../types';
import { HtmlElements } from './elements';
import type { HtmlStageRefs } from './elements';
import { InlineStyleKeeper, writeFrameStyles } from './inlineStyles';
import { assertHtmlLayerSupported, needsVisibility } from './keyframes';
import { WaapiAnimations } from './waapi';
import { HtmlAnimationRenderer } from './animationRenderer';
import { registerHtmlStageAtomicAccess } from './atomicAccess';
import type { IHtmlAnimationContext, IHtmlResolutionDiagnostic } from './animationTypes';
import type { IHtmlInspectPropertyOptions, IHtmlPropertyInspection } from './propertyInspection';
import type { ITransportTime, ITransportSyncState } from '../../transport/types';

/** Id of the HTML stage. */
export const HTML_STAGE_ID = 'html';

/** `waapi`: Web Animations; `frame`: inline styles written on every render. */
export type HtmlStageMode = 'waapi' | 'frame';

/** Options of `createHtmlStage`. */
export interface IHtmlStageOptions {
  /** Where selectors and `[data-timeline-target]` are looked up. Defaults to `document`. */
  readonly root?: ParentNode;
  /** Defaults to `waapi`. */
  readonly mode?: HtmlStageMode;
  /** Subtrees never targeted nor listed (e.g. the editor's own container). */
  readonly exclude?: Element | readonly Element[];
  /** Elements of `{ ref, stage: 'html' }` targets, by ref. */
  readonly refs?: HtmlStageRefs;
  /** Additional exclusion predicate, applied to every selector match and explicit target. */
  readonly excludeElement?: (element: Element) => boolean;
  /** Serializable HTML bindings, gradients and explicit conflict decisions. */
  readonly animationContext?: IHtmlAnimationContext;
}

/** Inspection for a host that owns its preview renderer. No styles or Web Animations are written. */
export interface IHtmlInspectionStageOptions extends Omit<IHtmlStageOptions, 'mode'> {
  /** Temporarily expose original source styles for each synchronous metadata read, then restore host preview. */
  readonly preserveSource?: <T>(read: () => T) => T;
}

/** Creates a full HTML metadata/context participant without taking ownership of the host's rendering. */
export function createHtmlInspectionStage(options: IHtmlInspectionStageOptions = {}): IHtmlStage {
  return createHtmlStageCore({ ...options, mode: 'frame' }, options.preserveSource ?? ((read) => read()));
}

/** The HTML stage. */
export interface IHtmlStage extends IStage<Element> {
  readonly mode: HtmlStageMode;
  /** Modern tracks and selector groups use exact per-frame evaluation in either requested mode. */
  readonly effectiveMode: HtmlStageMode;
  readonly targets: IStageTargets;
  resolveElements(target: LayerTarget): readonly Element[];
  readonly animationContext: IHtmlAnimationContext;
  readonly diagnostics: readonly IHtmlResolutionDiagnostic[];
  setAnimationContext(context: IHtmlAnimationContext): void;
  inspectProperty(target: LayerTarget, property: string, options?: IHtmlInspectPropertyOptions): IHtmlPropertyInspection;
  /** Refresh group membership and original CSS after the host changes the source document. */
  refresh(): void;
  /** Synchronous source edits run with owned preview declarations suspended, then recapture their bases. */
  withSourceStyles<T>(action: () => T): T;
  /**
   * Binds `ref` to `element` (`null` unbinds). Failed resolutions are
   * retried, and the layers already on `{ ref, stage: 'html' }` move to the
   * new element (the old one gets its styles back), or go to
   * `missingTargets` when the ref no longer resolves.
   */
  bind(ref: string, element: Element | null): void;
}

function acceptsHtml(target: LayerTarget): boolean {
  return isRefTarget(target) ? target.stage === HTML_STAGE_ID : true;
}

function assertMode(mode: unknown): asserts mode is HtmlStageMode {
  if (mode !== 'waapi' && mode !== 'frame') {
    throw new Error(`The HTML stage mode must be "waapi" or "frame" (got ${String(mode)}).`);
  }
}

/** Shared state of one HTML stage. */
interface IHtmlStageCore {
  readonly elements: HtmlElements;
  readonly listeners: Set<(affected?: readonly LayerTarget[]) => void>;
  ctx: IStageContext | null;
}

function registryOf(core: IHtmlStageCore): PropertyRegistry {
  return core.ctx?.registry ?? defaultPropertyRegistry;
}

/** Reports every layer after the first one on the same element. */
function reportDuplicates(core: IHtmlStageCore, layers: readonly IStageLayer<Element>[]): void {
  const seen = new Set<Element>();
  for (const { layerId, object } of layers) {
    if (seen.has(object)) {
      core.ctx?.report({
        code: StageReportCodes.DUPLICATE_TARGET,
        layerId,
        message: `Layer "${layerId}" animates an element already animated by another layer.`
      });
    }
    seen.add(object);
  }
}

function createTargets(core: IHtmlStageCore): IStageTargets {
  return {
    list: () => core.elements.list(),
    describe: (target) => {
      const element = core.elements.resolve(target);
      if (element === null) {
        return undefined;
      }
      return core.elements.list().find((info) => sameTarget(info.target, target)) ?? { target, label: element.id || element.tagName.toLowerCase(), group: 'HTML' };
    },
    subscribe: (onChange) => {
      core.listeners.add(onChange);
      return () => {
        core.listeners.delete(onChange);
      };
    }
  };
}

function createWaapiStage(core: IHtmlStageCore, base: IStage<Element>): IStage<Element> {
  const animations = new WaapiAnimations();
  return {
    ...base,
    update(doc: ITimelineDocument, layers: readonly IStageLayer<Element>[]): void {
      layers.forEach(({ layer }) => assertHtmlLayerSupported(layer));
      animations.rebuild(doc, layers, registryOf(core));
      reportDuplicates(core, layers);
    },
    sync: (time, state) => animations.sync(time, state),
    release: (layerId, element) => animations.release(layerId, element),
    detach: () => {
      animations.cancel();
      core.ctx = null;
    }
  };
}

function createFrameStage(core: IHtmlStageCore, base: IStage<Element>): IStage<Element> {
  const keeper = new InlineStyleKeeper();
  const hiddenByEditor = new Set<Element>();
  let managed = new Map<string, boolean>();
  /** Element held for each layer: acquired by `update`, given back by `release` or when the layer leaves. */
  let held = new Map<string, Element>();
  return {
    ...base,
    update(doc: ITimelineDocument, layers: readonly IStageLayer<Element>[]): void {
      layers.forEach(({ layer }) => assertHtmlLayerSupported(layer));
      // Styles of the previous document go away (tracks or visibility no longer animated); render rewrites the rest.
      keeper.restoreOriginals();
      hiddenByEditor.clear();
      const next = new Map(layers.map(({ layerId, object }) => [layerId, object]));
      // Acquire before releasing, so an element kept by another layer is not restored in between.
      next.forEach((element, layerId) => {
        if (held.get(layerId) !== element) {
          keeper.acquire(element);
        }
      });
      held.forEach((element, layerId) => {
        if (next.get(layerId) !== element) {
          keeper.release(element);
        }
      });
      held = next;
      managed = new Map(layers.map(({ layerId, layer }) => [layerId, needsVisibility(layer, doc.settings.totalFrames)]));
      reportDuplicates(core, layers);
    },
    render(_time, states: readonly IStageLayerState<Element>[]): void {
      const registry = registryOf(core);
      for (const state of states) {
        // A late target resolution can report a refused update without rolling back the host.
        // Only layers accepted by the last successful update may write to held elements.
        if (held.get(state.layerId) !== state.object) continue;
        writeFrameStyles(keeper, state.object, state.values, registry, {
          managed: managed.get(state.layerId) === true,
          active: state.active,
          editorVisible: state.editorVisible,
          hiddenByEditor
        });
      }
    },
    release(layerId: string, element: Element): void {
      if (held.get(layerId) !== element) {
        return;
      }
      held = new Map(Array.from(held).filter(([id]) => id !== layerId));
      keeper.release(element);
      if (keeper.count(element) === 0) {
        hiddenByEditor.delete(element);
      }
    },
    detach(): void {
      keeper.restoreAll();
      held = new Map();
      hiddenByEditor.clear();
      core.ctx = null;
    }
  };
}

/** Creates an HTML stage; see `IHtmlStageOptions`. */
export function createHtmlStage(options: IHtmlStageOptions = {}): IHtmlStage {
  return createHtmlStageCore(options);
}

function createHtmlStageCore(options: IHtmlStageOptions, inspectOnly?: <T>(read: () => T) => T): IHtmlStage {
  const mode = options.mode ?? 'waapi';
  assertMode(mode);
  const core: IHtmlStageCore = {
    elements: new HtmlElements(options.root ?? document, HTML_STAGE_ID, options.exclude, options.refs, options.excludeElement),
    listeners: new Set(),
    ctx: null
  };
  const base: IStage<Element> = {
    id: HTML_STAGE_ID,
    targets: createTargets(core),
    accepts: acceptsHtml,
    resolve: (target) => core.elements.resolve(target),
    attach: (ctx) => {
      core.ctx = ctx;
    }
  };
  const legacy = mode === 'waapi' ? createWaapiStage(core, base) : createFrameStage(core, base);
  const modern = new HtmlAnimationRenderer(core.elements, () => registryOf(core), options.animationContext, inspectOnly);
  let exact = false;
  let last: { doc: ITimelineDocument; layers: readonly IStageLayer<Element>[] } | undefined;
  let lastTime: ITransportTime = { frame: 1, integerFrame: 1, timeMs: 0 };
  let lastSync: ITransportSyncState = { playing: false, speed: 1 };
  let lastStates: readonly IStageLayerState<Element>[] = [];
  let sourceReads = 0;
  let sourceEdits = 0;
  let revision = 0;
  let mutationGuard = (): void => {};
  const notify = (targets?: readonly LayerTarget[]): void => Array.from(core.listeners).forEach((listener) => listener(targets));
  const useExact = (layers: readonly IStageLayer<Element>[]): boolean => inspectOnly !== undefined || options.animationContext !== undefined ||
    Object.keys(modern.animationContext.bindings ?? {}).length > 0 || layers.some(({ layer, target }) =>
      Object.keys(layer.propertyTimelines ?? {}).length > 0 || core.elements.resolveElements(target).length > 1);
  const targets = createTargets(core);
  const inspectSource = <T>(read: () => T): T => {
    if (exact || last === undefined || sourceReads > 0) return read();
    const snapshot = last;
    const ctx = core.ctx;
    sourceReads++;
    legacy.detach?.(); core.ctx = ctx;
    try { return read(); }
    finally {
      sourceReads--;
      if (last === snapshot && !exact) {
        legacy.update?.(snapshot.doc, snapshot.layers); legacy.sync?.(lastTime, lastSync); legacy.render?.(lastTime, lastStates);
      }
    }
  };
  const stage: IHtmlStage = {
    ...base,
    mode,
    get effectiveMode() { return exact ? 'frame' : mode; },
    get animationContext() { return modern.animationContext; },
    get diagnostics() { return modern.diagnostics; },
    targets: { ...targets, describe(target) {
      const info = targets.describe?.(target);
      return info === undefined || !exact ? info : { ...info, properties: modern.properties(target) };
    } },
    resolveElements: (target) => core.elements.resolveElements(target),
    inspectProperty: (target, property, inspectOptions) => inspectSource(() => modern.inspect(target, property, inspectOptions)),
    setAnimationContext(context) {
      mutationGuard();
      modern.setContext(context);
      revision++;
      if (last !== undefined) notify(last.layers.map((layer) => layer.target));
    },
    refresh() {
      mutationGuard();
      revision++;
      inspectSource(() => modern.refresh());
      notify(last?.layers.map((layer) => layer.target));
    },
    withSourceStyles(action) {
      mutationGuard();
      revision++;
      sourceEdits++;
      try { return inspectSource(() => modern.withSourceStyles(action)); }
      finally { if (--sourceEdits === 0) notify(last?.layers.map((layer) => layer.target)); }
    },
    bind(ref, element) {
      mutationGuard();
      revision++;
      core.elements.bind(ref, element);
      notify([{ ref, stage: HTML_STAGE_ID }]);
    },
    update(doc, layers) {
      const nextExact = useExact(layers);
      if (nextExact === exact) {
        if (exact) modern.update(doc, layers); else legacy.update?.(doc, layers);
      } else {
        const ctx = core.ctx;
        if (exact) modern.detach(); else legacy.detach?.();
        core.ctx = ctx;
        try {
          if (nextExact) modern.update(doc, layers); else legacy.update?.(doc, layers);
        } catch (error) {
          if (nextExact) modern.detach(); else legacy.detach?.();
          core.ctx = ctx;
          if (last !== undefined) {
            if (exact) { modern.update(last.doc, last.layers); modern.render(lastTime.frame, lastStates); }
            else { legacy.update?.(last.doc, last.layers); legacy.sync?.(lastTime, lastSync); legacy.render?.(lastTime, lastStates); }
          }
          throw error;
        }
        exact = nextExact;
      }
      last = { doc, layers };
    },
    sync(time, state) { lastTime = time; lastSync = state; if (!exact) legacy.sync?.(time, state); },
    render(time, states) {
      lastTime = time; lastStates = states;
      if (exact) modern.render(time.frame, states); else if (sourceReads === 0) legacy.render?.(time, states);
    },
    release(layerId, element) { if (exact) modern.release(layerId); else legacy.release?.(layerId, element); },
    detach() { modern.detach(); legacy.detach?.(); last = undefined; lastStates = []; exact = false; }
  };
  registerHtmlStageAtomicAccess(stage, {
    get revision() { return revision; },
    get context() { return modern.animationContext; },
    installContext(context) { modern.installContext(context); revision++; },
    inspect: (doc, context, layerId, property, kind) => inspectSource(() => modern.inspectCandidate(doc, context, layerId, property, kind)),
    validate: (doc, context) => inspectSource(() => modern.validateCandidate(doc, context)),
    source: (action) => inspectOnly === undefined ? inspectSource(() => modern.withSourceStyles(action)) : action(),
    readSource: (read) => inspectOnly === undefined ? inspectSource(() => modern.withSourceStyles(read)) : inspectOnly(read),
    guard: (check) => { mutationGuard = check; }
  });
  return stage;
}
