import * as THREE from 'three';
import { carrier, lightsPoints, spinners } from './airfields.js';
import { addMoving } from './colliders.js';
import { addDeck, moveDeck } from './decks.js';
import { SPEED } from './carrier.js';
import { Puffs } from './puffs.js';
import { mergeColored, xform, toWorld, smoothstep, lerp, clamp } from '../util.js';
import { kit } from './ports.js';
import { parkedGeo } from './milbase.js';
import { usFlag } from './flag.js';
import { radome } from '../planes/models.js';

// Escorte du porte-avions, qui navigue avec lui : deux destroyers, deux frégates (on peut poser un hélicoptère sur leur
// plateforme), un pétrolier ravitailleur, un sous-marin qui plonge et refait surface, deux vedettes et un hélicoptère.
// Les axes d'appontage et de catapultage (devant et derrière le pont) restent libres. Repère navire : -Z vers l'avant.

const GR = 0x8a949c, GD = 0x6c767e, GL = 0x9da6ad, DK = 0x3b434a, GLASS = 0x22384a, RED = 0x7d3a34, WH = 0xe9ecee, BLK = 0x1f2428;
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _w = { x: 0, z: 0 };

/** Coque militaire : étrave élancée et relevée, flancs évasés, tableau arrière ; pont à y1, flottaison rouge sombre. */
function hull(k, L, W, y1, sheer) {
  const shape = (g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const t = p.getZ(i) / L + 0.5, y = p.getY(i), v = smoothstep(-3, y1, y);
      let f = Math.pow(smoothstep(0, 0.42, t), 0.8) * lerp(1, 0.84, smoothstep(0.8, 1, t));
      f = Math.max(0.03, f * (0.72 + 0.28 * v));
      const up = sheer * (1 - smoothstep(0, 0.4, t)) * smoothstep(0, y1, y);
      p.setXYZ(i, p.getX(i) * f, y + up, p.getZ(i) + (1 - v) * L * 0.07 * (1 - smoothstep(0, 0.25, t)));
    }
    return g;
  };
  k.parts.push({ geo: shape(new THREE.BoxGeometry(W, y1 - 0.6, L, 2, 3, 22).translate(0, (y1 + 0.6) / 2, 0)), color: GR });
  k.parts.push({ geo: shape(new THREE.BoxGeometry(W, 3.6, L, 2, 2, 22).translate(0, -1.2, 0)), color: RED });
  k.parts.push({ geo: shape(new THREE.BoxGeometry(W * 0.97, 0.16, L * 0.99, 2, 1, 22).translate(0, y1 + 0.06, 0)), color: GD });
}
/** Bloc de superstructure à flancs inclinés (bas w × d, haut réduit de `in_`). */
function block(k, w, h, d, color, x, y, z, in_ = 0.82) {
  const g = new THREE.BoxGeometry(w, h, d), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0) { p.setX(i, p.getX(i) * in_); p.setZ(i, p.getZ(i) * (1 - (1 - in_) * 0.5)); }
  k.parts.push({ geo: g, color, matrix: xform(x, y + h / 2, z) });
}
function turret(k, z, y, s = 1) {
  block(k, 3.4 * s, 2.4 * s, 4.4 * s, GL, 0, y, z, 0.6);
  k.parts.push({ geo: new THREE.CylinderGeometry(0.16, 0.22, 6.5 * s, 8).rotateX(Math.PI / 2 - 0.12), color: DK, matrix: xform(0, y + 1.7 * s, z - 4.6 * s) });
}
function mast(k, z, y, h) {
  k.parts.push({ geo: new THREE.CylinderGeometry(0.35, 1.5, h, 4), color: GD, matrix: xform(0, y + h / 2, z, Math.PI / 4) });
  for (const t of [0.5, 0.72, 0.9]) k.B(9 - t * 6, 0.25, 0.4, GD, 0, y + h * t, z);
  k.C(0.06, 0.08, 5, WH, 0, y + h + 2.5, z, 5);
}
const dome = (k, r, x, y, z) => k.parts.push({ geo: new THREE.SphereGeometry(r, 10, 7), color: WH, matrix: xform(x, y, z) });
function helideck(k, y, z, w, d) {
  k.B(w, 0.2, d, DK, 0, y, z);
  const ring = Math.min(w, d) * 0.36;
  k.parts.push({ geo: new THREE.TorusGeometry(ring, 0.18, 3, 28).rotateX(Math.PI / 2), color: WH, matrix: xform(0, y + 0.12, z, 0, 1, 0.3, 1) });
  for (const s of [-1, 1]) k.B(0.35, 0.04, ring * 0.9, WH, s * ring * 0.36, y + 0.13, z);
  k.B(ring * 0.72, 0.04, 0.35, WH, 0, y + 0.13, z);
}
function rail(k, w, y, z0, z1) { // garde-corps le long du pont
  for (const s of [-1, 1]) { k.B(0.07, 0.07, z1 - z0, WH, s * w, y + 1.1, (z0 + z1) / 2); for (let z = z0; z <= z1; z += 4) k.B(0.07, 1.1, 0.07, WH, s * w, y + 0.55, z); }
}

/** Destroyer (150 m) : tourelle, silos, passerelle à panneaux radar, deux cheminées, hangar et plateforme hélico. */
function destroyer() {
  const k = kit(), y = 8;
  hull(k, 150, 19, y, 4);
  turret(k, -50, y + 2.4, 1.15); k.B(8.5, 2.6, 10, GR, 0, y + 0.9, -36.8);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) k.B(1.5, 0.25, 1.5, DK, (j - 1) * 2.4, y + 2.25, -40 + i * 2.1);
  block(k, 17, 5, 34, GR, 0, y, -14, 0.92); block(k, 15.5, 7, 22, GL, 0, y + 5, -17, 0.84); block(k, 13, 3.4, 15, GR, 0, y + 12, -18, 0.86);
  k.B(12.6, 1.1, 0.3, GLASS, 0, y + 13.6, -25.3); for (const s of [-1, 1]) k.B(0.3, 1.1, 10, GLASS, s * 6.1, y + 13.6, -20);
  for (const s of [-1, 1]) for (const z of [-26.6, -8]) k.parts.push({ geo: new THREE.CylinderGeometry(2.1, 2.1, 0.4, 8).rotateX(Math.PI / 2), color: GD, matrix: xform(s * 4.3, y + 8.6, z, (z < -20 ? s * 0.3 : Math.PI - s * 0.3)) });
  mast(k, -13, y + 15, 17); dome(k, 1.5, -3.6, y + 16.6, -15); dome(k, 1.5, 3.6, y + 16.6, -15);
  for (const z of [4, 22]) { block(k, 8, 9, 8, GD, 0, y + 3, z, 0.7); k.B(4.6, 0.8, 5.6, BLK, 0, y + 12.2, z); }
  block(k, 15, 4, 34, GR, 0, y, 14, 0.94);
  block(k, 16, 6.5, 16, GL, 0, y, 41, 0.9); k.B(5.6, 4.6, 0.3, DK, -3.6, y + 2.6, 49); k.B(5.6, 4.6, 0.3, DK, 3.6, y + 2.6, 49); dome(k, 1.3, 0, y + 8, 38);
  for (const s of [-1, 1]) { k.B(1.8, 1.4, 6.5, 0xd96a2b, s * 8.6, y + 4.6, 12); k.C(0.8, 0.9, 1, WH, s * 5, y + 13.4, -8, 8); } // embarcations, lance-leurres
  helideck(k, y + 0.2, 60, 15, 21); rail(k, 8.2, y, 24, 33);
  return { mesh: k.mesh(), L: 150, W: 19, y, top: [[-14, 22, 8.5, 22], [14, 18, 7.5, 13], [41, 9, 8, 8]], radar: [0, y + 24, -12.2], flag: [0, y, 72.5], deck: [0, y + 0.3, 60, 7.5, 10.4], lights: [0, y + 33, -13] };
}
/** Frégate (122 m) : lignes plus douces, une cheminée, radar sous dôme. */
function frigate() {
  const k = kit(), y = 6.6;
  hull(k, 122, 15.5, y, 3.2);
  turret(k, -42, y + 2, 0.9); k.B(6.5, 2, 8, GR, 0, y + 0.8, -31);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.B(1.4, 0.25, 1.4, DK, (j - 0.5) * 2.4, y + 1.85, -33 + i * 2);
  block(k, 14, 6, 40, GR, 0, y, -6, 0.88); block(k, 11.5, 5, 17, GL, 0, y + 6, -15, 0.82); k.B(9.6, 1.1, 0.3, GLASS, 0, y + 9.4, -22.8); for (const s of [-1, 1]) k.B(0.3, 1, 8, GLASS, s * 5, y + 9.4, -18);
  block(k, 5.5, 7, 5.5, GL, 0, y + 11, -11, 0.6); dome(k, 2.7, 0, y + 20, -11);
  mast(k, 0, y + 6, 14); block(k, 6.5, 8, 8, GD, 0, y + 5, 9, 0.72); k.B(3.8, 0.7, 5, BLK, 0, y + 13.2, 9);
  for (const s of [-1, 1]) { k.C(0.35, 0.35, 5, DK, s * 2.6, y + 7.4, -2, 8, Math.PI / 2 - 0.3, s * 0.5); k.B(1.6, 1.3, 5.6, 0xd96a2b, s * 6.4, y + 3.6, 3); }
  block(k, 13, 6, 18, GL, 0, y, 24, 0.9); k.B(7, 4.6, 0.3, DK, 0, y + 2.5, 33.1); k.B(1.4, 1.2, 2.6, GD, 0, y + 6.8, 24);
  helideck(k, y + 0.2, 45.5, 12.5, 23); rail(k, 6.6, y, 34, 34.1);
  return { mesh: k.mesh(), L: 122, W: 15.5, y, top: [[-8, 22, 7, 12], [20, 13, 6.5, 8]], radar: [0, y + 17, 0.6], flag: [0, y, 59], deck: [0, y + 0.3, 45.5, 6.4, 11.4], lights: [0, y + 23, 0] };
}
/** Pétrolier ravitailleur (175 m) : portiques et tuyaux, château arrière. */
function oiler() {
  const k = kit(), y = 8.5;
  hull(k, 175, 25, y, 3);
  for (const z of [-42, -18, 6]) {
    for (const s of [-1, 1]) { k.B(1.2, 19, 1.2, GL, s * 8.5, y + 9.5, z); k.B(1, 1, 11, GL, s * 8.5, y + 18, z + 0.1); for (let j = 0; j < 4; j++) k.parts.push({ geo: new THREE.TorusGeometry(1.35, 0.2, 4, 10, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2), color: BLK, matrix: xform(s * 8.5, y + 17.6, z - 4.05 + j * 2.7, 0, 1, 2.6, 1) }); }
    k.B(18, 1.2, 1.2, GL, 0, y + 18.6, z); k.B(9, 3, 8, GR, 0, y + 1.5, z + 11);
  }
  for (const s of [-1, 1]) k.B(0.7, 0.7, 92, RED, s * 4, y + 0.9, -14);
  block(k, 22, 9, 24, GR, 0, y, 45, 0.94); block(k, 19, 6, 14, WH, 0, y + 9, 41, 0.92); k.B(17.6, 1.2, 0.3, GLASS, 0, y + 13, 34.2); mast(k, 44, y + 15, 10);
  block(k, 7, 8, 7, GD, 0, y + 9, 53, 0.8); k.B(5, 0.8, 5, BLK, 0, y + 17.2, 53);
  for (const s of [-1, 1]) k.B(2, 1.6, 7, 0xd96a2b, s * 11.3, y + 8, 47);
  helideck(k, y + 0.2, 72, 20, 25);
  return { mesh: k.mesh(), L: 175, W: 25, y, top: [[-18, 20, 11, 38], [46, 18, 11, 14]], radar: [0, y + 20, 43], flag: [0, y, 86], deck: [0, y + 0.3, 72, 10, 12.4], lights: [0, y + 26, 44] };
}
/** Sous-marin en surface (110 m). */
function submarine() {
  const k = kit(), S = 0x2a3036;
  k.parts.push({ geo: new THREE.CylinderGeometry(5.4, 5.4, 70, 14).rotateX(Math.PI / 2), color: S, matrix: xform(0, -2.8, -4) });
  k.parts.push({ geo: new THREE.SphereGeometry(5.4, 14, 8), color: S, matrix: xform(0, -2.8, -39, 0, 1, 1, 2.2) });
  k.parts.push({ geo: new THREE.CylinderGeometry(5.4, 1.2, 24, 14).rotateX(-Math.PI / 2), color: S, matrix: xform(0, -3.2, 43) });
  k.B(4.4, 0.6, 66, 0x20252a, 0, 2.5, -4);
  block(k, 3.2, 6.4, 13, S, 0, 2, -14, 0.8); k.B(11, 0.5, 3, S, 0, 5.4, -15);
  for (const [z, h] of [[-17, 4], [-15.2, 5.6], [-13, 3]]) k.C(0.16, 0.2, h, GD, 0, 8 + h / 2, z, 6);
  k.parts.push({ geo: new THREE.BoxGeometry(0.8, 6, 5), color: S, matrix: xform(0, 1.2, 50) });
  for (const [x, z] of [[0.8, -18.4], [-0.8, -17.6]]) { k.B(0.5, 1.1, 0.4, 0x2d4a73, x, 8.8, z + 2); k.B(0.35, 0.4, 0.35, 0xd9b48f, x, 9.5, z + 2); }
  return { mesh: k.mesh(), L: 100, W: 10, y: 2.4, top: [[-14, 6, 1.6, 6.5]], flag: null, lights: [0, 12, -15] };
}
function guardBoat() {
  const k = kit();
  const g = new THREE.BoxGeometry(3.4, 1.7, 11, 2, 2, 8).translate(0, 0.4, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const t = p.getZ(i) / 11 + 0.5, f = Math.max(0.05, smoothstep(0, 0.45, t)) * (p.getY(i) < 0 ? 0.7 : 1); p.setX(i, p.getX(i) * f); if (p.getY(i) > 0) p.setY(i, p.getY(i) + 0.7 * (1 - smoothstep(0, 0.5, t))); }
  k.parts.push({ geo: g, color: DK }); k.B(2.2, 1.5, 3, GL, 0, 2, 0.4); k.B(2.25, 0.6, 2, GLASS, 0, 2.3, -0.2); k.C(0.06, 0.08, 2.4, DK, 0, 3.9, 1.4, 5); k.B(0.9, 0.8, 1, DK, 0, 1.6, -2.6); k.B(0.12, 0.12, 1.6, BLK, 0, 2.1, -3.4);
  return { mesh: k.mesh(), L: 11, W: 3.4, y: 1.4, top: [], lights: [0, 5.2, 1.4] };
}

// ---------------------------------------------------------------------------
/** Point et cap sur un « stade » (deux droites 2a et deux demi-cercles r), centré en (cx, cz) du repère du porte-avions. */
function stadium(o, s, out) {
  const { cx, cz, a, r } = o, A = Math.PI * r, P = 4 * a + 2 * A;
  s = ((s % P) + P) % P;
  let x, z, h; // h : cap local (0 = vers -Z)
  if (s < 2 * a) { x = r; z = a - s; h = 0; }
  else if ((s -= 2 * a) < A) { const t = s / r; x = r * Math.cos(t); z = -a - r * Math.sin(t); h = t; }
  else if ((s -= A) < 2 * a) { x = -r; z = -a + s; h = Math.PI; }
  else { const t = (s - 2 * a) / r; x = -r * Math.cos(t); z = a + r * Math.sin(t); h = Math.PI + t; }
  out.lx = cx + x * o.dir; out.lz = cz + z; out.h = h * o.dir;
  return out;
}

export function buildEscort(scene) {
  const C = carrier, ships = [], _o = {}, foam = new Puffs(scene, 60, { opacity: 0.75 });
  const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide });
  const wakeGeo = new THREE.BufferGeometry();
  wakeGeo.setAttribute('position', new THREE.Float32BufferAttribute([-0.4, 0, 0, 0.4, 0, 0, 1, 0, 1, -0.4, 0, 0, 1, 0, 1, -1, 0, 1], 3));
  // lames d'étrave : deux rubans d'écume le long de la coque
  const bow = new THREE.BufferGeometry();
  bow.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.5, 0.5, 0, -0.1, 0.9, 0, 0.5, 0, 0, -0.5, -0.9, 0, 0.5, -0.5, 0, -0.1], 3));
  /** Navire au poste (lx, lz) dans le repère du porte-avions, qui louvoie de ±ax (en travers) et ±az (en long). */
  const add = (d, opt) => {
    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    root.add(d.mesh);
    root.add(lightsPoints([0, d.lights[1], d.lights[2]], 0xffffff, 6), lightsPoints([-d.W / 2, d.y + 3, -d.L * 0.12], 0xff3020, 4), lightsPoints([d.W / 2, d.y + 3, -d.L * 0.12], 0x30ff60, 4));
    if (d.radar) {
      const r = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(5, 1.4, 0.3), color: WH, matrix: xform(0, 0.4, 1.3) }, { geo: new THREE.BoxGeometry(0.4, 0.4, 1.4), color: GD, matrix: xform(0, 0, 0.6) }]), lam());
      r.position.set(...d.radar); root.add(r); spinners.push({ obj: r, rate: 1.4 + ships.length * 0.2 });
    }
    if (d.flag) {
      const pole = new THREE.Mesh(mergeColored([{ geo: new THREE.CylinderGeometry(0.07, 0.1, 7, 6), color: WH }]), lam());
      pole.position.set(d.flag[0], d.flag[1] + 3.5, d.flag[2]); root.add(pole);
      const f = usFlag(2.2); f.position.set(d.flag[0], d.flag[1] + 4.6, d.flag[2]); f.rotation.y = -Math.PI / 2; root.add(f);
    }
    scene.add(root);
    const s = { root, d, phase: ships.length * 1.7, t: ships.length * 37, w: 0.02, ax: 0, az: 0, depth: 0, pitch: 0, ...opt, cols: [] };
    for (const [z, top, hw, hd] of [[0, d.y, d.W / 2, d.L * 0.47], ...d.top.map(([z, h, hw, hd]) => [z, d.y + h, hw, hd])]) s.cols.push({ z, top, c: addMoving(hw, hd, -8, top) });
    s.wake = new THREE.Mesh(wakeGeo, wakeMat); s.bow = new THREE.Mesh(bow, wakeMat);
    s.wake.renderOrder = s.bow.renderOrder = 1;
    s.wake.position.set(0, 0.2, d.L * 0.46); s.wake.scale.set(d.W * 0.55, 1, d.L * 0.5 + SPEED * 14);
    s.bow.position.set(0, 0.25, -d.L * 0.25); s.bow.scale.set(d.W * 0.8, 1, d.L * 0.42);
    root.add(s.wake, s.bow);
    if (d.deck && opt.land) s.deck = addDeck({ x: 0, z: 0, yaw: 0, y: d.deck[1], hw: d.deck[3], hl: d.deck[4], kind: 'deck', name: opt.land });
    ships.push(s);
    return s;
  };
  add(destroyer(), { lx: -560, lz: -420, ax: 70, az: 60, land: 'Destroyer' }); add(destroyer(), { lx: 560, lz: -380, ax: 60, az: 70, land: 'Destroyer' });
  add(frigate(), { lx: -600, lz: 380, ax: 70, az: 60, land: 'Frégate' }); add(frigate(), { lx: 600, lz: 430, ax: 60, az: 70, land: 'Frégate' });
  add(oiler(), { lx: 255, lz: 110, ax: 12, az: 20 });
  const sub = add(submarine(), { lx: -300, lz: -40, ax: 60, az: 160, w: 0.012 });
  add(guardBoat(), { lx: -190, lz: -330, ax: 55, az: 60, w: 0.09 }); add(guardBoat(), { lx: 205, lz: -330, ax: 45, az: 70, w: 0.08 });

  // hélicoptères gris : un garé sur le pétrolier, un autre de garde au-dessus de l'eau
  const { geo, spec } = parkedGeo('helico', [0x7d8790, 0x5d666e, 0x2b3138]), hmat = lam();
  for (const s of ships) if (s.d.deck && !s.deck) { const h = new THREE.Mesh(geo, hmat); h.position.set(s.d.deck[0], s.d.deck[1] + spec.gearH, s.d.deck[2]); h.castShadow = true; s.root.add(h); }
  const heli = new THREE.Mesh(parkedGeo('helico', [0x7d8790, 0x5d666e, 0x2b3138], true).geo, hmat); heli.castShadow = true; heli.rotation.order = 'YXZ';
  const disc = new THREE.Mesh(new THREE.CircleGeometry(6.2, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xd5dbe0, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false }));
  disc.position.set(0, 2.5, 0); heli.add(disc);
  const blades = new THREE.Mesh(mergeColored([0, 1].map((i) => ({ geo: new THREE.BoxGeometry(12.4, 0.06, 0.38), color: BLK, matrix: xform(0, 0, 0, (i * Math.PI) / 2) }))), lam());
  blades.position.set(0, 2.48, -0.05); heli.add(blades); spinners.push({ obj: blades, rate: 31 });
  heli.add(lightsPoints([0, -1, 0], 0xff4030, 5)); scene.add(heli);
  const guard = { route: { cx: 330, cz: 0, a: 380, r: 70, dir: 1 }, s: 0, v: 24, col: addMoving(4, 6, 0, 1), bank: 0 };

  // avion-radar : grands cercles au large, loin au-dessus de la flotte
  const rg = parkedGeo('veilleur', null, true), awacs = new THREE.Mesh(rg.geo, hmat); awacs.castShadow = false; awacs.rotation.order = 'YXZ';
  const dm = new THREE.Mesh(mergeColored(radome()), lam()); dm.position.set(0, 3.35, 1.2); awacs.add(dm); spinners.push({ obj: dm, rate: 0.7 });
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.CircleGeometry(1.95, 20), disc.material); p.position.set(s * 3.6, 0.45, -4.4); awacs.add(p); }
  awacs.add(lightsPoints([0, -1.4, 0], 0xff3020, 6)); scene.add(awacs);
  const orbit = { a: 0, r: 2300, y: 620, v: 82, col: addMoving(6, 8, 0, 1) };

  const api = {
    ships, heli, sub, awacs,
    update(dt, time) {
      // sous-marin : 80 s en surface, plonge, 50 s sous l'eau (en changeant de poste), refait surface
      const P = 190; sub.t += dt; const u = sub.t % P;
      const want = u < 80 ? 0 : u < 150 ? -26 : 0, v0 = sub.depth;
      sub.depth += clamp((want - sub.depth) * 0.12, -1.3, 1.1) * dt;
      const vy = dt > 0 ? (sub.depth - v0) / dt : 0;
      sub.pitch += (clamp(vy * 0.11, -0.16, 0.2) - sub.pitch) * (1 - Math.exp(-0.8 * dt));
      sub.under = sub.depth < -7.5;
      if (dt > 0 && Math.abs(vy) > 0.15 && sub.depth < -0.4 && sub.depth > -12 && Math.random() < dt * 14) {
        const b = (Math.random() - 0.5) * 80; foam.emit(sub.x + Math.sin(sub.yaw) * b, 0.2, sub.z + Math.cos(sub.yaw) * b, C.vx + (Math.random() - 0.5) * 4, 1 + Math.random() * 2, C.vz + (Math.random() - 0.5) * 4, 0.8, 3.2 + Math.random() * 2, 2.6);
      }
      foam.update(dt);
      for (const s of ships) {
        if (s !== sub) s.t += dt;
        const a = s.t * s.w, lx = s.lx + Math.sin(a) * s.ax, lz = s.lz + Math.cos(a * 0.83) * s.az;
        const dx = Math.cos(a) * s.ax * s.w, dz = -Math.sin(a * 0.83) * s.az * 0.83 * s.w;
        toWorld(C, lx, lz, _w);
        s.x = _w.x; s.z = _w.z; s.yaw = C.yaw + Math.atan2(-dx, SPEED - dz);
        const big = s.d.L > 60 ? 1 : 2.6, t = time + s.phase;
        s.root.position.set(s.x, s.depth + Math.sin(t * 0.6 * big) * 0.14 * big, s.z);
        s.root.rotation.set(Math.sin(t * 0.5 * big) * 0.006 * big + (big > 1 ? 0.05 : 0) + s.pitch, s.yaw, Math.sin(t * 0.43 * big) * 0.012 * big);
        for (const { z, top, c } of s.cols) { c.x = s.x + Math.sin(s.yaw) * z; c.z = s.z + Math.cos(s.yaw) * z; c.yaw = s.yaw; c.y1 = top + s.depth; }
        if (s.deck) moveDeck(s.deck, s.x + Math.sin(s.yaw) * s.d.deck[2], s.z + Math.cos(s.yaw) * s.d.deck[2], s.yaw, dt);
      }
      sub.wake.visible = sub.bow.visible = sub.depth > -1.5; sub.root.visible = sub.depth > -24;
      const g = guard;
      g.s += g.v * dt;
      stadium(g.route, g.s, _o); toWorld(C, _o.lx, _o.lz, _w); g.x = _w.x; g.z = _w.z; g.yaw = C.yaw + _o.h;
      stadium(g.route, g.s + 10, _o); const turn = Math.abs(Math.sin(_o.h + C.yaw - g.yaw)) > 0.02 ? 0.3 : 0;
      g.bank += (turn - g.bank) * (1 - Math.exp(-dt));
      const y = 72 + Math.sin(time * 0.4) * 3;
      heli.position.set(g.x, y, g.z); heli.rotation.set(-0.1, g.yaw, g.bank);
      Object.assign(g.col, { x: g.x, z: g.z, yaw: g.yaw, y0: y - 2.5, y1: y + 3 });
      // avion-radar : cercle à gauche autour de la flotte
      const o = orbit; o.a += (o.v / o.r) * dt;
      awacs.position.set(C.x + Math.cos(o.a) * o.r, o.y + Math.sin(o.a * 3) * 12, C.z - Math.sin(o.a) * o.r); awacs.rotation.set(0.02, o.a, 0.24);
      Object.assign(o.col, { x: awacs.position.x, z: awacs.position.z, yaw: o.a, y0: awacs.position.y - 3, y1: awacs.position.y + 4 });
    },
  };
  api.update(0, 0); // en place dès la première image
  return api;
}
