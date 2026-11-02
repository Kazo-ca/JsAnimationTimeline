<!-- doc/integration/timeline-ha4-api.md -->
# HA4 — API HTML pour HtmlAnimation

30 octobre 2026. Contrat consommé : HA-TL-001 r2. Branche
`v2/HA4-html-target-resolution`, basée sur `2f5295d` (HA3, PR #124).
Cette API accompagne les paquets construits depuis cette branche ; elle ne décrit
pas une nouvelle version déjà publiée sur npm ou NuGet. Les preuves finales sont
dans `doc/v2/todo/ha4-validation.md` du dépôt Timeline.

## Responsabilités et sauvegarde

Le modèle temporel reste générique. L'adaptateur HTML du runtime résout les
sélecteurs, inspecte les bases CSS et arbitre les contributions par élément et
propriété. Le Designer fournit les destinations CSS et la structure initiale des
dégradés. Il conserve les décisions HTML avec son projet :

```ts
interface HtmlProject {
  timeline: ITimelineDocument;
  html: IHtmlAnimationContext;
}
interface IHtmlAnimationContext {
  version: 1;
  bindings?: Readonly<Record<string, Readonly<Record<string, HtmlPropertyBinding>>>>;
  gradients?: Readonly<Record<string, readonly IHtmlGradientDefinition[]>>;
  resolutions?: readonly IHtmlConflictResolution[];
}
```

Les deux dictionnaires externes sont indexés par identifiant stable de calque,
le dictionnaire de bindings par nom de propriété temporelle. Par exemple,
`marginTop` est associé à `{kind:'style', cssName:'margin-top', unit:'px'}`.
Les noms temporels respectent la validation du modèle ; un nom CSS avec tiret
n'est pas automatiquement un identifiant temporel valide.

`cloneHtmlAnimationContext(input: unknown)` valide et détache les données JSON.
Les champs inconnus, accesseurs, fonctions, cycles et références de dégradé
inexistantes sont refusés. Les dictionnaires copiés n'ont pas de prototype.
Le schéma séparé est `schema/html-animation-context.schema.json` ; les contraintes
de références et d'identités sont aussi vérifiées par le validateur runtime.
Aucun champ CSS n'est ajouté au document générique ni aux modèles temporels C#.

L'historique des clés reste celui de `editor.propertyTimelines`. L'hôte conserve
l'historique de son contexte HTML, comme ses autres données de projet. Les helpers
de résolution sont purs : une proposition ou son annulation ne change rien.
La démo fournit des boutons d'annulation/rétablissement de décision distincts.
Aucune opération HA4 n'ajoute implicitement une clé initiale pour résoudre un conflit.

## Scène et inspection

```ts
const stage = createEditorHtmlStage(editorContainer, {
  root: sceneContainer,
  animationContext: project.html
});
const editor = createEditor(editorContainer, { data: project.timeline, stage });
```

`createHtmlStage` offre les mêmes fonctions dans le runtime. Les méthodes réelles
de `IHtmlStage` sont :

| Membre | Comportement |
| --- | --- |
| `resolve(target)` | Premier élément représentatif, conservé pour compatibilité avec `IStage<Element>`. |
| `resolveElements(target)` | Toutes les correspondances autorisées ; `root` et exclusions s'appliquent aux sélecteurs. Une ref ou un élément explicite reste une cible unique. |
| `inspectProperty(target, property, {layerId?, valueKind?})` | Nombre d'éléments, `editable`, `interpolable`, motif éventuel et valeur initiale commune. |
| `targets.describe(target)` | Métadonnées et capacités courantes, avec capture/validation utilisées par les commandes. |
| `animationContext` | Copie détachée du contexte enregistrable. |
| `setAnimationContext(context)` | Validation avant application ; conserve les clés temporelles. |
| `diagnostics` | Conflits, capacités indisponibles et décisions périmées ; copies des diagnostics courants. |
| `refresh()` | Rafraîchit bases et membres des cibles après une modification du DOM ou des feuilles de style sources. |
| `withSourceStyles(action)` | Suspend les déclarations d'aperçu, exécute une action synchrone sur les styles sources puis recapture les bases et rétablit l'aperçu. |
| `mode` / `effectiveMode` | Mode demandé / stratégie réellement employée. |

Pour modifier un style inline que la scène pilote déjà, utiliser
`withSourceStyles` ; écrire directement dans cet inline pendant l'aperçu ne
constitue pas une mise à jour fiable de la base. Les bases inspectées pendant
l'aperçu ne sont jamais les valeurs d'animation. La scène restaure uniquement
ses déclarations, avec leurs priorités initiales ; les styles voisins restent
à l'hôte. Les écritures modernes utilisent `!important` pour appliquer l'aperçu
même face à une classe source importante.

Les pistes modernes et les groupes utilisent l'évaluation exacte à chaque image,
y compris fractionnaire, même si `mode:'waapi'` a été demandé. Dans ce cas
`effectiveMode === 'frame'`. Les documents historiques à cibles uniques conservent
leur stratégie historique. `buildLayerKeyframes` continue de refuser une conversion
moderne qui ferait perdre sa sémantique.

## Capacités, édition et capture

Une propriété de groupe est indisponible lorsque ses bases effectives diffèrent.
Les autres propriétés communes restent modifiables. Le motif invite à utiliser
des ID individuels ; l'interface peut le présenter dans un bouton d'information.
Le panneau numérique affiche ses propriétés bloquées avec un champ désactivé
et une explication ; le panneau CSS du Designer utilise l'inspection pour les
autres propriétés et leurs types.

`ITargetPropertyInfo` possède désormais les champs optionnels `editable`,
`interpolable`, `reason`, `initialValue`, `sample(layerId, frame)` et
`validate(layerId, timeline: IPropertyTimeline | undefined)`. `undefined` représente
le retrait complet de la piste : la validation vérifie aussi le retour à sa base.
La validation retourne des diagnostics
`{severity:'error'|'warning', message, property?, fromFrame?, toFrame?}`.
Ces capacités sont génériques ; elles n'exigent aucun DOM.

Les commandes HA2/HA3 relisent ces capacités, y compris au redo. Un diagnostic
bloquant refuse l'édition ; un avertissement seul la permet. Les textes et
booléens se modifient par maintien, sans MotionTween. Les propriétés CSS exigeant
des entiers, comme `z-index`, se modifient également par maintien : une
interpolation susceptible de produire des fractions est refusée. Une nouvelle propriété
exige toujours sa valeur initiale fournie par l'hôte.

Une capture F6 reprend le rendu résolu, et refuse un groupe dont les membres
affichent des valeurs différentes. Un `set` explicite peut modifier la piste de
groupe commune même si une cible spécifique surcharge certains éléments :
la valeur saisie est enregistrée sur la piste choisie. Les clés, transactions,
annulations et événements restent ceux de l'API HA2 ; aucun moteur temporel
supplémentaire n'est nécessaire dans le Designer.

Quand seules les valeurs affichées diffèrent, le panneau conserve donc le champ
modifiable, vide avec une indication de valeurs multiples. Cette situation est
distincte de bases CSS divergentes, qui rendent la propriété du groupe indisponible.

## Priorités et décisions explicites

La priorité est appliquée par destination CSS et par élément. Une propriété
spécifique ne remplace pas les autres propriétés de la contribution de groupe.
Le cas 59 reste automatique : groupe constant dès 1, piste plus spécifique
constante avec sa première clé ultérieure ; sa première valeur s'applique dès
le début sur le recouvrement. Hors recouvrement, la base précède la première clé.
Les captures redondantes de la même valeur préservent cette règle.

Les cas non couverts produisent un diagnostic avec `code`, `id`, `signature`,
`property`, `layerIds`, `targets`, période, `choices`, `blocking` et `message`.
Une égalité de spécificité ne dépend pas de l'ordre des lignes. Le diagnostic
`before-first-conflict` peut en outre proposer les politiques :

- `initial` : base spécifique avant sa première clé ;
- `first-key` : première valeur spécifique dès le début ;
- `underlying` : contribution sous-jacente jusqu'à la première clé spécifique.

Ces politiques concernent uniquement le préfixe indiqué ; `toFrameExclusive`
précise que sa borne finale est exclue. Les clés suivantes restent inchangées.
La décision se construit après confirmation du choix par l'utilisateur :

```ts
const next = resolveHtmlConflict(stage.animationContext, diagnostic,
  winnerLayerId, beforeFirstPolicy); // quatrième argument seulement pour le préfixe
stage.setAnimationContext(next);
```

`removeHtmlConflictResolution(context, conflictId)` retire une décision dans une
nouvelle copie. Toute modification rendant la signature inapplicable produit
`stale-resolution`, y compris après undo temporel. La sélection n'intervient
jamais dans l'évaluation enregistrée. L'hôte présente et enregistre les décisions.

Le calcul de spécificité prend en charge types, ID, classes, attributs et
combinateurs simples. Listes et pseudo-sélecteurs complexes peuvent être résolus
par le navigateur mais demandent une décision en cas de recouvrement ; leur
poids n'est jamais deviné. Les collisions raccourci/sous-propriété, transform
complet/composantes et fonds complets/dégradés sont aussi signalées.

## Valeurs CSS et dégradés

`HtmlPropertyBinding` a trois formes : `style` (nom CSS/unité), `transform`
(x/y/rotation/scaleX/scaleY/skewX/skewY), `gradient` (identité, composant,
éventuelle identité de point). Les transformations 2D originales sont décomposées
et leurs composantes non pilotées sont conservées. Les transformations non
représentables et les unités non convertibles sont signalées explicitement.
Les couleurs modernes utilisent des composantes sRGB de 0 à 1.

Un `IHtmlGradientDefinition` contient `id`, `cssName:'background-image'`, `type`
(`linear`, `radial`, `conic`), angle en degrés, centre/rayons en pourcentages et
des points stables `{id,color,opacity,position,present}`. La couleur du point est
un RGB opaque (`a:1`) ; sa piste d'opacité est l'unique propriétaire de son alpha.
Sa position est un pourcentage, également pour les dégradés coniques.

Depuis HA7, les points présents sont ordonnés au rendu par position évaluée
croissante. À position égale, l'ordre structurel initial est conservé, pour
préserver les ruptures de couleur. Ce tri ne modifie ni le tableau du contexte,
ni les identifiants, ni les pistes de couleur/opacité/présence. Le résultat est
identique en navigation directe, en lecture et en retour arrière. Cette évolution
n'est pas incluse dans les archives HA6 initiales ; voir `timeline-ha7-api.md`.

Chaque composante possède sa piste indépendante. La présence booléenne permet
d'ajouter ou retirer un point à une image sans renuméroter les autres. Le Designer
enregistre sa définition structurelle dans le contexte, puis écrit les clés via
les transactions Timeline. La structure initiale est fournie par l'hôte ; HA4
n'est pas un parseur universel de textes CSS de dégradés. Pour les groupes, le
fond source est également comparé, afin qu'une même définition fournie ne masque
pas des fonds DOM divergents.

L'ajout structurel et ses clés ne forment pas une transaction atomique publique
dans HA4–HA7 : `setAnimationContext()` est distinct de `beginTransaction()`.
Un point préenregistré invisible peut apparaître par une clé, mais son annulation
ne retire pas sa définition du contexte. La proposition technique, non livrée,
est décrite dans `timeline-host-transactions-proposal.md`.

`prepareHtmlResolution`, `resolveHtmlBinding`, `readHtmlPropertyBase`,
`captureHtmlTransformBase` et `composeHtmlDeclarations` sont exportés pour les
adaptateurs et futurs exporteurs. La composition est pure et ne modifie pas le DOM.

## Démonstration et limites restantes

Démo réelle : `demo/editor/html-properties.html`. Elle conserve les scénarios de
groupe, bases divergentes, cas 59, F6, dégradé, choix de priorité, rechargement,
transformation et restauration. Les tests Playwright associés passent par l'UI.

HA5/HA6 restent à réaliser après validation de la phase B : JSON de lecture,
JavaScript autonome HTML et export CSS fidèle ou refus motivé. Aucun export
moderne complet n'est annoncé par cette passation. Le contrat cible r2 reste
l'autorité produit ; cette page précise la correspondance d'API effectivement livrée.
