import * as THREE from 'three';
import { heightAt, HALF } from './terrain.js';
import { cityPort, fishPort, islets } from './places.js';
import { lightsPoints } from './airfields.js';
import { addBox, addCylinder, addMoving } from './colliders.js';
import { buildModel } from './boats.js';
import { People } from './people.js';
import { mergeColored, xform, mulberry32, toWorld, smoothstep } from '../util.js';

// Ports de la grande île : port de la Grande Ville (quais, grues, conteneurs, cargo, paquebot, gare maritime), port de
// pêche (pontons, halle, chalutiers qui vont et viennent) et ferry vers le Village des Pêcheurs. Mer vers -X.

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _w = { x: 0, z: 0 };

/** Plus court chemin en eau profonde (A* sur une grille de 100 m), lissé puis rééchantillonné tous les 10 m. */
export function waterPath(a, b, before = [], after = []) {
  const G = 100, n = Math.round((2 * HALF) / G) + 1, at = (i) => -HALF + i * G, idx = (p) => Math.round((p.x + HALF) / G) + Math.round((p.z + HALF) / G) * n;
  const depth = new Map(), H = (k) => { if (!depth.has(k)) { const i = k % n; depth.set(k, heightAt(at(i), at((k - i) / n))); } return depth.get(k); };
  const s = idx(a), e = idx(b), ex = e % n, ez = (e - ex) / n, g = new Map([[s, 0]]), from = new Map(), open = new Map([[s, 0]]);
  while (open.size) {
    let k = -1, bf = Infinity;
    for (const [q, f] of open) if (f < bf) { bf = f; k = q; }
    if (k === e) break;
    open.delete(k);
    const i = k % n, j = (k - i) / n;
    for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
      const x = i + u, y = j + v, q = x + y * n;
      if ((!u && !v) || x < 0 || y < 0 || x >= n || y >= n) continue;
      const h = H(q);
      if (h > -14 && q !== e) continue;
      const c = g.get(k) + Math.hypot(u, v) * (h > -30 ? 3 : h > -45 ? 1.6 : 1);
      if (g.has(q) && g.get(q) <= c) continue;
      g.set(q, c); from.set(q, k); open.set(q, c + Math.hypot(x - ex, y - ez));
    }
  }
  let pts = [];
  for (let k = e; k !== undefined; k = from.get(k)) { const i = k % n; pts.unshift({ x: at(i), z: at((k - i) / n) }); }
  pts[0] = a; pts[pts.length - 1] = b;
  for (let it = 0; it < 6; it++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : { x: (pts[i - 1].x + 2 * p.x + pts[i + 1].x) / 4, z: (pts[i - 1].z + 2 * p.z + pts[i + 1].z) / 4 }));
  return resample([...before, ...pts, ...after], 10);
}
function resample(pts, step) {
  const c = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p.x, 0, p.z)), false, 'centripetal');
  c.arcLengthDivisions = pts.length * 12;
  return c.getSpacedPoints(Math.max(4, Math.round(c.getLength() / step)));
}
function along(pts, s, out) {
  const n = pts.length - 1, u = Math.max(0, Math.min(n - 1e-4, s / 10)), i = Math.floor(u), f = u - i, a = pts[i], b = pts[i + 1];
  out.x = a.x + (b.x - a.x) * f; out.z = a.z + (b.z - a.z) * f;
  out.yaw = Math.atan2(a.x - b.x, a.z - b.z);
  return out;
}

/** Toit à deux pans : longueur selon X, largeur selon Z, faîte à h. */
export function prism(l, w, h) {
  const g = new THREE.BufferGeometry(), a = l / 2, b = w / 2;
  const A = [-a, 0, -b], B = [a, 0, -b], C = [a, 0, b], D = [-a, 0, b], E = [-a, h, 0], F = [a, h, 0];
  g.setAttribute('position', new THREE.Float32BufferAttribute([D, C, F, D, F, E, B, A, E, B, E, F, A, D, E, C, B, F].flat(), 3));
  return g;
}
export function kit() {
  const parts = [];
  return {
    parts,
    B: (w, h, d, c, x, y, z, ry = 0, rx = 0, rz = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry, 1, 1, 1, rx, rz) }),
    C: (rt, rb, h, c, x, y, z, seg = 10, rx = 0, rz = 0) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, matrix: xform(x, y, z, 0, 1, 1, 1, rx, rz) }),
    mesh: () => { const m = new THREE.Mesh(mergeColored(parts), lam({ side: THREE.DoubleSide })); m.castShadow = m.receiveShadow = true; return m; },
  };
}
/** Coque simple : boîte effilée à la proue (-Z) et, si `both`, à la poupe. */
function shipHull(k, L, W, y0, y1, color, both = false) {
  const g = new THREE.BoxGeometry(W, y1 - y0, L, 2, 3, 14).translate(0, (y0 + y1) / 2, 0), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i) / L + 0.5, u = both ? Math.min(t, 1 - t) : t, f = Math.max(0.06, Math.pow(smoothstep(0, both ? 0.16 : 0.24, u), 0.7)), v = (p.getY(i) - y0) / (y1 - y0);
    p.setX(i, p.getX(i) * f * (0.75 + 0.25 * v));
    if (!both) p.setZ(i, p.getZ(i) + (1 - v) * L * 0.05 * (1 - smoothstep(0, 0.2, t)));
  }
  k.parts.push({ geo: g, color });
}
function ferryMesh() {
  const k = kit(), W = 0xf4f4ee, B = 0x2f6fb8;
  shipHull(k, 62, 15, -2, 3.2, B, true); shipHull(k, 62.4, 15.4, 2.6, 3.3, W, true);
  k.B(13, 0.4, 50, 0x6b737a, 0, 3.4, 0);
  for (const s of [-1, 1]) { k.B(1, 5, 44, W, s * 6.4, 5.8, 0); for (let z = -18; z <= 18; z += 6) k.B(1.1, 1.6, 2.6, 0x3a5a70, s * 6.4, 6.4, z); }
  k.B(13.8, 0.6, 46, W, 0, 8.5, 0); k.B(11, 3.2, 30, W, 0, 10.4, 0); k.B(11.1, 1.2, 28, 0x3a5a70, 0, 10.8, 0); k.B(12, 0.4, 31, B, 0, 12.2, 0);
  for (const s of [-1, 1]) { k.B(7, 3, 5, W, 0, 13.9, s * 11); k.B(7.1, 1.1, 5.1, 0x26394a, 0, 14.4, s * 11); k.B(8, 0.3, 6, B, 0, 15.5, s * 11); k.C(0.12, 0.12, 6, W, 0, 18.4, s * 11, 5); k.B(9, 0.3, 7, 0x8d959d, 0, 3.6, s * 28, 0, s * 0.12); }
  k.C(1.5, 1.8, 5, 0xf2c230, 0, 14.6, 0); k.C(1.55, 1.6, 1, 0x2b2e33, 0, 17.4, 0);
  for (const s of [-1, 1]) for (const z of [-6, 0, 6]) k.C(0.7, 0.7, 2.6, 0xf08a2c, s * 5.8, 13.2, z, 8, Math.PI / 2);
  for (let j = 0; j < 8; j++) k.B(1.8, 1.4, 4.2, [0xd8312b, 0x2f5fa8, 0xf4f4ee, 0xf2c230][j % 4], (j % 2 ? 2.4 : -2.4), 4.3, -20 + j * 5.6);
  const m = k.mesh();
  m.add(lightsPoints([0, 21.6, -11, 0, 21.6, 11, -5, 8, 24, 5, 8, 24, -5, 8, -24, 5, 8, -24], 0xfff0c8, 4));
  return m;
}
function cargoMesh(rnd) {
  const k = kit();
  shipHull(k, 124, 19, -3, 7, 0x2b3440); shipHull(k, 124.4, 19.4, -3, -0.4, 0xa83232); k.B(17, 0.4, 100, 0x6b737a, 0, 7.1, 8);
  k.B(16, 15, 12, 0xf4f4ee, 0, 14.5, 48); k.B(20, 2.6, 8, 0xf4f4ee, 0, 22.5, 46); k.B(20.2, 1.1, 8.2, 0x26394a, 0, 22.9, 46); k.C(1.8, 2.2, 7, 0x2f6fb8, 0, 26, 52);
  const CC = [0xc8402f, 0x2f6fb8, 0x2f8a5a, 0xf2c230, 0xd9d4c8, 0xe07a2c];
  for (let z = -44; z <= 34; z += 13) for (let x = -2.5; x <= 2.5; x++) { const h = 1 + Math.floor(rnd() * 4); for (let y = 0; y < h; y++) k.B(2.5, 2.5, 12, CC[Math.floor(rnd() * 6)], x * 2.7, 8.7 + y * 2.6, z); }
  k.C(0.3, 0.3, 12, 0xd9dcdf, 0, 13, -52, 5);
  return k.mesh();
}
function linerMesh() {
  const k = kit(), W = 0xfbfbf8;
  shipHull(k, 150, 22, -3, 9, 0x1f3f6e); shipHull(k, 150.3, 22.3, 8, 9.6, 0xf2c230);
  for (let d = 0; d < 6; d++) { const L = 116 - d * 9; k.B(20 - d * 0.8, 2.8, L, W, 0, 11.2 + d * 3, 8 + d * 1.2); k.B(20.2 - d * 0.8, 1.1, L - 4, 0x3a5a70, 0, 11.4 + d * 3, 8 + d * 1.2); }
  k.B(16, 0.4, 24, 0x4fb8e0, 0, 27.6, 34); k.B(18, 2.4, 10, W, 0, 25.2, -30); k.B(18.2, 1.1, 10.2, 0x26394a, 0, 25.6, -30);
  k.C(3, 4, 9, 0x1f3f6e, 0, 32, 20); k.C(3.05, 3.3, 2, 0xf2c230, 0, 33, 20);
  for (const s of [-1, 1]) for (let z = -30; z <= 50; z += 12) k.B(1.6, 1.6, 7, 0xf08a2c, s * 10.6, 12, z);
  const m = k.mesh(), l = [];
  for (const s of [-1, 1]) for (let d = 0; d < 5; d++) for (let z = -40; z <= 50; z += 9) l.push(s * (10.3 - d * 0.4), 11.4 + d * 3, z);
  m.add(lightsPoints(l, 0xffe2a0, 3));
  return m;
}

export function buildPorts(scene) {
  if (!cityPort.active) return null;
  const rnd = mulberry32(9091), bob = [], gulls = [];
  const place = (o, mesh, lx, y, lz, ry = 0) => { toWorld(o, lx, lz, _w); mesh.position.set(_w.x, y, _w.z); mesh.rotation.order = 'YXZ'; mesh.rotation.y = o.yaw + ry; scene.add(mesh); return mesh; };
  const solid = (o, lx, lz, hx, hz, y0, y1) => { toWorld(o, lx, lz, _w); addBox(_w.x, _w.z, o.yaw, hx, hz, y0, y1); };
  const wake = () => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.5, 0, 1, 0.5, 0, 1], 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide })); scene.add(m); return m; };

  // ------------------------------------------------------------------ port de la Grande Ville
  {
    const P = cityPort, Y = P.alt, k = kit(), lamps = [], red = [], CC = [0xc8402f, 0x2f6fb8, 0x2f8a5a, 0xf2c230, 0xd9d4c8, 0xe07a2c];
    k.B(60, 8, 520, 0xb8b4aa, -124, Y - 3.7, 0); k.B(2, 1.2, 520, 0xe8c23a, -153, Y + 0.5, 0); k.B(230, 0.5, 500, 0x9aa09f, 22, Y + 0.02, 0);
    k.B(290, 0.1, 12, 0x55585c, 0, Y + 0.32, 0);
    for (let z = -240; z <= 240; z += 12) { k.C(0.5, 0.6, 1.2, 0x2b2e33, -151, Y + 0.8, z, 6); k.B(1, 2.4, 2.4, 0x1b1c1e, -154.6, Y - 1.5, z); }
    solid(P, -124, 0, 31, 260, -10, Y + 0.3);
    // piles de conteneurs
    for (let a = 0; a < 5; a++) for (let b = 0; b < 8; b++) for (let c = 0; c < 2; c++) {
      const x = -84 + a * 26 + c * 3, z = 60 + b * 22, h = Math.floor(rnd() * 4.4);
      for (let y = 0; y < h; y++) k.B(2.5, 2.5, 12, CC[Math.floor(rnd() * 6)], x, Y + 1.5 + y * 2.6, z);
    }
    solid(P, -20, 137, 66, 90, Y, Y + 8);
    // portiques de quai
    for (const z of [80, 150, 215]) {
      const c = 0x2f6fb8;
      for (const x of [-146, -122]) for (const s of [-9, 9]) k.B(1.4, 34, 1.4, c, x, Y + 17, z + s);
      k.B(1.2, 1.2, 18, c, -146, Y + 12, z); k.B(1.2, 1.2, 18, c, -122, Y + 12, z);
      for (const s of [-9, 9]) k.B(26, 1.4, 1.2, c, -134, Y + 33, z + s);
      for (const s of [-2, 2]) k.B(88, 1.8, 1, c, -152, Y + 36, z + s); k.B(8, 5, 6, 0xf4f4ee, -118, Y + 36, z); k.B(1.2, 16, 1.2, c, -146, Y + 43, z); k.B(38, 0.5, 0.5, 0x3a3f45, -164, Y + 44, z, 0, 0, 0.38); k.B(34, 0.5, 0.5, 0x3a3f45, -130, Y + 44, z, 0, 0, -0.46);
      k.B(3, 2.4, 4, 0xf2c230, -172, Y + 34, z); k.B(0.2, 12, 0.2, 0x2b2e33, -172, Y + 27, z); k.B(2.5, 2.5, 12, 0xc8402f, -172, Y + 20, z);
      red.push(-196, Y + 37.5, z, -146, Y + 52, z); solid(P, -146, z, 1.5, 10, Y, Y + 52); solid(P, -122, z, 1.5, 10, Y, Y + 36); solid(P, -152, z, 44, 3, Y + 33, Y + 38);
    }
    // entrepôts
    for (const [x, z, c] of [[90, 90, 0x9fb4c4], [90, 160, 0xc9a27a], [90, 225, 0x9fb4c4], [95, -190, 0xb9705a]]) {
      k.B(70, 12, 44, c, x, Y + 6, z); k.parts.push({ geo: prism(72, 46, 6), color: 0x6b737a, matrix: xform(x, Y + 12, z) });
      for (const u of [-20, 0, 20]) k.B(12, 7, 0.4, 0x4a5058, x + u, Y + 3.5, z - 22.1);
      solid(P, x, z, 35, 22, Y, Y + 16);
    }
    // gare maritime et tour de l'horloge, parkings
    k.B(36, 9, 80, 0xf0e6d6, -90, Y + 4.5, -70); k.B(40, 1, 84, 0x2f6fb8, -90, Y + 9.4, -70); for (let z = -104; z <= -36; z += 8) k.B(36.3, 4.5, 5, 0x3a5a70, -90, Y + 4.4, z);
    k.B(8, 34, 8, 0xf0e6d6, -90, Y + 17, -20); k.parts.push({ geo: new THREE.ConeGeometry(6.6, 9, 4), color: 0x2f6fb8, matrix: xform(-90, Y + 38.4, -20, Math.PI / 4) });
    for (const ry of [0, 1, 2, 3]) k.parts.push({ geo: new THREE.CylinderGeometry(2.6, 2.6, 0.5, 16).rotateX(Math.PI / 2), color: 0xfbfbf8, matrix: xform(-90 + Math.sin(ry * 1.5708) * 4.1, Y + 29, -20 + Math.cos(ry * 1.5708) * 4.1, ry * 1.5708) });
    solid(P, -90, -70, 18, 40, Y, Y + 10); solid(P, -90, -20, 4, 4, Y, Y + 42);
    for (let a = 0; a < 3; a++) for (let b = 0; b < 12; b++) if (rnd() < 0.7) k.B(1.8, 1.4, 4.2, [0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0x9aa3ab][Math.floor(rnd() * 5)], -40 + b * 4, Y + 1, -40 - a * 12);
    // rampe et couloir du ferry (devant z = 0), passerelle du paquebot
    k.B(16, 0.6, 14, 0x6b737a, -159, Y - 0.5, 0, 0, 0, 0.06); k.B(0.6, 8, 0.6, 0xf2c230, -154, Y + 4, -8); k.B(0.6, 8, 0.6, 0xf2c230, -154, Y + 4, 8);
    k.B(12, 2.6, 2.6, 0xf4f4ee, -158, Y + 6, -130);
    // jetée et feu
    for (let i = 0; i < 26; i++) k.parts.push({ geo: new THREE.DodecahedronGeometry(6 + rnd() * 3, 0), color: 0x8f8a82, matrix: xform(-160 - i * 7, -1 + rnd() * 2, -262 - Math.sin(i / 26 * 1.4) * 30, rnd() * 6) });
    k.C(2, 2.6, 13, 0xf4f4ee, -340, 8, -292); k.C(2.1, 2.2, 3, 0xc8402f, -340, 9, -292); k.C(1.4, 1.6, 2.4, 0xffe08a, -340, 15.6, -292); lamps.push(-340, 16, -292);
    for (let z = -240; z <= 240; z += 40) { k.C(0.2, 0.3, 16, 0x8d959d, -112, Y + 8, z, 5); k.B(3, 0.5, 1, 0x3a3f45, -112, Y + 16, z); lamps.push(-112, Y + 15.6, z); }
    const m = place(P, k.mesh(), 0, 0, 0); m.add(lightsPoints(lamps, 0xfff0c8, 7), lightsPoints(red, 0xff3020, 5));
    const cargo = place(P, cargoMesh(rnd), -166, 0, 150); solid(P, -166, 150, 9.5, 62, -4, 24);
    const liner = place(P, linerMesh(), -167, 0, -150); solid(P, -167, -150, 11, 75, -4, 34);
    bob.push([cargo, 0.006], [liner, 0.004]);
    toWorld(P, -220, 60, _w); gulls.push({ x: _w.x, z: _w.z, alt: 45 });
  }

  // ------------------------------------------------------------------ port de pêche
  const crowd = [];
  const walk = (o, pts) => crowd.push({ loop: pts.map(([a, b]) => { const w = {}; toWorld(o, a, b, w); return w; }) });
  const moored = (o, kind, variant, lx, lz, ry) => { const m = new THREE.Mesh(buildModel(kind, variant), lam({ side: THREE.DoubleSide })); m.castShadow = true; place(o, m, lx, 0, lz, ry); bob.push([m, 0.03]); };
  {
    const P = fishPort, Y = P.alt, k = kit(), lamps = [];
    k.B(26, 7, 262, 0xb3a894, -52, Y - 3.4, 0); k.B(100, 0.5, 250, 0xbdb29c, 8, Y, 0); solid(P, -52, 0, 13, 131, -8, Y + 0.2);
    // pontons de bois
    for (const z of [-90, -30, 30, 90]) {
      k.B(64, 0.5, 4, 0x9a7650, -96, 1.8, z); for (let x = -70; x >= -128; x -= 9) for (const s of [-2, 2]) k.C(0.3, 0.35, 9, 0x6b4e33, x, -1.2, z + s, 6);
      k.C(0.12, 0.12, 5, 0x3a3f45, -127, 4, z, 5); lamps.push(-127, 6.6, z); solid(P, -96, z, 32, 2, -5, 2);
      for (const s of [-1, 1]) for (const x of [-84, -108]) if (rnd() < 0.85) moored(P, ['fisher', 'fisher', 'trawler'][Math.floor(rnd() * 3)], Math.floor(rnd() * 4), x, z + s * 6, rnd() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
      walk(P, [[-60, z - 1], [-126, z - 1], [-126, z + 1], [-60, z + 1]]);
    }
    // halle aux poissons, cabanes colorées, château d'eau à glace, filets et casiers
    k.B(26, 8, 54, 0xe9e2d4, 5, Y + 4, 0); k.parts.push({ geo: prism(56, 30, 6), color: 0x3f7fc4, matrix: xform(5, Y + 8, 0, Math.PI / 2) }); for (let z = -21; z <= 21; z += 14) k.B(0.4, 5, 8, 0x3a5a70, -8.2, Y + 2.8, z); solid(P, 5, 0, 13, 27, Y, Y + 13);
    const HC = [0xd8452e, 0x3f7fc4, 0x3d9a6a, 0xf0b62f, 0xf4f2ea, 0xe07a9b];
    for (let i = 0; i < 14; i++) { const z = -118 + i * 18; if (Math.abs(z) < 34) continue; k.B(9, 6, 8, HC[i % 6], 22, Y + 3, z); k.parts.push({ geo: new THREE.ConeGeometry(1, 1, 4), color: i % 2 ? 0x6b4e33 : 0xb9472f, matrix: xform(22, Y + 8, z, Math.PI / 4, 7.4, 4, 7) }); k.B(0.2, 3.4, 1.8, 0xf4f4ee, 17.4, Y + 1.8, z); k.B(0.2, 1.4, 1.6, 0x3a5a70, 17.4, Y + 3.6, z + 2.6); solid(P, 22, z, 4.5, 4, Y, Y + 9); }
    for (let i = 0; i < 40; i++) k.B(1.4, 0.9, 1.1, [0x2f8a5a, 0x3f7fc4, 0xf08a2c, 0xb08a5a][i % 4], -34 + rnd() * 20, Y + 0.7 + (rnd() < 0.3 ? 0.9 : 0), (rnd() - 0.5) * 220, rnd());
    for (let i = 0; i < 7; i++) k.parts.push({ geo: new THREE.IcosahedronGeometry(2, 0), color: i % 2 ? 0x2f8a5a : 0xc46a3a, matrix: xform(-44, Y + 0.6, -105 + i * 34, i, 1.2, 0.5, 1) });
    k.C(3, 3, 5, 0x9fb4c4, 40, Y + 17, -90, 10); for (const [a, b] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) k.C(0.25, 0.25, 15, 0x6b737a, 40 + a, Y + 7.5, -90 + b, 5); solid(P, 40, -90, 3, 3, Y, Y + 20);
    for (let z = -120; z <= 120; z += 30) { k.C(0.15, 0.2, 6, 0x3a3f45, -38, Y + 3, z, 5); lamps.push(-38, Y + 6.2, z); }
    // digue en arc et feu vert
    for (let i = 0; i < 34; i++) { const a = -0.2 + i * 0.045; k.parts.push({ geo: new THREE.DodecahedronGeometry(5 + rnd() * 2.5, 0), color: 0x8f8a82, matrix: xform(-40 - Math.sin(a) * 165, rnd() - 1, 20 + Math.cos(a) * 130 + 10, rnd() * 6) }); }
    k.C(1.6, 2, 10, 0xf4f4ee, -202, 7, 56); k.C(1.7, 1.7, 2, 0x2f8a5a, -202, 10, 56); lamps.push(-202, 13, 56);
    const m = place(P, k.mesh(), 0, 0, 0); m.add(lightsPoints(lamps, 0xffe2a0, 5));
    for (let i = 0; i < 14; i++) { const x = -32 + rnd() * 24, z = (rnd() - 0.5) * 200; walk(P, [[x, z], [x + 8, z + 10], [x, z + 22], [x - 4, z + 8]]); }
    toWorld(P, -90, 0, _w); gulls.push({ x: _w.x, z: _w.z, alt: 28 }); toWorld(P, -30, 60, _w); gulls.push({ x: _w.x, z: _w.z, alt: 22 });
  }

  // ------------------------------------------------------------------ ferry (ne fait jamais demi-tour : deux proues)
  const isl = islets.find((o) => o.kind === 'pecheurs');
  const q = (o, lx, lz) => { const w = {}; toWorld(o, lx, lz, w); return w; };
  const A = { x: isl.x, z: isl.z, yaw: 0 };
  const path = waterPath(q(cityPort, -520, 0), q(A, 560, 0), [q(cityPort, -184, 0), q(cityPort, -300, 0)], [q(A, 400, 0), q(A, 268, 0)]);
  const ferry = ferryMesh(), fcol = addMoving(7.5, 31, -3, 18), fw = wake();
  scene.add(ferry); ferry.rotation.order = 'YXZ';
  const F = { s: 0, dir: 1, v: 0, wait: 20, L: (path.length - 1) * 10, mesh: ferry, path, pos: { x: 0, z: 0, yaw: 0 } };

  // ------------------------------------------------------------------ chalutiers : sortent, pêchent en rond, reviennent
  const trawlers = [];
  [[-150, -60, 700, 500, 320, 3], [-150, 0, 1500, -250, 420, 1], [-150, 60, 1100, 900, 360, 2]].forEach(([lx, lz, out, sx, R, variant], i) => {
    // points en repère local du port : le large vers -X ; un tour de pêche puis retour le long du ponton
    const c = [-out - 300, sx - 300], pts = [q(fishPort, lx + 22, lz - 40), q(fishPort, lx + 6, lz), q(fishPort, lx - 40, lz + 30), q(fishPort, -320, lz + 60)];
    for (let t = 0; t <= 8; t++) { const a = t * 0.785; pts.push(q(fishPort, c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R)); }
    pts.push(q(fishPort, -330, lz - 70), q(fishPort, lx - 40, lz - 60), q(fishPort, lx + 14, lz - 44));
    if (pts.slice(3, -3).some((p) => heightAt(p.x, p.z) > -8)) return;
    const mesh = new THREE.Mesh(buildModel(i === 1 ? 'trawler' : 'fisher', variant), lam({ side: THREE.DoubleSide }));
    mesh.castShadow = true; mesh.rotation.order = 'YXZ'; scene.add(mesh);
    const P = resample(pts, 10), t = { mesh, path: P, L: (P.length - 1) * 10, s: rnd() * (P.length - 1) * 10, v: 0, wait: 0, vmax: 4.5 + rnd(), wake: wake(), col: addMoving(2.5, 8, -2, 8), pos: { x: 0, z: 0, yaw: 0 } };
    trawlers.push(t);
    if (i < 2) gulls.push({ x: 0, z: 0, alt: 14, follow: t.pos, r: 22, count: 9 });
  });

  const people = new People(scene, crowd, (x, z) => Math.max(heightAt(x, z) > 2 ? fishPort.alt + 0.25 : 2.05, 2.05), 31);
  const setWake = (w, x, z, yaw, len, v, back) => { w.visible = v > 0.6; w.position.set(x + Math.sin(yaw) * back, 0.15, z + Math.cos(yaw) * back); w.rotation.y = yaw; w.scale.set(len * 0.25 + v * 0.8, 1, len * (0.6 + v * 0.25)); };
  return {
    gulls, ferry: F, trawlers,
    update(dt, t, cam) {
      for (const [m, a] of bob) { m.position.y = Math.sin(t * 1.1 + m.position.x) * a * 4; m.rotation.z = Math.sin(t * 0.8 + m.position.z) * a; }
      if (F.wait > 0) F.wait -= dt;
      else {
        const left = F.dir > 0 ? F.L - F.s : F.s;
        F.v += Math.max(-0.5 * dt, Math.min(0.25 * dt, Math.min(11, Math.sqrt(0.36 * Math.max(0, left)) + 0.15) - F.v));
        F.s += F.dir * F.v * dt;
        if (left < 0.4) { F.dir = -F.dir; F.v = 0; F.wait = 75; }
      }
      along(path, F.s, F.pos);
      const yaw = F.pos.yaw + (F.dir > 0 ? 0 : Math.PI);
      ferry.position.set(F.pos.x, Math.sin(t * 0.9) * 0.12, F.pos.z); ferry.rotation.set(0, F.pos.yaw, Math.sin(t * 0.7) * 0.012);
      fcol.x = F.pos.x; fcol.z = F.pos.z; fcol.yaw = F.pos.yaw;
      setWake(fw, F.pos.x, F.pos.z, yaw, 40, F.v, 26);
      for (const b of trawlers) {
        if (b.wait > 0) { b.wait -= dt; b.v = 0; } else {
          const left = b.L - b.s;
          b.v += Math.max(-0.6 * dt, Math.min(0.4 * dt, Math.min(b.vmax, Math.sqrt(0.5 * Math.max(0, left)) + 0.3) - b.v));
          b.s += b.v * dt;
          if (b.s >= b.L) { b.s = 0; b.v = 0; b.wait = 60 + Math.random() * 60; }
        }
        along(b.path, b.s, b.pos);
        b.mesh.position.set(b.pos.x, Math.sin(t * 1.3 + b.L) * 0.22, b.pos.z); b.mesh.rotation.set(Math.sin(t * 0.9) * 0.03, b.pos.yaw, Math.sin(t * 1.1 + b.L) * 0.05);
        b.col.x = b.pos.x; b.col.z = b.pos.z; b.col.yaw = b.pos.yaw;
        setWake(b.wake, b.pos.x, b.pos.z, b.pos.yaw, 14, b.v, 6);
      }
      people.update(dt, t, cam);
    },
  };
}
