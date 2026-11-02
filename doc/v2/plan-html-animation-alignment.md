<!-- doc/v2/plan-html-animation-alignment.md -->
# Alignement Timeline / HtmlAnimation

Date : 30 octobre 2026. Autorisation : corriger les écarts du contrat HA-TL-001.
Base : `v2/base`, `e90be9d5338b81ad644455c89ca64d22c526eb09`.

Le planner ECC et le guide TDD ont examiné le modèle et les tests avant toute
implémentation. Les choix produit ne sont pas remis en discussion.

## Phases et tâches

| Phase | Tâche / branche | Résultat | État |
| --- | --- | --- | --- |
| A — Socle et API | HA1 / `v2/HA1-property-tracks` | Pistes indépendantes, valeurs typées, évaluation, accélérations paramétrées, schéma et .NET. | PR #122 fusionnée dans v2/base (`1b0232b`). |
| A — Socle et API | HA2 / `v2/HA2-property-editing-api` | Commandes par propriété, découpe exacte, transactions publiques et démo moteur/API. | PR #123 fusionnée dans v2/base (`afcdb6b`). Phase A validée par l’utilisateur le 30 octobre 2026 (« 1. a »). |
| B — Éditeur et HTML | HA3 / `v2/HA3-property-rows-selection` | Lignes, sélection, dépliage, commandes visuelles et choix d'accélération avec courbe. | PR #124 fusionnée dans v2/base (`2f5295d`). |
| B — Éditeur et HTML | HA4 / `v2/HA4-html-target-resolution` | Groupes, bases DOM, valeurs CSS riches, spécificité, cas 59 et conflits. | PR #125 fusionnée dans v2/base (`fef760a`). Phase B validée par l’utilisateur le 30 octobre 2026 (« a »). |
| C — Sorties et raccordement | HA5 / `v2/HA5-playback-exports` | JSON préévalué, lecteur, export JS autonome HTML. | PR #126 fusionnée dans v2/base (`79aea4c`) après vérification locale et revues ECC. |
| C — Sorties et raccordement | HA6 / `v2/HA6-css-export-conformance` | CSS fidèle/refus explicite, parité, démo et passation API réelle. | PR #127 fusionnée (`f93429b`), référence fonctionnelle `3345e1c` vérifiée ; phase C validée par l'utilisateur. |
| Complément du raccordement | HA7 / `v2/HA7-gradient-stop-order` | Tri des points de dégradé au rendu, identité conservée, archives locales distinctes. | Référence `a3b7652` vérifiée, revues ECC favorables. Aucune fusion ni publication autorisée pour ce lot. |

Chaque tâche produit une PR vers `v2/base`. Fusion autorisée seulement après
validation complète et revues sans constat bloquant. Aucune fusion vers `main`.
À la fin de chaque phase : résumé, démo et arrêt pour validation utilisateur.
Les documents d'intégration sont conservés avec la première tâche.

## Décision technique du socle

Les documents historiques gardent leurs `spans` et leur comportement. Ajouter
des `propertyTimelines` au niveau du calque, sans permettre à une même propriété
d'avoir simultanément des clés dans les deux représentations.

Une piste moderne possède une valeur initiale propre à la cible, des clés et des
transitions explicites. La politique avant sa première clé est explicite : base
initiale normalement, première valeur uniquement lorsque le contexte d'intégration
le demande. Le cas 59 ne sera jamais codé à partir des noms littéraux des sélecteurs.
Les plages historiques restent responsables de la visibilité lorsqu'elles sont
présentes ; une plage `blank` n'est pas un reset de propriété.

Les valeurs modernes sont des objets sérialisables discriminés (nombre, texte,
booléen et couleur). Les paramètres d'un dégradé utilisent des pistes distinctes
avec une identité stable. Cette représentation est validée par le schéma, le
contrôle de forme, le validateur et les modèles C# générés.

La sortie évaluée expose ces valeurs typées. La sortie numérique existante reste
une projection de compatibilité pour les consommateurs actuels, pas une deuxième
source de données éditables. Les adaptateurs HTML et .NET doivent préserver les
valeurs typées ; aucun filtrage silencieux des couleurs ou textes n'est acceptable.

Les accélérations modernes sont sérialisables et paramétrées. Elles conservent
les courbes de Bézier et ajoutent les familles inspirées de Blend : sinus,
circulaire, puissances, exponentielle, retour, rebond et élastique, avec modes
entrée, sortie et entrée/sortie. Les paramètres sont validés et bornés ; aucune
fonction JavaScript n'est persistée dans le JSON.

Une transition peut conserver une source d'évaluation indépendante : domaine,
clés d'origine et accélération. Cela permet de restreindre une courbe lors d'une
insertion sans réappliquer le même easing à chaque moitié, ce qui changerait le
mouvement. La validation doit couvrir les images fractionnaires, le dépassement
et les interpolateurs personnalisés.

Le passage d'une propriété historique à la représentation moderne sera explicite
dans les commandes HA2. L'absence du nouveau champ conserve l'ancien rendu au
chargement. Les anciens lecteurs stricts ne sont pas censés lire les nouveaux champs.

## Validation et preuves

Écrire et exécuter les tests rouges avant l'implémentation, puis vérifier le vert.
Préserver les tests de refus, verrouillages, absence de mutation et annulation.
Remplacer seulement les attentes qui décrivent un comportement explicitement dépassé.

Cas prioritaires : indépendance opacité/position, bases par cible, maintien, absence
de clé initiale inventée, découpe exacte, valeurs riches et round-trip .NET. Les
fonctions d'accélération sont testées aux bornes, à l'intérieur et avec leurs
paramètres invalides. Les tests et démos restent réutilisables dans le dépôt.

Avant chaque PR, sur les fichiers finaux : dist nettoyé dans les chemins vérifiés,
`npm ci`, lint sans erreur, typecheck, tests, build, build:demo, Playwright avec
`CI=1`, ports propres au dossier, build .NET Release sans avertissement, tests .NET
et pack local. Les consommateurs et parcours Blazor concernés sont également vérifiés.

Ports réservés à ce dossier pour ce chantier : `E2E_EDITOR_PORT=9401`,
`E2E_RUNTIME_PORT=9402` ; vérifier leur disponibilité avant de démarrer les serveurs.
Le dépôt lit actuellement `E2E_V2_EDITOR_PORT` : définir aussi cette variable à
9401. Le cache Chromium local utilisé est `node_modules/.cache/ms-playwright`
via `PLAYWRIGHT_BROWSERS_PATH`. Les tests Blazor utilisent 9403 et 9404.

Avant PR : revues ECC générale, sécurité, TypeScript et C# pour les changements
.NET/modèles. Chaque corps de PR rapporte les preuves réellement obtenues, sans
prétendre que le contrat complet est livré après une seule tâche.

## Suivi de portée

Les fonctions d'accélération demandées le 30 octobre complètent le contrat :
sélection par transition, paramètres, aperçu de courbe, annulation et fidélité des
exports. Le dialogue HA3 offre ces familles et paramètres, la courbe exacte et le Bézier.

La référence officielle des familles et modes est
[Microsoft — Easing functions](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/graphics-multimedia/easing-functions).
Elle confirme les fonctions du framework et leurs modes ; elle ne constitue pas
une inspection visuelle de l'interface historique de Blend 4.

La copie du contrat destinée à HtmlAnimation sera actualisée sans écraser ses
modifications. Une simulation côté Designer ne vaut jamais conformité du moteur réel.

## Décision de lecture HA5

Le JSON demandé en section 7 du contrat est préévalué aux images entières. Son
champ `sampling: 'frames'` rend cette précision explicite : la recherche applique
le plancher et le bornage, puis lit directement un état complet des seules
propriétés pilotées. Aucun lissage entre échantillons n'est inventé. Le document
éditable et sa lecture exacte aux images fractionnaires restent disponibles.

Le format générique ne dépend pas du DOM. Le format HTML conserve les objets
sources distincts et ajoute les déclarations résolues qui font autorité pour le
rendu HTML. Le JavaScript autonome lit ces déclarations avec la même précision
par image, sans réimplémenter les courbes. Un groupe ne dépend jamais de l'ordre
des éléments dans `querySelectorAll` : les bases imposant plusieurs résultats
exigent des sélecteurs stables vérifiés, ou produisent un refus explicite.

La compilation est bornée, validée et sans mutation du document éditable. Les
consommateurs d'archives, les tests sans DOM et une démo de relecture autonome
vérifient la frontière réellement publiée par les fichiers du dépôt. HA6 traite
ensuite séparément la fidélité des animations CSS et leurs motifs de refus.

## Décision de fidélité CSS HA6

L'API moderne `exportHtmlCss` inspecte la scène source et annonce une fidélité
continue uniquement pour les trajectoires qu'elle peut traduire exactement.
Les images discrètes HA5 ne servent jamais à ajuster une courbe présentée comme
exacte. Les segments proviennent des clés, transitions et choix HTML résolus.

Le sous-ensemble prévu comprend les propriétés numériques CSS compatibles,
les maintiens de valeurs, les transitions linéaires/Bézier et les transformations
2D dont la composition est démontrable. Les effets non représentables, les
interpolateurs personnalisés, les courbes découpées non traduisibles et les
compositions incompatibles produisent un refus global contextualisé, avec
alternatives JavaScript/JSON. Ces alternatives gardent leur précision par image.

Les règles sont limitées au container source. Une cascade prioritaire, des
animations concurrentes ou une inspection impossible empêchent la certification.
Les déclarations importantes dominent les animations et ne peuvent pas être
contournées en ajoutant `!important` dans `@keyframes` ; voir
[CSS Animations du W3C](https://www.w3.org/TR/css-animations-1/) et
[CSS Easing du W3C](https://www.w3.org/TR/css-easing-1/).

L'ancienne API sans DOM conserve sa signature mais refuse désormais toute sortie
partielle. Elle reste un chemin historique sans certification continue. La démo
moderne et l'intégration Designer utilisent la nouvelle API stricte. Les tests
comparent des animations CSS réelles à l'aperçu aux images fractionnaires et
aux bornes exactes des clés, en plus des refus et de l'absence de mutation.
