// packages/editor/src/core/editor/freezeDocument.ts
/**
 * Gel en profondeur des documents de l'éditeur : rend l'immuabilité du
 * document effective au lieu d'être une simple convention. Un plugin ou
 * l'hôte qui modifie `ctx.document` / `editor.document` en place obtient une
 * `TypeError` au lieu de contourner les commandes, les événements et
 * l'historique.
 *
 * `createEditor()` gèle le document initial (après validation par le Store)
 * puis, avant tout autre gestionnaire, chaque document annoncé par
 * `document:changed` (commandes, annuler / rétablir, annulation d'un
 * regroupement) et `document:loaded` (`editor.load`).
 *
 * Coût : les documents produits par les commandes partagent leurs
 * sous-arbres inchangés avec le précédent. Ces sous-arbres, déjà gelés par
 * cette fonction, sont mémorisés (`WeakSet`) et sautés : seul le chemin
 * modifié est parcouru. Un objet gelé ailleurs (par l'hôte, peut-être en
 * surface seulement) est, lui, parcouru en entier.
 */

import type { ITimelineDocument } from '@kazo-ca/timeline-runtime';
import type { EventBus } from '../events/EventBus';

/** Objets déjà gelés en profondeur par `deepFreezeValue`. */
const deeplyFrozen = new WeakSet<object>();

export function deepFreezeValue(value: unknown): void {
  if (typeof value !== 'object' || value === null || deeplyFrozen.has(value)) return;
  Object.freeze(value);
  Object.values(value).forEach(deepFreezeValue);
  deeplyFrozen.add(value);
}

/**
 * Gèle `doc` en profondeur (en place) et le retourne.
 *
 * @returns Le même objet, désormais immuable.
 */
export function freezeDocument(doc: ITimelineDocument): ITimelineDocument {
  deepFreezeValue(doc);
  return doc;
}

/**
 * Abonne au bus le gel des documents annoncés par le Store. À appeler avant
 * le démarrage des plugins : le gel passe ainsi avant leurs gestionnaires.
 */
export function freezeAnnouncedDocuments(bus: EventBus): void {
  bus.on('document:changed', ({ document }) => void freezeDocument(document));
  bus.on('document:loaded', ({ document }) => void freezeDocument(document));
}
