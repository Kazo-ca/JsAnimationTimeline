<!-- doc/integration/timeline-ha9-host-render-api.md -->
# HA9 — Rendu hôte avant notification

Contrat `HA9-HOST-RENDER/1`, **implémenté et vérifié localement**.
Référence et archives : `doc/v2/todo/ha9-validation.md`.
Base HA8 : `f6de3c592c8c90c35285332f704ef68dfcce0b41`.
Branche : `v2/HA9-designer-integration-bridge`.

Le checkpoint concerne uniquement le rendu hôte préparé et compensable. La
résolution de conflit sur candidat final et la projection spatiale restent des
volets distincts à réaliser ; HA9 ne les annonce pas comme disponibles.

## Surface publique

`createEditor(container, { hostRenderer, stage, ... })` accepte un participant
`IEditorHostRenderer` avec `prepare(candidate): IPreparedHostChange`. Les types
sont exportés par `@kazo-ca/timeline-editor`.

`IHostRenderCandidate` expose une vue immuable :

- `document` : document temporel candidat ;
- `htmlContexts` : contextes HTML candidats, chacun avec son `stageId` ;
- `time` : instant candidat, borné et cohérent avec durée/fps candidats ;
- `sample` : échantillon évalué par le moteur Timeline ;
- `cause` : `initialize`, `execute`, `undo`, `redo`, `group-cancel`, `load`,
  `refresh`, `seek`, `playback` ou `destroy`.

La préparation est pure et synchrone. Son résultat réutilise le contrat HA8
`{ changed, apply, rollback }`. `rollback` restaure exactement les déclarations
et leur priorité, l'absence d'attributs, l'état du renderer et ses éventuels
journaux/notifications différées, y compris après une application interrompue.

## Responsabilités

Utiliser `createHtmlInspectionStage` lorsque l'hôte est seul propriétaire de
l'aperçu HTML. Son `preserveSource` reste responsable des lectures de sources.
L'application préparée intervient après la fin de cette protection temporaire,
afin que la restauration des styles de lecture n'écrase pas le nouvel aperçu.
Le participant reçoit les valeurs du candidat ; il ne doit pas chercher une
valeur ancienne dans un cache mis à jour seulement par un observateur ultérieur.
Lire `candidate.sample.layer(layerId)?.propertyValues` pour les pistes typées.
Le callback peut fonctionner sans DOM (`stage: false`) ; pour HTML, ne pas le
combiner avec une scène qui écrit elle aussi les mêmes styles. Le contrat de
writer unique relève du montage hôte, pas d'une détection automatique des scènes.

Le montage remplace l'ancien abonnement hôte qui effectuait le même rendu après
`document:changed` ou `frame:render`. Garder les deux chemins provoquerait deux
écritures et rendrait les garanties de compensation impossibles à attribuer.
Les observateurs restent utilisables pour afficher des informations après
succès ; ils ne constituent plus le point de préparation du rendu.

## Garanties vérifiées

Le document, les contextes, le rendu hôte et l'historique sont cohérents dès la
première notification de succès. Le raccord concerne les transactions HA8 mais
aussi `editor.execute`, les commandes des plugins et `propertyTimelines`, avec
undo/redo et groupes. Sans `hostRenderer`, le comportement existant est conservé.

Un refus ou une exception avant commit compense les écritures provisoires sans
consommer le redo. Une compensation impossible expose la faute persistante HA8
et bloque les mutations et prochains rendus. Détruire l'instance reste permis ;
l'hôte doit restaurer son état avant recréation. Une exception d'observateur
après commit ne défait jamais une transaction réussie.
La réconciliation de cadence/durée avant commit utilise un instant d'horloge
capturé, sans planifier de callback. Un échec de lecture de l'horloge avant cette
réconciliation refuse la commande et compense son aperçu. La planification de
l'image suivante appartient aux notifications postcommit : si `requestFrame`
échoue, le bus signale l'erreur, mais document, rendu, timing et historique
restent ceux de la commande réussie. Aucun refus trompeur n'est retourné après
une validation déjà effectuée.

La navigation et la lecture utilisent le même writer, avant `playhead:changed`
et `frame:render`, sans créer d'historique. Un changement de cadence conserve
l'image entière courante ; une réduction de durée borne cette image. Le candidat
et les premiers observateurs utilisent déjà cet instant réconcilié.

`seek` conserve son contrat existant : le transport change immédiatement, le
rendu suit à la prochaine image d'affichage. Si ce rendu différé échoue, son DOM
et son journal sont compensés et l'erreur remonte ; aucun événement d'image
réussie n'est publié. Le transport reste à l'instant demandé, sans rembobinage
implicite. L'hôte peut réessayer explicitement après correction. Cette frontière
ne transforme pas `seek` en une commande d'historique.

L'initialisation prépare le premier rendu avant les plugins et `editor:ready`.
Un échec compensable nettoie les ressources et la racine ajoutée. Un chargement
refusé conserve le document, le rendu et la branche redo ; un chargement réussi
réinitialise l'historique avant ses observateurs. `refreshTargets` réinspecte
les sources puis prépare un rendu sans créer d'entrée d'historique.

Exception de cycle de vie conservée de HA8 : avant `load` ou `destroy`, un geste
actif contenant des participants hôtes est d'abord annulé et compensé, avec ses
notifications d'annulation. Cette annulation est une opération terminée distincte.
Si le chargement ou la destruction échoue ensuite, l'état conservé est celui
après annulation du geste ; le geste n'est pas rouvert et son aperçu provisoire
n'est pas restauré. Pour contrôler cette étape, l'hôte termine explicitement le
geste avant de demander le changement de cycle de vie.

La cause `destroy` permet à l'hôte de préparer la restitution des styles sources.
Si elle échoue mais se compense, la destruction lève et l'éditeur reste utilisable
pour une nouvelle tentative. Après une faute persistante, la destruction libère
le noyau sans rappeler le renderer ni masquer l'état DOM à réparer.
Une fois le renderer libéré, les callbacks de destruction ne peuvent plus
modifier le document ni réappliquer l'aperçu. Si initialisation et nettoyage
échouent tous deux, les façades conservées par un plugin sont définitivement
invalidées et les deux erreurs sont conservées dans l'erreur retournée.

Les mutations réentrantes sont refusées pendant préparation/application/
compensation et notification atomique.
Ce refus est synchrone : aucun appel n'est mis en attente. Dès que les
notifications se terminent, un nouvel appel est permis. Ce choix a été confirmé
par l'utilisateur ; une exception de callback ne retire pas le succès déjà
commis.

## Preuves et raccordement

Le test Designer `exposes the committed Designer preview, context and history
to every backend observer` doit observer la série de fonds
35→90→35→55→35→55 pour transaction execute/undo/redo puis édition directe
Timeline/undo/redo. Chaque observateur doit déjà lire le rendu correspondant.
Les 37 nouveaux tests locaux et les sept parcours navigateur conservés dans
`host-rendering.html` couvrent cette série, les refus, la compensation partielle,
la faute, la réentrance, l'instant candidat et le cycle de vie. Les preuves et
archives HA8 restent distinctes ; aucune validation du raccordement Designer
n'est présumée. Son chantier doit installer les trois archives identifiées par
commit et SHA-256, remplacer son writer tardif et exécuter son propre test RED.
