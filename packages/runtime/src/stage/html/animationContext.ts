// packages/runtime/src/stage/html/animationContext.ts
import type { IHtmlAnimationContext, IHtmlConflictResolution } from './animationTypes';
import { isHtmlPropertyBinding } from './cssBindings';
import { isHtmlGradientDefinition } from './gradients';
import { isHtmlSpatialDefinition } from './spatial';

function record(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype;
}

/** Clone JSON data without invoking accessors, toJSON or retaining caller aliases. */
function cloneData(value: unknown, ancestors: Set<object>, depth: number): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (depth > 64 || typeof value !== 'object' || value === null || ancestors.has(value)) {
    throw new TypeError('Le contexte HTML doit contenir uniquement des données JSON finies, sans cycle.');
  }
  if (!Array.isArray(value) && !record(value)) throw new TypeError('Le contexte HTML contient un objet non sérialisable.');
  if (Object.getOwnPropertySymbols(value).length > 0) throw new TypeError('Le contexte HTML ne prend pas en charge les symboles.');
  ancestors.add(value);
  const fields: Array<[string, unknown]> = [];
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!('value' in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError('Le contexte HTML ne prend pas en charge les accesseurs ni les champs masqués.');
    }
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new TypeError('Le contexte HTML contient un nom réservé.');
    fields.push([key, cloneData(descriptor.value, ancestors, depth + 1)]);
  }
  ancestors.delete(value);
  if (!Array.isArray(value)) {
    const copy = Object.create(null) as Record<string, unknown>;
    fields.forEach(([key, child]) => { copy[key] = child; });
    return copy;
  }
  if (fields.length !== value.length || fields.some(([key], index) => key !== String(index))) {
    throw new TypeError('Le contexte HTML contient un tableau incomplet ou des champs supplémentaires.');
  }
  return fields.map(([, child]) => child);
}

function keysAre(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((name) => allowed.includes(name));
}

function validResolution(value: unknown): value is IHtmlConflictResolution {
  return record(value) && keysAre(value, ['conflictId', 'signature', 'winnerLayerId', 'beforeFirst']) &&
    [value.conflictId, value.signature, value.winnerLayerId].every((item) => typeof item === 'string' && item.length > 0) &&
    (value.beforeFirst === undefined || typeof value.beforeFirst === 'string' && ['initial', 'first-key', 'underlying'].includes(value.beforeFirst));
}

/** Strict public boundary for persisted HTML data. Throws before any DOM write. */
export function cloneHtmlAnimationContext(input: unknown): IHtmlAnimationContext {
  const value = cloneData(input, new Set(), 0);
  if (!record(value) || !keysAre(value, ['version', 'bindings', 'gradients', 'spatial', 'resolutions']) || value.version !== 1) {
    throw new TypeError('Le contexte HTML doit utiliser la version 1 et des champs reconnus.');
  }
  if (value.bindings !== undefined && (!record(value.bindings) || Object.keys(value.bindings).some((key) => key === '') || !Object.values(value.bindings).every((bindings) =>
    record(bindings) && Object.keys(bindings).every((key) => key !== '') && Object.values(bindings).every(isHtmlPropertyBinding)))) {
    throw new TypeError('Les associations de propriétés HTML sont invalides.');
  }
  if (value.gradients !== undefined && (!record(value.gradients) || Object.keys(value.gradients).some((key) => key === '') || !Object.values(value.gradients).every((gradients) =>
    Array.isArray(gradients) && gradients.every(isHtmlGradientDefinition) && new Set(gradients.map((gradient) => gradient.id)).size === gradients.length))) {
    throw new TypeError('Les définitions de dégradés HTML sont invalides.');
  }
  if (value.resolutions !== undefined && (!Array.isArray(value.resolutions) || !value.resolutions.every(validResolution) ||
    new Set(value.resolutions.map((resolution) => resolution.conflictId)).size !== value.resolutions.length)) {
    throw new TypeError('Les résolutions de conflits HTML sont invalides ou dupliquées.');
  }
  if (value.spatial !== undefined && (!record(value.spatial) || Object.keys(value.spatial).some((key) => key === '') || !Object.values(value.spatial).every((definitions) =>
    Array.isArray(definitions) && definitions.every(isHtmlSpatialDefinition) && new Set(definitions.map((definition) => definition.id)).size === definitions.length))) {
    throw new TypeError('Les définitions de projections spatiales HTML sont invalides.');
  }
  const context = value as unknown as IHtmlAnimationContext;
  for (const [layerId, bindings] of Object.entries(context.bindings ?? {})) {
    for (const binding of Object.values(bindings)) {
      if (binding.kind === 'spatial' && !context.spatial?.[layerId]?.some((definition) => definition.id === binding.projectionId)) {
        throw new TypeError('Une association spatiale référence une définition absente.');
      }
      if (binding.kind !== 'gradient') continue;
      const definition = context.gradients?.[layerId]?.find((gradient) => gradient.id === binding.gradientId);
      if (definition === undefined || binding.stopId !== undefined && !definition.stops.some((stop) => stop.id === binding.stopId)) {
        throw new TypeError('Une association de dégradé référence une définition ou un point absent.');
      }
    }
  }
  return context;
}

/** A stable JSON representation for comparison, without depending on object key order. */
export function canonicalHtmlData(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalHtmlData).join(',')}]`;
  return `{${Object.entries(value).filter(([, child]) => child !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalHtmlData(child)}`).join(',')}}`;
}
