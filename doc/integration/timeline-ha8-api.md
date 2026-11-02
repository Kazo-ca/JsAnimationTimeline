<!-- doc/integration/timeline-ha8-api.md -->
# HA8 — Transaction atomique du Designer

Contrat `HA8-TRANSACTIONS/1`, **implémentation vérifiée localement, livrée sur
branche et en archives locales**. Branche `v2/HA8-atomic-host-transactions`, basée sur la livraison HA7
`f88738c3b9ade14850b8f9ce91dfda6a336eec64`. La référence HA7 fonctionnelle reste
`a3b7652534a4532050d8c21d3703f957c50d61d9` (PR 128 ouverte, non fusionnée).

Le lot a été explicitement autorisé après la proposition
`timeline-host-transactions-proposal.md`. La question 2 a fixé le refus
synchrone des mutations pendant notification atomique, avec nouvel appel
possible après celle-ci. Aucune publication, aucun tag ni fusion autorisés.

## Surface publique

`editor.transactions` et `ctx.transactions` partagent l'unique historique
existant. `execute(request)` est synchrone. Une requête contient :

- `label` ;
- `commands` optionnel : commandes documentaires pures `ICommand` ;
- `properties` optionnel : `PropertyTimelineOperation[]`, images explicites ;
- `htmlContext` optionnel : `{ stageId, context }` candidat complet ;
- `effect` optionnel : participant hôte synchrone préparé et réversible ;
- `isCurrent` optionnel : garde de confirmation initiale, jamais appliquée au redo.

Les commandes précèdent les opérations de propriétés pour permettre objet puis
première clé. Aucune deuxième pile ne doit être introduite. Un contexte seul ou
un effet seul doit rester annulable. Une propriété refusée invalide toute la
requête ; aucun résultat partiel ne constitue une réussite.

Les résultats sont `changed` avec révision, `noop`, `refused` avec motif ou
`faulted` avec diagnostic. Le consommateur ne doit pas convertir `faulted` en
simple refus « rien n'a changé ». `transactions.fault` expose une faute conservée.

## Participant hôte

`effect.prepare(direction)` reçoit `execute`, `undo` ou `redo` et renvoie
`{ changed, apply, rollback }`. La préparation est pure, synchrone et capture
l'état nécessaire. `rollback()` doit aussi compenser un `apply()` interrompu
après une écriture partielle.

L'état hôte inclut les attributs DOM, leur absence initiale, le journal net et
les deltas Full XPath ainsi que les événements locaux en attente. Restaurer
seulement l'attribut sans restaurer ce journal est insuffisant. Aucune intention
utilisateur ne doit être rejouée comme une nouvelle édition lors d'undo/redo.
Les effets réseau et irréversibles restent exclus de ce contrat.

L'échec d'une compensation doit être visible et bloquer les mutations et
l'historique. Un simple load(document) ne prouve pas que le DOM a été réparé :
la récupération minimale prévue consiste à détruire l'instance, restaurer
explicitement l'état hôte puis recréer une instance cohérente.

La façade `transactions.execute` retourne `faulted`. Les méthodes historiques
à résultat booléen (`execute`, `undo`, `redo`) lèvent en cas de faute
irrécupérable ; `false` reste un refus ordinaire, pas une preuve de compensation
échouée. Le détail reste accessible dans `transactions.fault`.

## Garanties vérifiées

Le document et le contexte candidats sont validés ensemble, y compris les
nouvelles cibles rendues accessibles par un effet provisoire. Les diagnostics
introduits ou affectés sont refusés sans transformer un conflit préexistant
sans rapport en interdiction globale. Les décisions de résolution ne sont
jamais rendues artificiellement valides par réécriture de signature.

Toute notification de succès observe document, contexte, rendu et disponibilité
d'historique cohérents pour les participants de la transaction. Une tentative réentrante pendant cette notification est
refusée immédiatement ; la même demande peut être rappelée après. Une exception
d'observateur ne défait pas le commit déjà réussi.

L'événement ciblé `transaction:changed` porte `transactionId`, `label`, `revision`,
`phase` (`preview`, `commit`, `cancel`), `cause` et éventuellement `groupId`.
Un groupe HA2 mixte émet des aperçus puis un seul commit terminal. Son annulation
restaure aussi contexte et effets en ordre inverse, sans perdre le redo antérieur.
Load/destroy doivent compenser un groupe actif et invalider ses poignées sans
agir sur un document ultérieur.

## Compatibilité avec HtmlAnimation

Quand l'hôte possède son rendu HTML, utiliser
`createHtmlInspectionStage(options)` du runtime et passer **cette instance** à
`createEditor`. Elle expose les mêmes métadonnées et le même contexte HTML que
`createHtmlStage`, sans écrire de style ni créer d'animation Web Animations.
Un décorateur artisanal de `IStage` ne transporte pas le participant atomique.

`IHtmlInspectionStageOptions` reprend les options HTML sans `mode`, avec
`preserveSource?: <T>(read: () => T) => T`. Ce callback doit exposer les styles
source pendant la lecture synchrone puis restaurer l'aperçu hôte, y compris
l'absence initiale d'attribut `style`. Il s'applique aussi aux lectures différées
`sample`/`validate` et à l'inspection du candidat. Les écritures de l'effet hôte
restent en dehors de ce callback.

Cette scène ne rend pas implicitement l'aperçu du Designer. L'hôte reste
responsable de son rendu et doit inclure les modifications DOM qui exigent une
compensation dans son participant `effect`. L'atomicité ne couvre pas une
écriture externe indépendante effectuée par un observateur après le commit.

Les noms `HA-ADAPTER-001/r3` ou les types locaux de dégradés r4 ne prouvent pas
une compatibilité avec cette API. L'adaptateur doit mapper explicitement
ses résultats, sa sélection et ses notifications vers le contrat validé.

Cas de conformité : première édition avec calque/cible/bindings/base/clé ; nouveau
point avec ID stable, définition, canaux couleur/opacité/position/présence et
base false ; décision de conflit et clés ; modification d'attribut et journal
même sans modification temporelle. Undo retire la structure ajoutée ; redo
restaure les mêmes identifiants. Le renommage des cibles déjà animées reste
interdit côté Designer ; cette API ne l'autorise pas implicitement.

Les transformations supplémentaires de l'adaptateur Designer r3 et les
composantes absolues décomposées HA4 nécessitent toujours leur correspondance
explicite. Ce lot ne modifie pas cette sémantique pour contourner l'intégration.

Les commandes documentaires doivent rester pures et réversibles. Le redo
revalide leurs refus et permissions actuels ainsi que les capacités des
propriétés ; il ne rejoue pas l'ancien `isCurrent` lié à la sélection ou à
l'image active au moment de l'édition initiale.

## Livraison et preuves

Vérification complète et revues ECC générale, TypeScript et sécurité terminées,
sans constat restant. Les archives HA7 ne contiennent pas cette API. Les trois
archives HA8 cohérentes, le paquet NuGet local et leurs empreintes se trouvent
dans `%TEMP%/JsTimeline-HA8-artifacts-20261031` ; le `README.md` de ce dossier
identifie le commit fonctionnel exact. Les preuves sont conservées dans
`doc/v2/todo/ha8-validation.md`.

La session Designer possède leur installation et ses essais d'adaptateur. Ce
lot ne modifie pas le dépôt HtmlAnimation et ne revendique pas sa validation.
Démo conservée : `demo/editor/atomic-transactions.html` ; parcours automatisés :
`e2e/validation/atomic-transactions.spec.ts`.
