// packages/runtime/src/stage/html/gradients.ts
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { HtmlPropertyBinding, HtmlReadResult, IHtmlGradientDefinition, IHtmlGradientStop } from './cssTypes';
import { htmlColorText, htmlNumberText, isHtmlColor } from './cssValue';

type GradientBinding = Extract<HtmlPropertyBinding, { kind: 'gradient' }>;
export interface IHtmlGradientChange { readonly binding: GradientBinding; readonly value: TimelinePropertyValue }
const TYPES = ['linear', 'radial', 'conic'];
const DEFINITION_KEYS = ['id', 'cssName', 'type', 'angle', 'centerX', 'centerY', 'radiusX', 'radiusY', 'stops'];
const STOP_KEYS = ['id', 'color', 'opacity', 'position', 'present'];

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function isStop(value: unknown): value is IHtmlGradientStop {
  return record(value) && Object.keys(value).every((key) => STOP_KEYS.includes(key)) && id(value.id)
    && isHtmlColor(value.color, true) && finite(value.opacity) && value.opacity >= 0 && value.opacity <= 1
    && finite(value.position) && typeof value.present === 'boolean';
}

export function isHtmlGradientDefinition(value: unknown): value is IHtmlGradientDefinition {
  if (!record(value) || !Object.keys(value).every((key) => DEFINITION_KEYS.includes(key)) || !id(value.id)
    || value.cssName !== 'background-image' || !TYPES.includes(value.type as string)) return false;
  if (![value.angle, value.centerX, value.centerY, value.radiusX, value.radiusY].every(finite)
    || (value.radiusX as number) < 0 || (value.radiusY as number) < 0) return false;
  return Array.isArray(value.stops) && value.stops.length >= 2 && value.stops.every(isStop)
    && new Set(value.stops.map((stop) => stop.id)).size === value.stops.length
    && value.stops.filter((stop) => stop.present).length >= 2;
}

function findGradient(binding: GradientBinding, definitions: readonly IHtmlGradientDefinition[]): HtmlReadResult<IHtmlGradientDefinition> {
  const found = definitions.filter((definition) => definition.id === binding.gradientId);
  if (found.length !== 1 || !isHtmlGradientDefinition(found[0])) {
    return { status: 'unsupported', reason: `Le dégradé « ${binding.gradientId} » n'a pas de définition initiale valide et unique.` };
  }
  return { status: 'value', value: found[0] };
}

/** A definition is the host's captured gradient structure, never inferred from an animated style. */
export function readHtmlGradientValue(binding: GradientBinding, definitions: readonly IHtmlGradientDefinition[]): HtmlReadResult<TimelinePropertyValue> {
  const found = findGradient(binding, definitions);
  if (found.status !== 'value') return found;
  const gradient = found.value;
  if (binding.stopId === undefined) {
    if (binding.component === 'type') return { status: 'value', value: { kind: 'text', value: gradient.type } };
    if (['angle', 'centerX', 'centerY', 'radiusX', 'radiusY'].includes(binding.component)) {
      return { status: 'value', value: { kind: 'number', value: gradient[binding.component as 'angle'] } };
    }
  }
  const stop = gradient.stops.find((entry) => entry.id === binding.stopId);
  if (stop === undefined) return { status: 'unsupported', reason: `Le point « ${binding.stopId ?? ''} » du dégradé est introuvable.` };
  switch (binding.component) {
    case 'color': return { status: 'value', value: { ...stop.color } };
    case 'opacity': case 'position': return { status: 'value', value: { kind: 'number', value: stop[binding.component] } };
    case 'present': return { status: 'value', value: { kind: 'boolean', value: stop.present } };
    default: return { status: 'unsupported', reason: 'Ce composant de dégradé ne correspond pas à un point.' };
  }
}

export function validateHtmlGradientValue(binding: GradientBinding, value: TimelinePropertyValue, definitions: readonly IHtmlGradientDefinition[]): string | undefined {
  const initial = readHtmlGradientValue(binding, definitions);
  if (initial.status !== 'value') return initial.reason;
  if (value.kind !== initial.value.kind) return 'Le type du composant du dégradé est incompatible.';
  if (value.kind === 'color' && !isHtmlColor(value, true)) return 'La couleur du point doit être un RGB opaque ; son opacité dispose d’une propriété indépendante.';
  if (value.kind === 'text' && !TYPES.includes(value.value)) return 'Le type de dégradé doit être linéaire, radial ou conique.';
  if (value.kind === 'number' && !Number.isFinite(value.value)) return 'La valeur du dégradé doit être finie.';
  return undefined;
}

function applyChange(gradient: IHtmlGradientDefinition, { binding, value }: IHtmlGradientChange): IHtmlGradientDefinition {
  if (binding.stopId === undefined) {
    if (binding.component === 'type' && value.kind === 'text') return { ...gradient, type: value.value as IHtmlGradientDefinition['type'] };
    if (value.kind === 'number') {
      const number = binding.component === 'radiusX' || binding.component === 'radiusY' ? Math.max(0, value.value) : value.value;
      return { ...gradient, [binding.component]: number };
    }
  }
  return { ...gradient, stops: gradient.stops.map((stop) => {
    if (stop.id !== binding.stopId) return stop;
    if (binding.component === 'color' && value.kind === 'color') return { ...stop, color: { ...value } };
    if (binding.component === 'present' && value.kind === 'boolean') return { ...stop, present: value.value };
    if ((binding.component === 'opacity' || binding.component === 'position') && value.kind === 'number') {
      return { ...stop, [binding.component]: binding.component === 'opacity' ? Math.min(1, Math.max(0, value.value)) : value.value };
    }
    return stop;
  }) };
}

/** Rebuild one declaration from independent component values; no input is mutated. */
export function composeHtmlGradient(definition: IHtmlGradientDefinition, changes: readonly IHtmlGradientChange[]): HtmlReadResult<string> {
  if (!isHtmlGradientDefinition(definition)) return { status: 'unsupported', reason: 'La définition initiale du dégradé est invalide.' };
  let gradient = definition;
  for (const change of changes) {
    const reason = validateHtmlGradientValue(change.binding, change.value, [definition]);
    if (reason !== undefined) return { status: 'unsupported', reason };
    gradient = applyChange(gradient, change);
  }
  // Sort only the rendered copy; stable ties retain the definition's hard-stop order.
  const stops = gradient.stops.filter((stop) => stop.present).sort((left, right) => left.position - right.position);
  if (stops.length < 2) return { status: 'unsupported', reason: 'Le dégradé exige au moins deux points présents à cette image.' };
  const colors = stops.map((stop) => `${htmlColorText(stop.color, stop.opacity)} ${htmlNumberText(stop.position)}%`).join(', ');
  const n = htmlNumberText;
  if (gradient.type === 'linear') return { status: 'value', value: `linear-gradient(${n(gradient.angle)}deg, ${colors})` };
  const center = `${n(gradient.centerX)}% ${n(gradient.centerY)}%`;
  if (gradient.type === 'radial') return { status: 'value', value: `radial-gradient(ellipse ${n(gradient.radiusX)}% ${n(gradient.radiusY)}% at ${center}, ${colors})` };
  return { status: 'value', value: `conic-gradient(from ${n(gradient.angle)}deg at ${center}, ${colors})` };
}
