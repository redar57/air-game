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
    id: 'tourisme', name: 'Le Tourisme',
    desc: 'Monomoteur à aile haute. Lent, stable, pardonne presque tout : parfait pour flâner.',
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
    id: 'hydravion', name: "L'Hydravion",
    desc: "Amphibie : roues sorties (G) pour la piste, rentrées dans les flotteurs pour l'eau. Idéal pour les criques.",
    maxSpeed: 58, stall: 24, accel: 4.4, pitchRate: 1.05, rollRate: 1.45, yawRate: 0.5, gLimit: 4,
    brake: 6, maxSink: 6.5, gearH: 2.35, bellyH: 1.9, span: 12.6, len: 9, wingY: 0.9,
    retract: true, floats: true, amphibian: true, jet: false,
    cam: { dist: 19, height: 4.8 }, eye: [0, 0.46, -1.25],
    inertia: 0.36, stallBite: 0.3, flaps: true, turb: 0.95,
    engine: { kind: 'piston', cyl: 9, radial: true, idle: 600, max: 2200, blades: 3, gear: 1, exhaust: 85, rough: 0.45 },
    paint: [0xf5f2ea, 0xf08a2c, 0xe2e8ec], // couleurs principales (remplacées par les livrées)
    stats: [0.2, 0.42, 0.9],
  },
  {
    id: 'canadair', name: "L'Écopeur",
    desc: "Bombardier d'eau amphibie bimoteur, façon Canadair : rase un lac ou la mer pour remplir sa soute, puis largue sur les flammes avec X. Roues rentrées (G) pour l'eau.",
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
    brake: 8, maxSink: 7, gearH: 1.7, bellyH: 0.72, span: 11.2, len: 9.4, wingY: -0.1,
    retract: true, floats: false, jet: false,
    cam: { dist: 19, height: 4.4 }, eye: [0, 0.66, -0.45],
    inertia: 0.2, stallBite: 1, flaps: true, turb: 0.6,
    engine: { kind: 'piston', cyl: 12, idle: 900, max: 3000, blades: 3, gear: 0.48, exhaust: 150, rough: 0.3 },
    guns: [[-2.7, -0.3, -2.3], [2.7, -0.3, -2.3]], // canons dans le bord d'attaque (gauche, droite)
    paint: [0x5f6f3f, 0xf4f1ea, 0xf2c230], // couleurs principales (remplacées par les livrées)
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
    id: 'cargo', name: 'Le Gros Porteur',
    desc: "Quadrimoteur de 40 m d'envergure. Lourd et majestueux : anticipez tout, surtout l'atterrissage.",
    maxSpeed: 118, stall: 40, accel: 3.6, pitchRate: 0.5, rollRate: 0.6, yawRate: 0.25, gLimit: 2.6,
    brake: 6, maxSink: 5.5, gearH: 3.55, bellyH: 2.35, span: 40, len: 30, wingY: 2,
    retract: true, floats: false, jet: false,
    cam: { dist: 62, height: 13 }, eye: [0, 1.2, -12.45],
    inertia: 0.42, stallBite: 0.6, flaps: true, turb: 0.3,
    engine: { kind: 'turboprop', count: 4, blades: 4, prop: 1020, spool: 1.1 },
    paint: [0xf2f2ee, 0x2f5fa8, 0x8d959d], // couleurs principales (remplacées par les livrées)
    stats: [0.45, 0.12, 0.3],
  },
];

PLANES.push({
  id: 'helico', name: "L'Hélicoptère",
  desc: "Bombardier d'eau rouge et blanc. Gaz à 50 % = vol stationnaire, plus pour monter. Manche pour avancer et tourner, Espace pour se stabiliser.",
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
  desc: 'Gros hélicoptère de transport à deux rotors en tandem. Lent à réagir, mais stable comme un rocher.',
  maxSpeed: 80, stall: 12, accel: 0, pitchRate: 1, rollRate: 1, yawRate: 0.8, gLimit: 3,
  tilt: 0.38, push: 2, turnRate: 0.65,
  brake: 6, maxSink: 5, gearH: 2.2, bellyH: 2.2, span: 14, len: 30, wingY: 3,
  retract: false, floats: false, jet: false, heli: true,
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

for (const p of PLANES) p.takeoff = p.stall * 1.12;

/** Livrées : remplacent dans l'ordre les couleurs « paint » de chaque appareil (null = d'origine). */
export const LIVERIES = [
  { name: "D'origine", colors: null },
  { name: 'Patrouille', colors: [0x1f4f9c, 0xf4f4f4, 0xd8312b] },
  { name: 'Nuit', colors: [0x2a2e35, 0x6b7480, 0xf2c230] },
  { name: 'Désert', colors: [0xd8b878, 0x8a5a33, 0x6b7448] },
  { name: 'Corail', colors: [0xf27059, 0x2ec4b6, 0xfff1d6] },
  { name: 'Arctique', colors: [0xf2f5f7, 0xe8462e, 0x2b3440] },
];

/** Points de départ proposés au menu. */
export const STARTS = [
  { id: 'aeroport', name: 'Aéroport' },
  { id: 'altiport', name: 'Altiport' },
  { id: 'porte-avions', name: 'Porte-avions' },
  { id: 'vol', name: 'En vol' },
];
