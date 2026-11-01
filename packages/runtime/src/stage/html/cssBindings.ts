// packages/runtime/src/stage/html/cssBindings.ts
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { PropertyRegistry } from '../../properties/PropertyRegistry';
import type { HtmlGradientComponent, HtmlPropertyBinding, HtmlReadResult, HtmlTransformComponent, IHtmlResolvedBinding } from './cssTypes';
import { isHtmlSpatialBinding } from './spatial';

const TRANSFORMS: readonly HtmlTransformComponent[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'];
const GEOMETRY: readonly HtmlGradientComponent[] = ['type', 'angle', 'centerX', 'centerY', 'radiusX', 'radiusY'];
const STOP_COMPONENTS: readonly HtmlGradientComponent[] = ['color', 'position', 'opacity', 'present'];
const UNITS = new Set(['', 'px', '%', 'em', 'rem', 'ex', 'ch', 'lh', 'rlh', 'cap', 'ic', 'rex', 'rch', 'rcap', 'ric',
  'vw', 'vh', 'vmin', 'vmax', 'vi', 'vb', 'svw', 'svh', 'svmin', 'svmax', 'svi', 'svb',
  'lvw', 'lvh', 'lvmin', 'lvmax', 'lvi', 'lvb', 'dvw', 'dvh', 'dvmin', 'dvmax', 'dvi', 'dvb',
  'cm', 'mm', 'q', 'in', 'pt', 'pc', 'deg', 'grad', 'rad', 'turn', 's', 'ms']);
const CSS_NAME = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|--[a-zA-Z_][a-zA-Z0-9_-]*)$/;
const UNSAFE_PROPERTIES = new Set(['all', 'behavior', '-moz-binding']);

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}
function identity(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }

/** Reject declaration blocks and broad resets; each binding owns exactly one CSS destination. */
export function isHtmlCssPropertyName(value: unknown): value is string {
  return typeof value === 'string' && CSS_NAME.test(value) && !UNSAFE_PROPERTIES.has(value);
}

export function isHtmlPropertyBinding(value: unknown): value is HtmlPropertyBinding {
  if (!record(value)) return false;
  if (value.kind === 'spatial') return isHtmlSpatialBinding(value);
  if (value.kind === 'style') return keys(value, ['kind', 'cssName', 'unit']) && isHtmlCssPropertyName(value.cssName)
    && (value.unit === undefined || typeof value.unit === 'string' && UNITS.has(value.unit));
  if (value.kind === 'transform') return keys(value, ['kind', 'component']) && TRANSFORMS.includes(value.component as HtmlTransformComponent);
  if (value.kind !== 'gradient' || !keys(value, ['kind', 'gradientId', 'component', 'stopId']) || !identity(value.gradientId)) return false;
  return GEOMETRY.includes(value.component as HtmlGradientComponent) ? value.stopId === undefined
    : STOP_COMPONENTS.includes(value.component as HtmlGradientComponent) && identity(value.stopId);
}

/** Tuple encoding avoids aliases caused by punctuation in stable ids. */
export function htmlBindingDestination(binding: HtmlPropertyBinding): string {
  if (binding.kind === 'style') return JSON.stringify(['style', binding.cssName]);
  if (binding.kind === 'transform') return JSON.stringify(['transform', binding.component]);
  if (binding.kind === 'spatial') return JSON.stringify(['spatial', binding.component]);
  return JSON.stringify(['gradient', binding.gradientId, binding.stopId ?? '', binding.component]);
}

export function htmlGradientValueKind(component: HtmlGradientComponent): TimelinePropertyValue['kind'] {
  return component === 'present' ? 'boolean' : component === 'type' ? 'text' : component === 'color' ? 'color' : 'number';
}

/** Infer only a CSS association, never a baseline or a temporal value. */
export function resolveHtmlBinding(
  property: string, valueKind: TimelinePropertyValue['kind'], registry: PropertyRegistry, explicit?: HtmlPropertyBinding
): HtmlReadResult<IHtmlResolvedBinding> {
  let binding = explicit;
  if (binding === undefined) {
    const descriptor = registry.get(property);
    if (descriptor?.kind === 'value') return { status: 'unsupported', reason: `La propriété « ${property} » ne possède pas de destination CSS.` };
    if (descriptor?.kind === 'transform') {
      if (!TRANSFORMS.includes(property as HtmlTransformComponent)) return { status: 'unsupported', reason: `La transformation « ${property} » ne peut pas être composée avec sa base.` };
      binding = { kind: 'transform', component: property as HtmlTransformComponent };
    } else if (descriptor?.kind === 'style') binding = { kind: 'style', cssName: descriptor.cssName, unit: descriptor.unit };
    else binding = { kind: 'style', cssName: property };
  }
  if (!isHtmlPropertyBinding(binding)) return { status: 'unsupported', reason: `La destination CSS de « ${property} » est invalide.` };
  const expected = binding.kind === 'transform' ? 'number' : binding.kind === 'spatial' ? binding.component === 'sourceTransform' ? 'text' : 'number'
    : binding.kind === 'gradient' ? htmlGradientValueKind(binding.component) : undefined;
  if (expected !== undefined && expected !== valueKind || binding.kind === 'style' && valueKind === 'boolean') {
    return { status: 'unsupported', reason: `Le type de « ${property} » est incompatible avec sa destination CSS.` };
  }
  return { status: 'value', value: { binding: { ...binding }, valueKind } };
}
