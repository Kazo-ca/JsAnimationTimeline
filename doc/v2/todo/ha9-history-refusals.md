<!-- doc/v2/todo/ha9-history-refusals.md -->
# Suivi — Motif public des refus d'historique atomique

Signalé par le consommateur Designer pendant son raccordement HA9, après son
test réel d'observateurs devenu vert. Constat statique confirmé le 31 octobre
2026 (Toronto) ; correction distincte de HA10 à préparer. Les archives HA9
restent immuables. Aucun nouveau comportement produit n'est demandé.

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
rendu après écriture et distinction avec faute persistante. Aucune reproduction
dynamique locale Timeline ni correction n'est encore revendiquée ici.
