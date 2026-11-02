<!-- doc/v2/todo/ha9-history-refusals.md -->
# Suivi — Motif public des refus d'historique atomique

Signalé par le consommateur Designer pendant son raccordement HA9, après son
test réel d'observateurs devenu vert. Lot HA9B autorisé sur
`v2/HA9B-history-refusal-events`, depuis le checkpoint HA10 documentaire
`a3f9c04be2dad14100434abf9a373e890c6fb3ac` (fonctionnel `426ae9d`).
Les archives HA9 et HA10 restent immuables. Aucun nouveau comportement produit
n'est demandé ; aucune fusion, publication, création de tag ou écriture Designer.

## Constat vérifié en source

Avant le raccord de rendu HA9, une commande ordinaire dont undo/redo levait
`CommandRefusedError` passait par `CommandStack.apply` et publiait
`command:refused` avec l'identité de commande et son `reason` exact.
Avec `hostRenderer`, HA9 route les commandes ordinaires dans l'historique
atomique. Son `replay` ramène le résultat détaillé de `run` à un booléen sans
publier cet événement. Le motif est disponible puis perdu. Ce trou existait
déjà pour les transactions HA8 ; HA9 l'étend aux commandes ordinaires.

Le refus compensable reste `false` avec état restauré ; une compensation
impossible reste une faute persistante avec exception. Un historique vide doit
continuer à retourner `false` sans fabriquer un événement de refus.

## Reproduction consommateur transmise

Le coordinateur confirme deux RED conservés dans HtmlAnimation :
`npm test -- tests/timeline-atomic.test.ts -t "reports a public backend"`.
Les motifs attendus sont `Permission undo refusée` et `Permission redo refusée`.
Le consommateur ne reçoit que ses messages de secours génériques. Document et
historique sont intacts, sans faute persistante. Ces résultats sont rapportés
par l'autre chantier, pas exécutés par Timeline ; ils sont distincts du test
d'observateurs HA9 devenu vert sans affaiblissement de ses attentes.

## Correction et preuve attendues

Reproduire le cas avec l'API publique, préserver le motif exact et publier une
seule fois après compensation et abandon du lot, avec l'état restauré déjà
visible. Préserver la commande originale pour une entrée ordinaire. Examiner
le représentant public des entrées composites sans changer le contrat décidé.
Garder la protection contre les mutations réentrantes pendant la notification.

Tester undo et redo, motif exact sans préfixe artificiel, identité de commande,
document/aperçu/historique inchangés, réessai après retrait de la cause, refus de
rendu après écriture et distinction avec faute persistante. Les résultats HA9B
ci-dessous établissent ensuite ces garanties côté Timeline.

## Plan et RED HA9B

Planner ECC exécuté : préserver le motif métier exact, publier après compensation
et abandon du lot, protéger la notification contre la réentrance. Conserver la
commande originale pour une entrée ordinaire unique ; utiliser un représentant
descriptif sans effet pour une unité composite. Ne pas fabriquer de refus pour
un historique vide ou une faute persistante. Les résultats structurés des
transactions conservent leur contrat.

Le TDD public reproduit le défaut avant correction : deux cas sans renderer
passent ; les deux mêmes cas avec renderer échouent, événement attendu une fois
mais reçu zéro fois. Journal : `%TEMP%/JsTimeline-HA9B-tdd-red-20261101.log`.
Ajouter les refus de révision et de rendu partiellement appliqué, l'état lu
depuis l'observateur, les groupes, le réessai après réparation et la réentrance.
Une suppression ciblée évite qu'un appel `execute` depuis `command:refused`
réémette récursivement le même événement, sans masquer les refus ordinaires.

## Résultat HA9B

Correction et gate local terminés : 4 088 tests JavaScript, 226 parcours Playwright,
180 tests .NET et consommateurs d'archives verts. Les 22 nouveaux tests publics
couvrent aussi les deux chemins de refus réentrant immédiat/différé constatés
en revue, avec RED avant correction. Le callback complet est placé dans le lot
existant pour garder la protection active lors de sa véritable livraison.
Démo française `history-refusals.html` et trois parcours Playwright conservés.
Revues ECC générale, TypeScript et sécurité finales sans constat restant.
Voir `ha9b-validation.md` pour preuves, limites et empreintes. La projection
spatiale reste un lot distinct après cette correction consommateur.
