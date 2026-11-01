<!-- doc/integration/timeline-ha10-conflict-api.md -->
# HA10 — Confirmation atomique d'un conflit et des clés annoncées

Contrat `HA10-FINAL-CANDIDATE-CONFLICTS/1`, **implémenté et vérifié localement**.
Branche `v2/HA10-final-candidate-conflicts`, après HA9. Ne pas supposer cette
interface disponible dans les archives HA9 ou les packages publiés.
Référence fonctionnelle : `426ae9dc4f6f4ea60923dc5e797f86a7f4cdfbb5`,
[PR #131](https://github.com/Kazo-ca/JsAnimationTimeline/pull/131), non fusionnée.

## Surface publique

`editor.transactions.resolveHtmlConflict(request)` renvoie le résultat synchrone
HA8 `EditorTransactionResult` : `changed`, `noop`, `refused` ou `faulted`.
Le type `IHtmlConflictTransactionRequest` est exporté par le package éditeur :

```ts
interface IHtmlConflictTransactionRequest {
  readonly label: string;
  readonly stageId: string;
  readonly confirmation: { readonly id: string; readonly signature: string };
  readonly winnerLayerId: string;
  readonly beforeFirst?: HtmlBeforeFirstPolicy;
  readonly properties?: readonly Extract<PropertyTimelineOperation, { kind: 'set' }>[];
  readonly isCurrent: () => boolean;
}
```

Le ticket provient du diagnostic bloquant affiché. L'adaptateur traduit le choix
opaque présenté par le Designer en `winnerLayerId` et, pour un conflit de
préfixe, `beforeFirst`. `properties` contient seulement les écritures de clés
explicitement annoncées par ce choix. Ni capture implicite, ni commande libre,
ni remplacement arbitraire du contexte HTML ne font partie de cette opération.
Le diagnostic doit encore être bloquant dans le contexte courant : répéter un
ticket déjà résolu est refusé, même si la résolution enregistrée porte encore
la même signature. Le résultat commun comprend `noop`, mais cette méthode ne
promet pas une reconfirmation idempotente d'un ancien ticket.
Les champs admis sont capturés une fois sous la protection atomique. Une requête
absente ou un getter défaillant est refusé sans écriture ni perte du redo ; les
champs étrangers de la transaction HA8 ne sont ni exécutés ni consultés ici.

Les diagnostics du runtime HA10 exposent aussi `contributions`, une liste
additive de couples `{ layerId, property }`. Les écritures sont limitées à ces
participants : les alias CSS restent possibles, sans pouvoir modifier une piste
sans rapport avec le conflit confirmé. Ne pas extraire ces couples en analysant
les chaînes opaques `id` ou `signature`. Consommer ensemble le runtime et
l'éditeur HA10 ; un runtime antérieur ne fournit pas cette information.

## Pourquoi une opération dédiée

Les clés participent à la signature HA4. Une décision produite avant leur ajout
ne confirme donc pas le document après cet ajout. HA10 valide d'abord le ticket
original, utilise le moteur de pistes pour les écritures annoncées, puis calcule
la décision sur le diagnostic réel du candidat final. L'hôte n'a pas à importer
une fonction interne, reconstruire un document hypothétique ou changer une
signature pour forcer son acceptation.

Un conflit qui disparaît après une écriture confirmée, par exemple une clé
initiale supprimant un préfixe ambigu, n'exige plus de décision enregistrée. Les
clés explicitement demandées restent présentes. Le cas 59 et les priorités
automatiques existantes ne créent jamais de clé supplémentaire.

## Garde de confirmation et historique

`isCurrent` est obligatoire. Elle couvre le ticket de l'interface, l'identité et
les membres des cibles DOM, ainsi que les sources CSS pertinentes. La signature
HA4 seule ne protège pas toutes ces dimensions. La garde est synchrone, sans
effet de bord ; les lectures du CSS source utilisent la protection hors aperçu
de la scène d'inspection. La confirmation est revalidée après les callbacks
externes avant le commit.

L'opération utilise le renderer préparé HA9 et une seule entrée d'historique.
Les garanties de compensation, faute persistante, groupes et premier observateur
restent celles de HA8/HA9. Une mutation réentrante depuis ces notifications est
refusée ; l'appel suivant après leur fin est permis.

Undo et annulation de groupe peuvent restaurer les diagnostics exacts de l'état
antérieur réellement confirmé. Cette exception n'autorise aucun autre nouveau
conflit ni aucune propriété devenue non éditable. Redo revalide l'état et les
capacités actuelles ; il ne rappelle pas l'ancienne garde de confirmation UI.
L'hôte conserve la responsabilité de synchroniser ses changements DOM externes
avec l'éditeur et son historique.
Un rafraîchissement de sources ne suffit pas à périmer l'historique HA10 : le
replay vérifie les snapshots attendus, le contexte réel et les capacités après
ce rafraîchissement. Un groupe devenu incompatible refuse le redo sans perdre
son entrée ; un retour à un état compatible permet de le réessayer.

Les écritures de pistes respectent le verrouillage et les capacités habituels.
Une décision contextuelle sans écriture conserve le comportement HA8 : elle
n'introduit pas une nouvelle interdiction liée au verrouillage d'une piste
qu'elle ne modifie pas. Les diagnostics finaux restent intégralement validés.

## Validation et raccordement

Plan et preuves initiales : `doc/v2/todo/ha10-final-candidate-conflicts.md`.
Vérification complète et archives : `doc/v2/todo/ha10-validation.md`.
Ce contrat est additif au raccordement HA9 ; il ne change pas les archives déjà
remises et ne livre pas la projection spatiale HA11. Les 45 tests publics HA10
et les six parcours de `final-candidate-conflicts.html` restent réutilisables.
Le raccordement effectif dans le Designer doit encore être testé par son chantier.
La perte du motif public de refus undo/redo, signalée séparément sur HA9, reste
suivie dans `doc/v2/todo/ha9-history-refusals.md` ; HA10 ne la revendique pas corrigée.
