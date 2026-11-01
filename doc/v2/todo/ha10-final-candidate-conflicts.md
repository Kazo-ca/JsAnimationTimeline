<!-- doc/v2/todo/ha10-final-candidate-conflicts.md -->
# HA10 — Décisions de conflit sur le candidat final

Branche `v2/HA10-final-candidate-conflicts`, issue de la référence documentaire
HA9 `98c1e216e5fad056f6a99f744cba78a988fd1ab6` (code vérifié
`c340203e50ac84f5fb58e8f9e60dc83f3c2bdf56`). Lot de support autorisé après la
passation HA9. Aucune fusion, publication, création de tag ou modification du
dépôt HtmlAnimation. HA7, HA8 et HA9 gardent leurs archives propres.

## Écart et preuve initiale

Le diagnostic HA4 signe les clés et transitions du document. Calculer une
décision sur le document courant, puis ajouter une clé dans la même transaction
HA8, rend cette décision périmée. Le test public ajouté pour HA10 reproduit
`refused` au lieu de `changed`, sans importer d'implémentation interne. Le même
test échoue aussi sur le scaffold public HA10 avant sa logique fonctionnelle.
Le refus HA8 de réutiliser une ancienne signature reste intentionnel et testé.

## Plan ECC retenu

1. Ajouter `transactions.resolveHtmlConflict` et
   `IHtmlConflictTransactionRequest`, contrat `HA10-FINAL-CANDIDATE-CONFLICTS/1`.
   Recevoir ticket original, choix explicite, éventuelle politique de préfixe,
   écritures `set` annoncées et garde `isCurrent` obligatoire. Ne pas accepter
   de commande, capture, effet hôte ou remplacement libre du contexte.
2. Valider le ticket avant toute édition, appliquer les écritures avec le moteur
   existant, recalculer le véritable diagnostic final et créer sa décision avec
   le résolveur HA4. Ne pas fabriquer une signature. Si le conflit disparaît,
   garder les écritures confirmées sans décision devenue inutile.
3. Utiliser l'atomicité, le renderer et l'historique HA8/HA9. Vérifier la garde
   jusqu'à la frontière de commit. Undo/cancel peuvent restaurer uniquement les
   diagnostics initiaux exacts enregistrés, sans autoriser d'autres bloqueurs.
   Redo revalide l'état et les capacités, pas l'ancien ticket d'interface.
4. Conserver tests publics, démo française et parcours Playwright ; vérifier
   archives et types publics ; exécuter le contrôle local complet et les revues
   ECC générale, TypeScript et sécurité avant une PR ouverte vers `v2/base`.

## Limites et critères

La signature HA4 ne constitue pas une identité des nœuds DOM ni une empreinte
complète du CSS source. L'hôte reste responsable de la garde de confirmation,
avec lecture des sources hors aperçu. Le cas 59 reste automatique ; aucune clé
n'est ajoutée sans écriture explicitement annoncée. Une mutation depuis une
notification est refusée immédiatement ; un nouvel appel après notification
reste possible, conformément au choix confirmé par l'utilisateur.

Les preuves couvrent signature authentique, tickets périmés, garde et permissions,
préfixe disparu, absence de clés implicites, refus sans consommation du redo,
undo/redo/groupes, cohérence au premier observateur et compensation du renderer.
La projection spatiale commune appartient à HA11 et n'est pas livrée par HA10.

## État

Implémentation et vérification locales terminées : 4 066 tests JavaScript dans
280 suites, 223 parcours Playwright, 180 tests .NET, builds et consommateurs
d'archives verts. Revues ECC générale, TypeScript et sécurité finales sans
constat restant. Les 45 tests ciblés HA10 comprennent les reproductions des
défauts de revue. Voir `ha10-validation.md` pour les résultats et empreintes.
Le suivi distinct `ha9-history-refusals.md` décrit un refus d'historique dont
le motif public est perdu ; sa correction et la projection spatiale restent
des suites séparées, sans modification des archives HA9.
