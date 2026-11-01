// packages/runtime/src/stage/html/spatialRebinding.ts
import { collectLayers } from '../../evaluate/evaluateDocument';
import type { ITimelineDocument } from '../../model/document';
import type { IHtmlAnimationContext } from './animationTypes';
import { canonicalHtmlData } from './animationContext';

/** A retained track's unit also defines its initial value, even before its first key exists. */
export function validateHtmlSpatialRebinding(before: ITimelineDocument, previous: IHtmlAnimationContext,
  after: ITimelineDocument, next: IHtmlAnimationContext): string | undefined {
  const afterLayers = new Map(collectLayers(after).map((layer) => [layer.id, layer]));
  for (const layer of collectLayers(before)) {
    for (const property of Object.keys(layer.propertyTimelines ?? {})) {
      if (afterLayers.get(layer.id)?.propertyTimelines?.[property] === undefined) continue;
      const original = previous.bindings?.[layer.id]?.[property];
      const replacement = next.bindings?.[layer.id]?.[property];
      if (original?.kind !== 'spatial' && replacement?.kind !== 'spatial') continue;
      if (canonicalHtmlData(original) !== canonicalHtmlData(replacement)) {
        return `L’unité ou la destination spatiale de « ${property} » ne peut pas changer tant que la piste et sa valeur initiale existent. Supprimez puis recréez explicitement la piste.`;
      }
    }
  }
  return undefined;
}
