import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { milBase, lightsPoints, spinners } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { mergeColored, xform, toWorld } from '../util.js';
import { usFlag } from './flag.js';
import { bodyMesh, STAND } from '../tanker.js';
import { PLANES } from '../planes/catalog.js';
import { getModel } from '../planes/models.js';

// Décor de la base militaire : appareils garés, abris bétonnés, batterie antiaérienne, chars, clôture et miradors,
// ponton et patrouilleur, escouade qui défile et jeep en ronde. Repère local de la piste (piste le long de Z).

const lam = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const OL = 0x5f6b45, OD = 0x46502f, SA = 0xcdbf98, CO = 0x9a9d9f, ST = 0x8a9199, DK = 0x2b3027, BLK = 0x1f2428, YE = 0xe8c33a;

/** Appareil du jeu réduit à une seule géométrie (décor : sans cockpit, flammes ni disques d'hélice). */
export function parkedGeo(id, colors, bare = false) { // bare : sans les pales
  const spec = PLANES.find((p) => p.id === id), m = getModel(spec, { name: '_gare', colors }), parts = [];
  m.root.updateMatrixWorld(true);
  const inv = m.root.matrixWorld.clone().invert();
  const walk = (o) => {
    if (o === m.cockpit || m.flames.includes(o) || (bare && (o === m.spin || m.props.some((p) => p.blades === o)))) return;
    if (o.isMesh && !o.material.transparent && !o.material.vertexColors) parts.push({ geo: o.geometry, color: o.material.color, matrix: inv.clone().multiply(o.matrixWorld) });
    o.children.forEach(walk);
  };
  walk(m.root);
  return { geo: mergeColored(parts), spec };
}

function tankParts(parts, x, z, ry, col = OD) {
  const at = (geo, color, lx, y, lz, rx = 0) => parts.push({ geo, color, matrix: xform(x, 0, z, ry).multiply(xform(lx, y, lz, 0, 1, 1, 1, rx)) });
  for (const s of [-1, 1]) { at(new THREE.BoxGeometry(0.8, 1.1, 6.6), 0x25282b, s * 1.45, 0.6, 0); at(new THREE.BoxGeometry(0.9, 0.25, 6.8), col, s * 1.45, 1.25, 0); }
  at(new THREE.BoxGeometry(2.4, 1, 6.2), col, 0, 1.15, 0);
  at(new THREE.CylinderGeometry(1.2, 1.6, 0.95, 8), col, 0, 2.1, 0.3);
  at(new THREE.CylinderGeometry(0.13, 0.16, 4.6, 8).rotateX(Math.PI / 2), col, 0, 2.2, -3.2, 0.06);
  at(new THREE.BoxGeometry(0.6, 0.25, 0.6), DK, 0.4, 2.65, 0.6);
}

export function buildMilBase(scene) {
  if (!milBase.active) return;
  const rw = milBase.rw, side = rw.width / 2, L = rw.length, parts = [], _w = {};
  const G = new THREE.Group();
  G.position.set(rw.x, rw.alt, rw.z); G.rotation.y = rw.yaw;
  scene.add(G);
  const B = (w, h, d, c, x, y, z, ry = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry) });
  const C = (rt, rb, h, c, x, y, z, seg = 10) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, matrix: xform(x, y, z) });
  const collide = (x, z, hw, hd, h, ry = 0) => { toWorld(rw, x, z, _w); addBox(_w.x, _w.z, rw.yaw + ry, hw, hd, rw.alt, rw.alt + h); };
  const red = [], white = []; // feux de nuit : balises d'obstacle et projecteurs

  // --- drapeau américain : grand mât sur le terrain de rassemblement
  const fx = side + 135, fz = 165;
  C(0.16, 0.3, 26, 0xe3e6e8, fx, 13, fz, 8); C(0.35, 0.35, 0.5, YE, fx, 26.2, fz, 8);
  C(2.4, 2.8, 0.6, 0xe8e4d8, fx, 0.4, fz, 8);
  const flag = usFlag(5.4);
  flag.position.set(fx, 20.3, fz); flag.rotation.y = -0.6;
  G.add(flag);
  collide(fx, fz, 0.4, 0.4, 26);

  // --- marquages : voies de circulation jaunes, places de parking, bandes d'arrêt
  const line = (w, d, x, z, ry = 0, c = YE) => B(w, 0.06, d, c, x, 0.27, z, ry);
  line(0.6, 900, side + 24, 60);
  for (const z of [-300, 0, 300]) { line(22, 0.6, side + 12, z); B(0.6, 0.06, 26, YE, side + 2.5, 0.22, z); }

  // --- appareils garés
  const park = (id, spots, colors = null) => {
    const { geo, spec } = parkedGeo(id, colors), mat = lam();
    for (const [x, z, ry, ground = 0.2] of spots) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, spec.gearH + ground, z); m.rotation.y = ry; m.castShadow = true;
      G.add(m);
      collide(x, z, spec.heli ? 3 : spec.span * 0.4, spec.len * 0.45, spec.gearH + 3, ry);
      if (!spec.heli) line(0.5, spec.len + 14, x + Math.sin(ry) * 2, z + Math.cos(ry) * 2, ry);
    }
  };
  const row = []; for (let k = 0; k < 6; k++) row.push([side + 72, -262 + k * 30, Math.PI / 2 - 0.45]);
  park('jet', row);
  park('cargo', [[side + 78, 62, Math.PI / 2]]);
  park('birotor', [[side + 64, 290, 0.3]], [0x56603f, 0x3f4a2f, 0x2b3024]);
  park('libellule', [[side + 58, 335, 0.2], [side + 58, 360, 0.2]], [0x56603f, 0x2b3024]);
  // un Stratotanker à demeure : perche repliée, passerelle, camion-citerne, groupe de parc, cales et cônes
  {
    const tx = side + 72, tz = -25, t = bodyMesh(), g = new THREE.Group();
    g.add(t.m, t.gear, t.boom); t.boom.rotation.x = -0.06; t.tube.position.z = 9.6;
    g.position.set(tx, STAND + 0.2, tz); g.rotation.y = Math.PI / 2; G.add(g);
    collide(tx, tz, 2.2, 20, 7, Math.PI / 2); collide(tx + 2, tz, 19.5, 5, 4.6, Math.PI / 2);
    line(0.5, 60, tx - 8, tz, Math.PI / 2); line(0.5, 8, tx - 14.5, tz);
    // escalier jusqu'à la porte avant gauche
    for (let k = 0; k < 8; k++) B(1.4, 0.2, 0.7, 0xdfe3e6, tx - 15, 0.5 + k * 0.42, tz + 6.6 - k * 0.62);
    B(1.6, 0.25, 1.8, 0xdfe3e6, tx - 15, 3.75, tz + 2.3); B(0.4, 3.6, 0.4, YE, tx - 15, 1.9, tz + 2.2); B(1.8, 0.4, 6, YE, tx - 15, 0.5, tz + 4.4);
    B(2.4, 1, 9, 0x3a4148, tx - 6, 1, tz + 16); B(2.4, 2.2, 2.2, OL, tx - 6, 2, tz + 19.5); parts.push({ geo: new THREE.CylinderGeometry(1.25, 1.25, 6.2, 10).rotateX(Math.PI / 2), color: 0xd9dcdf, matrix: xform(tx - 6, 2.4, tz + 14.6) }); // camion-citerne
    B(2.2, 1.6, 3, YE, tx - 14, 1.1, tz - 5); B(0.2, 0.2, 4, BLK, tx - 14, 0.5, tz - 2); // groupe de parc
    for (const s of [-1, 1]) for (const z of [-2.6, 2.6]) B(0.6, 0.4, 1.2, YE, tx + 0.5 + z * 0.75, 0.45, tz + s * 2.9);
    for (const [x, z] of [[-22, 0], [12, -21], [12, 21], [23, 0]]) parts.push({ geo: new THREE.ConeGeometry(0.4, 1, 6), color: 0xf07a1e, matrix: xform(tx + x, 0.7, tz + z) });
    collide(tx - 6, tz + 16, 1.3, 5, 4); collide(tx - 15, tz + 4, 1, 4, 4);
  }
  // escabeaux, tracteurs et chariots de bombes devant les chasseurs
  for (let k = 0; k < 6; k++) {
    const z = -252 + k * 30;
    B(1.6, 0.9, 2.8, YE, side + 92, 0.75, z, 0.3); B(1.5, 0.8, 1, 0x2c4558, side + 92, 1.4, z + 0.5, 0.3);
    B(1.4, 0.3, 3, OD, side + 97, 0.55, z + 1, 0.3); for (const s of [-0.35, 0.35]) parts.push({ geo: new THREE.CylinderGeometry(0.22, 0.22, 2.4, 8).rotateX(Math.PI / 2), color: 0xd9dcdf, matrix: xform(side + 97 + s, 0.95, z + 1, 0.3) });
  }

  // --- à gauche de la piste : parking d'alerte et abris bétonnés, deux chasseurs prêts à partir
  B(88, 0.3, 250, 0x6e7177, -side - 66, 0.05, 130);
  for (const z of [40, 220]) { B(26, 0.3, 26, 0x6e7177, -side - 10, 0.04, z); line(26, 0.6, -side - 12, z); }
  line(0.6, 230, -side - 34, 130);
  for (let k = 0; k < 4; k++) {
    const z = 40 + k * 60, x = -side - 92;
    parts.push({ geo: new THREE.CylinderGeometry(12, 12, 30, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).rotateY(Math.PI / 2), color: 0x7f8571, matrix: xform(x, 0, z, 0, 1, 0.75, 1) });
    B(0.4, 7.2, 15, DK, x + 15, 3.6, z);
    for (const s of [-1, 1]) B(2, 6.5, 2, CO, x + 15, 3.2, z + s * 9);
    line(40, 0.6, x + 36, z);
    collide(x, z, 15, 11, 9);
  }
  park('jet', [[-side - 58, 100, -Math.PI / 2], [-side - 58, 160, -Math.PI / 2]], [0x6f7a64, 0x525c48, 0x2b3024]);

  // --- batterie antiaérienne : trois lanceurs et un radar derrière des sacs de sable
  const bx = -side - 110, bz = -60;
  for (let k = 0; k < 3; k++) {
    const x = bx + (k - 1) * 24, z = bz + Math.abs(k - 1) * 8;
    parts.push({ geo: new THREE.TorusGeometry(8, 0.8, 5, 18, Math.PI * 1.6).rotateX(Math.PI / 2).rotateY(0.9), color: SA, matrix: xform(x, 0.5, z) });
    B(2.6, 1, 8, OD, x, 1.1, z); B(2.5, 1.8, 2, OL, x, 2.4, z + 3);
    for (const s of [-0.8, 0.8]) for (const u of [0, 1]) {
      const M = xform(x + s, 3 + u * 1.2, z - 0.8, 0, 1, 1, 1, 0.75);
      parts.push({ geo: new THREE.BoxGeometry(1.1, 1.0, 6), color: u ? OL : OD, matrix: M });
      parts.push({ geo: new THREE.ConeGeometry(0.35, 1.2, 8).rotateX(-Math.PI / 2), color: 0xe8eaec, matrix: M.clone().multiply(xform(0, 0, -3.4)) });
    }
    collide(x, z, 3, 5, 6);
  }
  const trk = (x, z) => { B(2.4, 1.2, 7, OD, x, 1.2, z); B(2.4, 2.2, 4.4, OL, x, 2.7, z + 1); };
  trk(bx, bz + 30);
  const dish = new THREE.Mesh(mergeColored([
    { geo: new THREE.BoxGeometry(6, 3.4, 0.5), color: OL, matrix: xform(0, 2.2, 0, 0, 1, 1, 1, -0.2) },
    { geo: new THREE.CylinderGeometry(0.4, 0.5, 2, 8), color: DK, matrix: xform(0, 0.6, 0.3) },
  ]), lam());
  dish.position.set(bx, 3.8, bz + 31); G.add(dish); spinners.push({ obj: dish, rate: 1.7 });

  // --- radômes et antenne de transmissions
  for (const [x, z, r] of [[-side - 150, 360, 9], [-side - 122, 385, 6.5]]) {
    C(r * 0.6, r * 0.7, 5, CO, x, 2.5, z);
    parts.push({ geo: new THREE.IcosahedronGeometry(r, 2), color: 0xf4f5f3, matrix: xform(x, 4 + r * 0.85, z) });
    collide(x, z, r * 0.8, r * 0.8, 5 + r * 1.8);
  }
  const ax = -side - 165, az = 320;
  for (let k = 0; k < 8; k++) for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B(0.25, 5, 0.25, k % 2 ? 0xf4f4ee : 0xd8312b, ax + sx * (1.6 - k * 0.17), 2.5 + k * 5, az + sz * (1.6 - k * 0.17));
  for (let k = 1; k < 8; k++) B(3.4 - k * 0.34, 0.2, 3.4 - k * 0.34, ST, ax, k * 5, az);
  C(0.08, 0.1, 8, ST, ax, 44, az, 5); red.push(ax, 48.2, az); collide(ax, az, 1.7, 1.7, 47);
  B(9, 3.6, 6, SA, ax + 9, 1.8, az); B(9.4, 0.4, 6.4, OD, ax + 9, 3.8, az); collide(ax + 9, az, 4.5, 3, 4);

  // --- chars, camions, filets de camouflage
  B(60, 0.12, 70, 0xb3a27c, -side - 60, 0.08, 330);
  for (let k = 0; k < 8; k++) { const x = -side - 82 + (k % 4) * 13, z = 312 + Math.floor(k / 4) * 24; tankParts(parts, x, z, 0); collide(x, z, 2, 3.5, 3); }
  for (let k = 0; k < 3; k++) {
    const z = 262 + k * 2, x = -side - 84 + k * 20;
    parts.push({ geo: new THREE.ConeGeometry(9, 4.2, 6, 1, true), color: k % 2 ? 0x6b7a45 : 0x55663a, matrix: xform(x, 2.4, z, k) });
    B(2.4, 2, 5, OD, x, 1.2, z);
  }

  // --- parcours du combattant et champ de tir
  B(50, 0.1, 130, 0xc2ad7d, -side - 62, 0.07, 445);
  for (const [x, h] of [[-12, 2.4], [0, 3.2], [12, 1.8]]) for (let k = 0; k < 3; k++) B(8, h, 0.5, 0x8a6a44, -side - 62 + x, h / 2, 392 + k * 16 + x * 0.2);
  for (let k = 0; k < 8; k++) parts.push({ geo: new THREE.TorusGeometry(0.8, 0.28, 5, 10).rotateX(Math.PI / 2), color: 0x1f2123, matrix: xform(-side - 70 + (k % 2) * 2, 0.3, 440 + Math.floor(k / 2) * 2) });
  for (const x of [-4, 4]) B(0.5, 6, 0.5, 0x8a6a44, -side - 56 + x, 3, 445);
  B(9, 0.5, 0.5, 0x8a6a44, -side - 56, 6, 445); for (let k = -1; k <= 1; k++) B(0.12, 5, 0.12, 0xd9c48f, -side - 56 + k * 2.4, 3.4, 445);
  for (let k = 0; k < 5; k++) { B(1.2, 1.8, 0.1, 0xf4f0e2, -side - 82 + k * 10, 1.6, 505); B(0.4, 0.4, 0.12, 0xd8312b, -side - 82 + k * 10, 1.8, 504.95); }
  parts.push({ geo: new THREE.SphereGeometry(1, 10, 5, 0, 6.2832, 0, Math.PI / 2), color: 0x7f9a50, matrix: xform(-side - 62, 0, 514, 0, 30, 4.5, 5) });

  // --- côté casernes : réfectoire, château d'eau, terrain de sport, groupes électrogènes, projecteurs
  B(26, 5, 20, SA, side + 150, 2.5, 235); B(27, 0.7, 21, OD, side + 150, 5.3, 235); B(26.2, 1.2, 12, 0x3a5a70, side + 150, 3.2, 235); collide(side + 150, 235, 13, 10, 6);
  B(24, 0.1, 40, 0x4f8a55, side + 150, 0.2, 300); for (const s of [-1, 1]) { B(24, 0.05, 0.3, 0xf4f4ee, side + 150, 0.28, 300 + s * 19); B(5, 0.2, 0.2, 0xf4f4ee, side + 150, 2.4, 300 + s * 18.5); for (const u of [-2.4, 2.4]) B(0.2, 2.4, 0.2, 0xf4f4ee, side + 150 + u, 1.2, 300 + s * 18.5); }
  const wx = side + 160, wz = 385;
  for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) B(0.5, 15, 0.5, ST, wx + a, 7.5, wz + b);
  C(5.5, 5.5, 6, OL, wx, 18, wz, 12); parts.push({ geo: new THREE.ConeGeometry(5.9, 2.4, 12), color: OD, matrix: xform(wx, 22.2, wz) }); red.push(wx, 24, wz); collide(wx, wz, 5.5, 5.5, 23);
  for (let k = 0; k < 3; k++) { B(3, 2, 5, OL, side + 168 + k * 4.5, 1.2, 60); B(0.5, 1, 0.5, DK, side + 168 + k * 4.5, 2.6, 61); }
  for (const [x, z] of [[side + 130, -300], [side + 130, -40], [side + 112, 205], [side + 120, 405], [-side - 112, 70], [-side - 112, 190]]) {
    C(0.2, 0.3, 16, ST, x, 8, z, 6); B(4, 1, 0.6, 0x3a3f45, x, 16, z); for (const s of [-1.2, 0, 1.2]) white.push(x + s, 16, z);
    collide(x, z, 0.3, 0.3, 16.5);
  }
  // vigie : passerelle, antennes, balise
  B(13, 0.4, 13, ST, side + 125, 17.6, 60); for (const s of [-6.3, 6.3]) { B(0.1, 1, 13, ST, side + 125 + s, 18.3, 60); B(13, 1, 0.1, ST, side + 125, 18.3, 60 + s); }
  for (const [a, h] of [[-3, 5], [0, 8], [-1.5, 3.5]]) C(0.08, 0.1, h, 0xe3e6e8, side + 125 + a, 22.8 + h / 2, 62, 5);
  red.push(side + 125, 31.5, 62, side + 175, 19.5, -380);
  // entrée du poste de commandement : perron, vigie de toit, paraboles
  B(8, 4, 6, SA, side + 135, 9.6, 110); B(8.2, 1.4, 6.2, 0x29495f, side + 135, 10.2, 110);
  for (const s of [-12, 12]) { C(0.2, 0.3, 2, ST, side + 135 + s, 8.6, 110, 6); parts.push({ geo: new THREE.SphereGeometry(2, 10, 5, 0, 6.2832, 0, 1.1), color: 0xf0f1ef, matrix: xform(side + 135 + s, 9.4, 110, 0, 1, 1, 1, 2.3) }); }

  // --- routes intérieures
  for (const [w, d, x, z] of [[7, 792, side + 174, 31], [164, 7, side + 95, 427], [164, 7, side + 95, -365]]) B(w, 0.12, d, 0x4f5257, x, 0.15, z);

  // --- clôture, miradors aux angles, poste de garde
  const X0 = -224, X1 = 226, Z0 = -600, Z1 = 600;
  const fence = (x, z, w, d) => { for (const y of [0.9, 1.7, 2.5]) B(w, 0.08, d, 0xa8adb2, x, y, z); };
  fence(X0, 0, 0.08, Z1 - Z0); fence(X1, -310, 0.08, 580); fence(X1, 310, 0.08, 580); fence(0, Z0, X1 - X0, 0.08); fence(0, Z1, X1 - X0, 0.08);
  for (let z = Z0; z <= Z1; z += 12) for (const x of [X0, X1]) B(0.18, 2.8, 0.18, 0x7a8086, x, 1.4, z);
  for (let x = X0; x <= X1; x += 12) for (const z of [Z0, Z1]) B(0.18, 2.8, 0.18, 0x7a8086, x, 1.4, z);
  const tower = (x, z) => {
    for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) B(0.4, 11, 0.4, 0x6b5a3c, x + a, 5.5, z + b);
    B(5.4, 0.4, 5.4, 0x6b5a3c, x, 9, z); for (const s of [-2.6, 2.6]) { B(0.2, 1.3, 5.4, OD, x + s, 9.8, z); B(5.4, 1.3, 0.2, OD, x, 9.8, z + s); }
    parts.push({ geo: new THREE.ConeGeometry(4.4, 2, 4), color: OD, matrix: xform(x, 12, z, Math.PI / 4) });
    B(0.5, 1.2, 0.4, OL, x, 9.8, z); B(0.4, 0.4, 0.4, 0xd9b48f, x, 10.6, z);
    white.push(x, 11.4, z);
    collide(x, z, 2.8, 2.8, 13);
  };
  for (const x of [X0 + 6, X1 - 6]) for (const z of [Z0 + 8, Z1 - 8, 60]) if (!(x > 0 && z === 60)) tower(x, z);
  B(5, 3.4, 5, SA, X1 - 6, 1.7, 14); B(5.6, 0.4, 5.6, OD, X1 - 6, 3.6, 14); B(5.1, 1, 3, 0x3a5a70, X1 - 6, 2.2, 14);
  for (let k = 0; k < 8; k++) B(2.2, 0.3, 0.3, k % 2 ? 0xf4f4ee : 0xd8312b, X1 - 0.5, 1.3, -8 + k * 2.2, Math.PI / 2);
  for (const s of [-14, -20]) for (let k = 0; k < 4; k++) B(1.4, 0.5, 0.7, SA, X1 - 6, 0.3 + (k % 2) * 0.45, s + k * 1.5);
  B(50, 0.12, 8, 0x4f5257, side + 190, 0.15, 0);

  // --- ponton et patrouilleur : on cherche la rive en face du portail
  let sx = 240;
  while (sx < 700 && heightAt((toWorld(rw, sx, 0, _w), _w.x), _w.z) > 1) sx += 4;
  if (sx < 700) {
    // chemin du portail au ponton, posé sur le relief
    const rib = [], y = (x, z) => heightAt((toWorld(rw, x, z, _w), _w.x), _w.z) + 0.35 - rw.alt;
    for (let x = X1; x < sx; x += 4) for (const [a, b, c] of [[[x, -3], [x, 3], [x + 4, -3]], [[x + 4, -3], [x, 3], [x + 4, 3]]]) for (const [u, v] of [a, b, c]) rib.push(u, y(u, v), v);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(rib, 3));
    parts.push({ geo: rg, color: 0xb9ad92 });
    for (let k = -2; k < 11; k++) { B(6, 0.5, 6, 0x9a9488, sx + k * 6, 1.6 - rw.alt, 0); for (const s of [-2.4, 2.4]) C(0.35, 0.35, 8, 0x6b6660, sx + k * 6, -2.4 - rw.alt, s, 6); }
    B(8, 0.5, 34, 0x9a9488, sx + 66, 1.6 - rw.alt, 0);
    const hull = new THREE.BoxGeometry(5.4, 3, 26, 1, 1, 6), p = hull.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i), k = z < -4 ? Math.max(0.05, 1 - (-4 - z) / 9.2) : 1; p.setX(i, p.getX(i) * k * (p.getY(i) < 0 ? 0.75 : 1)); if (z < -8 && p.getY(i) > 0) p.setY(i, p.getY(i) + 0.8); }
    const bp = [{ geo: hull, color: 0x7d878f, matrix: xform(0, 0.8, 0) }];
    const bb = (w, h, d, c, x, y, z) => bp.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
    bb(4, 2.4, 7, 0x8d979f, 0, 3.4, 1); bb(4.1, 0.8, 5, 0x29495f, 0, 3.9, -0.4); bb(3, 1, 4, 0x7d878f, 0, 5, 1.4); bb(0.3, 5, 0.3, ST, 0, 7.5, 2);
    bb(1.6, 0.2, 0.5, ST, 0, 9, 2); bp.push({ geo: new THREE.CylinderGeometry(0.8, 1, 0.9, 8), color: 0x6b757d, matrix: xform(0, 2.9, -6) }); bb(0.2, 0.2, 2.6, DK, 0, 3.1, -7.8);
    const boat = new THREE.Mesh(mergeColored(bp), lam());
    boat.position.set(sx + 76, -rw.alt, 0); G.add(boat);
    spinners.push({ tick(t) { boat.position.y = -rw.alt + Math.sin(t * 0.9) * 0.25; boat.rotation.z = Math.sin(t * 0.7) * 0.03; } });
    collide(sx + 76, 0, 2.7, 13, 8 - rw.alt);
  }

  const mat = lam();
  Object.assign(mat, { polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }); // devant le béton du parking
  const mesh = new THREE.Mesh(mergeColored(parts), mat);
  mesh.receiveShadow = true; mesh.castShadow = true;
  G.add(mesh);
  G.add(lightsPoints(red, 0xff3020, 5), lightsPoints(white, 0xfff2cc, 6));

  // --- escouade qui défile autour du drapeau, jeep en ronde sur la route intérieure
  const sq = [];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 6; j++) {
    const x = (i - 1) * 1.5, z = j * 1.6 - 4;
    sq.push({ geo: new THREE.BoxGeometry(0.55, 1.2, 0.4), color: OL, matrix: xform(x, 1, z) }, { geo: new THREE.BoxGeometry(0.4, 0.4, 0.4), color: 0xd9b48f, matrix: xform(x, 1.8, z) }, { geo: new THREE.BoxGeometry(0.5, 0.2, 0.5), color: OD, matrix: xform(x, 2.08, z) });
  }
  const squad = new THREE.Mesh(mergeColored(sq), lam()); squad.castShadow = true; G.add(squad);
  const jp = [];
  const jb = (w, h, d, c, x, y, z) => jp.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  jb(1.9, 0.8, 4, OL, 0, 0.95, 0); jb(1.7, 0.7, 0.1, 0x3a5a70, 0, 1.7, -0.6); jb(0.5, 0.9, 0.4, OD, -0.4, 1.6, 0.4); jb(0.5, 0.9, 0.4, OD, 0.4, 1.6, 0.4); jb(0.12, 0.12, 2, DK, 0, 2.3, 0.6);
  for (const x of [-0.85, 0.85]) for (const z of [-1.3, 1.3]) jp.push({ geo: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(x, 0.42, z) });
  const jeep = new THREE.Mesh(mergeColored(jp), lam()); jeep.castShadow = true;
  jeep.add(lightsPoints([-0.6, 0.95, -2.1, 0.6, 0.95, -2.1], 0xfff4c8, 1.6));
  G.add(jeep);
  /** Avance un objet le long d'un rectangle (x0..x1, z0..z1) à la vitesse v. */
  const patrol = (o, x0, x1, z0, z1, v, y) => {
    const w = x1 - x0, d = z1 - z0, P = 2 * (w + d);
    spinners.push({ tick(t) {
      let s = (t * v) % P;
      if (s < d) { o.position.set(x1, y, z1 - s); o.rotation.y = 0; }
      else if ((s -= d) < w) { o.position.set(x1 - s, y, z0); o.rotation.y = Math.PI / 2; }
      else if ((s -= w) < d) { o.position.set(x0, y, z0 + s); o.rotation.y = Math.PI; }
      else { o.position.set(x0 + s - d, y, z1); o.rotation.y = -Math.PI / 2; }
    } });
  };
  patrol(squad, fx - 15, fx + 15, fz - 15, fz + 15, 1.6, 0.15);
  patrol(jeep, side + 18, side + 174, -365, 427, 11, 0.22);
}
