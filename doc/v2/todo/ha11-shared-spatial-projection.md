<!-- doc/v2/todo/ha11-shared-spatial-projection.md -->
# HA11 — Projection spatiale commune

Branche `v2/HA11-shared-spatial-projection`, issue de la référence documentaire
HA9B `bbbbf10beab6e8cc1e40aef0ff4612e0fe050357` (code vérifié
`6d19da1f75af53e902b86164ce4cfb8003cef465`). Lot de support autorisé ; aucune
fusion, publication, création de tag ou modification du dépôt HtmlAnimation.
Les archives précédentes restent immuables.

## Écart et RED publics

La projection Designer conserve `translation × rotation × scale × sourceTransform`.
La transformation HA4 est une décomposition absolue ; réutiliser sa rotation
change la signification de l'ajustement. Une source `translateX(100px)` avec une
rotation 0→90 entre les images 1 et 101 doit donner une translation de
`(70,710678 ; 70,710678)` à l'image 51, et non `(100 ; 0)` ou `(50 ; 50)`.
Deux pistes de pivots ne peuvent pas non plus piloter la même déclaration
`transform-origin` comme deux styles indépendants.

Deux tests publics reproduisent ces différences avant la correction. Leur log
initial est conservé sous `%TEMP%/JsTimeline-HA11-tdd-original-red-20261101.log`.
Le plan et les tests sont accompagnés par les agents natifs ECC planner/TDD.

## Plan retenu

1. Ajouter une définition spatiale versionnée et un binding distinct. Conserver
   source écrite, provenance, conversions consenties, unités et origine X/Y/Z.
   La source peut être une piste texte maintenue, donc sa capture garde sa date.
2. Composer les canaux déjà évalués dans le runtime commun. Aperçu, renderer
   hôte HA9 et HA5 JSON/JavaScript partagent cette composition. HA4 et le moteur
   temporel générique gardent leur comportement. Refuser une nouvelle unité qui
   réinterpréterait les clés existantes.
3. Inclure les définitions complètes dans les conflits et le regroupement CSS.
   N'accepter HA6 que lorsque sa fidélité continue peut être démontrée ; sinon
   expliquer le refus global et proposer les exports JSON/JavaScript.
4. Conserver démo française, tests de matrices/origines/coins dans Chromium,
   tests publics d'historique, archives et contrat autonome. Exécuter les revues
   ECC générale/TypeScript/sécurité puis le contrôle local complet. Coordonner
   les suites lourdes et la fenêtre navigateur avec le Designer.

## Contraintes de fidélité

Les expressions sources et unités relatives restent du CSS ; aucune conversion
silencieuse en pixels ni interpolation de seules matrices extrêmes. Les échelles
évaluées peuvent être nulles ou négatives et conserver les dépassements de courbe.
Les restrictions de manipulation des poignées appartiennent au Designer : elles
ne limitent pas arbitrairement la projection du moteur.

Une conversion consentie conserve sa provenance récupérable. Sa date d'audit ne
remplace pas une clé temporelle. Un pivot modifié ne supprime pas les coordonnées
source non pilotées, notamment Z. Les membres d'un groupe doivent rester
compatibles ; un identifiant de projection commun ne suffit pas à les fusionner.

## État

Pause du 1er novembre 2026 levée par Benoit. Vérification complète terminée, voir
`doc/v2/todo/ha11-validation.md`. Contrat : `doc/integration/timeline-ha11-spatial-api.md`.

## Cas ajoutés par les revues

- **Sources de groupe :** deux sources écrites `50%` et `100px` peuvent donner
  la même matrice à une taille précise. RED publics inline/stylesheet et création
  de clé ; correction par preuve des déclarations gagnantes, pas uniquement de
  leur valeur calculée. Deux parcours navigateur sont conservés dans la démo.
- **Piste sans clé :** `initialValue: 2` avec unité `em` ne doit pas devenir
  implicitement `2px` lors d'une première clé ultérieure. RED setter/transactions,
  refus sans consommer le redo et suppression/recréation explicite couverts.
- **Identité locale :** deux noms de projection différents ne doivent pas empêcher
  `#id` de gagner sur `.classe`. La priorité utilise le composant physique ; la
  composition vérifie les sources qui coexistent réellement. Les signatures
  continuent d'inclure la provenance complète.
- **Syntaxe numérique :** alternatives numériques disjointes pour éviter le
  backtracking quadratique d'une chaîne invalide proche de la limite de longueur.
  L'imbrication des expressions est également bornée.

Les logs RED/GREEN restent conservés sous `%TEMP%` et seront regroupés avec le
rapport complet après la dernière vérification. Les mesures de revue ciblées
ne valent pas une exécution de la suite globale ni un résultat navigateur.
