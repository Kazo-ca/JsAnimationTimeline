<!-- doc/v2/todo/tl7-conformance.md -->
# Étape 7 — Conformité TL-C01 à TL-C18

Branche `v2/TL7-conformance`, issue de `v2/base` `b796743` (HA1 à HA11).
Objectif : livrer ce que demande la section 10 du contrat HA-TL-001. Cela comprend
la correspondance d'API, la référence exacte, les capacités, et chaque cas TL-C
exécuté contre les packages réellement construits, avec son résultat.

## Constats de l'audit (ecc:planner, lecture seule)

- **Aucun test actuel ne vise les packages construits.** Jest et les démos Vite
  pointent `@kazo-ca/*` vers `packages/*/src`. Seul `tools/packaging/consumers.mjs`
  touche `dist`, et seulement en test de fumée.
- **Preuve mal citée.** `timeline-integration-status.md` cite
  `property-keyframes.spec.ts` pour C01 à C05, C07, C09 et C10. Ce parcours utilise
  l'ancien chemin `setProperty`, que la section 8 du contrat déclare non conforme.
- Plusieurs preuves passent par des fonctions internes plutôt que par l'API publique.

| Cas | Couverture actuelle | Manque principal |
| --- | --- | --- |
| C01, C02, C03, C10, C12 | Couverts | Variante publique de mise à jour d'une clé existante (C01) ; repli manuel pendant la sélection (C12) |
| C04, C05, C07 | Couverts sur le fond | Valeurs littérales du contrat et suppression d'une moitié via l'API publique |
| C06 | Partiel | Lecture linéaire et comparaison commune aperçu, JSON, JS et CSS |
| C08 | Couvert | Diagnostic sans propriété ni période (écart G1) |
| C09 | Partiel | Aucun refus public de `set` ou `moveKey` sur une clé de tween |
| C11 | Partiel | Valeur affichée mise à jour et zéro édition dans un même scénario |
| C13 | Partiel | Lecture linéaire contre accès direct ; indépendance de la sélection dans les exports |
| C14 | Partiel | `exportHtmlCss` avec une décision mémorisée |
| C15 | Partiel | Le paquet construit n'a qu'un test de fumée |
| C16 | Partiel | Refus d'un JSON de lecture par `load` ou `validateDocument` |
| C17 | Partiel | Concordance entre la courbe affichée et les échantillons |
| C18 | Partiel | Effets bounce et back ; interpolateur personnalisé avec dépassement |

## Écarts de code possibles

- **G1.** Les refus d'édition renvoient `{ status: 'refused', reason }`, sans
  propriété, période ni gravité structurées (`propertyTimelineTypes.ts:9`).
  `operations.ts:49-50` ne garde que le message du diagnostic hôte. Les messages du
  noyau ne nomment ni la propriété ni les images.
- **G2.** Les avertissements non bloquants sont ignorés lors d'une réussite
  (`operations.ts:49`), alors que la section 5 les veut observables.

## Plan

1. **Banc sur paquets construits :** démo `demo/conformance` sans alias vers les
   sources. Elle échoue si un module ne vient pas de `dist`. Port dédié dans
   `tools/devPorts` et serveur Playwright. Script Node sans DOM sur les archives
   empaquetées pour C04, C05, C15 et C16.
2. **Suite `e2e/conformance/tl-conformance.spec.ts` :** un test par cas, titré
   `TL-Cxx — <phrase du contrat>`. Elle utilise l'API publique, et l'interface
   seulement pour C11, C12 et C17.
3. **Cas HTML et exports :** C06, C13, C14 et C15, avec scènes figées dans la démo
   de conformité.
4. **Rapport `doc/integration/timeline-conformance.md` :** correspondance d'API,
   capacités, résultats par cas, commits et SHA-256. Correction de la ligne
   erronée du document d'état.

Les tests existants restent des preuves d'appui ; aucun n'est modifié.

## Décisions retenues par défaut

- **Paquets construits pour chaque cas**, archives empaquetées pour les cas Node.
- **Tolérances CSS reprises de HA6 :** 4 décimales pour l'opacité, 2 pour les px.
  JSON et JS comparés aux images entières, selon HA5.
- **Refus CSS expliqué = sortie conforme** (C15) pour une politique que le CSS ne
  sait pas exprimer.
- **Un cas en échec est déclaré « non conforme »** avec `test.fail()` et une entrée
  d'écart. La livraison n'est pas bloquée ; la correction demande un lot autorisé.

## Questions pour Benoit

- **D1 — C09 :** scénario de référence. Dans le noyau générique, aucune édition ne
  peut invalider un tween sans capacité hôte. Proposition : capacité hôte
  `interpolable: false` ou `validate` en erreur.
- **D2 — G1/G2 :** un motif texte suffit-il, ou faut-il un refus structuré
  (propriété, période, gravité, avertissements) ? Le second est un changement
  d'API, donc un lot à part.
- **D5 — C17 :** le Designer utilise-t-il le dialogue d'effets de la Timeline ou
  dessine-t-il sa propre courbe ? Dans le premier cas, le dialogue doit exposer
  ses points échantillonnés.

## État au 4 novembre 2026

- Suite réalisée : 28 tests Playwright sur paquets construits et 5 vérifications
  Node sur archives. Tous les cas TL-C01 à TL-C18 passent ; aucun `test.fail()`.
  Résultats et correspondance d'API : `doc/integration/timeline-conformance.md`.
- Revues ECC générale et TypeScript : aucun constat bloquant. Les huit constats
  moyens sont corrigés : garde contre un `dist` périmé, C17 comparé à des formes
  littérales et au dialogue, titre de C09, nettoyage du banc.
- Les archives produites depuis `b796743` sont identiques octet par octet à HA11.
- Contrôle : lint, typecheck, 4 207 tests Jest et builds réussis. Suite e2e complète
  sur `f0a4693` : 259 sur 259.
- Dernier passage complet sur `ca5c5af` : 262 sur 263. Le test
  `keeps the effect dialog accessible at 768px` a échoué sur un
  `ERR_CONNECTION_REFUSED` du serveur de prévisualisation, puis a réussi trois fois
  seul. Même symptôme que l'échec isolé noté pour HA11.
- D1 (capacité hôte pour C09), D2 (G1/G2) et D5 (dialogue de C17) attendent la
  décision de Benoit.
