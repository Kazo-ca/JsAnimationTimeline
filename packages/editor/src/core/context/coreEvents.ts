// packages/editor/src/core/context/coreEvents.ts
/**
 * Événements réservés au noyau : liste à l'exécution des noms de
 * `CoreEventName` et garde utilisée par la façade des événements pour
 * refuser qu'un plugin les émette.
 *
 * La table `CORE_EVENTS` est typée `Record<CoreEventName, true>` : le
 * compilateur exige exactement un nom par membre de `CoreEventName`, ni plus
 * ni moins.
 */

import type { CoreEventName } from './IEditorContext';

const CORE_EVENTS: Readonly<Record<CoreEventName, true>> = Object.freeze({
  'editor:ready': true,
  'editor:destroying': true,
  'document:loaded': true,
  'document:changed': true,
  'property:changed': true,
  'transaction:changed': true,
  'command:before': true,
  'command:refused': true,
  'history:changed': true,
  'playhead:changed': true,
  'frame:render': true,
  'playback:play': true,
  'playback:pause': true,
  'playback:loop': true,
  'playback:complete': true,
  'stage:report': true,
  'stage:targetsChanged': true
});

/** Noms des événements émis par le noyau seul. */
export const CORE_EVENT_NAMES: readonly CoreEventName[] = Object.freeze(
  Object.keys(CORE_EVENTS) as CoreEventName[]
);

/** Vrai si `name` est un événement réservé au noyau. */
export function isCoreEventName(name: string): name is CoreEventName {
  return Object.prototype.hasOwnProperty.call(CORE_EVENTS, name);
}

/**
 * Lève une erreur si un plugin tente d'émettre un événement du noyau.
 *
 * @param operation Méthode appelée, reprise dans le message (ex. « events.emit »).
 */
export function assertPluginEvent(name: string, operation: string): void {
  if (!isCoreEventName(name)) return;
  throw new Error(
    `${operation} : « ${name} » est un événement du noyau ; un plugin peut s'y abonner mais pas l'émettre.`
  );
}
