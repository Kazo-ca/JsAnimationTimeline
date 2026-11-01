// packages/export-css/src/continuous/target.ts
import { composeHtmlDeclarations, evaluatePropertyTimeline } from '@kazo-ca/timeline-runtime';
import type { IHtmlResolvedBinding, PropertyDescriptor, TimelinePropertyValue } from '@kazo-ca/timeline-runtime';
import type { IHtmlCssTarget, IHtmlCssTrajectory } from './htmlScene';
import { analyzeTimeline, ContinuousCssError, timelineTiming } from './timeline';
import type { IContinuousTimeline } from './timeline';

export interface IContinuousCssFrame { readonly frame: number; readonly value: string; readonly timing: string }
export interface IContinuousCssAnimation { readonly property: string; readonly frames: readonly IContinuousCssFrame[] }
interface IAnalyzedTrajectory { readonly trajectory: IHtmlCssTrajectory; readonly plan: IContinuousTimeline }

const LENGTH_PROPERTIES = new Set(['left', 'right', 'top', 'bottom', 'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
  'margin-left', 'margin-right', 'margin-top', 'margin-bottom', 'padding-left', 'padding-right', 'padding-top', 'padding-bottom',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width', 'font-size', 'letter-spacing', 'word-spacing',
  'outline-width', 'outline-offset', 'column-gap', 'row-gap', 'text-indent']);
const HELD_PROPERTIES = new Set([...LENGTH_PROPERTIES, 'opacity', 'visibility', 'color', 'background-color', 'background-image',
  'border-color', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color',
  'border-style', 'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style', 'outline-style',
  'font-style', 'font-family', 'font-weight', 'line-height', 'text-align', 'text-decoration-color', 'transform', 'z-index']);

function destination(trajectory: IHtmlCssTrajectory): string {
  const { binding } = trajectory.binding;
  if (binding.kind === 'spatial') return binding.component === 'pivotX' || binding.component === 'pivotY' ? 'transform-origin' : 'transform';
  return binding.kind === 'style' ? binding.cssName : binding.kind === 'transform' ? 'transform' : 'background-image';
}

function continuousDescriptor(trajectory: IHtmlCssTrajectory): PropertyDescriptor | undefined {
  const { binding } = trajectory.binding;
  const transitioning = (trajectory.timeline.transitions?.length ?? 0) > 0;
  if (binding.kind === 'gradient') {
    if (transitioning) throw new ContinuousCssError('unsupported-gradient-interpolation', 'Une transition de dégradé ne peut pas être reproduite fidèlement par cet export CSS.');
    return trajectory.descriptor;
  }
  if (binding.kind === 'transform') return trajectory.descriptor;
  if (binding.kind === 'spatial') {
    if (binding.component === 'sourceTransform' && transitioning) {
      throw new ContinuousCssError('unsupported-spatial-source-interpolation', 'La transformation source doit rester une piste de valeurs maintenues. Utilisez JavaScript ou JSON.');
    }
    return trajectory.descriptor;
  }
  if (!HELD_PROPERTIES.has(binding.cssName) || transitioning && binding.cssName !== 'opacity' && !LENGTH_PROPERTIES.has(binding.cssName)) {
    throw new ContinuousCssError('unsupported-css-destination', `La destination « ${binding.cssName} » ne possède pas d'interpolation CSS vérifiée dans cet export.`);
  }
  if (!transitioning) return trajectory.descriptor;
  if ((binding.unit ?? '') !== (binding.cssName === 'opacity' ? '' : 'px')) {
    throw new ContinuousCssError('unsupported-css-unit', `L'unité de « ${binding.cssName} » n'est pas prise en charge pour un export CSS continu.`);
  }
  const descriptor: PropertyDescriptor = trajectory.descriptor ?? { name: trajectory.property, kind: 'value', unit: '', defaultValue: 0 };
  if (binding.cssName === 'opacity') return { ...descriptor, min: Math.max(0, descriptor.min ?? 0), max: Math.min(1, descriptor.max ?? 1) };
  if (/^(?:min-|max-)?(?:width|height)$|^padding-|^border-.*-width$|^font-size$|^outline-width$|^(?:column|row)-gap$/.test(binding.cssName)) {
    return { ...descriptor, min: Math.max(0, descriptor.min ?? 0) };
  }
  return descriptor;
}

function analyze(trajectory: IHtmlCssTrajectory, totalFrames: number): IAnalyzedTrajectory {
  try { return { trajectory, plan: analyzeTimeline(trajectory.timeline, totalFrames, continuousDescriptor(trajectory)) }; }
  catch (error) {
    if (error instanceof ContinuousCssError) throw new ContinuousCssError(error.code, error.message, error.fromFrame, error.toFrame, trajectory.layerId, trajectory.property);
    throw error;
  }
}

function sample(item: IAnalyzedTrajectory, frame: number, totalFrames: number): TimelinePropertyValue {
  return evaluatePropertyTimeline(item.trajectory.timeline, Math.min(frame, totalFrames), item.trajectory.descriptor);
}

function segmentTiming(items: readonly IAnalyzedTrajectory[], from: number, to: number, totalFrames: number): string {
  const changing = items.filter((item) => JSON.stringify(sample(item, from, totalFrames)) !== JSON.stringify(sample(item, to, totalFrames)));
  const timings = [...new Set(changing.map((item) => timelineTiming(item.plan, from, to)))];
  if (timings.length > 1) throw new ContinuousCssError('incompatible-transform-timing', 'Les composantes de cette transformation utilisent des courbes ou maintiens incompatibles dans une animation CSS.', from, to);
  return timings[0] ?? 'steps(1, end)';
}

function composeFrame(target: IHtmlCssTarget, items: readonly IAnalyzedTrajectory[], frame: number, property: string, totalFrames: number): string {
  const values: Record<string, TimelinePropertyValue> = {};
  const bindings: Record<string, IHtmlResolvedBinding> = {};
  items.forEach((item, index) => { values[`value-${index}`] = sample(item, frame, totalFrames); bindings[`value-${index}`] = item.trajectory.binding; });
  const composition = composeHtmlDeclarations(target.element, values, bindings, target.gradients, target.transformBase, target.spatial);
  const result = composition.declarations[property];
  if (composition.diagnostics.length > 0 || result === undefined) {
    throw new ContinuousCssError('invalid-css-value', composition.diagnostics[0]?.reason ?? `La déclaration « ${property} » ne peut pas être composée.`);
  }
  if (/[{};<]/.test(result) || result.includes('/*') || result.includes('*/')) throw new ContinuousCssError('unsafe-css-value', 'Cette valeur ne peut pas être intégrée dans une feuille de style exportée.');
  return result;
}

/** One animation per destination keeps independent property timings independent. */
export function compileContinuousTarget(target: IHtmlCssTarget, totalFrames: number, maxKeyframes = 10_000): readonly IContinuousCssAnimation[] {
  const destinations = new Map<string, IAnalyzedTrajectory[]>();
  target.trajectories.forEach((trajectory) => {
    const name = destination(trajectory);
    destinations.set(name, [...(destinations.get(name) ?? []), analyze(trajectory, totalFrames)]);
  });
  let count = 0;
  return [...destinations].map(([property, items]) => {
    const frames = [...new Set(items.flatMap((item) => item.plan.frames))].sort((a, b) => a - b);
    count += frames.length;
    if (count > maxKeyframes) throw new ContinuousCssError('resource-limit', 'La feuille de style dépasse la limite de clés CSS. Utilisez JavaScript ou JSON.');
    return { property, frames: frames.map((frame, index) => ({ frame,
      value: composeFrame(target, items, frame, property, totalFrames),
      timing: index === frames.length - 1 ? 'steps(1, end)' : segmentTiming(items, frame, frames[index + 1], totalFrames)
    })) };
  });
}
