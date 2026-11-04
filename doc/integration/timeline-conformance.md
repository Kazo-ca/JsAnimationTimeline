<!-- doc/integration/timeline-conformance.md -->
# Conformité de JsAnimationTimeline au contrat HA-TL-001

Ce document répond à la section 10 du [contrat](timeline-contract.md). Il donne la
référence à utiliser, la correspondance d'API, les capacités, et les cas TL-C01 à
TL-C18 exécutés avec leurs résultats. Il ne vaut ni publication, ni validation de
l'intégration Designer, ni fusion vers `main`.

## Référence

| Élément | Valeur |
| --- | --- |
| Code des packages | `v2/base` `b7967436e341ae43022651ac7138b46c4895e4f6` (HA1 à HA11). Aucun fichier sous `packages/` n'est modifié par l'étape 7. |
| Suite de conformité | Branche `v2/TL7-conformance` ; commit indiqué dans la PR qui l'apporte. |
| Archives vérifiées | Identiques octet par octet à celles livrées pour HA11 (`doc/v2/todo/ha11-validation.md`). Le Designer peut garder l'installation HA11 `2b920f1`. |

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | 665FFC0856E732E7688F15E70319C0437225A31AC8DBA51D41476881A5313319 |
| kazo-ca-timeline-editor-1.0.0.tgz | AC00A083ADC6015944D753BAD1D706817D89DE746A8E14AAD97444240173C28D |
| kazo-ca-timeline-export-css-1.0.0.tgz | 5253386172FA71B097A7F163E3FF459BEFD58033ECC404C916449CD3831D6C95 |

## Comment la conformité est prouvée

- **Paquets construits.** La page `demo/editor/conformance.html` est construite
  par `vite.conformance.config.ts`, sans alias vers les sources. Les modules
  `@kazo-ca/*` viennent donc de `packages/*/dist`. La construction échoue si un
  module vient de `packages/*/src`, ou si `dist` est plus ancien que les sources.
- **Suite Playwright** `e2e/conformance/tl-conformance.spec.ts` : chaque test est
  titré `TL-Cxx — …` et passe par l'API publique. L'interface n'est utilisée que
  pour C11, C12 et le dialogue de C17.
- **Script Node sans DOM** `tools/conformance/node-conformance.mjs` : il installe
  hors ligne les trois archives empaquetées et vérifie C04, C05, C15 et C16, puis
  affiche leurs SHA-256.

Commandes :

```bash
npm run build
npm run build:demo
npx playwright test conformance
npm run test:conformance:node -- <dossier des trois archives npm>
```

La troisième commande s'exécute dans `e2e`. Pour la dernière, les archives sont
produites par `npm pack --workspace packages/<nom> --pack-destination <dossier>`.

## Correspondance d'API

| Opération du contrat (§3) | API publique |
| --- | --- |
| Lire le contexte | `editor.playback.frame`, `editor.playback.playing`, `editor.document.settings` (`fps`, `totalFrames`) |
| Évaluer | `editor.sample(frame)`, `editor.onFrame` ; runtime `evaluateLayer`, `evaluateDocument` |
| État initial | `initialValue` des pistes et des propriétés cibles ; `createHtmlStage`, `createHtmlInspectionStage`, `createEditorHtmlStage` |
| Écrire une valeur à une image | `editor.propertyTimelines.set` |
| Capturer la valeur évaluée | `editor.propertyTimelines.capture` |
| Transitions et effets | `createTransition`, `removeTransition`, `setEasing` ; type `PropertyEasing` ; `createPropertyEasingFunction` |
| Déplacer ou supprimer une clé | `editor.propertyTimelines.moveKey`, `deleteKey` |
| Geste en plusieurs propriétés | `editor.propertyTimelines.beginTransaction`, puis `commit` ou `cancel` ; `editor.transactions.execute` |
| Annuler, rétablir | `editor.undo`, `redo`, `canUndo`, `canRedo` |
| Sauvegarder, rouvrir | `editor.toJSON`, `editor.load` ; `validateDocument` ; `cloneHtmlAnimationContext` |
| Données de lecture génériques | `compilePlayback`, `parsePlayback`, `samplePlayback`, `createPlaybackPlayer` |
| Lecture et exports HTML | `compileHtmlPlayback`, `parseHtmlPlayback`, `createHtmlPlaybackPlayer`, `exportHtmlJavascript` ; `exportHtmlCss` (package export-css) |
| Conflits non couverts | `resolveHtmlConflict` (runtime), `editor.transactions.resolveHtmlConflict` |
| Observations | `editor.on(...)`, qui renvoie une fonction de désabonnement : `property:changed`, `document:changed`, `history:changed`, `transaction:changed`, refus d'historique HA9B |

Les mutations renvoient `changed`, `noop` ou `refused` avec un motif. Les
transactions de l'éditeur ajoutent `faulted`.

## Capacités

- Valeurs : nombre, texte, booléen, couleur ; dégradés côté HTML (HA1, HA7).
- Effets : 12 familles et Bézier, modes entrée, sortie et entrée-sortie, paramètres
  bornés (HA2, HA3).
- Images de 1 à N, évaluation aux images fractionnaires.
- Exports HA5 JSON/JS échantillonnés aux images entières. CSS HA6 continu, ou refus
  global expliqué avec les alternatives `javascript` et `json`.
- Transactions atomiques, rendu hôte avant notification, conflits sur candidat
  final, refus d'historique publics, projection spatiale (HA8 à HA11).

## Résultats

Exécution du 4 novembre 2026 sur les paquets construits de `b796743`. Chromium
seulement ; Firefox et WebKit ne sont pas couverts.

| Cas | Résultat | Ce que le test vérifie |
| --- | --- | --- |
| TL-C01 | Conforme | Créer puis modifier la clé à 50 ne touche que cette clé ; tween d'opacité inchangé ; un événement à l'image 50. |
| TL-C02 | Conforme | Piste d'opacité identique et mêmes valeurs à chaque demi-image. |
| TL-C03 | Conforme | La capture stocke la valeur évaluée, dans un tween comme dans un maintien ; aucun retour à la valeur d'origine. |
| TL-C04 | Conforme | Maintien jusqu'à la clé suivante et après la dernière, dans l'éditeur, chez l'hôte et dans le runtime Node. |
| TL-C05 | Conforme | Valeurs littérales du contrat : 1 jusqu'à 49,875, 0,8 dès 50, seule clé `[50]`. |
| TL-C06 | Conforme | Cas 59 : 0,8 pour le bouton spécifique dès l'image 1, 0,5 pour les autres. Mêmes valeurs en accès direct, lecture linéaire, JSON, JS et CSS ; aucune clé ni résolution ajoutée. |
| TL-C07 | Conforme | Insertion dans un tween non linéaire : deux transitions distinctes, mouvement identique ; chaque moitié reste indépendante. |
| TL-C08 | Conforme, voir écart G1 | Une, trois ou deux clés non voisines, ou une propriété texte, sont refusées sans effet ; deux clés voisines sont acceptées. |
| TL-C09 | Conforme avec une capacité hôte | `set`, `moveKey` et `deleteKey` refusés sans toucher la transition ni l'historique. Le refus vient d'une règle de l'hôte : le noyau générique ne peut pas invalider un tween seul. |
| TL-C10 | Conforme | Geste X/Y en une seule annulation ; un geste annulé ne laisse aucune trace. |
| TL-C11 | Conforme | Navigation et sélection mettent à jour le panneau sans édition, événement ni historique. |
| TL-C12 | Conforme | Dépliage temporaire ; dépliage et repli manuels conservés. |
| TL-C13 | Conforme | Accès direct, lecture linéaire, JSON/JS (images entières) et CSS (quarts d'image) concordent, avec ou sans sélection. |
| TL-C14 | Conforme | Diagnostic bloquant, exports refusés ; décision explicite, annulable, mémorisée ; clé ajoutée seulement après confirmation ; ticket périmé refusé ; décision respectée après rechargement. |
| TL-C15 | Conforme | JSON générique sans champ CSS, DOM ou XPath ; JSON et JS HTML fidèles à l'aperçu ; refus CSS global expliqué pour un effet élastique. |
| TL-C16 | Conforme | Sauvegarde et réouverture identiques ; un JSON de lecture est refusé par `load` et par `validateDocument`. |
| TL-C17 | Conforme, voir question D5 | Échantillons comparés à des valeurs littérales ; choix confirmé dans le dialogue en une annulation ; Échap sans effet. |
| TL-C18 | Conforme | Insertion dans élastique, back, bounce et Bézier avec dépassement, avec et sans interpolateur personnalisé : mêmes valeurs à chaque 0,125 image. |

## Écarts et limites connus

- **G1 — refus peu structurés.** Un refus d'édition ne renvoie qu'un motif texte
  (`propertyTimelineTypes.ts:9`), sans propriété, période ni gravité structurées.
  Le motif d'un diagnostic hôte est conservé, mais ses autres champs sont perdus
  (`operations.ts:49-50`). Le contrat demande que le diagnostic explique la
  propriété et la période. Décision attendue de Benoit.
- **G2 — avertissements perdus.** Les avertissements non bloquants d'un hôte ne
  sont pas exposés après une réussite (`operations.ts:49`).
- **D5 — courbe du dialogue.** La concordance entre la courbe dessinée par le
  dialogue de la Timeline et le rendu n'est vérifiée que si le Designer utilise
  ce dialogue. Décision attendue de Benoit.
- **Frontière CSS.** La durée CSS est écrite avec 16 chiffres. Une clé de maintien
  tombe donc à environ 2e-13 ms de sa frontière d'image exacte. Le banc lit le CSS
  avec un décalage de 1 ns ; aucun lecteur réel ne peut percevoir cet écart.
- Cette suite prouve les garanties Timeline. Le Designer doit encore exécuter ses
  propres tests d'adaptateur et de parcours sur cette même référence.
