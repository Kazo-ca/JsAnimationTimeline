<!-- doc/integration/timeline-host-transactions-proposal.md -->
# Proposition — Transaction du document, du contexte HTML et des effets hôte

**Proposition technique uniquement. Aucune API ci-dessous n'est implémentée
dans HA7.** Le Designer r3 demande une seule annulation pour une opération qui
ajoute structure HTML, objet et clés, avec refus sans écriture partielle.
Les essais d'un dégradé déjà défini peuvent avancer indépendamment.

## Limite vérifiée

`ICommand` transforme purement un `ITimelineDocument`. `setAnimationContext`
modifie séparément le contexte HTML et notifie la scène. `cancelGroup` restaure
le snapshot temporel sans appeler undo des sous-commandes. Une commande peut
aussi être refusée après son do, sans compensation de ses effets externes.
Une commande de contexte seul retournant le même document serait un no-op.

Le Store publie document:changed immédiatement. La scène peut ensuite signaler
un refus alors que le Store contient déjà le document modifié. Le hold de scène
ne transforme donc pas cette séquence en transaction atomique.
Mettre un effet dans ICommand.do/undo sortirait du contrat. Préenregistrer un
point invisible n'est pas un ajout structurel atomique : undo le masque mais
ne supprime pas sa définition du projet.

## Extension minimale proposée

Ajouter une voie de transaction dédiée à la pile d'historique existante, sans
mettre le contexte HTML dans le modèle temporel générique :

```ts
editor.transactions.execute({
  label,
  commands,    // Commandes documentaires pures, dont création d'objet.
  properties,  // Opérations typées de propertyTimelines réutilisées.
  htmlContext, // Optionnel : stageId et contexte candidat complet.
  effect,      // Optionnel : effet local synchrone réversible préparé.
  isCurrent    // Garde de sélection/temps/document, pas une garde du redo.
});
```

Ces noms et signatures sont une proposition à finaliser dans un lot distinct.
Les opérations réutilisent capture, interpolation et validation existantes.
Le participant hôte aurait une méthode pure prepare(direction) retournant
changed, apply() et rollback(). Rollback restaure l'état capturé même si apply
échoue partiellement. Le couple r3 redo/undo ne suffit que s'il garantit cette
compensation. Réseau, publication et effets irréversibles sont hors contrat.

## Validation et publication atomiques

1. Capturer les générations du document, du contexte et du cycle de vie ; vérifier
   garde/veto ; cloner le contexte et préparer l'effet sans mutation.
2. Construire le document candidat avec commandes et opérations de propriétés.
   Le refus d'une seule opération invalide tout le lot.
3. Valider document et contexte candidats ensemble. La validation doit pouvoir
   inspecter les nouveaux bindings et objets sans lire uniquement la scène active.
4. Si l'effet change les cibles DOM nécessaires à l'inspection, l'appliquer
   provisoirement sous protection et revalider avant publication. Préparer le
   rendu et les diagnostics ; recontrôler générations et préconditions.
5. Installer document, contexte, rendu et entrée d'historique, puis seulement
   publier les événements. Ne supprimer le redo antérieur qu'après réussite.
6. En cas d'échec, compenser les effets provisoires et restaurer contexte/rendu ;
   document et historique restent inchangés, sans événement de succès.

Cela requiert une voie interne de publication différée du Store et de la scène,
pas seulement une file d'événements autour des setters actuels.

## Historique, groupes et événements

Une entrée conserve document/commandes, contextes avant/après et effet hôte.
Le contexte seul est une modification annulable. Undo/redo prévalident la
direction complète puis déplacent l'entrée seulement après réussite.
Les groupes enregistrent les participants : leur cancel les compense en ordre
inverse en plus de restaurer le document. Les résolutions sauvegardées sont
revalidées ; leur signature n'est jamais réécrite pour masquer un état périmé.

Un contexte changé hors transaction avance sa révision. Une transaction périmée
ne doit pas écraser cette modification. Interdire les mutations réentrantes
pendant préparation/application/compensation et pendant la série de notifications
atomiques. L'utilisateur a choisi le refus synchrone de ces appels, avec un motif
explicite ; un nouvel appel après la notification peut réussir. Aucune file
implicite ne promet un résultat synchrone pour une opération future. Une exception
d'observateur ne défait pas un commit déjà réussi.

Proposer un événement terminal transaction:committed avec direction et révision,
pour le onChange r3. Les événements détaillés sont émis après installation de
l'état complet. Cette garantie concerne les observations publiques Timeline/
Designer ; elle ne masque pas des mutations DOM transitoires à du JavaScript
externe ou aux callbacks de composants personnalisés.

Load/destroy doivent terminer ou compenser le geste actif avant d'invalider ses
poignées et de détacher les scènes. Un load réentrant pendant la transaction
doit être refusé ou différé, sans effacer l'historique pendant compensation.

Si la compensation échoue, retourner une faute explicite et bloquer édition/
historique jusqu'à récupération cohérente ; ne pas retourner un simple refused
prétendant que rien n'a changé. Conserver un diagnostic exploitable. La garantie
ne peut être absolue pour des callbacks hôte arbitraires.

## Tests requis avant de déclarer r3 compatible

- Deux propriétés dont la seconde est refusée : aucune clé, structure, écriture
  DOM ni entrée d'historique résiduelle.
- Effet partiellement appliqué puis exception : compensation exacte, sans succès.
- Nouveau point + bindings + présence à 50 : une entrée ; undo retire aussi la
  structure ; redo restitue les mêmes IDs. Même preuve pour objet + première clé.
- Contexte seul : undo/redo fonctionnels malgré un document identique.
- Cancel d'un groupe mixte : contexte, DOM et document restaurés ; redo conservé.
- Garde, résolution ou génération périmée : refus sans écrasement concurrent.
- Undo/redo refusé par les capacités actuelles : piles et états inchangés.
- Observateur réentrant ou fautif : état complet et ordre des événements préservés.
- Load/destroy pendant préparation/geste : aucune compensation sur un nouveau
  document ; poignées invalidées et ressources libérées.
- Compensation défaillante : faute visible, blocage et récupération documentée.
- Sauvegarde/rechargement : document et contexte distincts mais cohérents.

Aucune décision fonctionnelle supplémentaire n'est nécessaire pour cette note.
L'utilisateur a autorisé l'implémentation de ce lot distinct, HA8, après la
préparation de HA7. Sa validation et son contrat final restent à livrer ; aucune
disponibilité de cette API ne doit être annoncée au Designer. Le refus synchrone
pendant notification a été explicitement confirmé (question 2, choix A).
