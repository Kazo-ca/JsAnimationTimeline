<!-- doc/v2/todo/ha9-integration-bridge.md -->
# HA9 — Raccordement public du Designer

Branche `v2/HA9-designer-integration-bridge`, base fonctionnelle HA8
`f6de3c592c8c90c35285332f704ef68dfcce0b41`. HA7/HA8, leurs PR et leurs archives
restent inchangés. Ce lot de support est autorisé pour satisfaire les garanties
déjà décidées. Aucune fusion, publication, création de tag ou écriture dans le
dépôt HtmlAnimation.

## Plan court

**Ordre de livraison actualisé :** le checkpoint HA9 porte uniquement sur le
rendu hôte (étape 1 et ses preuves). Le coordinateur l'a priorisé pour débloquer
le RED du Designer avant la résolution candidate et la projection spatiale.
Aucun code de ces deux autres volets n'avait été écrit au moment du découpage ;
ils restent autorisés et suivis, mais seront livrés sur une branche suivante.
Contrat de ce checkpoint : `HA9-HOST-RENDER/1`.

1. **Rendu hôte préparé.** Ajouter un raccord public opt-in de l'éditeur :
   snapshot candidat immuable, préparation sans écriture, application avant
   notification, compensation exacte. Utiliser le même historique pour les
   transactions et les commandes ordinaires, y compris undo/redo et groupes.
   Le montage avec scène d'inspection conserve un seul writer. Couvrir aussi
   navigation, lecture, instant candidat lors d'un changement de durée/fps et
   cycle de vie. Le comportement sans ce raccord reste compatible.
2. **Décision et clés annoncées.** Recevoir le ticket de conflit original et le
   choix confirmé, appliquer les opérations du moteur, puis créer la décision
   depuis le véritable diagnostic du candidat final. Ne pas recopier une
   signature pour forcer sa validité. La garde hôte doit protéger les membres
   DOM/styles sources, qui ne sont pas tous encodés dans la signature HA4.
3. **Projection spatiale commune.** Ajouter un binding distinct et versionné,
   conservant `T × R × S × sourceTransform` et les pivots indépendants après
   l'évaluation temporelle. Partager la composition entre scène, HA5 JSON/JS
   et HA6 CSS. CSS n'accepte que la fidélité continue démontrée ; sinon refus
   explicite avec alternatives. HA4 absolu et le modèle temporel générique
   conservent leur sémantique.
4. **Preuves et livraison.** Tests RED/GREEN ciblés, démo et Playwright conservés,
   revues ECC générale/TypeScript/sécurité, vérification complète locale sur le
   nouveau code, archives cohérentes et contrat versionné pour l'autre session.
   Coordonner la fenêtre navigateur avec le Designer, sans multiplier les
   suites lourdes concurrentes ni relancer HA8 comme un nouveau lot.

## Constats initiaux vérifiés

- Une résolution faite avant l'ajout d'une clé devient périmée : probe publique
  Node/jsdom sur HA8 refusée avec document/historique inchangés. L'application
  pure des opérations existe en interne, mais aucune composition publique
  actuelle ne prépare la décision sur le candidat final.
- Source `translateX(100px)` et rotation d'ajustement 0→90 aux images 1→101 :
  à 51, `R45 × T100` exige `(70,710678 ; 70,710678)`. HA4 absolu produit
  `(100 ; 0)` ; convertir seulement les clés extrêmes donnerait `(50 ; 50)`.
  Probe publique RED exécutée sans modifier le dépôt.
- Deux bindings style vers transform-origin ne représentent pas pivotX/Y :
  probe publique RED avec deux diagnostics de destination dupliquée.
- RED Designer conservé dans `tests/timeline-atomic.test.ts`, test
  `exposes the committed Designer preview, context and history to every backend observer` :
  `document:changed` observe bindings/clé/historique nouveaux mais un fond à
  90 degrés au lieu de 35. La correction doit vérifier le DOM dans les
  observateurs, pas ajouter une notification tardive.

## Limites conservées

Source CSS et conversions consenties restent explicites et récupérables. Les
unités relatives ne sont pas normalisées silencieusement en pixels ; changer
l'unité du binding ne doit pas réinterpréter les anciennes clés. La source
capturée par consentement appartient au suffixe de projection, pas à une
déclaration transform concurrente qui écrase les ajustements.

Les limites de poignées du Designer restent celles déjà convenues : cibles
individuelles mesurables 2D, refus des contextes spatiaux non pris en charge,
diagnostic explicite. Une limite des poignées ne devient pas arbitrairement
une restriction générale du panneau CSS ou des projections. Le cas 59 reste
automatique et aucune clé implicite n'est ajoutée par une résolution silencieuse.

## État

Checkpoint de rendu implémenté et vérifié localement : 4 021 tests JavaScript,
217 parcours Playwright, 180 tests .NET, builds et consommateurs d'archives verts.
Revues ECC générale, TypeScript et sécurité finales favorables. Voir
`doc/v2/todo/ha9-validation.md` pour les résultats, limites et empreintes.
Aucun code spatial ou de résolution candidate dans ce checkpoint. Les deux
besoins restent autorisés pour une branche suivante, avec leurs RED initiaux
décrits ci-dessus. La conformité du raccordement Designer reste à vérifier dans
son propre dépôt après installation ; aucune fusion ou publication effectuée.
