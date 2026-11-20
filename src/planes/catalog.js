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
    stats: [0.22, 0.5, 1],
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
    stats: [0.3, 1, 0.75],
  },
  {
    id: 'hydravion', name: "L'Hydravion",
    desc: "Se pose sur l'eau comme sur la piste. Idéal pour explorer les criques et les îlots.",
    maxSpeed: 58, stall: 24, accel: 4.4, pitchRate: 1.05, rollRate: 1.45, yawRate: 0.5, gLimit: 4,
    brake: 6, maxSink: 6.5, gearH: 1.8, bellyH: 1.8, span: 12.6, len: 9, wingY: 0.9,
    retract: false, floats: true, jet: false,
    cam: { dist: 19, height: 4.8 }, eye: [0, 0.46, -1.25],
    inertia: 0.36, stallBite: 0.3, flaps: true, turb: 0.95,
    engine: { kind: 'piston', cyl: 9, radial: true, idle: 600, max: 2200, blades: 3, gear: 1, exhaust: 85, rough: 0.45 },
    stats: [0.2, 0.42, 0.9],
  },
  {
    id: 'chasseur', name: 'Le Chasseur à hélice',
    desc: "Long nez, gros moteur. Rapide et nerveux, il demande un peu de piste pour s'arrêter.",
    maxSpeed: 150, stall: 36, accel: 9.5, pitchRate: 1.55, rollRate: 2.7, yawRate: 0.6, gLimit: 8,
    brake: 8, maxSink: 7, gearH: 1.7, bellyH: 0.72, span: 11.2, len: 9.4, wingY: -0.1,
    retract: true, floats: false, jet: false,
    cam: { dist: 19, height: 4.4 }, eye: [0, 0.66, -0.45],
    inertia: 0.2, stallBite: 1, flaps: true, turb: 0.6,
    engine: { kind: 'piston', cyl: 12, idle: 900, max: 3000, blades: 3, gear: 0.48, exhaust: 150, rough: 0.3 },
    stats: [0.58, 0.78, 0.55],
  },
  {
    id: 'jet', name: 'Le Jet de chasse',
    desc: 'Postcombustion au-delà de 90 % de gaz. Taillé pour le porte-avions et les passages à fond.',
    maxSpeed: 230, stall: 55, accel: 13, pitchRate: 1.5, rollRate: 3.3, yawRate: 0.5, gLimit: 9,
    afterburner: 0.75,
    brake: 10, maxSink: 9, gearH: 2.1, bellyH: 0.86, span: 10.6, len: 15.6, wingY: 0,
    retract: true, floats: false, jet: true,
    cam: { dist: 27, height: 5.6 }, eye: [0, 0.9, -3.75],
    inertia: 0.15, stallBite: 0.8, flaps: true, turb: 0.35,
    engine: { kind: 'jet', spool: 0.55 },
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
    stats: [0.45, 0.12, 0.3],
  },
];

for (const p of PLANES) p.takeoff = p.stall * 1.12;

/** Points de départ proposés au menu. */
export const STARTS = [
  { id: 'aeroport', name: 'Aéroport' },
  { id: 'altiport', name: 'Altiport' },
  { id: 'porte-avions', name: 'Porte-avions' },
  { id: 'vol', name: 'En vol' },
];
