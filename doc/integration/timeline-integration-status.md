<!-- doc/integration/timeline-integration-status.md -->
# Raccordement réel de HtmlAnimation à la Timeline

Ce document accompagne le contrat HA-TL-001 r2 et les API HA1 à HA8. Il permet
au chantier HtmlAnimation d'avancer sans accès à la conversation Timeline.

## Référence de travail

Les changements sont intégrés par PR dans `Kazo-ca/JsAnimationTimeline`, branche
`v2/base`. HA1 à HA5 sont fusionnés (PR #122 à #126, dernière fusion `79aea4c`).
La référence fonctionnelle HA6 vérifiée est
`3345e1ca499c5141527275bf72ba9e7c1e5e5811`, dans la
[PR #127](https://github.com/Kazo-ca/JsAnimationTimeline/pull/127).
Ce commit contient les API HA1 à HA6 et les preuves décrites dans
`doc/v2/todo/ha6-validation.md`. Les commits documentaires suivants ne changent
pas les binaires vérifiés.
La phase C a été validée par l'utilisateur, puis les essais locaux du Designer
et le tri des points de dégradé ont été confirmés (choix 1A/2A).
HA7 livre ce tri localement sur `v2/HA7-gradient-stop-order`, sans publication ni
fusion. Sa référence fonctionnelle est `a3b7652534a4532050d8c21d3703f957c50d61d9` ;
les preuves et empreintes sont consignées dans `doc/v2/todo/ha7-validation.md`.
Les archives HA6 initiales restent une livraison distincte.
HA8 ajoute l'historique atomique sur `v2/HA8-atomic-host-transactions`, qui inclut
HA7. Son contrat est `HA8-TRANSACTIONS/1` dans `timeline-ha8-api.md` ; son état de
validation et ses archives sont décrits dans `doc/v2/todo/ha8-validation.md`.
Les PR HA7 et HA8 restent distinctes et ne sont pas fusionnées automatiquement.

Ces changements ne désignent pas une nouvelle version publiée. Le numéro de
version des archives locales ne suffit pas à identifier ce code. Utiliser le
commit de la PR intégrée et construire ses packages, ou les archives locales
vérifiées indiquées dans le document de validation. Ne pas supposer que les
packages actuellement disponibles sur npm/NuGet possèdent ces interfaces.

## Interfaces à utiliser

| Besoin du Designer | Frontière réelle |
| --- | --- |
| Objet générique, valeurs et évaluation | Runtime HA1 : `propertyTimelines`, valeurs typées, évaluation indépendante de chaque propriété. |
| Écrire/capturer une clé | `editor.propertyTimelines.set/capture`, avec `initialValue` pour le premier enregistrement ; HA2. |
| Gestes X/Y et historique | `beginTransaction`, validation/annulation du geste et historique de l'éditeur ; HA2. |
| MotionTween, effet et découpe | `createTransition`, `removeTransition`, `setEasing`, capture dans une transition ; HA2/HA3. |
| Sélection et lignes de propriétés | `frames.grid.rows()`, `propertyKeyframes()`, sélection de calques et restauration du dépliage ; HA3. |
| CSS source, groupes et conflits | Scène HTML HA4, inspection de propriétés, contexte HTML enregistré et décisions explicites. |
| JSON de lecture générique | `compilePlayback`, `parsePlayback`, `samplePlayback`, `createPlaybackPlayer` ; HA5. |
| JSON/JavaScript pour le DOM | `compileHtmlPlayback`, `parseHtmlPlayback`, `createHtmlPlaybackPlayer`, `exportHtmlJavascript` ; HA5. |
| CSS accepté ou refus global | `exportHtmlCss` avec scène et contexte HTML ; HA6. |
| Points de dégradé qui se croisent | Tri stable au rendu par position évaluée ; identifiants et données conservés ; HA7. |
| Structure, contexte, clés et effet HTML dans une annulation | `editor.transactions.execute`, même historique que HA2 ; HA8. |
| Designer seul responsable du rendu HTML | `createHtmlInspectionStage` et son callback `preserveSource` ; HA8. |

Les signatures et limites détaillées sont dans les documents d'API voisins.
L'ancienne méthode numérique `editor.setProperty()` conserve son contrat
historique : elle ne remplace pas la façade moderne. Les identifiants de lignes
de propriétés sont opaques et ne sont pas des identifiants de calques.

## Garanties à conserver pendant le raccordement

- Le Designer transmet des valeurs initiales inspectées hors aperçu ; il ne
  remplace pas la base par la valeur momentanément rendue d'une animation.
- La Timeline crée/modifie la clé de la seule propriété concernée. Elle assure
  le maintien, l'interpolation, la capture dans une courbe et la découpe exacte.
- L'arbre DOM, le panneau CSS et les poignées utilisent les API de sélection et
  de commande ; ils ne rejouent pas une navigation comme une édition utilisateur.
- Les objets `.button` et `#button-2` restent distincts. Le cas 59 se résout dans
  la scène HTML sans ajouter une clé initiale au document éditable.
- Le contexte HTML et ses décisions se sauvegardent avec le projet Designer,
  séparément du document temporel générique. Une décision périmée est refusée.
- HA7 trie les points au rendu par position, sans modifier leur identité.
  L'historique atomique pour contexte HTML + clés + effets DOM appartient à HA8.
  Ne pas supposer sa présence dans les archives HA7 ou les versions publiées.
- L'effet HA8 doit compenser son DOM, son journal Full XPath et ses événements
  en attente, même après une application partielle. Un simple couple redo/undo
  existant ne prouve pas cette garantie. Une faute de compensation exige une
  restauration hôte et une recréation de l'éditeur.
- Un document éditable ne se reconstruit pas à partir du JSON préévalué. Les
  sorties HA5 annoncent une précision par image ; le CSS HA6 accepté est continu.
- Le Designer présente les refus CSS et les alternatives disponibles. Il ne
  contourne pas un refus en réimplémentant l'interpolation ou en supprimant des
  pistes sans l'annoncer.

## Parcours de conformité réutilisables

| Contrat | Parcours conservé dans Timeline |
| --- | --- |
| TL-C01 à C05, C07, C09, C10 | `e2e/validation/property-editing.spec.ts`, `property-keyframes.spec.ts` et tests de commandes par propriété. |
| TL-C08, C11, C12, C17 | `e2e/validation/property-editor.spec.ts`, `property-editor-easing.spec.ts`. |
| TL-C06, C13, C14 | Démo `html-properties.html`, tests de résolution HTML et parcours Playwright associés. |
| TL-C15, C16 | Démo `playback-exports.html`, tests Node sans DOM, parseurs et import réel du module autonome. |
| TL-C13, C15 et refus CSS | Démo `css-exports.html`, comparaison de CSSAnimation réelles avec le moteur aux images fractionnaires. |
| TL-C18 | Tests d'évaluation/découpe des sources de courbe et parcours d'insertion dans un effet élastique. |
| HA8-TRANSACTIONS/1 | Démo `atomic-transactions.html`, tests `Editor.hostTransaction*` et `e2e/validation/atomic-transactions.spec.ts`. |

Les résultats détaillés de chaque lot sont dans `doc/v2/todo/ha*-validation.md`.
HtmlAnimation doit maintenant exécuter ses propres tests d'adaptateur et de
parcours avec le même commit réel. La conformité des tests Timeline ne constitue
pas une validation automatique du Designer ; ses simulations doivent être
remplacées et identifiées explicitement lors du raccordement.

Cette passation n'autorise aucune publication ni fusion vers `main`. Les PR vers
`main` restent soumises à l'approbation explicite de l'utilisateur.
