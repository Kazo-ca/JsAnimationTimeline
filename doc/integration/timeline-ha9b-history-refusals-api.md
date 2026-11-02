<!-- doc/integration/timeline-ha9b-history-refusals-api.md -->
# HA9B — Motifs publics des refus d'annulation et de rétablissement

Complément `HA9-HISTORY-REFUSALS/1`, **corrigé et vérifié localement** sur
`v2/HA9B-history-refusal-events`. Il restaure un comportement du canal public
existant `command:refused` ; il n'ajoute pas une seconde pile d'historique.
Les checkpoints HA9 et HA10 précédents restent distincts et immuables.
Référence fonctionnelle : `6d19da1f75af53e902b86164ce4cfb8003cef465`,
[PR #132](https://github.com/Kazo-ca/JsAnimationTimeline/pull/132), non fusionnée.

## Comportement attendu

Avec `hostRenderer`, une commande ordinaire dont `undo` ou `do` refuse pendant
le replay doit retourner `false` et publier exactement une fois
`command:refused`. Pour `CommandRefusedError`, le motif est `error.reason`, sans
le préfixe du message d'erreur. Le champ `command` garde l'identité originale
pour une commande ordinaire unique. Une entrée composite utilise un représentant
descriptif figé, stable pour la même entrée, portant son libellé ; ses méthodes
`do` et `undo` rendent le document reçu sans effet et ne rejouent aucun participant
hôte. Il ne remplace pas la commande réelle conservée dans l'historique.

La notification intervient après compensation et abandon des événements de
succès provisoires. Son observateur lit déjà le document, le contexte, l'aperçu
et l'historique restaurés. Les mutations réentrantes sont refusées pendant cette
notification, sans boucle de notifications de refus ; un appel après sa fin est
possible. Un refus conserve l'entrée d'historique pour réessayer après réparation.
Si une notification de refus est différée par le lot atomique existant, sa
protection couvre la livraison réelle aux callbacks, pas seulement sa mise en
file. L'appel réentrant reste refusé immédiatement ; seule la notification suit
le mécanisme de publication déjà en place.

Un historique vide continue à retourner `false` sans événement de refus. Une
compensation impossible conserve la faute persistante et son exception ; elle
ne devient pas un refus ordinaire. Les API de transactions retournant un
`EditorTransactionResult` conservent leur canal et ne doublent pas leurs refus.
Leur champ `reason` utilise aussi le motif exact de `CommandRefusedError`,
plutôt que son message préfixé. Les autres erreurs gardent leur message.

## Raccordement Designer

L'adaptateur peut continuer à écouter `command:refused` autour d'undo/redo et
afficher son motif précis. Ses deux régressions conservées sont :
`npm test -- tests/timeline-atomic.test.ts -t "reports a public backend"`.
Elles attendent respectivement `Permission undo refusée` et
`Permission redo refusée`. Ces tests sont indépendants du test d'observateurs
HA9 déjà rapporté vert par le consommateur.

Plan : `doc/v2/todo/ha9-history-refusals.md`. Résultats et archives :
`doc/v2/todo/ha9b-validation.md`. Les 22 tests publics et les trois parcours
Playwright de `history-refusals.html` restent réutilisables. Le consommateur
doit encore installer cette référence et rejouer ses deux RED sans en réduire
les attentes. Ne pas attribuer ce correctif aux archives HA9 ou HA10 déjà livrées.
