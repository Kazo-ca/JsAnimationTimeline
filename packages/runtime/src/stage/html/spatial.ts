// packages/runtime/src/stage/html/spatial.ts
import type { TimelinePropertyValue } from '../../model/propertyTimeline';
import type { IHtmlAnimationContext } from './animationTypes';
import { canonicalHtmlData } from './animationContext';
import type { HtmlReadResult, IHtmlResolvedBinding } from './cssTypes';
import { htmlNumberText, parseHtmlNumber } from './cssValue';
import { isHtmlSpatialSourceTransform, safeSpatialCss, spatialCssValue } from './spatialCss';
import type { HtmlSpatialBinding, HtmlSpatialCoordinate, IHtmlSpatialChange, IHtmlSpatialDefinition } from './spatialTypes';

const LENGTHS = ['px', '%', 'em', 'rem', 'vw', 'vh'];
const ANGLES = ['deg', 'rad', 'turn'];
const FAILURE = 'La projection spatiale ou sa source CSS est invalide ; une conversion explicite peut être nécessaire.';
function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.getPrototypeOf(value) === null || Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value: Record<string, unknown>, names: readonly string[]): boolean { return Object.keys(value).every((key) => names.includes(key)); }
function id(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 512; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function coordinate(value: unknown, axis: 'x' | 'y' | 'z'): boolean {
  if (!record(value)) return false;
  if (keys(value, ['value', 'unit']) && finite(value.value) && LENGTHS.includes(value.unit as string)) return axis !== 'z' || value.unit !== '%';
  return keys(value, ['css']) && typeof value.css === 'string' && (spatialCssValue(value.css, 'length', axis !== 'z')
    || (axis === 'x' ? ['left', 'center', 'right'] : axis === 'y' ? ['top', 'center', 'bottom'] : []).includes(value.css));
}
function capture(value: unknown): boolean {
  return record(value) && keys(value, ['kind', 'authoredValue', 'computedValue']) && ['authored', 'computed'].includes(value.kind as string)
    && typeof value.computedValue === 'string' && (value.authoredValue === undefined || typeof value.authoredValue === 'string');
}
function conversion(value: unknown): boolean {
  return record(value) && keys(value, ['id', 'property', 'confirmedAtFrame', 'originalValue', 'replacementValue', 'reason', 'consent'])
    && id(value.id) && id(value.property) && finite(value.confirmedAtFrame) && Number.isInteger(value.confirmedAtFrame) && value.confirmedAtFrame >= 1
    && typeof value.originalValue === 'string' && typeof value.replacementValue === 'string'
    && ['source-unavailable', 'unit-replacement'].includes(value.reason as string) && value.consent === 'explicit';
}

export function isHtmlSpatialBinding(value: unknown): value is HtmlSpatialBinding {
  if (!record(value) || value.kind !== 'spatial' || !id(value.projectionId)) return false;
  if (['scaleX', 'scaleY', 'sourceTransform'].includes(value.component as string)) return keys(value, ['kind', 'projectionId', 'component']);
  if (!keys(value, ['kind', 'projectionId', 'component', 'unit'])) return false;
  return value.component === 'rotation' ? ANGLES.includes(value.unit as string)
    : ['translateX', 'translateY', 'pivotX', 'pivotY'].includes(value.component as string) && LENGTHS.includes(value.unit as string);
}

export function isHtmlSpatialDefinition(value: unknown): value is IHtmlSpatialDefinition {
  return record(value) && keys(value, ['id', 'version', 'composition', 'sourceTransform', 'origin', 'provenance', 'conversions'])
    && id(value.id) && value.version === 1 && value.composition === 'prepend-trs' && isHtmlSpatialSourceTransform(value.sourceTransform)
    && record(value.origin) && keys(value.origin, ['x', 'y', 'z']) && coordinate(value.origin.x, 'x') && coordinate(value.origin.y, 'y') && coordinate(value.origin.z, 'z')
    && record(value.provenance) && keys(value.provenance, ['transform', 'origin']) && capture(value.provenance.transform) && capture(value.provenance.origin)
    && (value.conversions === undefined || Array.isArray(value.conversions) && value.conversions.every(conversion)
      && new Set(value.conversions.map((entry) => entry.id)).size === value.conversions.length);
}

function find(binding: HtmlSpatialBinding, definitions: readonly IHtmlSpatialDefinition[]): HtmlReadResult<IHtmlSpatialDefinition> {
  const matches = definitions.filter((definition) => definition.id === binding.projectionId);
  return matches.length === 1 && isHtmlSpatialDefinition(matches[0]) ? { status: 'value', value: matches[0] }
    : { status: 'unsupported', reason: FAILURE };
}
export function spatialCoordinateText(value: HtmlSpatialCoordinate<string>): string {
  return 'css' in value ? value.css : `${htmlNumberText(value.value)}${value.unit}`;
}

/** Identity adjustments and captured origin/source are never inferred from an evaluated preview. */
export function readHtmlSpatialValue(binding: HtmlSpatialBinding, definitions: readonly IHtmlSpatialDefinition[]): HtmlReadResult<TimelinePropertyValue> {
  const result = find(binding, definitions);
  if (result.status !== 'value') return result;
  if (binding.component === 'sourceTransform') return { status: 'value', value: { kind: 'text', value: result.value.sourceTransform } };
  if (binding.component === 'pivotX' || binding.component === 'pivotY') {
    const captured = result.value.origin[binding.component === 'pivotX' ? 'x' : 'y'];
    const parsed = parseHtmlNumber(spatialCoordinateText(captured), binding.unit);
    // A different untouched source unit/expression is retained in the definition. New tracks must supply their explicit initial value.
    return parsed.status === 'value' ? { status: 'value', value: { kind: 'number', value: parsed.value } }
      : { status: 'unsupported', reason: 'L’origine source ne peut pas être exprimée dans cette unité sans conversion explicite.' };
  }
  return { status: 'value', value: { kind: 'number', value: binding.component === 'scaleX' || binding.component === 'scaleY' ? 1 : 0 } };
}

export function validateHtmlSpatialValue(binding: HtmlSpatialBinding, value: TimelinePropertyValue, definitions: readonly IHtmlSpatialDefinition[]): string | undefined {
  if (!isHtmlSpatialBinding(binding) || find(binding, definitions).status !== 'value') return FAILURE;
  if (binding.component === 'sourceTransform') return value.kind === 'text' && isHtmlSpatialSourceTransform(value.value) ? undefined : FAILURE;
  return value.kind === 'number' && Number.isFinite(value.value) ? undefined : 'Une composante spatiale exige un nombre fini.';
}

/** Pure post-evaluation projection. No temporal interpolation, measurements or source mutation. */
export function composeHtmlSpatial(definition: IHtmlSpatialDefinition, changes: readonly IHtmlSpatialChange[]): HtmlReadResult<Readonly<Record<string, string>>> {
  if (!isHtmlSpatialDefinition(definition)) return { status: 'unsupported', reason: FAILURE };
  const values: Record<string, string> = { translateX: '0px', translateY: '0px', rotation: '0deg', scaleX: '1', scaleY: '1',
    pivotX: spatialCoordinateText(definition.origin.x), pivotY: spatialCoordinateText(definition.origin.y), sourceTransform: definition.sourceTransform };
  const seen = new Set<string>();
  for (const { binding, value } of changes) {
    const reason = validateHtmlSpatialValue(binding, value, [definition]);
    if (reason !== undefined || seen.has(binding.component)) return { status: 'unsupported', reason: reason ?? 'Plusieurs propriétés pilotent la même composante spatiale.' };
    seen.add(binding.component);
    values[binding.component] = value.kind === 'number' ? `${htmlNumberText(value.value)}${'unit' in binding ? binding.unit : ''}` : value.kind === 'text' ? value.value : '';
  }
  const declarations: Record<string, string> = {};
  if ([...seen].some((component) => component !== 'pivotX' && component !== 'pivotY')) {
    const suffix = values.sourceTransform.trim().toLowerCase() === 'none' ? '' : ` ${values.sourceTransform}`;
    declarations.transform = `translate(${values.translateX}, ${values.translateY}) rotate(${values.rotation}) scale(${values.scaleX}, ${values.scaleY})${suffix}`;
  }
  if (seen.has('pivotX') || seen.has('pivotY')) declarations['transform-origin'] = `${values.pivotX} ${values.pivotY} ${spatialCoordinateText(definition.origin.z)}`;
  return { status: 'value', value: declarations };
}

/** Local identifiers and capture audit data do not change a projection's physical CSS meaning. */
export function htmlSpatialCompositionKey(definition: IHtmlSpatialDefinition | undefined): string {
  return definition === undefined ? canonicalHtmlData(undefined) : canonicalHtmlData({ version: definition.version,
    composition: definition.composition, sourceTransform: definition.sourceTransform, origin: definition.origin });
}

/** Physical definitions determine shared identity; original context retains every audit record. */
export function resolveHtmlSpatialBindings(context: IHtmlAnimationContext, properties: readonly { readonly layerId: string; readonly binding: IHtmlResolvedBinding }[]): {
  readonly bindings: readonly IHtmlResolvedBinding[]; readonly definitions: readonly IHtmlSpatialDefinition[];
} {
  const definitions = new Map<string, IHtmlSpatialDefinition>();
  const bindings = properties.map(({ layerId, binding }) => {
    if (binding.binding.kind !== 'spatial') return binding;
    const spatial = binding.binding;
    const definition = context.spatial?.[layerId]?.find((entry) => entry.id === spatial.projectionId);
    if (definition === undefined) throw new TypeError('Une association spatiale référence une définition absente.');
    // A compact generated ID avoids overstepping the public stable-ID size limit.
    const signature = htmlSpatialCompositionKey(definition);
    let resolved = definitions.get(signature);
    if (resolved === undefined) { resolved = { ...definition, id: `projection-${definitions.size}` }; definitions.set(signature, resolved); }
    return { ...binding, binding: { ...spatial, projectionId: resolved.id } };
  });
  return { bindings, definitions: [...definitions.values()] };
}

/** Browser validity is additional to portable syntax validation, never its replacement. */
export function supportedSpatialDeclarations(element: Element, declarations: Readonly<Record<string, string>>): boolean {
  const css = element.ownerDocument.defaultView?.CSS;
  return Object.entries(declarations).every(([name, value]) => safeSpatialCss(value)
    && (typeof css?.supports !== 'function' || css.supports(name, value)));
}
