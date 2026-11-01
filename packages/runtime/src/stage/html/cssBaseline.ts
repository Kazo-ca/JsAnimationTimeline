// packages/runtime/src/stage/html/cssBaseline.ts
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { HtmlReadResult, HtmlTransformValues, IHtmlGradientDefinition, IHtmlResolvedBinding } from './cssTypes';
import { readHtmlTransform } from './cssTransform';
import { parseHtmlColor, parseHtmlNumber } from './cssValue';
import { readHtmlGradientValue } from './gradients';
import { isHtmlPropertyBinding } from './cssBindings';
import { readHtmlSpatialValue } from './spatial';
import type { IHtmlSpatialDefinition } from './spatialTypes';

/** Obtain effective styles in the element's realm; the caller must suspend owned preview writes first. */
export function readHtmlComputedStyle(element: Element): HtmlReadResult<CSSStyleDeclaration> {
  const view = element.ownerDocument.defaultView;
  if (view === null) return { status: 'unsupported', reason: 'Les styles effectifs sont indisponibles pour ce document.' };
  try { return { status: 'value', value: view.getComputedStyle(element) }; }
  catch { return { status: 'unsupported', reason: 'Les styles effectifs de cet élément ne peuvent pas être inspectés.' }; }
}

export function captureHtmlTransformBase(element: Element): HtmlReadResult<HtmlTransformValues> {
  const computed = readHtmlComputedStyle(element);
  if (computed.status !== 'value') return computed;
  return readHtmlTransform(computed.value.getPropertyValue('transform').trim());
}

export function readHtmlPropertyBase(
  element: Element, resolved: IHtmlResolvedBinding, gradients: readonly IHtmlGradientDefinition[] = [], spatial: readonly IHtmlSpatialDefinition[] = []
): HtmlReadResult<TimelinePropertyValue> {
  const { binding, valueKind } = resolved;
  if (!isHtmlPropertyBinding(binding)) return { status: 'unsupported', reason: 'La destination CSS est invalide.' };
  if (binding.kind === 'spatial') return readHtmlSpatialValue(binding, spatial);
  if (binding.kind === 'gradient') return readHtmlGradientValue(binding, gradients);
  if (binding.kind === 'transform') {
    const base = captureHtmlTransformBase(element);
    return base.status === 'value' ? { status: 'value', value: { kind: 'number', value: base.value[binding.component] } } : base;
  }
  const computed = readHtmlComputedStyle(element);
  if (computed.status !== 'value') return computed;
  const css = computed.value.getPropertyValue(binding.cssName).trim();
  if (css === '') return { status: 'unsupported', reason: `La valeur effective de « ${binding.cssName} » est indisponible.` };
  if (valueKind === 'text') return { status: 'value', value: { kind: 'text', value: css } };
  if (valueKind === 'color') return parseHtmlColor(css);
  if (valueKind === 'number') {
    const parsed = parseHtmlNumber(css, binding.unit ?? '');
    return parsed.status === 'value' ? { status: 'value', value: { kind: 'number', value: parsed.value } } : parsed;
  }
  return { status: 'unsupported', reason: 'Une propriété CSS ne peut pas recevoir directement une valeur booléenne.' };
}
