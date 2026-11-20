# Air Game — vol libre

Petit simulateur de vol arcade au-dessus d'une île : six avions (tourisme, biplan de voltige, hydravion,
chasseur à hélice, jet avec postcombustion, quadrimoteur), un aéroport, un altiport et un porte-avions.
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
| X | R3 ou croix ↓ | Missile (jet de chasse) |
| G | X (Carré) | Train |
| Espace | A (Croix) | Freins / aérofreins |
| C | Y (Triangle) | Changer de vue |
| souris (glisser) | stick droit | Regarder autour |
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
