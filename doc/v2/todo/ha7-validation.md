<!-- doc/v2/todo/ha7-validation.md -->
# HA7 — Croisement des points et livraison locale

31 octobre 2026. Branche `v2/HA7-gradient-stop-order`, base intégrée HA6
`f93429bd55d3f950b31bb833c6068176de0555bd`. Choix utilisateur 1A/2A : essais
locaux du Designer et tri des points selon leur position évaluée, IDs conservés.
Aucun tag, publication ni fusion autorisés dans ce lot.

## Changement et périmètre

La composition des trois géométries trie uniquement une copie des points présents
après application des valeurs évaluées. Les égalités gardent l'ordre structurel.
Aucun changement du modèle générique, des identifiants, des signatures ou de C#.
Les lecteurs JSON/JS conservent leur précision par image ; l'export CSS refuse
toujours l'interpolation de composantes et accepte les dégradés maintenus.

Contrat : `doc/integration/timeline-ha7-api.md`. L'historique atomique contexte
HTML + clés + effets hôte n'est pas livré ; sa proposition technique et ses
tests requis sont dans `timeline-host-transactions-proposal.md`.

## Preuves RED/GREEN

Planner ECC natif et guide TDD exécutés avant correction. Avant le tri :
six échecs runtime, un échec CSS maintenu et un échec de scène éditeur sur
l'image 41,5 (point à 49,375 % rendu après celui à 50 %). Après correction :
11 tests runtime ciblés, 2 CSS et 6 éditeur réussis.

Deux scénarios Playwright ont reproduit le mauvais ordre dans les démos HA6
construites : édition de position à 25 % derrière un point à 50 %, et croisement
pendant un vrai MotionTween. Les parcours restent dans le dépôt pour les démos.
Le parcours d'export compare également le module autonome réellement importé.

Revues ECC natives générale, TypeScript et sécurité terminées : aucun constat
bloquant. Les reviewers ont relu les changements, frontières et régressions,
sans revendiquer de nouvelles exécutions des suites globales. Aucune revue C#
revendiquée : aucun code C# ou schéma n'a changé ; sa compatibilité reste testée.

## Vérification globale

Les cinq dossiers dist ont été vérifiés et nettoyés. npm ci a d'abord rencontré
un verrou Rolldown ; à la reprise, un handle exclusif a confirmé l'absence de
verrou actif et aucun processus n'a été arrêté. L'accès réseau npm a ensuite
été nécessaire. npm ci : 479 packages ; manifeste et lockfile inchangés.
Les 30 alertes de développement préexistantes restent inchangées (5 faibles,
18 modérées, 6 hautes, 1 critique) ; aucun audit fix appliqué.

Logs de cette reprise : `%TEMP%/JsTimeline-HA7-validation-20261031`.
Cache Chromium conservé hors node_modules avant npm ci :
`%TEMP%/JsTimeline-browser-cache-20261030`.
Ports : 9411/9412 et 9413/9414 pour Blazor, CI=1.

- Lint : zéro erreur ; typecheck, build et build:demo réussis.
- npm test : **3 923 tests / 262 suites** (runtime 1 208, éditeur 2 482,
  export CSS 121, conventions 63, bridge JS 49).
- Playwright global : **204 tests**, workers=2, retries=0 ; 19 tests ciblés
  avaient aussi confirmé le correctif, dont l'import réel du module autonome.
- Playwright Blazor : **6 + 3 tests** réussis.
- .NET Release : **0 avertissement, 0 erreur**, build sans nouvelle restauration
  des dépendances inchangées ; **180 tests** réussis.
- Packs npm et NuGet locaux réussis. Consommateurs réels ESM/CommonJS, CSS,
  types Bundler/NodeNext, API de lecture/export, C# et ressources statiques validés.

Le lancement Playwright dans le sandbox passait les assertions mais bloquait à
l'arrêt des serveurs Windows. Le lancement autorisé hors sandbox s'est terminé
normalement, sans arrêt aveugle de processus. L'accès à la configuration NuGet
habituelle a été requis pour les hôtes navigateur et le consommateur de package.
Builds et tests ont tous utilisé des commandes ordinaires, sans UltraCode.

## Archives

Archives produites dans `%TEMP%/JsTimeline-HA7-artifacts-20261031`, distinct des
archives HA6. Les trois archives npm doivent être installées ensemble ; leur
version 1.0.0 ne suffit pas à identifier cette livraison. La session Designer
possède son installation. Référence fonctionnelle vérifiée :
`a3b7652534a4532050d8c21d3703f957c50d61d9`. Les changements documentaires suivants
ne modifient pas les binaires vérifiés.
Les 113 fichiers dist runtime, 284 éditeur et 19 export-css contenus dans les
archives ont été comparés octet pour octet aux builds vérifiés : tous identiques.

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | 64000DD3C3FA3F6EBF0F82029E244DA7151E6F3AF3B81A41D74B924A41E227F2 |
| kazo-ca-timeline-editor-1.0.0.tgz | 3FC98E27B0090800D4F7F16717E29B4F2ACDEA3E63328525CFC115FD078B11CA |
| kazo-ca-timeline-export-css-1.0.0.tgz | B745CA1C740B926D29C6678DD682DE546D141A5E507ABC7DFA1012D66FCF93BE |
| JsTimeline.Blazor.1.0.0.nupkg | A480FE84DCC0E589E3F0C69626DCB21FBDAC8718AB5BB77419659E33913C5EA3 |
