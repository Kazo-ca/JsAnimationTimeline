<!-- doc/v2/todo/ha10-validation.md -->
# HA10 — Vérification des décisions sur candidat final

31 octobre 2026 à Toronto ; exécutions finales le 1er novembre en UTC.
Branche `v2/HA10-final-candidate-conflicts`, base documentaire HA9
`98c1e216e5fad056f6a99f744cba78a988fd1ab6` ; code HA9
`c340203e50ac84f5fb58e8f9e60dc83f3c2bdf56`.
Contrat : `HA10-FINAL-CANDIDATE-CONFLICTS/1`, dans
`doc/integration/timeline-ha10-conflict-api.md`.

## Résultat

La confirmation du ticket original et les écritures annoncées utilisent une
seule transaction. La décision est calculée depuis le diagnostic réellement
obtenu après les clés, sans transplantation de signature ni clé implicite.
Si les écritures éliminent le conflit, aucune décision obsolète n'est conservée.
Annulation, rétablissement, groupes et rendu hôte partagent l'historique HA8/HA9.
Aucune fusion, publication, création de tag ou écriture dans HtmlAnimation.
Les archives des checkpoints précédents restent inchangées.

## Preuves RED/GREEN et revues

Planner et TDD ECC natifs exécutés. Le premier test public reproduit le refus
HA8 d'une décision accompagnée d'une clé nouvelle ; le scaffold HA10 échoue
ensuite comportementalement avant la correction. Les 45 tests HA10 dans quatre
suites couvrent la signature finale réelle, alias et contributions, permissions,
disparition de préfixe ou de priorité, absence de clés implicites, découpe d'un
MotionTween, ticket périmé, redo, groupes, observations et compensation.

Constats corrigés avec régressions :

- Un conflit de priorité supprimé par deux pistes devenues équivalentes doit
  conserver les écritures confirmées, comme un préfixe devenu inutile.
- Les gardes lisent les styles sources à toutes les frontières, même lorsque
  l'aperçu initial ou final est différent ; les contributions sont détachées.
- Après un rafraîchissement, un redo HA10 revalide contexte et capacités ; un
  groupe divergent refuse, puis redevient réessayable après réparation.
- Les requêtes absentes et getters défaillants passent par la frontière de
  refus atomique ; champs étrangers ignorés, réentrance bloquée.
- La requête est capturée une seule fois : un getter alternant de garde ne
  peut plus contourner sa présence obligatoire ; ticket/choix/clés sont stables.

Le journal des 38 premiers tests verts est conservé. Les RED initiaux et les
GREEN ciblés 42 puis 45 ont été exécutés par les agents, avec sorties d'outils,
sans fichiers de logs séparés ; le passage complet final les inclut tous.

Revues natives ECC générale, TypeScript et sécurité finales favorables après
les corrections, sans constat restant sur HA10. Elles sont statiques ; la
vérification globale ci-dessous est celle de l'intégrateur. Pas de revue C# :
aucun code ou schéma .NET modifié. Aucun résultat de raccordement Designer
n'est présumé à partir des tests Timeline.

## Vérification complète

Commandes ordinaires, aucun UltraCode. Logs :
`%TEMP%/JsTimeline-HA10-validation-20261031/`.

| Vérification | Résultat |
| --- | --- |
| Cinq dist nettoyés après contrôle des chemins ; npm ci | 479 paquets ; manifests et lockfile inchangés |
| npm run lint | 0 erreur |
| npm run typecheck | Tous les workspaces réussis |
| npm test | 4 066 tests / 280 suites : runtime 1 208, editor 2 625, CSS 121, conventions 63, Blazor JS 49 |
| npm run build ; npm run build:demo | Réussis depuis dist propre |
| Parcours Playwright HA10 ciblés | 6 réussis, workers=1, retries=0 |
| npm run test:e2e, CI=1, workers=2, retries=0 | 223 réussis ; ports 9441/9442 ; 03:06:20–03:07:30 UTC ; sortie 0 ; serveurs arrêtés et ports libres |
| dotnet build dotnet/JsTimeline.sln -c Release --no-restore | 0 avertissement, 0 erreur |
| dotnet test dotnet/JsTimeline.sln -c Release --no-build --no-restore | 180 réussis |
| Trois npm pack ; dotnet pack Release | Archives locales créées |
| npm run test:packaging | ESM/CommonJS/CSS, lecture, transactions, nouvelle API de conflits, types Bundler/NodeNext ESM+CJS ; consommateur C# et assets NuGet réussis |
| Comparaison dist des archives | 425 fichiers identiques : runtime 114, editor 292, CSS 19 |
| Comparaison assets NuGet | Runtime/editor ESM et CSS identiques au build final |

Les suites navigateur Blazor séparées ne sont pas relancées pour ce lot sans
modification C#. Les six captures HA10 et leurs observations sont conservées
par Playwright ; la capture principale a aussi été inspectée visuellement.
L'audit npm conserve 30 vulnérabilités de développement déjà présentes ; aucune
dépendance ni correction automatique d'audit ajoutée.

## Archives

Dossier : `%TEMP%/JsTimeline-HA10-artifacts-20261031`.
Versions locales toujours 1.0.0 : identifier les archives par commit et SHA-256,
pas par le numéro seul. Installer les trois archives npm ensemble ; runtime et
éditeur changent, export-css reste identique à HA9. Aucune publication.

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | 4BC4CDF7A977B0112290E3B9A8E7BDCC8B8E0D5B24EAEC4DF0F12E5BFAECC26B |
| kazo-ca-timeline-editor-1.0.0.tgz | 471DDFD1D34D47A9A0854CDD3E6AF33A05C6E6292CD2C598D65E9C45A52D190C |
| kazo-ca-timeline-export-css-1.0.0.tgz | B745CA1C740B926D29C6678DD682DE546D141A5E507ABC7DFA1012D66FCF93BE |
| JsTimeline.Blazor.1.0.0.nupkg | 106104EC5D21F89965CFEDC7BA6B58EDCE6FF21276219CB7B1E6A397D7AEC773 |

## Limites explicites

Le ticket doit désigner un diagnostic toujours bloquant ; une confirmation
déjà résolue est refusée. Les écritures sont seulement des `set` sur les couples
participants annoncés. La garde initiale protège DOM/source ; redo revalide
contexte et capacités sans rappeler cette ancienne garde UI. Une décision sans
écriture conserve les permissions contextuelles HA8.

La projection spatiale commune reste le chantier suivant. Le motif public
manquant sur certains refus d'undo/redo HA9 est suivi séparément dans
`ha9-history-refusals.md`, avec les RED rapportés par le Designer ; ce correctif
n'est pas inclus dans HA10. La correction de ces écarts ne nécessite aucune
modification rétroactive des archives déjà livrées.
