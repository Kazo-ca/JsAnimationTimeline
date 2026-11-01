<!-- doc/integration/README.md -->
# Passation HtmlAnimation ↔ JsAnimationTimeline

Édition du 30 octobre 2026. Dossier documentaire autonome ; aucun accès à l'autre
session n'est nécessaire. Les droits d'accès aux conversations et aux dossiers
peuvent varier selon l'outil : ils ne constituent pas un mécanisme de coordination.

## Lire dans cet ordre

1. [Spécifications du Designer](specifications-designer.md) — produit, contrôles,
   comportements décidés, cas de référence et critères d'acceptation.
2. [Contrat cible de Timeline](timeline-contract.md) — garanties futures attendues,
   état actuel observé, opérations conceptuelles et scénarios de conformité.
3. [Message de démarrage pour la session Designer](designer-session.md) — contexte
   à transmettre à la session qui travaillera dans HtmlAnimation.
4. [API HA1](timeline-ha1-api.md), [API HA2](timeline-ha2-api.md), [API HA3](timeline-ha3-api.md), [API HA4](timeline-ha4-api.md), [API HA5](timeline-ha5-api.md) et [API HA6](timeline-ha6-api.md) — capacités
   effectivement implémentées, méthodes publiques, vérifications et limites restantes.
5. [Raccordement réel et référence de travail](timeline-integration-status.md) —
   interfaces à consommer, parcours réutilisables et distinction avec les versions publiées.
6. [Transactions HA8](timeline-ha8-api.md) et
   [rendu hôte HA9](timeline-ha9-host-render-api.md) — historique partagé,
   préparation compensable et aperçu visible avant les notifications. Lire leur
   état de validation et la référence des archives avant de les installer.
7. [Décisions de conflit HA10](timeline-ha10-conflict-api.md) — confirmation du
   diagnostic original et calcul sur les clés réellement obtenues. Vérifier
   l'état de livraison indiqué dans ce contrat avant de l'utiliser.
8. [Refus d'historique HA9B](timeline-ha9b-history-refusals-api.md) — complément
   pour préserver le motif public d'undo/redo avec le renderer hôte.
9. [Projection spatiale HA11](timeline-ha11-spatial-api.md) — ajustements sur une
   source conservée, pivots indépendants et sorties partagées. Lire son statut
   de livraison avant de remplacer une référence consommée.

Les documents suffisent sans relire les discussions et sans suivre les références
numérotées aux anciennes questions. Les cas concernés sont décrits intégralement.
Les liens relatifs restent à l'intérieur de ce dossier ; les références externes
d'inspiration sont facultatives pour comprendre le besoin.

## Dépôts et responsabilité des documents

| Chantier | Dépôt | Clone local communiqué |
| --- | --- | --- |
| Designer et deux contrôles réutilisables | `Kazo-ca/HtmlAnimation` | `C:\Users\clefw\repos\source\HtmlAnimation` |
| Moteur et éditeur temporels | `Kazo-ca/JsAnimationTimeline` | `C:\Users\clefw\repos\source\JsAnimationTimeline` |

| Document | Référence initiale | Autorité après cette passation |
| --- | --- | --- |
| `specifications-designer.md` | HA-DESIGN-001 / révision 1. | Chantier HtmlAnimation ; copie de référence côté Timeline. |
| `timeline-contract.md` | HA-TL-001 / révision 1. | Chantier Timeline ; copie de référence côté HtmlAnimation. |
| Ce dossier et le message de démarrage | Passation du 30 octobre 2026. | Coordination documentaire ; pas un état vivant des exécutions. |

Chaque modification d'une garantie partagée doit incrémenter sa révision et expliquer
le changement. Copier la révision complète à l'autre chantier et vérifier son contenu
avant de la consommer. Si l'autre dossier n'est pas accessible, joindre le document
à la session correspondante ou le transmettre par une branche/PR explicitement
identifiée. L'historique d'un chat n'est pas la source de vérité du contrat.

Ne pas écraser une copie modifiée par l'autre chantier : comparer d'abord les
révisions et les différences. Les noms de fichiers et leurs liens sont identiques
dans les deux dépôts pour permettre une copie autonome. Une synchronisation de
documents ne vaut ni livraison de package ni validation de l'intégration.

## État au moment de la passation

| Élément | État documentaire connu |
| --- | --- |
| Décisions produit | Consolidées dans HA-DESIGN-001 / r1. |
| Garanties attendues de la Timeline | Décrites dans HA-TL-001 / r1. |
| API actuelle de la Timeline inspectée | Snapshot `e90be9d5338b81ad644455c89ca64d22c526eb09` ; capacités et limites dans le contrat. |
| API exacte du futur raccordement | Correspondance de méthodes/types à fournir par le chantier Timeline. |
| Implémentation des garanties manquantes | Non réalisée par la préparation de cette passation. |
| Tests de conformité du futur contrat | Non exécutés ; scénarios TL-C01 à TL-C16 à conserver. |
| HtmlAnimation au début de la passation | Clone existant avec sa licence ; aucune implémentation ajoutée ici. |
| Nouvelle session Designer | Aucun chat créé ni message envoyé par cette passation. |

## Avancer en parallèle

Le chantier HtmlAnimation peut concevoir les deux contrôles autonomes, les parcours
du Designer, la sélection, les outils et les diagnostics à partir des spécifications.
Pour les échanges Timeline, utiliser une frontière d'adaptation et, lorsque le
travail d'implémentation sera autorisé, des scénarios simulés identifiés comme tels.
Ils ne doivent pas devenir un second moteur temporel livré dans le Designer.

Le chantier Timeline est responsable des clés/pistes, des règles d'évaluation,
des transitions, des opérations d'historique nécessaires et des garanties de lecture.
Il fournit la correspondance de l'API future et une référence exécutable précise
pour remplacer les simulations. Il peut consulter la spécification Designer copiée
localement pour comprendre les parcours consommateurs.

Le travail en parallèle ne nécessite pas que les versions actuelles satisfassent
déjà le contrat futur. En revanche, le raccordement final exige les mêmes versions
de documents, une version/commit réel de Timeline et des tests des deux côtés.

## Informations à échanger lors d'une évolution

Chaque chantier consigne dans sa passation de suivi :

- révision du contrat consommée et document modifié, le cas échéant ;
- branche et commit concernés, ou indication « changements locaux non commités » ;
- capacités réellement disponibles, capacités encore simulées et écarts connus ;
- scénarios de conformité exécutés, résultats et tests Playwright pertinents ;
- modification d'API ou de schéma avec la correspondance de l'ancien vers le nouveau.

Les mécanismes techniques peuvent être conçus sans redemander les choix produit
déjà tranchés. Une proposition qui change un comportement décidé doit être identifiée
comme telle et soumise à l'utilisateur. Les conflits d'animation non couverts suivent
le mécanisme fonctionnel prévu, pas une priorité inventée par l'implémentation.

### Mise à jour du 30 octobre : effets MotionTween

Le contrat `timeline-contract.md` passe à la révision 2 : choix d'effets inspirés
de Blend, modes, paramètres et aperçu de courbe, avec conservation des effets
à la découpe et à la sauvegarde. La copie r2 a été transmise à HtmlAnimation
après vérification que sa copie r1 n'avait pas changé. Le tableau précédent
reste le constat initial de passation, pas une déclaration de livraison.

Le chantier Timeline progresse par HA1 à HA6, dans
`doc/v2/plan-html-animation-alignment.md` de son dépôt. Le socle HA1 ne livre
pas encore les commandes de conception, les lignes de propriétés ou l'adaptateur
HTML complet. Le raccordement du Designer doit attendre les capacités réellement
validées et leur correspondance d'API.

### Mise à jour HA3 / HA4

HA3 est fusionné par la PR #124 dans `v2/base` (`2f5295d`) : lignes de propriétés,
commandes visuelles et accélérations configurables. HA4 ajoute la scène HTML exacte,
les groupes, les bases CSS, les valeurs riches et les décisions de conflit.
Consulter les API ci-dessus et leurs preuves de vérification avant raccordement.
Les formats de lecture/export modernes restent le chantier HA5/HA6 ; aucun nouveau
package publié ne doit être déduit de ces mises à jour documentaires.

### Mise à jour HA5

La phase B est validée. La branche `v2/HA5-playback-exports`, issue de `fef760a`
(PR #125), ajoute les formats de lecture préévalués et le JavaScript autonome.
Leur précision est explicitement `sampling: 'frames'` ; le document éditable
conserve l'évaluation fractionnaire de ses courbes. Le format HTML contient ses
déclarations résolues et ne doit pas être remplacé par une application DOM du
JSON générique. Voir l'API HA5 et `doc/v2/todo/ha5-validation.md` dans Timeline
pour les signatures réelles, les conditions de ciblage et les preuves obtenues.
La PR #126 est fusionnée dans `v2/base` au commit `79aea4c`.
HA6 ajoute l'API CSS stricte, avec refus global lorsqu'une trajectoire ou la cascade
ne permettent pas une reproduction continue. Consulter le document de raccordement
et l'API HA6 pour la référence à intégrer et les limites exactes.

## Règles de travail à emporter

- Les documents n'autorisent pas à coder pendant la discussion de spécification.
  L'autorisation d'implémenter viendra de la demande adressée à chaque chantier.
- Interface en français ; code, commits et PR en anglais. Conserver les instructions
  locales du dépôt et les règles personnelles ECC lorsqu'elles sont disponibles.
- Avant une implémentation, suivre les règles ECC et les agents exigés par l'utilisateur ;
  la préparation de ces documents n'est pas une revue ECC du futur code.
- Pas de `any` ; chaque nouveau fichier commence par son chemin relatif dans un
  commentaire adapté. Les styles de la Timeline restent sous `.JsTimeLine` ; le
  nommage/scoping des nouveaux contrôles est à définir dans leur propre dépôt.
- Commandes fonctionnelles annulables et tests d'annulation ; tests Playwright
  des parcours visuels et scénarios réutilisables dans les démos.
- Builds/tests en commandes ordinaires, jamais via UltraCode. Les contrôles de
  validation propres à chaque dépôt restent applicables.
- Ne pas fusionner de PR vers `main` sans approbation de l'utilisateur, sauf
  instruction explicite contraire. Aucun package n'est publié par cette passation.
