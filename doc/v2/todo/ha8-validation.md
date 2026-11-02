<!-- doc/v2/todo/ha8-validation.md -->
# HA8 — Suivi de l'historique partagé

31 octobre 2026. Branche `v2/HA8-atomic-host-transactions`, base HA7 documentaire
`f88738c3b9ade14850b8f9ce91dfda6a336eec64`, PR 128 non fusionnée. Le lot technique
a été explicitement autorisé. Refus synchrone pendant notification confirmé à
la question 2 (message utilisateur reçu le 1er novembre à 01:07:06.948 UTC,
soit le 31 octobre à Toronto). Aucune nouvelle confirmation n'est nécessaire.

## Plan et responsabilités

Plan ECC et guide TDD natifs exécutés. La proposition est conservée dans
`doc/integration/timeline-host-transactions-proposal.md`. API versionnée ciblée :
`HA8-TRANSACTIONS/1`, documentée dans `timeline-ha8-api.md`.

- Noyau : pile unique, entrée atomique et journal de compensation, préparation
  candidate HTML, installation puis notification, garde/cycle de vie/faute.
- TDD : preuves d'ajout structurel complet, refus, compensation, historique,
  groupes, événements, réentrance, chargement et destruction.
- Démo/Playwright : parcours visibles conservés, snapshots en lecture seule,
  vraie API publique, aucun second moteur ni historique simulé.
- Intégrateur : consommateurs d'archives, contrat de passation, vérification
  complète, revues ECC et PR vers v2/base laissée sans fusion.

## Résultat

Implémentation et vérification locales terminées. La branche inclut HA7 et HA8,
avec un historique unique, des effets hôtes préparés/compensables, la validation
du candidat complet et une scène publique d'inspection sans rendu DOM. Aucune
fusion, publication ni modification du dépôt HtmlAnimation effectuée.

Avant l'implémentation, trois tests ont exécuté la façade compilée et échoué sur
refused au lieu de changed : ajout complet du point, objet + ID + première clé,
contexte seul. RED/GREEN supplémentaire acquis pour la capture résolue spécifique
et groupée, le refus pendant préparation/application/veto, les cibles DOM avant
gel, la dernière clé couleur/texte et les commandes personnalisées `kind`.
La régression des permissions d'ICommand au redo a réussi dès son premier
lancement après la correction parallèle : aucun RED revendiqué pour ce cas.

Le nouveau consommateur de types échoue contre les archives HA7 : absence de
transactions, de ses types publics et de son événement. Cette preuve distincte
évite de confondre le numéro local 1.0.0 avec la présence de l'API HA8. Log :
`%TEMP%/JsTimeline-HA7-validation-20261031/ha8-packaging-red.log`.

## Vérification complète

Commandes ordinaires, aucun UltraCode. Logs finaux dans
`%TEMP%/JsTimeline-HA8-validation-20261031/`.

| Vérification | Résultat |
| --- | --- |
| Cinq répertoires dist nettoyés après vérification des chemins ; npm ci | 479 paquets, manifests et lockfile inchangés |
| npm run lint | 0 erreur |
| npm run typecheck | Réussi dans tous les workspaces |
| npm test | 3 984 tests / 269 suites : runtime 1 208, editor 2 543, CSS 121, conventions 63, Blazor JS 49 |
| npm run build et npm run build:demo | Réussis depuis dist propre |
| npm run test:e2e, CI=1, workers=2, retries=0 | 210 tests réussis ; ports 9421/9422 ; 01:40:13–01:41:22 UTC le 1er novembre ; sortie 0, serveurs arrêtés |
| dotnet build dotnet/JsTimeline.sln -c Release --no-restore | 0 avertissement, 0 erreur |
| dotnet test dotnet/JsTimeline.sln -c Release --no-build --no-restore | 180 tests réussis |
| npm pack, trois workspaces ; dotnet pack -c Release --no-restore | Trois tgz et un nupkg locaux |
| npm run test:packaging | ESM, CommonJS, CSS, playback, transactions, inspection, types Bundler/NodeNext ESM+CJS, consommateur C# et assets NuGet réussis |
| Comparaison des fichiers dist archivés avec le build final | 422 fichiers identiques : runtime 114, editor 289, CSS 19 |

Les six nouveaux scénarios Playwright HA8 sont inclus dans les 210 tests finaux.
Les suites navigateur Blazor séparées n'ont pas été relancées pour ce lot sans
modification C# ; leurs résultats HA7 ne sont pas comptés comme des tests HA8.
L'audit npm signale les mêmes 30 vulnérabilités de développement que HA7 ; aucune
dépendance ni correction automatique d'audit ajoutée dans ce lot.

## Revue ECC

Rôles natifs utilisés : planner, TDD guide, code reviewer, TypeScript reviewer,
security reviewer. Quatre constats MEDIUM corrigés avec régression : refus
réentrant confondu avec noop, gel d'une cible DOM invalide, suppression de
dernière clé CSS typée, collision avec le kind d'une ICommand. Revues finales
générale/TypeScript/sécurité favorables, aucun constat restant. Pas de revue
C# : aucun code C# ni schéma .NET modifié ; build, tests et consommateur NuGet
vérifiés. Aucune conformité de l'adaptateur Designer revendiquée.

## Archives locales et passation

Répertoire distinct de HA7 : `%TEMP%/JsTimeline-HA8-artifacts-20261031`.
Son README identifie le commit exact et les instructions d'installation. Les
versions restent 1.0.0 : identifier cette livraison par commit et SHA-256, jamais
par le numéro seul. Installer les trois archives npm ensemble. La session
Designer assure cette installation ; Timeline n'écrit pas dans son dépôt.

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | E8AED4B5126B6335DB78A9ACBBA27BD5B7924192CE11641C32FA9EBD63B6251F |
| kazo-ca-timeline-editor-1.0.0.tgz | 3EACD0734240493740FE5F5095E19CE58F8CD51C84824BFB1EBF6A0D8CA57908 |
| kazo-ca-timeline-export-css-1.0.0.tgz | B745CA1C740B926D29C6678DD682DE546D141A5E507ABC7DFA1012D66FCF93BE |
| JsTimeline.Blazor.1.0.0.nupkg | DB9731B3CE4D03D36BC6084F012F69EC62FA5278804E9685EB6D852E56884823 |
