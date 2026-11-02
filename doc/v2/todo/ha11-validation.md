<!-- doc/v2/todo/ha11-validation.md -->
# HA11 — Vérification de la projection spatiale commune

Exécutions du 2 novembre 2026 en UTC, après levée de la pause par Benoit.
Branche `v2/HA11-shared-spatial-projection`, partie de
`bbbbf10beab6e8cc1e40aef0ff4612e0fe050357`. Les PR #128 à #132 sont fusionnées
dans `v2/base` (`2ebe1a762b1cf48ca62abdc1a1fba43bd404e255`, CI verte).
Contrat : `doc/integration/timeline-ha11-spatial-api.md`.
Référence fonctionnelle vérifiée : `2b920f1123458b2ddd80d5c726eb1b11047e1d82`.
Les ajouts documentaires suivants ne changent pas les binaires vérifiés.

Aucune fusion vers `main`, publication, création de tag ou écriture dans
HtmlAnimation. Les archives HA7 à HA9B ne sont pas modifiées.

## Écarts trouvés à la reprise

- **Transformation perdue en silence.** Revue TypeScript ECC : un pivot refusé
  retirait une transformation HA4 valide, sans diagnostic sur ses pistes. Deux
  tests publics RED (`review-transform-drop-red.log`) puis correction dans
  `cssCompose.ts` : le refus d'un pivot ne touche que `transform-origin`. Si la
  projection refusée pilote la transformation, ses pistes reçoivent un diagnostic.
- **Parcours de glissement de clé.** `editor-demo.spec.ts` échouait à chaque essai.
  Le lien de démo HA11 repousse la ligne sous la fenêtre de 720 px, et la souris
  n'atteint pas ce qui est hors écran. Le test amène la grille à l'écran avant de
  calculer ses coordonnées ; aucune assertion n'est changée.
- **Échec isolé non reproduit.** Au premier passage complet, `keeps controls and
  timeline readable at 1440px` a échoué sur un `ERR_CONNECTION_REFUSED` de page.
  Il a réussi trois fois seul, puis dans les deux passages complets suivants.
  Cause non identifiée. Log : `first-e2e-full-2-failures.log`.

## Vérification complète

Commandes ordinaires, aucun UltraCode. Logs :
`%TEMP%/JsTimeline-HA11-validation-20261101/`.

| Vérification | Résultat |
| --- | --- |
| Cinq dist nettoyés, puis `npm run build` ; `npm run build:demo` | Réussis |
| `npm run lint` ; `npm run typecheck` | 0 erreur ; tous les workspaces |
| `npm test` | 4 207 tests / 290 suites : runtime 1 305, editor 2 656, CSS 134, conventions 63, Blazor JS 49 |
| Neuf parcours `spatial-projection.spec.ts` | 9 réussis, aussi inclus dans la suite complète |
| Playwright complet, `CI=1`, workers 2, retries 0 | 235 réussis, Chromium ; ports 9461/9462 ; 04:23:07–04:24:32 UTC ; sortie 0 ; ports libres ensuite |
| `dotnet build dotnet/JsTimeline.sln -c Release` | 0 avertissement, 0 erreur |
| `dotnet test dotnet/JsTimeline.sln -c Release --no-build --no-restore` | 180 réussis |
| Trois `npm pack` ; `dotnet pack` Release | Archives locales créées |
| `npm run test:packaging` | Consommateurs npm et NuGet réussis, projection spatiale incluse |
| Comparaison dist des archives | 430 fichiers identiques : runtime 119, editor 292, CSS 19 |
| Comparaison assets NuGet | Runtime/editor ESM, maps et CSS identiques au build final |

La suite Playwright a tourné sur le code final de `cssCompose.ts`. Seules les
assertions du test unitaire ajouté ont changé ensuite, et `npm test` a été relancé.
Firefox et WebKit ne sont pas couverts ; les suites navigateur Blazor séparées ne
sont pas relancées, HA11 ne contenant aucun diff C#. L'audit npm conserve ses
30 alertes de dépendances ; aucune dépendance changée.

## Revues ECC

`ecc:code-reviewer`, `ecc:typescript-reviewer` et `ecc:security-reviewer` sur
`bbbbf10..899d068`, revues statiques.

- Générale : favorable, aucun constat.
- Sécurité : favorable, aucun constat. Note pour une phase ultérieure : les champs
  de provenance ne sont pas validés ; ils ne sont pas émis dans le CSS ni les scripts.
  Les incorporer dans une balise `script` exigerait un échappement.
- TypeScript : aucun constat critique ou élevé, deux constats moyens. Le premier
  est corrigé ci-dessus. Le second reste ouvert : la capture de source de groupe
  parcourt chaque feuille pour chaque membre, jusqu'à 50 000 règles par élément,
  ce qui peut ralentir l'éditeur sur une grande page. Aucun défaut de résultat.

La correction de `cssCompose.ts` n'a pas été relue par un agent de revue distinct.

## Archives et passation

Dossier : `%TEMP%/JsTimeline-HA11-artifacts-20261101`.
Versions locales 1.0.0 : identifier par commit et SHA-256, pas par le numéro seul.
Installer les trois archives ensemble. Aucun paquet publié.

| Archive | SHA-256 |
| --- | --- |
| kazo-ca-timeline-runtime-1.0.0.tgz | 665FFC0856E732E7688F15E70319C0437225A31AC8DBA51D41476881A5313319 |
| kazo-ca-timeline-editor-1.0.0.tgz | AC00A083ADC6015944D753BAD1D706817D89DE746A8E14AAD97444240173C28D |
| kazo-ca-timeline-export-css-1.0.0.tgz | 5253386172FA71B097A7F163E3FF459BEFD58033ECC404C916449CD3831D6C95 |
| JsTimeline.Blazor.1.0.0.nupkg | 7B9EC57094B25782305B5412393871AFC526406088C1E1D43635B97776C8D8A4 |

Le Designer doit installer cette référence exacte et vérifier sa propre intégration.
Ces preuves Timeline ne présument pas du résultat de ses tests d'adaptateur.
