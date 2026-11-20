# Air Game — vol libre

Petit simulateur de vol arcade au-dessus d'une île : neuf avions (tourisme, planeur, biplan de voltige, hydravion
amphibie, écopeur bombardier d'eau, chasseur à hélice, avion de course, jet avec postcombustion, quadrimoteur) et trois hélicoptères (bombardier d'eau,
Libellule à bulle, Bi-rotor de transport), un aéroport, un altiport et un porte-avions.
Tout est généré par le code : relief, avions, sons. Aucune installation.

## Jouer

**En ligne : https://redar57.github.io/air-game/** (rien à télécharger).

**Sur ton ordinateur :** télécharge le projet (bouton *Code* → *Download ZIP*), décompresse-le, puis **double-clic sur `jouer.html`.** C'est tout : le jeu s'ouvre dans le navigateur, sous Windows, macOS ou Linux.

Navigateurs : Chrome, Edge, Firefox ou Safari récents (Safari 16.4 minimum).

> Si jamais le double-clic ne marche pas (navigateur très restrictif), il reste les lanceurs avec serveur local :
> `jouer.bat` (Windows) ou `jouer.command` (macOS) ; voir « Si ça bloque » plus bas.

## Commandes

| Clavier | Manette | Action |
|---|---|---|
| Z/S ou ↑/↓ (W/S en QWERTY) | stick gauche ↕ | Piquer / cabrer |
| Q/D ou ←/→ | stick gauche ↔ | Incliner |
| A/E | LB / RB | Palonnier |
| R/F | RT / LT | Gaz |
| V | B (Rond) | Volets (3 crans) |
| X | R3 ou croix ↓ | Missile (jet) · mitrailleuses (chasseur, maintenir) · larguer l'eau (bombardiers d'eau, maintenir) |
| G | X (Carré) | Train |
| Espace | A (Croix) | Freins / aérofreins |
| C | Y (Triangle) | Changer de vue |
| souris (glisser) | stick droit | Regarder autour |
| N | croix ← | Carte de l'île |
| T | croix ↑ | Heure du jour |
| Retour arrière | Select | Réapparaître en vol |
| Échap | Start | Pause |
| H / M | | Masquer l'interface / couper le son |

**Manette** : n'importe quelle manette Bluetooth ou USB reconnue par le navigateur (Xbox, PlayStation, Switch Pro…).
Connecte-la, puis appuie sur un bouton pour la réveiller : « Manette connectée » s'affiche. Elle vibre au toucher
des roues, au décrochage et au crash (si le navigateur le permet).

## En vol

- **Planche de bord** (vue cockpit, touche C) : anémomètre avec arcs de vitesse, horizon artificiel, altimètre,
  compte-tours, accéléromètre (G) ou bille-aiguille, conservateur de cap, variomètre, voyants (train, volets, gaz,
  décrochage, freins, train non sorti, altitude).
- **Vue extérieure** : vitesse, altitude, vitesse verticale, gaz, bandeau de cap en haut de l'écran.
- **Aide à l'atterrissage** : en approche d'une piste ou du porte-avions, 4 feux indiquent le plan de descente
  (2 blancs + 2 rouges = parfait ; tout blanc = trop haut ; tout rouge = trop bas) et une flèche ramène vers l'axe.
- Les gouvernes (ailerons, profondeur, direction) et les volets bougent sur les avions.
- **Jet de chasse** : missiles illimités. Garde une montgolfière bien au centre de l'écran : le cadre blanc
  « VISÉE… » se resserre puis devient jaune « VERROUILLÉ » (environ 1 s). Un missile verrouillé suit sa cible,
  sinon il part tout droit. Touchée, la montgolfière retombe en lambeaux puis regonfle 40 s plus tard ;
  le décor, lui, n'est jamais abîmé.
- **Chasseur à hélice** : mitrailleuses dans les ailes, tir tant que X est maintenue. Le réticule rond montre où
  convergent les balles ; une rafale d'une seconde abat une montgolfière.
- **Hydravion amphibie** : G sort les roues (sous les flotteurs) pour la piste, les rentre pour l'eau.
  Amerrir roues sorties fait capoter l'avion : le voyant « TRAIN ! » et le bandeau préviennent.
- **Hélicoptères** : la manette des gaz règle le pas du rotor et ne bouge jamais seule — **50 % = vol stationnaire**,
  plus pour monter, moins pour descendre (près du sol, la descente est freinée toute seule). Avant / arrière pour
  avancer ou reculer, gauche / droite pour tourner, A/E (palonnier) pour pivoter sur place, Espace pour revenir en
  stationnaire. Ils se posent partout où c'est assez plat.
- **Bombardiers d'eau** (l'hélicoptère rouge et l'Écopeur) : écope au ras de l'eau — stationnaire bas pour
  l'hélico, glissade sur l'eau roues rentrées pour l'Écopeur — puis maintiens X pour larguer. Au menu, l'option
  *Incendies* (touche F) fait apparaître des feux sur l'île ; une fois tous éteints, d'autres se déclarent. Sans
  incendies, on peut quand même écoper et larguer où l'on veut.
- **Planeur** : sans moteur, il part en altitude. Les gros nuages ronds marquent les thermiques : tourne dedans pour
  monter, le vario bipe d'autant plus vite que ça monte.
- **Petite ou grande carte** (option *Carte* du menu, le jeu se recharge) : la petite, c'est l'île seule ; la grande
  ajoute l'île du Nord (montagne et *Aéroport Nord*), l'île de l'Est (*Piste de l'Est*) et cinq îlots, soit 4 pistes
  au choix du départ. Elle met quelques secondes de plus à se générer.
- **Carte** : mini-carte en bas à droite (tourne avec l'appareil), grande carte avec N (croix ← à la manette) :
  pistes, thermiques, montgolfières, feux.
- **Carburant** (option du menu) : la consommation dépend des gaz. Le plein se fait à l'arrêt sur la station
  (aire jaune ⛽) devant les hangars de l'aéroport. En panne sèche, l'hélicoptère descend en autorotation.
- **Livrées** : six jeux de couleurs par appareil, choisis au menu (gardés d'une partie à l'autre).
- **Menu** : liste des appareils avec vignettes et filtre Avions / Hélicos, fiche avec atouts et commandes propres à
  chaque appareil, choix du départ, de l'heure, du sens du tangage et du son. ↑/↓ change d'appareil, ←/→ de départ
  (à la manette : croix ou stick, LB/RB pour la catégorie, A pour décoller).

## Si ça bloque

- **Le double-clic ouvre le fichier dans un éditeur** : clic droit sur `jouer.html` → *Ouvrir avec* → ton navigateur.
- **Lanceurs avec serveur** (`jouer.bat`, `jouer.command`) : utilisent Python 3 s'il est là, sinon PowerShell
  (Windows) ou Ruby (macOS). Laisse la fenêtre du serveur ouverte pendant la partie.
  - macOS « développeur non identifié » : clic droit sur `jouer.command` → *Ouvrir* → *Ouvrir*.
  - macOS « vous n'avez pas l'autorisation » : `chmod +x jouer.command` dans le Terminal.
  - Windows « Windows a protégé votre ordinateur » : *Informations complémentaires* → *Exécuter quand même*.

## Développement

Le code est dans `src/` (modules JavaScript, three.js dans `vendor/`).

- Lancer en développement : `python3 serveur.py` puis ouvrir `http://localhost:8317/` (index.html charge `src/` directement).
- Après une modification, régénérer la version double-clic : `python3 build.py` (recrée `jouer.html`).
- Console du navigateur : `airgame` donne accès à l'avion, au monde et à quelques outils de test
  (`airgame.select('jet', 'vol')`, `airgame.run(5, { pitch: 1 })`…).
