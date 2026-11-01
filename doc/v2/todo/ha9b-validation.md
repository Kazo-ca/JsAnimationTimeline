<!-- doc/v2/todo/ha9b-validation.md -->
# HA9B — Vérification des refus publics d'historique

31 octobre 2026 à Toronto ; exécutions le 1er novembre en UTC.
Branche `v2/HA9B-history-refusal-events`, base HA10 documentaire
`a3f9c04be2dad14100434abf9a373e890c6fb3ac`, fonctionnelle
`426ae9dc4f6f4ea60923dc5e797f86a7f4cdfbb5`.
Complément `HA9-HISTORY-REFUSALS/1` :
`doc/integration/timeline-ha9b-history-refusals-api.md`.

## Résultat

Le chemin atomique publie maintenant `command:refused` après un undo/redo refusé
et compensé, avec le motif exact de `CommandRefusedError.reason`. Une commande
ordinaire conserve son identité ; une entrée composite fournit un représentant
figé, stable et sans effet. Le document, le contexte, l'aperçu et l'historique
sont déjà restaurés lors de l'observation. Les refus immédiats ou différés sont
protégés contre les mutations réentrantes et leurs notifications récursives.
Historique vide, refus et faute persistante restent distincts.

Aucune fusion, publication, création de tag ou écriture dans HtmlAnimation.
Les archives HA9 et HA10 ne sont pas modifiées. L'autre chantier doit installer
ce checkpoint avant de rejouer ses deux tests consommateurs conservés.

## Preuves RED/GREEN et revues

Planner et TDD ECC natifs exécutés. Deux témoins sans renderer passent, tandis
que les deux mêmes commandes avec renderer échouent initialement faute
d'événement. Deux chemins supplémentaires ont ensuite été reproduits : refus
depuis `document:changed`, puis refus mis en file pendant `command:before`.
Ils produisaient deux événements au lieu d'un. Le test de livraison différée
couvre aussi `renderer.prepare` et l'abandon du lot parent après échec.

22 nouveaux tests publics dans deux suites passent. Ils couvrent motifs exacts,
identité et représentants composites, lecture de l'état depuis les callbacks,
compensation partielle, effet seul, groupes/cancel, révision périmée, faute,
exceptions d'observateurs, réentrance et réessai. Lint ciblé des tests : 0 erreur.

Un passage de régression ciblé a exécuté 207 tests dans 20 suites avec couverture
de `CommandStack`, `atomicHistory`, `createEditorTransactions` et `EventBus` :
94,35 % instructions, 90,83 % branches, 92,2 % fonctions, 97,31 % lignes.
Le passage global ci-dessous est distinct. Un essai intermédiaire chevauchait
le patch de publication et a rencontré une erreur de compilation TypeScript ;
son log est conservé mais n'est pas présenté comme RED fonctionnel.

Revues finales natives ECC générale, TypeScript et sécurité favorables après
correction des chemins immédiat et différé. Aucun constat restant dans ce lot.
Ces relectures sont statiques ; l'intégrateur exécute le gate complet. Aucun
code C# ou schéma .NET modifié, donc aucune revue C# revendiquée. Les preuves
Timeline ne présument pas du résultat des tests de l'adaptateur Designer.

## Vérification complète

Commandes ordinaires, aucun UltraCode. Logs :
`%TEMP%/JsTimeline-HA9B-validation-20261031/`.

| Vérification | Résultat |
| --- | --- |
| Cinq dist nettoyés après contrôle des chemins ; npm ci | 479 paquets, manifests et lockfile inchangés |
| npm run lint | 0 erreur |
| npm run typecheck | Tous les workspaces réussis |
| npm test | 4 088 tests / 282 suites : runtime 1 208, editor 2 647, CSS 121, conventions 63, Blazor JS 49 |
| npm run build ; npm run build:demo | Réussis depuis dist propre |
| Playwright HA9B ciblé | 3 réussis, workers=1, retries=0 |
| npm run test:e2e, CI=1, workers=2, retries=0 | 226 réussis ; ports 9451/9452 ; 03:27:06–03:28:18 UTC ; sortie 0 ; serveurs arrêtés et ports libres |
| dotnet build dotnet/JsTimeline.sln -c Release --no-restore | 0 avertissement, 0 erreur après relance autorisée |
| dotnet test dotnet/JsTimeline.sln -c Release --no-build --no-restore | 180 réussis |
| Trois npm pack ; dotnet pack Release | Archives locales créées |
| npm run test:packaging | Consommateurs ESM/CommonJS/CSS, types Bundler/NodeNext ESM+CJS, C# et assets NuGet réussis |
| Comparaison dist des archives | 425 fichiers identiques : runtime 114, editor 292, CSS 19 |
| Comparaison assets NuGet | Runtime/editor ESM et CSS identiques au build final |

Le premier build .NET a refusé la copie de cinq assets générés dans `wwwroot`.
La même commande relancée hors sandbox a réussi, sans changement de source ou
de permissions. Log initial : `dotnet-build-access-denied.log`.
Les suites navigateur Blazor séparées ne sont pas relancées pour ce lot sans
modification C#. Les parcours et captures HA9B sont conservés ; la capture
principale a aussi été inspectée visuellement. L'audit npm conserve les 30
vulnérabilités de développement existantes ; aucune dépendance changée.

## Archives et passation

Dossier : `%TEMP%/JsTimeline-HA9B-artifacts-20261031`.
Versions locales 1.0.0 : identifier par commit et SHA-256, pas par le numéro seul.
Installer les trois archives ensemble ; runtime et export-css sont identiques
à HA10, l'éditeur contient le correctif. Aucun paquet publié.

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | 4BC4CDF7A977B0112290E3B9A8E7BDCC8B8E0D5B24EAEC4DF0F12E5BFAECC26B |
| kazo-ca-timeline-editor-1.0.0.tgz | BC12A4A58670C9E18AB783DAF8E3B9A2F97B9DBD1133DFD9EA38418F3059FC22 |
| kazo-ca-timeline-export-css-1.0.0.tgz | B745CA1C740B926D29C6678DD682DE546D141A5E507ABC7DFA1012D66FCF93BE |
| JsTimeline.Blazor.1.0.0.nupkg | 9C305953275C810B98443351AD9F4A2F9676EFCAE9F7E42197261E45EB2CE3A4 |

Régression consommateur à rejouer dans HtmlAnimation :
`npm test -- tests/timeline-atomic.test.ts -t "reports a public backend"`.
Attentes exactes : `Permission undo refusée` et `Permission redo refusée`, reçues
une seule fois via `command:refused`, état conservé et aucune faute persistante.
Le test de rendu HA9 rapporté vert par le Designer reste une preuve distincte.
La projection spatiale commune n'est pas livrée par ce correctif.
