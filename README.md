# Air Game — vol libre

Petit simulateur de vol arcade au-dessus d'une île : dix-sept avions et ULM (tourisme, planeur, biplan de voltige, hydravion
amphibie, écopeur bombardier d'eau, chasseur à hélice, avion de course, jet avec postcombustion, quadrimoteur, double poutre, avion de ligne, pendulaire, autogire, avion-radar, jet à décollage vertical, avion de brousse, grand hydravion), un deltaplane et un parapente, une montgolfière, un dirigeable et quatre hélicoptères (bombardier d'eau ou secours au treuil,
Libellule à bulle, Bi-rotor de transport, hélicoptère grue), un aéroport, un altiport et un porte-avions.
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
| V | B (Rond) | Volets (3 crans) · tuyères (Vertical) |
| B | croix → | Sauter en parachute |
| X | R3 ou croix ↓ | Missile (jet) · mitrailleuses (chasseur, maintenir) · larguer l'eau (bombardiers d'eau, maintenir) · treuil (secours, maintenir) · élingue (Bi-rotor) · parachutistes (Gros Porteur) · matériel (Bipoutre) · repoussage (Long-Courrier à sa porte) · ouvrir le parachute |
| G | X (Carré) | Train |
| Espace | A (Croix) | Freins / aérofreins |
| C | Y (Triangle) | Changer de vue |
| souris (glisser) | stick droit | Regarder autour |
| N | croix ← | Carte de l'île |
| T | croix ↑ | Heure du jour |
| Retour arrière | Select | Réapparaître en vol |
| Échap | Start | Pause |
| J (au menu) | | Carnet de vol et badges |
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
- **Hélicoptère de secours** (version *Secours* de l'hélicoptère) : des naufragés et des randonneurs attendent sous
  des colonnes orange. En stationnaire au-dessus, maintiens X pour descendre le treuil, relâche pour remonter la
  personne accrochée (3 places), puis pose-toi sur l'hélisurface de l'hôpital (croix verte sur la carte).
- **Bi-rotor et son élingue** : une charge attend sous une colonne bleue (conteneur, citerne, jeep…). Crochet près
  de l'anneau jaune, X pour l'accrocher ; elle se balance et pèse (plus de gaz). Pose-la doucement dans le cercle
  vert de destination, puis X pour la décrocher. Lâchée en l'air, elle s'écrase.
- **Parachutistes** (Gros Porteur) : 12 hommes à bord. Au-dessus de 250 m et sous 340 km/h, X en fait sauter 4 ;
  ils ouvrent leur voile et se dirigent seuls vers la croix orange, à condition d'être largués assez près. On
  rembarque à l'arrêt sur l'aire verte de la base militaire (sur la petite carte : sur une piste).
- **Largage de matériel** (Bipoutre) : jeeps, caisses et canon sous parachutes. La croix bleue au sol montre où la
  charge tombera ; X largue (au-dessus de 120 m). On recharge à l'arrêt sur une piste.
- **Ravitaillement en vol** (Jet de chasse) : un ravitailleur façon KC-135 fait le tour de la carte, se pose de temps en
  temps à la base (petite carte : à l'aéroport), roule jusqu'à la pompe et repart. Pastille « R » sur la carte du Jet.
  Place-toi derrière, sous sa perche, à la même vitesse : elle se branche, le plein prend 20 s, Espace pour se débrancher.
- **Dirigeable** : il flotte tout seul. Gaz pour avancer, manche pour monter ou descendre, Espace pour s'arrêter.
- **Carnet de vol** (bouton du menu ou J) : heures, kilomètres, décollages et atterrissages par appareil, 33 badges.
- **Grande Ville** (grande carte) : en étoile autour d'une place à fontaine, gratte-ciel, cathédrale, parc, stade, fête foraine, port avec ferry vers le Village
  des Pêcheurs, port de pêche et ses chalutiers.
- **Îlots** : phare habité, station météo, île au trésor, village de pêcheurs (grande carte).
- **Plages et lac** : parasols, baigneurs, surfeurs, voiliers, planches à voile ; club nautique et canoës sur le lac.
- **Campagne** : vaches, moutons et chevaux au pré, tracteurs aux champs, promeneurs.
- **Volcan** : il fume, et entre en éruption toutes les 15 minutes environ (cendres, bombes, coulées de lave).
- **Base militaire** (grande carte) : sur l'îlot voisin du porte-avions. Drapeau américain, piste, hangars, radar,
  casernes, hélisurfaces, carburant, aire d'embarquement des parachutistes, appareils garés, abris bétonnés, batterie
  antiaérienne, chars, ponton et patrouilleur ; un Stratotanker y reste garé ; c'est aussi un point de départ.
- **Porte-avions et sa flotte** : ils font route ensemble le long d'un grand ovale ; l'appareil posé sur le pont est
  emporté avec lui. Avions garés, ascenseur, déflecteur, équipe en gilets de couleur, pompe à carburant (carré jaune à
  l'arrière, à droite). On se pose en hélicoptère sur les destroyers et les frégates ; le sous-marin plonge et refait
  surface ; un avion-radar tourne au-dessus.
- **Le Veilleur** (avion-radar) : la carte montre tout ce qui navigue ou vole autour.
- **Le Vertical** : tuyères vers le bas, il se pilote comme un hélicoptère ; prends de la vitesse puis V pour voler
  comme un jet, V encore (sous 430 km/h) pour revenir au vol vertical.
- **Le Baroudeur** : gros pneus, il se pose dans les prés et les pentes. **Le Paquebot volant** : quadrimoteur amphibie.
- **Vol libre** (deltaplane, parapente) : départ *Rampe de vol libre*, maintiens R pour courir, puis monte dans
  l'ascendance devant la rampe.
- **Montgolfière** : R brûleur, F soupape. Le vent tourne et forcit avec l'altitude (son sens est affiché).
- **Hélicoptère grue** : comme le Bi-rotor, mais pour une maison, une locomotive, une pelleteuse…
- **Saut en parachute** (B, au-dessus de 60 m) : X ou Espace ouvre la voile, le manche la dirige, Espace freine juste
  avant le sol. Retour arrière rend l'appareil.
- **Inverseurs de poussée et parachute-frein** : à l'atterrissage, gaz réduits et Espace.
- **Repoussage** : au départ de l'aéroport, le Long-Courrier est à sa porte ; X appelle le tracteur.
- **Nuages** : on entre vraiment dedans (brouillard, soleil voilé, quelques secousses).
- **Aéroport animé** : passerelles, bus, chariots à bagages, passagers.
- **Barrage et centrale** dans le canyon, avec retenue et cascade ; **station de ski** et son téléphérique ;
  **éoliennes**, **château fort**, **monastère** sur son piton ; **circuit** où dix voitures se disputent la course ;
  **plateforme pétrolière** avec hélisurface et carburant.
- **Site de lancement** : sur un îlot. Environ toutes les 20 minutes, une fusée sort du hall, roule
  jusqu'au pas de tir et décolle.
- **Routes et train** (grande carte) : des voitures, camionnettes, camions et cars circulent sur les routes
  goudronnées ; un petit train à vapeur fait le tour de l'île le long de la côte et s'arrête dans 8 gares, où il
  croise un train de marchandises ; barrières et feux aux passages à niveau.
- **Animaux** : bancs de dauphins qui bondissent près des côtes, baleines qui soufflent au large, cerfs à l'orée
  des bois (ils s'enfuient si on les frôle).
- **Planeur** : sans moteur, il part en altitude. Les gros nuages ronds marquent les thermiques : tourne dedans pour
  monter, le vario bipe d'autant plus vite que ça monte.
- **Petite ou grande carte** (option *Carte* du menu, le jeu se recharge) : la petite, c'est l'île seule ; la grande
  ajoute l'île du Nord (montagne et *Aéroport Nord*), l'île de l'Est (*Piste de l'Est*) et cinq îlots, soit 4 pistes
  au choix du départ. Elle met quelques secondes de plus à se générer.
- **Oiseaux** : des volées de mouettes tournent le long des côtes et des rapaces spiralent dans les thermiques ;
  ils s'écartent quand on fonce dessus.
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
