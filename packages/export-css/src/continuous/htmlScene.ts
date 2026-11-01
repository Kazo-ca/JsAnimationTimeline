// packages/export-css/src/continuous/htmlScene.ts
import { resolveHtmlSpatialBindings, withPreparedHtmlExport, type HtmlTransformValues, type IHtmlGradientDefinition,
  type IHtmlSpatialDefinition,
  type IHtmlResolvedBinding, type IHtmlResolvedTrajectory, type IPreparedHtmlExport,
  type IPropertyTimeline, type ITimelineDocument, type PlaybackResult, type PropertyDescriptor,
  type PropertyRegistry } from '@kazo-ca/timeline-runtime';
import type { IExportHtmlCssOptions } from '../htmlTypes';
import { assertCssCascade, collectCssRules } from './htmlCascade';
import { groupCssTargets, htmlExportScope } from './htmlTargets';
import { HtmlCssSceneError } from './htmlErrors';

export interface IHtmlCssTrajectory {
  readonly layerId: string;
  readonly property: string;
  readonly binding: IHtmlResolvedBinding;
  readonly timeline: IPropertyTimeline;
  readonly descriptor?: PropertyDescriptor;
}
export interface IHtmlCssTarget {
  readonly selector: string;
  readonly element: Element;
  readonly trajectories: readonly IHtmlCssTrajectory[];
  readonly transformBase?: HtmlTransformValues;
  readonly gradients: readonly IHtmlGradientDefinition[];
  readonly spatial?: readonly IHtmlSpatialDefinition[];
  /** Original capture records remain part of target grouping after physical composition remapping. */
  readonly spatialSources?: readonly { readonly layerId: string; readonly property: string; readonly definition: IHtmlSpatialDefinition }[];
}
export interface IHtmlCssScene {
  readonly document: ITimelineDocument;
  readonly registry: PropertyRegistry;
  readonly existingKeyframeNames: readonly string[];
  readonly targets: readonly IHtmlCssTarget[];
}

function trajectory(source: IHtmlResolvedTrajectory): IHtmlCssTrajectory {
  if (source.timeline === undefined) throw new HtmlCssSceneError('unsupported-legacy-track',
    'Convertissez les pistes historiques en pistes de propriétés avant cet export CSS continu.', source.layerId, source.property);
  if (source.before?.policy === 'underlying') throw new HtmlCssSceneError('unsupported-priority-switch',
    'Le changement de règle sous-jacente avant la première clé ne possède pas encore de représentation CSS continue vérifiée.', source.layerId, source.property);
  return { layerId: source.layerId, property: source.property, binding: source.binding, descriptor: source.descriptor,
    timeline: { ...source.timeline, ...(source.before?.policy === 'first-key' ? { beforeFirst: 'first-key' as const } : {}) } };
}

function visibility(prepared: IPreparedHtmlExport, element: Element): IHtmlCssTrajectory | undefined {
  const owners = prepared.layers.filter((layer) => layer.elements.includes(element) && layer.layer.spans.length > 0);
  const managed = owners.filter(({ layer }) => layer.spans.some((span) => span.kind === 'blank') ||
    layer.spans[layer.spans.length - 1].end < prepared.document.settings.totalFrames);
  if (managed.length === 0) return undefined;
  const frames = new Set([1]);
  for (const { layer } of managed) for (const span of layer.spans) {
    frames.add(span.start);
    if (span.end < prepared.document.settings.totalFrames) frames.add(span.end + 1);
  }
  const keys = [...frames].sort((a, b) => a - b).map((frame) => ({ frame, value: { kind: 'text' as const,
    value: managed.some(({ layer }) => !layer.spans.some((span) => span.start <= frame && span.end >= frame && span.kind !== 'blank')) ? 'hidden' : 'visible' } }));
  return { layerId: managed[0].layerId, property: 'visibility', binding: { valueKind: 'text', binding: { kind: 'style', cssName: 'visibility' } },
    timeline: { initialValue: keys[0].value, keys } };
}

/** Exact provenance, source cascade and stable selectors are established before producing CSS. */
export function prepareHtmlCssScene(document: ITimelineDocument, options: IExportHtmlCssOptions): PlaybackResult<IHtmlCssScene> {
  const outer = withPreparedHtmlExport(document, options, (prepared): PlaybackResult<IHtmlCssScene> => {
    try {
      const scope = htmlExportScope(options.root, options.rootSelector);
      const rules = collectCssRules(scope.document);
      const targets = prepared.trajectories.map((entry): IHtmlCssTarget => {
        const trajectories = entry.properties.map(trajectory);
        const visible = visibility(prepared, entry.element);
        if (visible !== undefined) {
          if (trajectories.some((item) => item.binding.binding.kind === 'style' && item.binding.binding.cssName === 'visibility')) {
            throw new HtmlCssSceneError('unsupported-visibility-composition', 'La visibilité des plages et une piste visibility ne peuvent pas être composées fidèlement dans cet export.');
          }
          trajectories.push(visible);
        }
        const gradients = [...new Map(trajectories.flatMap((item) => prepared.context.gradients?.[item.layerId] ?? []).map((gradient) => [gradient.id, gradient])).values()];
        const spatial = resolveHtmlSpatialBindings(prepared.context, trajectories);
        const spatialSources = trajectories.flatMap((item) => {
          const binding = item.binding.binding;
          if (binding.kind !== 'spatial') return [];
          const definition = prepared.context.spatial?.[item.layerId]?.find((source) => source.id === binding.projectionId);
          return definition === undefined ? [] : [{ layerId: item.layerId, property: item.property, definition }];
        });
        assertCssCascade(entry.element, trajectories.map((item) => item.binding.binding.kind === 'style' ? item.binding.binding.cssName :
          item.binding.binding.kind === 'gradient' ? 'background-image' : item.binding.binding.kind === 'spatial' &&
            (item.binding.binding.component === 'pivotX' || item.binding.binding.component === 'pivotY') ? 'transform-origin' : 'transform'), rules);
        return { selector: '', element: entry.element, trajectories: trajectories.map((item, index) => ({ ...item, binding: spatial.bindings[index] })),
          gradients, spatial: spatial.definitions, spatialSources, transformBase: prepared.transformBases.get(entry.element) };
      });
      const selectors = [...new Set(prepared.layers.map((layer) => 'selector' in layer.target ? layer.target.selector : ''))];
      return { status: 'exported', data: { document: prepared.document, registry: prepared.registry, existingKeyframeNames: rules.keyframeNames,
        targets: groupCssTargets(options.root, scope.selector, selectors, targets, options.selectorForElement) }, diagnostics: [] };
    } catch (error) {
      return { status: 'refused', diagnostics: [{ code: error instanceof HtmlCssSceneError ? error.code : 'html-export-refused',
        message: error instanceof Error ? error.message : 'La scène HTML ne peut pas être exportée.',
        ...(error instanceof HtmlCssSceneError ? { layerId: error.layerId, property: error.property } : {}) }] };
    }
  });
  return outer.status === 'refused' ? outer : outer.data;
}
