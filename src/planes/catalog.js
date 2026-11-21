/**
 * Caractéristiques des avions. Unités : mètres, m/s, rad/s.
 *  maxSpeed  vitesse en palier plein gaz        stall    vitesse de décrochage
 *  accel     poussée (m/s²) plein gaz           gLimit   facteur de charge maxi
 *  gearH     hauteur du centre au-dessus du sol, train sorti (bellyH : posé sur le ventre)
 *  eye       position des yeux du pilote (repère avion : -Z vers l'avant)
 *  inertia   temps de réponse (s) des commandes : un gros avion met du temps à s'incliner
 *  stallBite brutalité du décrochage (0 : le nez tombe gentiment, 1 : une aile tombe franchement)
 *  flaps     volets disponibles (abaissent la vitesse de décrochage, freinent l'avion)
 *  turb      sensibilité aux turbulences (un avion léger danse davantage)
 *  arcade    coup de pouce sur le virage à basse vitesse (1.5 par défaut)
 *  inputRate vitesse à laquelle une touche maintenue amène la commande en butée (5 par défaut)
 *  engine    réglages du son moteur (cylindres, régime, pales…), voir audio.js
 */
export const PLANES = [
  {
    id: 'tourisme', name: 'Le Tourisme', family: 'tourisme', variant: 'Classique',
    desc: 'Monomoteur à aile haute. Lent, stable, pardonne presque tout : parfait pour flâner. Existe aussi en version postier et hydravion.',
    maxSpeed: 62, stall: 23, accel: 4.6, pitchRate: 1.15, rollRate: 1.7, yawRate: 0.5, gLimit: 4.5,
    brake: 7, maxSink: 6.5, gearH: 1.36, bellyH: 1.36, span: 11, len: 8, wingY: 0.8,
    retract: false, floats: false, jet: false,
    cam: { dist: 17, height: 4.3 }, eye: [0, 0.4, -1.05],
    inertia: 0.32, stallBite: 0.25, flaps: true, turb: 1,
    engine: { kind: 'piston', cyl: 4, idle: 700, max: 2700, blades: 2, gear: 1, exhaust: 95, rough: 0.35 },
    paint: [0xf4f1ea, 0xd8432f], // couleurs principales (remplacées par les livrées)
    stats: [0.22, 0.5, 1],
  },
  {
    id: 'planeur', name: 'Le Planeur',
    desc: 'Pas de moteur : on part en altitude et on tient l\'air en spiralant dans les thermiques (sous les gros nuages ronds). Le vario bipe quand ça monte.',
    // dragK / inducedK : traînées très faibles (finesse ~30)
    maxSpeed: 60, stall: 19, accel: 0, dragK: 0.00028, inducedK: 0.025, pitchRate: 1.1, rollRate: 1.25, yawRate: 0.5, gLimit: 5.3,
    brake: 6, maxSink: 5, gearH: 0.75, bellyH: 0.75, span: 18, len: 8.2, wingY: 0.35,
    retract: false, floats: false, jet: false, glider: true,
    cam: { dist: 20, height: 4.6 }, eye: [0, 0.42, -1.6],
    inertia: 0.3, stallBite: 0.35, flaps: false, turb: 0.9,
    engine: { kind: 'none' },
    paint: [0xf6f6f2, 0xd8312b],
    stats: [0.15, 0.45, 0.8],
  },
  {
    id: 'biplan', name: 'Le Biplan',
    desc: 'Avion de voltige à cockpit ouvert. Tourne sur place : loopings et tonneaux à volonté.',
    maxSpeed: 76, stall: 22, accel: 7.5, pitchRate: 2.0, rollRate: 3.6, yawRate: 0.9, gLimit: 9,
    brake: 7, maxSink: 6.5, gearH: 1.46, bellyH: 1.46, span: 7.8, len: 6.2, wingY: 0.4,
    retract: false, floats: false, jet: false,
    cam: { dist: 14, height: 3.6 }, eye: [0, 0.74, -0.3],
    inertia: 0.12, stallBite: 0.7, flaps: false, turb: 1.1,
    engine: { kind: 'piston', cyl: 7, radial: true, idle: 650, max: 2500, blades: 2, gear: 1, exhaust: 120, rough: 0.5 },
    paint: [0xf2c230, 0xc93a2c, 0x33373c], // couleurs principales (remplacées par les livrées)
    stats: [0.3, 1, 0.75],
  },

  {
    id: 'canadair', name: "L'Écopeur",
    desc: "Bombardier d'eau amphibie bimoteur, façon Canadair : rase un lac ou la mer pour remplir sa soute, puis largue sur les flammes avec X. Roues sorties (G) seulement pour les pistes.",
    maxSpeed: 100, stall: 30, accel: 5, pitchRate: 0.8, rollRate: 1.05, yawRate: 0.35, gLimit: 3.5,
    brake: 6, maxSink: 6.5, gearH: 3.25, bellyH: 1.75, span: 28.6, len: 19.8, wingY: 1.9,
    retract: true, floats: true, amphibian: true, jet: false,
    cam: { dist: 42, height: 9.5 }, eye: [-0.45, 1.05, -7.1],
    inertia: 0.38, stallBite: 0.35, flaps: true, turb: 0.45, arcade: 1.8,
    engine: { kind: 'turboprop', count: 2, blades: 4, prop: 1150, spool: 1.0 },
    paint: [0xf2c230, 0xd8352a, 0xf4f1ea], // jaune, rouge, blanc (remplacées par les livrées)
    stats: [0.38, 0.32, 0.7],
  },
  {
    id: 'chasseur', name: 'Le Chasseur à hélice',
    desc: "Long nez, gros moteur, mitrailleuses dans les ailes (X maintenue). Rapide et nerveux.",
    maxSpeed: 150, stall: 36, accel: 9.5, pitchRate: 1.55, rollRate: 2.7, yawRate: 0.6, gLimit: 8,
    brake: 8, maxSink: 7, gearH: 1.7, bellyH: 1.3, span: 12.5, len: 10.6, wingY: -0.3,
    retract: true, floats: false, jet: false,
    cam: { dist: 20, height: 4.6 }, eye: [0, 0.72, 0.1],
    inertia: 0.2, stallBite: 1, flaps: true, turb: 0.6,
    engine: { kind: 'piston', cyl: 12, idle: 900, max: 3000, blades: 3, gear: 0.48, exhaust: 150, rough: 0.3 },
    guns: [[-3.4, -0.9, -2.2], [3.4, -0.9, -2.2]], // canons dans le bord d'attaque (gauche, droite)
    paint: [0x22395a, 0xf4f1ea, 0xf2c230], // couleurs principales (remplacées par les livrées)
    stats: [0.58, 0.78, 0.55],
  },
  {
    id: 'jet', name: 'Le Jet de chasse',
    desc: 'Postcombustion au-delà de 90 % de gaz, missiles illimités (touche X) pour chasser les montgolfières.',
    maxSpeed: 230, stall: 55, accel: 13, pitchRate: 2.1, rollRate: 4.2, yawRate: 0.85, gLimit: 12, // (arcade : un vrai chasseur tient 9 G)
    afterburner: 0.75,
    brake: 10, maxSink: 9, gearH: 2.1, bellyH: 0.86, span: 10.6, len: 15.6, wingY: 0,
    retract: true, floats: false, jet: true,
    cam: { dist: 27, height: 5.6 }, eye: [0, 0.9, -3.75],
    inertia: 0.09, stallBite: 0.8, flaps: true, turb: 0.35, inputRate: 9, arcade: 2.3,
    engine: { kind: 'jet', spool: 0.55 },
    missiles: [[-4.9, -0.32, 2.4], [4.9, -0.32, 2.4]], // rails sous les ailes (gauche, droite)
    paint: [0xaab3bc, 0x7d8791, 0x33383d], // couleurs principales (remplacées par les livrées)
    stats: [1, 0.85, 0.4],
  },
  {
    id: 'cargo', name: 'Le C-17',
    desc: "Quadriréacteur de transport militaire, aile haute et empennage en T, avec une section de 12 parachutistes : X les fait sauter par 4 par la rampe arrière au-dessus de la croix orange. On rembarque à l'arrêt sur l'aire verte de la base militaire.",
    maxSpeed: 140, stall: 38, accel: 4.4, pitchRate: 0.55, rollRate: 0.65, yawRate: 0.27, gLimit: 2.8,
    brake: 6.5, maxSink: 5.5, gearH: 3.55, bellyH: 2.6, span: 42, len: 33, wingY: 2.6,
    retract: true, floats: false, jet: true, paras: true,
    cam: { dist: 66, height: 14 }, eye: [0, 1.2, -13.9],
    inertia: 0.42, stallBite: 0.6, flaps: true, turb: 0.3,
    engine: { kind: 'jet', spool: 1.6 },
    paint: [0x7a838b, 0x5a6168, 0x3d4248], // couleurs principales (remplacées par les livrées)
    stats: [0.45, 0.12, 0.3],
  },
];

PLANES.push({
  id: 'helico', name: "L'Hélicoptère", family: 'helico', variant: "Bombardier d'eau",
  desc: "Bombardier d'eau rouge et blanc. Existe aussi en version secours, avec treuil. Gaz à 50 % = vol stationnaire, plus pour monter. Manche pour avancer et tourner, Espace pour se stabiliser.",
  // maxSpeed : vitesse de pointe ; climb : vitesse verticale maxi (m/s) ; stall : seulement pour les arcs de l'anémomètre
  maxSpeed: 75, stall: 10, accel: 0, pitchRate: 1, rollRate: 1, yawRate: 1.6, gLimit: 3.5,
  tilt: 0.55, push: 3, turnRate: 1.1, // hélico : inclinaison maxi (rad), poussée arcade du manche, virage au manche
  brake: 6, maxSink: 4.5, gearH: 1.66, bellyH: 1.66, span: 12.4, len: 15, wingY: 2.2,
  retract: false, floats: false, jet: false, heli: true,
  cam: { dist: 22, height: 6 }, eye: [0, 0.55, -1.65],
  inertia: 0.25, stallBite: 0, flaps: false, turb: 0.7,
  engine: { kind: 'turboprop', count: 1, blades: 4, prop: 390, spool: 0.8, heli: true },
  paint: [0xd8352a, 0xf3f1ec], // couleurs principales (remplacées par les livrées)
    stats: [0.25, 0.6, 0.8],
});

PLANES.push({
  id: 'secours', name: "L'Hélicoptère", family: 'helico', variant: 'Secours',
  desc: "Version de secours, avec treuil au-dessus de la porte : maintiens X en stationnaire pour descendre le câble jusqu'aux naufragés et aux randonneurs, relâche pour les remonter, puis pose-toi sur l'hélisurface de l'hôpital.",
  maxSpeed: 75, stall: 10, accel: 0, pitchRate: 1, rollRate: 1, yawRate: 1.6, gLimit: 3.5,
  tilt: 0.55, push: 3, turnRate: 1.1,
  brake: 6, maxSink: 4.5, gearH: 1.66, bellyH: 1.66, span: 12.4, len: 15, wingY: 2.2,
  retract: false, floats: false, jet: false, heli: true, rescue: true,
  cam: { dist: 22, height: 6 }, eye: [0, 0.55, -1.65],
  inertia: 0.25, stallBite: 0, flaps: false, turb: 0.7,
  engine: { kind: 'turboprop', count: 1, blades: 4, prop: 390, spool: 0.8, heli: true },
  paint: [0xd8352a, 0xf3f1ec],
  stats: [0.25, 0.6, 0.8],
});

PLANES.push({
  id: 'libellule', name: 'La Libellule',
  desc: 'Petit hélicoptère à bulle vitrée, léger et ultra-maniable. Pour se faufiler partout et se poser n\'importe où.',
  maxSpeed: 62, stall: 9, accel: 0, pitchRate: 1, rollRate: 1, yawRate: 2.3, gLimit: 3.5,
  tilt: 0.65, push: 4.2, turnRate: 1.7,
  brake: 6, maxSink: 4, gearH: 1.06, bellyH: 1.06, span: 8.4, len: 9, wingY: 1.45,
  retract: false, floats: false, jet: false, heli: true,
  cam: { dist: 15, height: 4 }, eye: [0, 0.42, -0.62],
  inertia: 0.16, stallBite: 0, flaps: false, turb: 0.9,
  engine: { kind: 'turboprop', count: 1, blades: 2, prop: 520, spool: 0.6, heli: true },
  paint: [0xf2c230, 0x26292d], // couleurs principales (remplacées par les livrées)
    stats: [0.2, 1, 0.95],
});
PLANES.push({
  id: 'birotor', name: 'Le Bi-rotor',
  desc: "Gros hélicoptère de transport à deux rotors en tandem, avec une élingue sous le ventre : X près de l'anneau d'une charge pour l'accrocher, X pour la décrocher une fois posée dans le cercle vert. Plus de gaz pour porter une charge lourde.",
  maxSpeed: 80, stall: 12, accel: 0, pitchRate: 1, rollRate: 1, yawRate: 0.8, gLimit: 3,
  tilt: 0.38, push: 2, turnRate: 0.65,
  brake: 6, maxSink: 5, gearH: 2.2, bellyH: 2.2, span: 14, len: 30, wingY: 3,
  retract: false, floats: false, jet: false, heli: true, sling: true,
  cam: { dist: 42, height: 11 }, eye: [0, 0.75, -7.6],
  inertia: 0.5, stallBite: 0, flaps: false, turb: 0.35,
  engine: { kind: 'turboprop', count: 2, blades: 3, prop: 230, spool: 1, heli: true },
  paint: [0x6b7448, 0x4d5434, 0xe9e4d4], // couleurs principales (remplacées par les livrées)
    stats: [0.35, 0.3, 0.75],
});
PLANES.splice(PLANES.findIndex((p) => p.id === 'jet'), 0, {
  id: 'racer', name: 'Le Racer',
  desc: 'Avion de course minuscule au moteur énorme. Le plus rapide des avions à hélice, et le plus nerveux.',
  maxSpeed: 135, stall: 31, accel: 12, pitchRate: 2.2, rollRate: 4.8, yawRate: 0.8, gLimit: 10,
  brake: 8, maxSink: 6.5, gearH: 1.27, bellyH: 1.27, span: 7.6, len: 7.2, wingY: -0.3,
  retract: false, floats: false, jet: false,
  cam: { dist: 13, height: 3.3 }, eye: [0, 0.62, -0.05],
  inertia: 0.08, stallBite: 0.9, flaps: false, turb: 0.8, inputRate: 8, arcade: 2,
  engine: { kind: 'piston', cyl: 8, idle: 950, max: 3300, blades: 3, gear: 0.6, exhaust: 135, rough: 0.35 },
  paint: [0xd62f2f, 0xf5f3ee], // couleurs principales (remplacées par les livrées)
    stats: [0.6, 1, 0.45],
});

PLANES.splice(PLANES.findIndex((p) => p.id === 'canadair'), 0, {
  id: 'epandeur', name: "L'Épandeur",
  desc: "Avion agricole : trémie devant le cockpit, rampe sous l'aile. Maintiens X en rase-mottes au-dessus des champs pour épandre, puis recharge à la piste en herbe de la Prairie (grande carte).",
  maxSpeed: 68, stall: 25, accel: 6.2, pitchRate: 1.35, rollRate: 2.3, yawRate: 0.6, gLimit: 5.5,
  brake: 7, maxSink: 7, gearH: 1.55, bellyH: 1.2, span: 13.4, len: 9, wingY: -0.35,
  retract: false, floats: false, jet: false, sprayer: true,
  cam: { dist: 19, height: 4.6 }, eye: [0, 1.0, 0.0],
  inertia: 0.2, stallBite: 0.3, flaps: true, turb: 0.9,
  engine: { kind: 'piston', cyl: 9, radial: true, idle: 600, max: 2300, blades: 3, gear: 1, exhaust: 110, rough: 0.45 },
  paint: [0xf2c230, 0x2f7a3a, 0xf4f1ea], // jaune, vert, blanc (remplacées par les livrées)
  stats: [0.25, 0.6, 0.85],
});

PLANES.splice(PLANES.findIndex((p) => p.id === 'tourisme') + 1, 0, {
  id: 'postier', name: 'Le Tourisme', family: 'tourisme', variant: 'Postier',
  desc: "Version postale, avec une soute sous le ventre : charge les sacs à l'arrêt sur une piste, puis largue-les (X) au-dessus du village indiqué. Ils descendent en parachute.",
  maxSpeed: 64, stall: 22, accel: 5, pitchRate: 1.2, rollRate: 1.9, yawRate: 0.55, gLimit: 4.5,
  brake: 7, maxSink: 6.5, gearH: 1.36, bellyH: 1.0, span: 11.2, len: 8.2, wingY: 0.86,
  retract: false, floats: false, jet: false, mail: true,
  cam: { dist: 17, height: 4.4 }, eye: [0, 0.4, -1.05],
  inertia: 0.3, stallBite: 0.25, flaps: true, turb: 1,
  engine: { kind: 'piston', cyl: 6, idle: 700, max: 2600, blades: 2, gear: 1, exhaust: 100, rough: 0.35 },
  paint: [0xf4ead6, 0xc8402f, 0x24324a], // crème, rouge, bleu nuit (remplacées par les livrées)
  stats: [0.24, 0.55, 0.95],
});

PLANES.splice(PLANES.findIndex((p) => p.id === 'postier') + 1, 0, {
    id: 'hydravion', name: 'Le Tourisme', family: 'tourisme', variant: 'Hydravion',
    desc: "Version sur flotteurs, amphibie : se pose sur l'eau, roues sorties (G) pour les pistes. Un peu plus lourd et plus lent. Idéal pour les criques.",
    maxSpeed: 58, stall: 24, accel: 4.4, pitchRate: 1.05, rollRate: 1.45, yawRate: 0.5, gLimit: 4,
    brake: 6, maxSink: 6.5, gearH: 2.35, bellyH: 1.9, span: 11.2, len: 8.2, wingY: 0.86,
    retract: true, floats: true, amphibian: true, jet: false,
    cam: { dist: 19, height: 4.8 }, eye: [0, 0.4, -1.05],
    inertia: 0.36, stallBite: 0.3, flaps: true, turb: 0.95,
    engine: { kind: 'piston', cyl: 9, radial: true, idle: 600, max: 2200, blades: 3, gear: 1, exhaust: 85, rough: 0.45 },
    paint: [0xf5f2ea, 0xf08a2c, 0xe2e8ec], // couleurs principales (remplacées par les livrées)
    stats: [0.2, 0.42, 0.9],
  });

for (const p of PLANES) p.takeoff = p.stall * 1.12;

/** Livrées propres à chaque appareil : remplacent dans l'ordre ses couleurs « paint ». */
const LIVERY_SETS = {
  tourisme: [['Ciel', [0xe9f1f7, 0x2f6fb5]], ['Sable', [0xefe3c8, 0x8a5a33]], ['Menthe', [0xf2f5ef, 0x2fae7a]], ['Club', [0x24467a, 0xf2c230]], ['Cerise', [0xf6efe6, 0x8e1f3a]]],
  postier: [['Bleu', [0x2f5fa8, 0xf2c230, 0xf4f1ea]], ['Vert', [0x2f6b47, 0xf4e9c9, 0x2b2e33]], ['Rétro', [0xe7dcc0, 0x8a5a33, 0x2b3440]], ['Gris', [0xbfc4c9, 0xd8312b, 0x2b3440]], ['Jaune', [0xf2c230, 0x2b3440, 0xf4f1ea]]],
  planeur: [['Arctique', [0xf6f6f2, 0x2f7fdc]], ['Fluo', [0xf6f6f2, 0xff7a1f]], ['Compétition', [0xf2f2ee, 0x1d2a44]], ['Lime', [0xf4f6ec, 0x8cc63f]], ['Rose', [0xfbf3f4, 0xe0457b]]],
  biplan: [['Cirque', [0xd8312b, 0xf4f1ea, 0x2b2e33]], ['Rétro', [0xe7dcc0, 0x2f5fa8, 0x4a3a2a]], ['Corsaire', [0x2a3f5f, 0xf2c230, 0x1b1d21]], ['Vert bouteille', [0x2f6b47, 0xf4e9c9, 0x2b2e33]], ['Arlequin', [0x8e5cc9, 0xf2c230, 0x2b2e33]]],
  hydravion: [['Lagon', [0xf5f2ea, 0x2ec4b6, 0xdfe8ea]], ['Garde-côte', [0xf4f4f0, 0xd8312b, 0xd8dde2]], ['Bois verni', [0xb9824a, 0x6b3f1f, 0xe9e1d2]], ['Marine', [0x1f3f6b, 0xf4f1ea, 0xc9d0d6]], ['Citron', [0xf6ea7a, 0x2f7fdc, 0xeeeeea]]],
  canadair: [['Pompier', [0xd8312b, 0xf2c230, 0xf4f1ea]], ['Forestier', [0x3f6b3a, 0xf2c230, 0xf4f1ea]], ['Nordique', [0xf4f1ea, 0xd8312b, 0x2b3440]], ['Orange', [0xf08a2c, 0x2b3440, 0xf4f1ea]], ['Ciel', [0xdfe9f2, 0x2f6fb5, 0xf4f1ea]]],
  chasseur: [['Olive', [0x5f6f3f, 0xf4f1ea, 0xf2c230]], ['Désert', [0xc8a46a, 0x7a5634, 0xf4f1ea]], ['Argent', [0xbfc4c9, 0x2b2e33, 0xd8312b]], ['Requin', [0x8d969c, 0xf4f1ea, 0xd8312b]], ['Hiver', [0xeeeeea, 0x6b7480, 0x2f6fb5]]],
  jet: [['Nuit', [0x2a2e35, 0x1c1f24, 0xf2c230]], ['Désert', [0xd8b878, 0xa88a5a, 0x5a4630]], ['Bleu acier', [0x6f8fb0, 0x4a6585, 0x23303f]], ['Démonstration', [0xf2f2ee, 0xd8312b, 0x1f4f9c]], ['Tigre', [0xf2a22c, 0x2b2e33, 0x1b1d21]]],
  cargo: [['Désert', [0xc8a46a, 0x9a7a4a, 0x5a4a35]], ['Forêt', [0x56603f, 0x3f4a2f, 0x2b3024]], ['Marine', [0x3f5068, 0x2b3a4f, 0x1f2833]], ['Nuit', [0x2e3237, 0x22262a, 0x18191c]], ['Humanitaire', [0xf2f2ee, 0x2f6fb5, 0x8d959d]]],
  secours: [['Montagne', [0xd8312b, 0xf2c230]], ['Gendarmerie', [0x1f3f6b, 0xf3f1ec]], ['Douanes', [0x2b2e33, 0xf2c230]], ['Marine', [0xf3f1ec, 0xf08a2c]], ['Sable', [0xc8a46a, 0xf3f1ec]]],
  helico: [['Montagne', [0xf2c230, 0x26292d]], ['Bleu', [0x2f6fb5, 0xf3f1ec]], ['Orange', [0xf08a2c, 0xf3f1ec]], ['Vert', [0x2f8a5a, 0xf3f1ec]], ['Noir', [0x26292d, 0xd8312b]]],
  libellule: [['Turquoise', [0x2ec4b6, 0x26292d]], ['Rouge', [0xd8312b, 0x26292d]], ['Blanc', [0xf3f1ec, 0x2f6fb5]], ['Violet', [0x8e5cc9, 0xf3f1ec]], ['Citron vert', [0x8cc63f, 0x26292d]]],
  birotor: [['Marine', [0x5d6e80, 0x3f4c5a, 0xe9e4d4]], ['Sable', [0xc8a46a, 0x9a7a4a, 0xe9e4d4]], ['Secours', [0xd8312b, 0xf3f1ec, 0x2b2e33]], ['Gris', [0x9aa3ab, 0x6b7480, 0xf3f1ec]], ['Jaune', [0xf2c230, 0x26292d, 0xf3f1ec]]],
  racer: [['Or', [0xd9a92b, 0x26292d]], ['Bleu course', [0x1f4f9c, 0xf5f3ee]], ['Vert anglais', [0x1f5a3a, 0xf2e7c9]], ['Noir et or', [0x1b1d21, 0xd9a92b]], ['Orange', [0xf27a1f, 0x1b1d21]]],
  epandeur: [['Rouge ferme', [0xc8402f, 0xf4f1ea, 0x2b2e33]], ['Bleu', [0x2f6fb5, 0xf2c230, 0xf4f1ea]], ['Vert pomme', [0x8cc63f, 0x2f5a2a, 0xf4f1ea]], ['Orange', [0xf08a2c, 0x2b2e33, 0xf4f1ea]], ['Argent', [0xbfc4c9, 0xc8402f, 0x2b2e33]]],
};
const ORIGINAL = { name: "D'origine", colors: null };
/** Livrées proposées pour un appareil (la première est toujours celle d'origine). */
export function liveriesOf(spec) {
  return [ORIGINAL, ...(LIVERY_SETS[spec.id] || []).map(([name, colors]) => ({ name, colors }))];
}

/** Points de départ proposés au menu. */
export const STARTS = [
  { id: 'aeroport', name: 'Aéroport' },
  { id: 'altiport', name: 'Altiport' },
  { id: 'porte-avions', name: 'Porte-avions' },
  { id: 'vol', name: 'En vol' },
];
