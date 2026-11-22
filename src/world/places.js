import { BIG, ISLETS, rawBase } from './terrain.js';

// Lieux construits (grande ville, ports, îlots aménagés) : emplacements et zones à aplanir, décidés avant le relief.

/** Grande ville (grande carte) : rectangle aligné sur les axes, quadrillé de rues. */
export const city = { active: false, x: -2950, z: 3350, yaw: 0, halfWid: 430, halfLen: 480, margin: 260, alt: 24 };
/** Port de la ville (quai gagné sur la mer) et port de pêche de la Baie. Repère local : la mer vers -X. */
export const cityPort = { active: false, name: 'Port de la Grande Ville', x: -3715, z: 3350, yaw: 0, halfWid: 145, halfLen: 250, margin: 45, alt: 5 };
export const fishPort = { active: false, name: 'Port de pêche', x: -5400, z: 2270, yaw: Math.PI / 2, halfWid: 60, halfLen: 130, margin: 55, alt: 4 };
/** Îlots aménagés : { kind, x, z, r, name, zone? }. */
export const islets = [];
/** Circuit automobile, château fort, monastère perché, plateforme pétrolière, éoliennes (emplacements choisis par carte). */
export const circuit = { name: 'Circuit', x: 0, z: 0, yaw: 0, halfWid: 190, halfLen: 310, margin: 170, alt: 20 };
export const castle = { name: 'Château fort', x: 0, z: 0, yaw: 0, halfWid: 50, halfLen: 58, margin: 130, alt: 60 };
export const monastery = { name: 'Monastère', x: 0, z: 0 };
export const rig = { name: 'Plateforme pétrolière', x: 0, z: 0, yaw: 0.4 };
export const windFarm = { name: 'Éoliennes', spots: [] };
/** Lieux décidés une fois le relief construit (barrage, station de ski, rampe de vol libre) : remplis par leurs modules. */
export const peaks = { dam: null, ski: null, ramp: null };
/** Endroits à laisser sans arbres : fonctions (x, z) -> vrai. */
export const keepOut = [];
/** Toutes les zones à aplanir de ces lieux. */
export const placeZones = [];

export function definePlaces() {
  const add = (kind, name, near) => {
    const it = ISLETS.reduce((b, o) => (Math.hypot(o.x - near[0], o.z - near[1]) < Math.hypot(b.x - near[0], b.z - near[1]) ? o : b));
    const p = { kind, name, x: it.x, z: it.z, r: it.r };
    islets.push(p);
    return p;
  };
  /** Terrasse plane à mi-hauteur de l'îlot (dx, dz : décalage depuis le centre). */
  const terrace = (p, dx, dz, hw, hl, margin, alt) => {
    const x = p.x + dx, z = p.z + dz;
    p.zone = { x, z, yaw: 0, halfWid: hw, halfLen: hl, margin, alt: alt ?? Math.round(rawBase(x, z)) };
    placeZones.push(p.zone);
  };
  Object.assign(circuit, BIG ? { x: 6000, z: -900, yaw: 0.35 } : { x: -600, z: 900, yaw: 0.9 });
  circuit.alt = Math.round(Math.max(8, rawBase(circuit.x, circuit.z)));
  Object.assign(castle, BIG ? { x: 3700, z: -1250, yaw: 0.5 } : { x: 2300, z: 900, yaw: -0.4 });
  castle.alt = Math.round(rawBase(castle.x, castle.z) + 26);
  Object.assign(monastery, BIG ? { x: -4200, z: -900 } : { x: -1300, z: -500 });
  Object.assign(rig, BIG ? { x: -5200, z: 7300 } : { x: 5000, z: 2000 });
  placeZones.push(circuit, castle);
  if (BIG) {
    for (const o of [city, cityPort, fishPort]) { o.active = true; placeZones.push(o); }
    terrace(add('phare', 'Phare du Levant', [12800, -500]), 0, 0, 26, 26, 90);
    terrace(add('meteo', 'Station météo', [-12300, 600]), 0, 0, 60, 45, 120);
    terrace(add('pecheurs', 'Village des Pêcheurs', [-9000, 6400]), 60, 0, 95, 110, 70, 6);
    add('tresor', 'Île au Trésor', [-3200, -8600]);
  } else {
    terrace(add('phare', 'Phare du Levant', [4300, -3700]), 0, 0, 24, 24, 90);
    terrace(add('meteo', 'Station météo', [-4700, -3000]), 0, 0, 50, 40, 100);
    add('tresor', 'Île au Trésor', [-1200, -4900]);
  }
}
