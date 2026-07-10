# Planificateur de Road Trip

**Application en ligne :** [road-planner-brown.vercel.app](https://road-planner-brown.vercel.app/)

Un outil pour planifier des déplacements professionnels sur plusieurs jours
entre différentes agences — conçu pour les tournées de préparation/
installation d'écrans ("préparateur chantier double écrans"), mais utile
pour tout métier qui consiste à visiter une liste de sites dans l'ordre le
plus logique, sur une ou plusieurs journées, en voiture.

L'outil place vos étapes sur une carte, calcule les trajets et temps de
conduite entre elles, garde une trace des agences déjà visitées, et
comptabilise le nombre d'écrans de remplacement à prévoir en fonction de ce
qui est actuellement installé sur place à chaque étape.

## Ce que fait l'outil

- **Itinéraires sur plusieurs jours** — découpez un trajet en autant de
  journées que nécessaire, chacune avec sa propre liste d'étapes et sa
  propre couleur sur la carte.
- **Calcul d'itinéraire** — saisissez ou recherchez des adresses, et
  l'application calcule les trajets de conduite entre elles (distance/temps
  par trajet).
- **Marqueurs d'agences sur la carte** — chaque agence connue apparaît sous
  forme de point coloré :
  - 🟣 **Violet** — pas encore visitée
  - 🟢 **Vert** — déjà visitée
  - 🔵 **Bleu** — fait actuellement partie du trajet (ajoutée comme étape sur
    n'importe quel jour)
  Survolez un marqueur pour voir son adresse, son statut de visite, et les
  écrans actuellement installés sur place.
- **Deux façons de cliquer sur un marqueur** (à basculer dans l'en-tête) :
  - **Ajouter comme étape** — cliquer sur une agence l'ajoute comme
    prochaine étape de la journée active.
  - **Basculer visité** — cliquer sur une agence bascule simplement son
    statut visité/non visité, sans toucher à l'itinéraire.
- **Récapitulatif des écrans** — pour chaque agence actuellement utilisée
  comme étape n'importe où dans le trajet, l'application regroupe les
  écrans sur place par marque/modèle et calcule le nombre d'écrans neufs à
  apporter, à la fois pour tout le trajet et par agence.
- **Mode clair/sombre**, avec la carte re-teintée pour correspondre.
- **Compatible mobile** — la carte occupe tout l'écran par défaut ; les
  panneaux de planification et de récapitulatif des écrans se rangent sous
  forme de tiroirs qu'on fait glisser vers le haut/bas, pour rester hors du
  chemin tant qu'on n'en a pas besoin.

## Comment l'utiliser

1. **Ouvrez l'application en ligne** : [road-planner-brown.vercel.app](https://road-planner-brown.vercel.app/)
2. **Ajoutez vos étapes pour le Jour 1** : saisissez une adresse dans un
   champ d'étape et choisissez-la parmi les suggestions d'autocomplétion,
   ou cliquez sur un marqueur d'agence sur la carte (en mode "Ajouter comme
   étape") pour l'ajouter comme prochaine étape.
3. **Calculez l'itinéraire** : appuyez sur le bouton de calcul pour tracer
   les trajets de conduite sur la carte et voir la distance/le temps par
   trajet.
4. **Ajoutez d'autres jours** avec l'onglet « + » si le trajet s'étend sur
   plusieurs journées — chaque jour a son propre onglet et sa propre
   couleur d'itinéraire.
5. **Consultez le récapitulatif des écrans** : dès que des agences figurent
   dans votre itinéraire, le panneau (à gauche sur ordinateur, en haut sur
   mobile) affiche le total des écrans par marque/modèle et le nombre
   d'unités neuves à apporter, mis à jour automatiquement au fur et à
   mesure que vous ajoutez ou retirez des étapes.
6. **Marquez les agences comme visitées** au fil de la tournée, soit en
   passant le mode de clic sur « Basculer visité » et en touchant le
   marqueur, soit directement depuis l'itinéraire.
7. **Basculez le mode sombre** depuis le bouton situé à côté du sélecteur
   de thème dans l'en-tête, si vous planifiez de nuit ou si vous préférez
   simplement ce mode.

## Stack technique

- [Next.js](https://nextjs.org/) (App Router) + TypeScript
- [Leaflet](https://leafletjs.com/) pour la carte, avec des tuiles
  OpenStreetMap
- Déployé sur [Vercel](https://vercel.com/)

## Lancer le projet en local

```bash
npm install
npm run dev
```

Puis ouvrez [http://localhost:3000](http://localhost:3000).

```bash
npm run build   # build de production
npm start       # lancer le build de production en local
```