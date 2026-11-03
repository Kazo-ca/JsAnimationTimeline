<!-- doc/integration/timeline-ha11-spatial-api.md -->
# HA11 — Projection spatiale partagée

Contrat `HA11-SPATIAL-PROJECTION/1`. Vérifié localement, voir
`doc/v2/todo/ha11-validation.md` du dépôt Timeline.
Ce document complète HA4/HA5/HA6/HA8/HA9 et ne modifie pas leurs garanties
temporelles. Il ne faut pas déduire une disponibilité dans les versions publiées.

## Responsabilité

Timeline évalue les canaux puis produit `T × R × S × sourceTransform`. Le
Designer fournit la source hors aperçu et les écritures consenties. Il ne doit
ni interpoler ni reconstruire un second moteur. Les bindings HA4 `transform`
restent absolus ; le nouveau binding `spatial` exprime un ajustement.

La composition suit l'ordre des fonctions CSS et conserve leur liste ; remplacer
uniquement les extrêmes par des matrices ne conserve pas nécessairement le trajet.
Références : [ordre de rendu CSS](https://drafts.csswg.org/css-transforms/#transform-rendering)
et [interpolation des transformations](https://drafts.csswg.org/css-transforms/#interpolation-of-transforms).

## Données additionnelles

Le contexte HTML reste à `version: 1`. Son champ optionnel `spatial` associe chaque
identifiant de calque à une liste de `IHtmlSpatialDefinition`. Chaque définition
porte `id`, `version: 1`, `composition: 'prepend-trs'`, `sourceTransform`,
`origin: { x, y, z }`, `provenance: { transform, origin }` et les éventuelles
`conversions` consenties.

Une coordonnée est soit `{ value, unit }`, soit `{ css }` pour conserver une
expression source. X/Y acceptent `px`, `%`, `em`, `rem`, `vw`, `vh` ; Z exclut
les pourcentages. Z reste conservé sans nouvelle piste de profondeur dans HA11.

Chaque capture source porte `kind: 'authored' | 'computed'`, `computedValue` et
éventuellement `authoredValue`. Une conversion porte `id`, `property`,
`confirmedAtFrame`, `originalValue`, `replacementValue`,
`reason: 'source-unavailable' | 'unit-replacement'`, `consent: 'explicit'`.
Ces données sont un audit récupérable ; `confirmedAtFrame` ne pilote pas la lecture.

| Composant du binding `spatial` | Type temporel | Unité du binding |
| --- | --- | --- |
| `translateX`, `translateY`, `pivotX`, `pivotY` | `number` | `px`, `%`, `em`, `rem`, `vw`, `vh` |
| `rotation` | `number` | `deg`, `rad`, `turn` |
| `scaleX`, `scaleY` | `number` fini | Aucune |
| `sourceTransform` | `text`, maintenu | Aucune |

Tous ces bindings portent `projectionId`. Les ajustements absents valent 0 pour
translation/rotation et 1 pour l'échelle ; les pivots absents conservent la source.
Les échelles ne sont pas bornées : zéro, valeurs négatives et dépassements de
courbes sont conservés. La validation des gestes Designer peut être plus stricte.

## Source datée et unités

Une capture consentie est une écriture dans une piste `sourceTransform`, avec
une `initialValue` source et une clé à l'instant choisi. Le texte évalué devient
le suffixe de la composition ; il n'écrase pas les ajustements. L'hôte utilise
HA8 pour enregistrer clés, contexte et effets dans une même action annulable.

Une unité appartient à la piste. Remplacer `%` par `px` dans son binding ne
convertit pas ses anciennes clés, valeurs initiales ni sources de transitions.
Une telle réinterprétation doit être refusée. Les conversions consenties doivent
rester explicites ; elles ne sont jamais déduites d'un changement de métadonnée.
La protection vaut aussi pour une piste conservée sans clé : son `initialValue`
existe déjà. HA11 n'effectue pas de migration automatique ; supprimer puis recréer
explicitement la piste reste possible, avec l'historique ordinaire.

## Composition et sorties

`composeHtmlDeclarations` reçoit en dernier argument optionnel les définitions
spatiales, après les dégradés et la base HA4. Ce helper public reçoit des valeurs
déjà évaluées et retourne des déclarations/diagnostics sans écrire le DOM. Le
renderer préparé HA9 reste l'unique writer lorsque l'hôte l'utilise.

HA5 conserve sa précision déclarée `sampling: 'frames'` ; les déclarations CSS
produites conservent leurs unités. HA6 doit préserver les valeurs entre les
images. Les trajectoires non représentables sont refusées globalement, avec
diagnostic et alternatives JSON/JavaScript ; aucune approximation silencieuse.

Les définitions complètes participent aux signatures de conflit et au regroupement
des cibles. Des identifiants de projection identiques ne prouvent pas la compatibilité
de deux sources. Les collisions avec un style `transform`/`transform-origin` ou un
binding absolu doivent être expliquées.

Les identifiants de projection sont locaux aux calques. Leur orthographe ne change
pas la priorité de `#id` sur `.classe` pour un même composant. La composition distingue
les données physiques (source, origine, ordre et version) des métadonnées de provenance.
Ces dernières restent dans les signatures complètes, mais ne créent pas à elles
seules une incompatibilité physique. La capture entre objets exige des composants,
unités et bases compatibles.

Les choix de préfixe HA4 continuent d'être appliqués avant la composition : deux
sources qui se succèdent sur une seule piste ne sont pas deux sources simultanées.
Si des contributions réellement simultanées nécessitent des sources incompatibles,
le conflit est explicite. Sa décision de composition reste globale à la projection,
comme les décisions de composition existantes ; HA11 ne crée pas un nouvel historique
de décisions limitées à des sous-intervalles.

`composeHtmlSpatial(definition, changes)` expose aussi le compositeur pur pour
une définition unique. Chaque changement contient `{ binding, value }`. Il ne
lit ni n'écrit le DOM et ne calcule aucune image intermédiaire. Pour réunir des
contributions résolues de plusieurs calques, appeler
`resolveHtmlSpatialBindings(context, properties)` : ses `bindings` suivent l'ordre
des propriétés reçues, ses `definitions` remappent les identifiants locaux sans
confondre leurs sources. Passer ensuite ces résultats à `composeHtmlDeclarations`.

## Sources prises en charge et groupes

Le contrôle portable accepte les fonctions de transformation 2D/3D avec valeurs
finies, unités CSS et expressions `calc`, `min`, `max`, `clamp`, `var` dans les
arguments typés. Les expressions ne sont pas évaluées en pixels. Le navigateur
valide aussi la déclaration complète lorsqu'il fournit `CSS.supports`.
Une variable qui remplace toute la liste, comme `var(--transform)`, reste refusée :
elle pourrait produire `none`, qui ne peut pas être ajouté comme suffixe à une
liste de fonctions. `env`, `attr` et les mots-clés globaux ne sont pas des sources
prises en charge par ce contrat. Une source refusée reste récupérable dans sa
provenance ; la conversion exige l'accord explicite de l'utilisateur.

Les sources sont limitées à 16 384 caractères, les identifiants à 512 caractères.
La validation borne l'imbrication des expressions et des règles CSS ; une entrée
hors de ces limites produit un refus, sans écriture DOM.

Pour un groupe, l'égalité des matrices calculées ne suffit pas : `translateX(50%)`
et `translateX(100px)` peuvent coïncider à 200 px de large et diverger ensuite.
L'inspection compare donc les expressions gagnantes **et** les valeurs calculées
de `transform` et `transform-origin`, hors aperçu. Les styles inline et les feuilles
accessibles avec sélecteurs reconnus sont pris en charge ; les médias exigent une
vérification par `matchMedia`. Une cascade inaccessible ou non démontrable
(imports, couches, règles scope/supports, imbrications non prises en charge) est
refusée pour les groupes. Les sources dépendant de variables sont aussi refusées
pour un groupe, car une même expression peut cacher des unités différentes selon
le membre. Les objets individuels conservent la prise en charge décrite plus haut.

Ces refus invitent à choisir des objets individuels ou une source explicite
commune. Ils ne remplacent jamais une source par celle d'un autre membre.

## Livraison et vérification

Référence vérifiée : `2b920f1123458b2ddd80d5c726eb1b11047e1d82`, branche
`v2/HA11-shared-spatial-projection`. Empreintes, preuves et limites :
`doc/v2/todo/ha11-validation.md`. Les archives HA9B ne contiennent pas HA11.
