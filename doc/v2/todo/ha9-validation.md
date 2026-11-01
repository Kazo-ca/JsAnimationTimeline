<!-- doc/v2/todo/ha9-validation.md -->
# HA9 — Vérification du rendu hôte préparé

31 octobre 2026 à Toronto ; exécutions finales le 1er novembre en UTC.
Branche `v2/HA9-designer-integration-bridge`, issue de HA8
`f6de3c592c8c90c35285332f704ef68dfcce0b41`.
Contrat `HA9-HOST-RENDER/1` : `doc/integration/timeline-ha9-host-render-api.md`.

## Résultat

Implémentation et vérification locales terminées. Les archives HA7/HA8 restent
inchangées. Aucune fusion, publication, création de tag ou modification du dépôt
Designer. Les conflits sur candidat final et la projection spatiale restent
réservés à la branche suivante, avec leurs constats dans `ha9-integration-bridge.md`.

Le participant de rendu reçoit document, contextes HTML, instant et échantillon
immuables. Il applique l'aperçu avant les premiers observateurs, avec compensation
exacte en cas d'échec. Transactions, commandes directes, historique, groupes,
navigation et cycle de vie sont couverts. Les mutations réentrantes sont refusées
pendant les notifications ; un nouvel appel après leur fin est accepté.

## Preuves RED/GREEN

Plan ECC et TDD natifs exécutés. Le RED initial reproduit le défaut Designer :
document/contexte/historique nouveaux, mais fond encore à 90 degrés au lieu de 35.
Les 37 nouveaux tests dans sept suites vérifient la séquence
35→90→35→55→35→55 avec le véritable échantillon candidat.

Quatre constats de revue/coordination corrigés avec régression :

- Façades invalidées même après double échec d'initialisation/nettoyage.
- Mutations et rendus refusés après libération pendant la destruction.
- Lecture d'horloge avant mutation temporelle, planification après commit : refus
  précommit compensé ; erreur postcommit signalée sans faux refus. Le RED originel
  prouvait une fuite de cadence/durée ; le correctif retire la planification du précommit.
- Révision revérifiée après `clock.now` : tick réentrant refusant le candidat périmé,
  sans rembobiner l'avancement physique de l'horloge.

Deux essais initiaux de seek supposaient un retour du transport après erreur de
rendu différé. Cette hypothèse a été rectifiée pour respecter le contrat existant :
temps demandé conservé, DOM compensé, erreur visible, aucune notification de
réussite et nouvelle tentative explicite. Aucun défaut corrigé n'est revendiqué
pour cette clarification. L'annulation préalable d'un geste avant load/destroy
reste une opération distincte, comme en HA8 ; cette limite est documentée.

La démo a aussi été corrigée après deux échecs Playwright : normalisation CSSOM
pour éviter les écritures/journaux redondants, et préservation d'une saisie d'image
non soumise pendant un rendu différé. Le septième scénario couvre la saisie.
Aucune assertion de compensation réduite, aucun retry ou timeout augmenté.

## Vérification complète

Commandes ordinaires, aucun UltraCode. Logs :
`%TEMP%/JsTimeline-HA9-validation-20261031/`.

| Vérification | Résultat |
| --- | --- |
| Cinq dist nettoyés après contrôle des chemins ; npm ci | 479 paquets ; manifests/lockfile inchangés |
| npm run lint | 0 erreur |
| npm run typecheck | Tous les workspaces réussis |
| npm test | 4 021 tests / 276 suites : runtime 1 208, editor 2 580, CSS 121, conventions 63, Blazor JS 49 |
| npm run build ; npm run build:demo | Réussis depuis dist propre |
| npm run test:e2e, CI=1, workers=2, retries=0 | 217 réussis ; ports 9431/9432 ; 02:38:10–02:39:23 UTC ; sortie 0, serveurs arrêtés |
| dotnet build dotnet/JsTimeline.sln -c Release --no-restore | 0 avertissement, 0 erreur |
| dotnet test dotnet/JsTimeline.sln -c Release --no-build --no-restore | 180 réussis |
| npm pack des trois workspaces ; dotnet pack Release | Trois tgz et un nupkg locaux |
| npm run test:packaging | ESM/CommonJS/CSS, playback, transactions, inspection, host rendering, types Bundler/NodeNext ESM+CJS ; consommateur C# et assets NuGet réussis |
| Comparaison dist des archives | 424 fichiers identiques : runtime 114, editor 291, CSS 19 |
| Comparaison assets NuGet | Runtime/editor ESM et CSS identiques au build final |

Les deux premiers passages navigateur avaient chacun 215 réussites et un échec
dans la nouvelle démo, corrigé avant le passage final. Les sept parcours ciblés
ont ensuite réussi avant les 217 finaux. Logs initiaux conservés sous
`playwright-before-cssom-fix.log` et `playwright-before-frame-draft-fix.log`.
Les suites navigateur Blazor séparées n'ont pas été relancées pour ce lot sans
modification C# ; aucun résultat historique n'est compté comme résultat HA9.
L'audit npm conserve les 30 vulnérabilités de développement déjà relevées en HA8 ;
aucune dépendance ni correction automatique d'audit ajoutée.

## Revue ECC

Rôles natifs : planner, TDD guide, code reviewer, TypeScript reviewer et security
reviewer. Revues finales générale/TypeScript/sécurité favorables, aucun constat
restant, derniers ajustements de démo compris. Relectures finales statiques ;
validation globale exécutée par l'intégrateur. Pas de revue C# : aucun code C# ni
schéma .NET modifié ; build, tests, pack et consommateur NuGet vérifiés.
Aucune conformité de l'adaptateur Designer revendiquée.

## Archives et passation

Dossier : `%TEMP%/JsTimeline-HA9-artifacts-20261031`.
Son README anglais identifie le commit exact, la PR et l'installation. Les
versions restent 1.0.0 : identifier par commit/SHA-256, jamais par le numéro seul.
Installer les trois archives npm ensemble. Runtime et export-css sont identiques
à HA8 ; l'éditeur contient la nouvelle API. Aucun paquet publié.

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | E8AED4B5126B6335DB78A9ACBBA27BD5B7924192CE11641C32FA9EBD63B6251F |
| kazo-ca-timeline-editor-1.0.0.tgz | 9C816308D0AB97E6FF0CB94FE56101379C01967A3C95D53FFCC8140221FE96C4 |
| kazo-ca-timeline-export-css-1.0.0.tgz | B745CA1C740B926D29C6678DD682DE546D141A5E507ABC7DFA1012D66FCF93BE |
| JsTimeline.Blazor.1.0.0.nupkg | 0575088DD5E9CE4989A6965C5584F82F3D3609F2E6F08C485BAB6627E1E50300 |

Le chantier Designer installe ce checkpoint et remplace son writer tardif par le
participant préparé, puis exécute son test
`exposes the committed Designer preview, context and history to every backend observer`.
Les preuves Timeline ne présument pas du résultat de ce raccordement.
