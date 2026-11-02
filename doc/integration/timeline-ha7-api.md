<!-- doc/integration/timeline-ha7-api.md -->
# HA7 — Ordre des points de dégradé au rendu

Choix confirmé par l'utilisateur : réordonner les points selon leur position
évaluée en conservant leur identité. Branche `v2/HA7-gradient-stop-order`, base
`f93429bd55d3f950b31bb833c6068176de0555bd`. Les preuves et références de livraison
sont dans `doc/v2/todo/ha7-validation.md`.

## Comportement

La composition partagée des dégradés linéaires, radiaux et coniques applique
d'abord les valeurs indépendantes par `stopId`, filtre les points absents, puis
trie une copie des points présents par position numérique croissante.
Les positions négatives ou supérieures à 100 restent acceptées. À position égale,
l'ordre du tableau structurel est conservé. Aucun tri par ID n'est effectué.

Exemple : rouge à 20 % et bleu à 80 % se déplacent respectivement jusqu'à 80 %
et 20 %. À mi-parcours, rouge puis bleu restent à 50 % ; après le croisement,
bleu précède rouge au rendu. Couleur, opacité et présence restent associées aux
identifiants initiaux. Ni la définition source, ni ses bindings, ni les pistes
ne sont réordonnés. Une navigation directe ou arrière donne le même résultat.

La scène et l'éditeur évaluent les images fractionnaires. HA5 JSON/JavaScript
conserve la précision par image annoncée et embarque les déclarations triées.
HA6 CSS exporte les dégradés maintenus ; une interpolation de composante reste
refusée avec `unsupported-gradient-interpolation` et les alternatives JSON/JS.
Ce lot ne change aucun schéma, signature publique ni modèle C#.

## Intégration du Designer

Le contrat HA4 décrit les canaux indépendants : géométrie et type du dégradé,
puis position, couleur RGB opaque, opacité et présence de chaque point.
Utiliser un `layerId`, un `gradientId` et des `stopId` stables. Les noms de pistes
suivent les identifiants alphanumériques de Timeline, pas des chemins CSS.

Pour un point déjà défini avec `present:false`, une première clé true à l'image
50 avec `initialValue:false` le laisse absent avant 50, sauf politique issue
d'un conflit de sélecteurs. Aucune clé artificielle à l'image 1 n'est nécessaire.
Au moins deux points doivent rester présents à toutes les images pertinentes.

`editor.propertyTimelines.beginTransaction()` regroupe les clés ; undo/redo et
cancel restaurent ces pistes et leur rendu. Il ne regroupe pas une modification
structurelle du contexte HTML ou un effet hôte. L'ajout structurel atomique
requis par le Designer reste distinct, décrit explicitement comme proposition
non implémentée dans `timeline-host-transactions-proposal.md`.

Les démos `html-properties.html` et `playback-exports.html` conservent les
régressions via l'interface, le lecteur JSON et l'import réel du module autonome.
Leurs captures Playwright restent réutilisables pour les démonstrations.

## Livraison locale

Installer ensemble les trois archives runtime/editor/export-css provenant de
la même référence vérifiée. Leur numéro 1.0.0 ne distingue pas HA6 et HA7 :
utiliser le commit et les empreintes SHA-256. Ne pas remplacer les archives HA6
au même chemin. Importer explicitement `@kazo-ca/timeline-editor/timeline-editor.css`.
La session Designer possède son installation ; cette session ne modifie pas son
dépôt. Aucun tag, publication ou fusion n'est autorisé dans ce lot.
