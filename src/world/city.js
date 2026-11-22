import * as THREE from 'three';
import { city } from './places.js';
import { lightsPoints } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { mergeColored, xform, mulberry32, toWorld, smoothstep } from '../util.js';
import { People } from './people.js';
import { prism } from './ports.js';

// La Grande Ville, en étoile : une place centrale, des boulevards circulaires irréguliers et des avenues courbes ;
// gratte-ciel au centre, immeubles puis maisons autour, parc, cathédrale, stade et fête foraine (grande roue, montagnes
// russes, manège), faubourgs et jardins en lisière. Repère local : origine au centre, sol à y = 0.

const STREET = 12, RINGS = [56, 128, 205, 285, 362, 432], SECT = [8, 8, 16, 16, 16]; // boulevards, secteurs entre deux boulevards
const TAU = Math.PI * 2;
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);

/** Point du plan : rayon r, angle a (les avenues s'enroulent un peu vers le centre, les boulevards ondulent). */
function P(r, a, o = {}) {
  const k = 1 - smoothstep(330, 440, r) * 0.6, wob = 1 + (0.045 * Math.sin(3 * a + 0.8) + 0.028 * Math.sin(5 * a + 2.1)) * k * smoothstep(40, 130, r);
  const t = a + 0.34 * (1 - r / 432) ** 1.4 * (r < 432 ? 1 : 0), R = r * wob;
  o.x = Math.cos(t) * R; o.z = Math.sin(t) * R * 1.08;
  return o;
}
/** Contour simplifié (pour la carte). */
export const cityOutline = (r, n = 48) => Array.from({ length: n }, (_, i) => P(r, (i / n) * TAU, {}));
/** Avenues principales jusqu'aux portes de la ville (d : 0 est, 1 sud, 2 ouest, 3 nord), en coordonnées monde. */
const GATE = [[1, 0], [0, 1], [-1, 0], [0, -1]];

/** Façade : 8 × 8 fenêtres (le mur blanc prend la couleur de l'immeuble) ; et les fenêtres éclairées la nuit. */
function facade() {
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; return [cv, cv.getContext('2d')]; };
  const [a, g] = mk(), [b, e] = mk(), rnd = mulberry32(8);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const x = i * 32 + 6, y = j * 32 + 8;
    g.fillStyle = ['#39566e', '#45657f', '#2f4a60'][Math.floor(rnd() * 3)]; g.fillRect(x, y, 20, 18);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 8, 18);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(i * 32, j * 32 + 29, 32, 2);
    if (rnd() < 0.42) { e.fillStyle = ['#ffd890', '#ffe9b8', '#ffc870', '#dfeaff'][Math.floor(rnd() * 4)]; e.fillRect(x, y, 20, 18); }
  }
  return [a, b].map((cv) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
}
function streetTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#4f5257'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e9e7df'; g.fillRect(31, 8, 2, 30); g.fillRect(1, 0, 1, 64); g.fillRect(62, 0, 1, 64);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}


export function buildCity(scene) {
  if (!city.active) return null;
  const G = new THREE.Group(), rnd = mulberry32(2718), Y = city.alt;
  G.position.set(city.x, Y, city.z);
  scene.add(G);
  const raw = [], red = [], lamps = [], trees = [];
  // repère courant : tout ce qu'on pose (boîtes, obstacles, lampes…) y est exprimé
  let Fm = new THREE.Matrix4(), Fo = { x: 0, z: 0, yaw: 0 };
  const frame = (o) => {
    Fo = o; Fm = xform(o.x, 0, o.z, o.yaw);
    const g = new THREE.Group(); g.position.set(o.x, 0, o.z); g.rotation.y = o.yaw; G.add(g); return g;
  };
  const HOME = { x: 0, z: 0, yaw: 0 }, _w = { x: 0, z: 0 };
  const world = (x, z) => { toWorld(Fo, x, z, _w); return { x: city.x + _w.x, z: city.z + _w.z }; };
  const parts = { push(...l) { for (const p of l) raw.push({ geo: p.geo, color: p.color, matrix: p.matrix ? Fm.clone().multiply(p.matrix) : Fm.clone() }); } };
  const B = (w, h, d, c, x, y, z, ry = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry) });
  const C = (rt, rb, h, c, x, y, z, seg = 10) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, matrix: xform(x, y, z) });
  const collide = (x, z, hw, hd, h, ry = 0) => { const w = world(x, z); addBox(w.x, w.z, Fo.yaw + ry, hw, hd, Y - 2, Y + h); };
  const cyl = (x, z, r, h) => { const w = world(x, z); addCylinder(w.x, w.z, r, Y, Y + h); };
  const light = (list) => (x, y, z) => { toWorld(Fo, x, z, _w); list.push(_w.x, y, _w.z); };
  const lamp = light(lamps), redl = light(red);
  const tree = (x, z, s) => { toWorld(Fo, x, z, _w); trees.push([_w.x, _w.z, s]); };

  // --- sol et rues : disque de bitume, rubans des boulevards et des avenues
  const tex = streetTexture();
  const ribbon = (pts, W, y, closed) => {
    const pos = [], uv = [], L = [0], n = pts.length, N = closed ? n : n - 1, side = [];
    for (let i = 0; i < n; i++) { const a = pts[closed ? (i - 1 + n) % n : Math.max(0, i - 1)], b = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)], dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; side.push([-dz / l, dx / l]); if (i) L.push(L[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z)); }
    L.push(L[n - 1] + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z));
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % n, p = pts[i], q = pts[j], [sx, sz] = side[i], [tx, tz] = side[j], h = W / 2;
      const a = [p.x - sx * h, y, p.z - sz * h], b = [p.x + sx * h, y, p.z + sz * h], c = [q.x - tx * h, y, q.z - tz * h], d = [q.x + tx * h, y, q.z + tz * h], v0 = L[i] / 16, v1 = L[i + 1] / 16;
      pos.push(...a, ...b, ...c, ...b, ...d, ...c); uv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })); m.receiveShadow = true; G.add(m);
  };
  const ring = (r, n = 96) => Array.from({ length: n }, (_, i) => P(r, (i / n) * TAU, {}));
  const flat = (pts, y, color) => { // polygone étoilé autour de son milieu
    const pos = [], n = pts.length, c = { x: 0, z: 0 }; for (const p of pts) { c.x += p.x / n; c.z += p.z / n; }
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; pos.push(c.x, y, c.z, b.x, y, b.z, a.x, y, a.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); raw.push({ geo: g, color });
  };
  // quartiers particuliers : [premier secteur, nombre de secteurs, première couronne, dernière couronne]
  const LOTS = [{ s: 13, n: 2, k0: 3, k1: 4, N: 16 }, { s: 5, n: 2, k0: 3, k1: 4, N: 16 }, { s: 2, n: 2, k0: 2, k1: 3, N: 16 }, { s: 3, n: 1, k0: 1, k1: 1, N: 8 }];
  const inLot = (k, i) => LOTS.some((l) => l.N === SECT[k] && k >= l.k0 && k <= l.k1 && (i - l.s + l.N) % l.N < l.n);
  // lisière : quelques îlots de la dernière couronne laissés aux champs, pour un contour irrégulier
  const gone = (k, i) => k === 4 && [2, 3, 9, 11, 15].includes(i);
  const midOf = (l) => { const r = (RINGS[l.k0] + RINGS[l.k1 + 1]) / 2, a = ((l.s + l.n / 2) / l.N) * TAU, p = P(r, a, {}), q = P(r, a + 0.01, {}); return { x: p.x, z: p.z, yaw: Math.atan2(-(q.z - p.z), q.x - p.x) + Math.PI / 2 }; };
  const [STAD, FAIR, PARK, CATH] = LOTS.map(midOf);
  // (le champ de foire est grand : il déborde un peu vers la campagne)
  { const l = Math.hypot(FAIR.x, FAIR.z); FAIR.x *= 1 + 26 / l; FAIR.z *= 1 + 26 / l; const m = Math.hypot(STAD.x, STAD.z); STAD.x *= 1 + 8 / m; STAD.z *= 1 + 8 / m; }
  CATH.yaw += Math.PI / 2;
  // boulevards et avenues
  flat(ring(RINGS[4] + 8, 72), 0.05, 0x4f5257);
  for (let k = 0; k < RINGS.length - 1; k++) ribbon(ring(RINGS[k]), k === 0 ? 16 : STREET, 0.14 + k * 0.004, true);
  const radial = [];
  for (let k = 0; k < SECT.length; k++) for (let i = 0; i < SECT[k]; i++) {
    const l = inLot(k, i) && inLot(k, (i - 1 + SECT[k]) % SECT[k]) && LOTS.some((q) => q.N === SECT[k] && q.n > 1 && k >= q.k0 && k <= q.k1 && (i - q.s + q.N) % q.N > 0 && (i - q.s + q.N) % q.N < q.n);
    if (l || (k === 4 && gone(4, i) && gone(4, (i + 15) % 16))) continue;
    const a = (i / SECT[k]) * TAU, pts = []; for (let u = 0; u <= 8; u++) pts.push(P(RINGS[k] + (RINGS[k + 1] - RINGS[k]) * (u / 8), a, {}));
    if (k === 0 || k === 1) radial.push(pts); ribbon(pts, STREET, 0.16, false);
  }
  // les quatre avenues des portes rejoignent les routes de l'île
  GATE.forEach(([gx, gz], d) => { const p = P(RINGS[5] - 4, (d / 4) * TAU, {}); ribbon([p, { x: p.x * 0.5 + gx * city.halfWid * 0.5, z: p.z * 0.5 + gz * city.halfLen * 0.5 }, { x: gx * city.halfWid, z: gz * city.halfLen }], STREET, 0.15, false); });

  // --- immeubles texturés
  const pos = [], uv = [], nor = [], col = [];
  const face = (v, n, w, h, c, flat_) => {
    const U = flat_ ? 0.002 : Math.max(1, Math.round(w / 3.6)) / 8, V = flat_ ? 0.002 : Math.max(1, Math.round(h / 3.4)) / 8;
    const q = [[0, 0], [U, 0], [U, V], [0, 0], [U, V], [0, V]], idx = [0, 1, 2, 0, 2, 3];
    _p.set(...n).transformDirection(Fm); const nn = [_p.x, _p.y, _p.z];
    idx.forEach((k, i) => { _p.set(...v[k]).applyMatrix4(Fm); pos.push(_p.x, _p.y, _p.z); nor.push(...nn); uv.push(...q[i]); col.push(c.r, c.g, c.b); });
  };
  const block = (x, z, w, d, y0, h, color, roof = 0x8f9499) => {
    const c = _c.setHex(color).clone(), r = new THREE.Color(roof), x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], w, h, c);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], w, h, c);
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], d, h, c);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], d, h, c);
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], 0, 0, r, true);
  };
  const GLASSY = [0x9fc4dd, 0xb8cfe0, 0x8fb0c8, 0xc9d6df, 0x7fa0b8], STONE = [0xe9dfc8, 0xd9c4a0, 0xf0e6d6, 0xc9b59a, 0xe0d0c0, 0xd8b8a0], BRICK = [0xb9705a, 0xc08468, 0xa86450];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const tower = (x, z, w, d, h) => {
    const c = pick(GLASSY), k = rnd();
    block(x, z, w, d, 0.3, h, c);
    if (k < 0.45) { block(x, z, w * 0.72, d * 0.72, h + 0.3, h * 0.22, c); h *= 1.22; B(w * 0.5, 2, d * 0.5, 0x7d858c, x, h + 1.2, z); C(0.2, 0.4, 16, 0xd9dcdf, x, h + 9, z, 5); redl(x, h + 17.5, z); }
    else if (k < 0.7) { parts.push({ geo: new THREE.ConeGeometry(w * 0.7, w * 0.8, 4), color: 0x5f7f98, matrix: xform(x, h + w * 0.4 + 0.3, z, Math.PI / 4) }); redl(x, h + w * 0.8 + 1, z); }
    else { B(w + 0.8, 1.2, d + 0.8, 0x6b737a, x, h + 0.8, z); B(w * 0.3, 3, d * 0.3, 0x8d959d, x + w * 0.15, h + 2, z); C(1.6, 1.6, 2.6, 0x9aa0a6, x - w * 0.25, h + 1.8, z + d * 0.2, 8); redl(x, h + 4, z); }
    collide(x, z, w / 2, d / 2, h + 3);
  };
  const mid = (x, z, w, d, h) => {
    block(x, z, w, d, 0.3, h, pick(rnd() < 0.3 ? BRICK : STONE), pick([0x8f9499, 0xa8705a, 0x7d858c]));
    B(w + 0.6, 0.7, d + 0.6, 0xf4f0e6, x, h + 0.3, z);
    if (rnd() < 0.6) { B(2.4, 1.6, 2, 0x9aa0a6, x + (rnd() - 0.5) * w * 0.5, h + 1.2, z + (rnd() - 0.5) * d * 0.5); }
    collide(x, z, w / 2, d / 2, h + 1);
  };
  const ROOFS = [0xc8553a, 0xb9472f, 0xd3704a, 0x4f6f8f];
  const house = (x, z, ry) => {
    const w = 9 + rnd() * 3, d = 8 + rnd() * 3, h = 5 + rnd() * 2;
    B(w, h, d, pick([0xf6efe2, 0xfbf7ef, 0xf0d9b8, 0xe9e2d4]), x, h / 2 + 0.2, z, ry);
    parts.push({ geo: new THREE.ConeGeometry(1, 1, 4), color: pick(ROOFS), matrix: xform(x, h + 2, z, ry + Math.PI / 4, w * 0.78, 3.8, d * 0.78) });
    collide(x, z, w / 2, d / 2, h + 3, ry);
  };
  /** Repère posé en (rayon, angle), -Z vers l'extérieur de la ville. */
  const spot = (r, a) => { const p = P(r, a, {}), q = P(r, a + 0.004, {}); return { x: p.x, z: p.z, yaw: Math.atan2(-(q.z - p.z), q.x - p.x) }; };
  const set = (o) => { Fo = o; Fm = xform(o.x, 0, o.z, o.yaw); };

  // --- îlots : trottoir courbe, puis bâtiments alignés le long des deux boulevards
  for (let k = 0; k < SECT.length; k++) for (let i = 0; i < SECT[k]; i++) {
    if (inLot(k, i) || gone(k, i)) continue;
    const r0 = RINGS[k] + STREET / 2 + 2, r1 = RINGS[k + 1] - (k === 4 ? 0 : STREET / 2 + 2), da = TAU / SECT[k], gap = (STREET / 2 + 2), cell = [];
    const A0 = i * da, A1 = A0 + da;
    for (let u = 0; u <= 10; u++) { const g = gap / r1; cell.push(P(r1, A0 + g + (A1 - A0 - 2 * g) * (u / 10), {})); }
    for (let u = 10; u >= 0; u--) { const g = gap / r0; cell.push(P(r0, A0 + g + (A1 - A0 - 2 * g) * (u / 10), {})); }
    flat(cell, 0.3, k < 2 ? 0xc4c2bc : k === 2 ? 0xc9c6be : 0x8fc06a);
    const depth = r1 - r0;
    const row = (r, w, gapW, fn) => { const span = (A1 - A0) * r - 2 * gap - 3, n = Math.max(1, Math.floor((span + gapW) / (w + gapW))); for (let q = 0; q < n; q++) { const a = (A0 + A1) / 2 + ((q - (n - 1) / 2) * Math.max(w + gapW, (span - w) / Math.max(1, n - 1) * 0.98)) / r; set(spot(r, a)); fn(q, n); } };
    if (k < 2) {
      const H = k === 0 ? 118 : 78;
      if (k === 0) row((r0 + r1) / 2, 30, 8, () => tower(0, 0, 28 + rnd() * 4, 30 + rnd() * 6, H * (0.75 + rnd() * 0.55)));
      else for (const r of [r0 + 15, r1 - 15]) row(r, 24, 6, () => { if (rnd() < 0.9) tower(0, 0, 21 + rnd() * 4, 22 + rnd() * 6, H * (0.4 + rnd() * 0.6)); });
    } else if (k === 2) {
      for (const r of [r0 + 13, r1 - 13]) row(r, 19, 1.5, () => { if (rnd() < 0.94) mid(0, 0, 18 + rnd() * 2, 21 + rnd() * 3, 14 + rnd() * 15); });
      for (let q = 0; q < 4; q++) { set(spot((r0 + r1) / 2 + (rnd() - 0.5) * 10, A0 + (A1 - A0) * (0.2 + rnd() * 0.6))); tree(0, 0, 0.7 + rnd() * 0.4); }
    } else {
      if (k === 3 && rnd() < 0.5) { for (const r of [r0 + 13, r1 - 13]) row(r, 20, 3, () => { if (rnd() < 0.9) mid(0, 0, 17 + rnd() * 3, 18 + rnd() * 3, 9 + rnd() * 9); }); }
      else for (const r of [r0 + 10, (r0 + r1) / 2, r1 - 10]) if (r !== (r0 + r1) / 2 || k === 4) row(r, 12, 5, () => { if (rnd() < 0.86) house((rnd() - 0.5) * 3, (rnd() - 0.5) * 3, rnd() < 0.5 ? 0 : Math.PI / 2); });
      for (let q = 0; q < 8; q++) { set(spot(r0 + depth * (0.35 + rnd() * 0.3), A0 + (A1 - A0) * (0.1 + rnd() * 0.8))); tree(0, 0, 0.7 + rnd() * 0.5); }
    }
  }
  // --- place centrale : fontaine, obélisque, pavés en étoile
  set(HOME);
  flat(ring(RINGS[0] - 8, 40), 0.22, 0xd9d2c0); flat(ring(30, 32), 0.26, 0xc4b79a);
  for (let k = 0; k < 8; k++) B(2.4, 0.06, 18, 0xb39a74, Math.cos(k * 0.785) * 38, 0.28, Math.sin(k * 0.785) * 38, Math.PI / 2 - k * 0.785);
  C(13, 13.6, 1.2, 0xe6dcc4, 0, 0.7, 0, 24); C(12, 12, 0.3, 0x4f9fd0, 0, 1.25, 0, 24); C(3.2, 4, 3, 0xe6dcc4, 0, 1.8, 0, 12); parts.push({ geo: new THREE.CylinderGeometry(0.9, 1.9, 24, 4), color: 0xe6dcc4, matrix: xform(0, 15, 0, 0.4) }, { geo: new THREE.ConeGeometry(0.95 * 1.1, 2.4, 4), color: 0xd9a92b, matrix: xform(0, 28.2, 0, 0.4) });
  for (let k = 0; k < 8; k++) parts.push({ geo: new THREE.ConeGeometry(0.5, 4.4, 5), color: 0xdff1fa, matrix: xform(Math.cos(k * 0.785) * 8, 3, Math.sin(k * 0.785) * 8) });
  collide(0, 0, 3, 3, 29);
  for (let k = 0; k < 24; k++) { const a = (k / 24) * TAU; if (k % 3) tree(Math.cos(a) * 43, Math.sin(a) * 43, 0.75); else lamp(Math.cos(a) * 43, 5, Math.sin(a) * 43); }
  // --- faubourgs et jardins en lisière : maisons éparses, vergers, petits bois jusque dans les coins du plateau
  for (let n = 0, c = 0; n < 4000 && c < 110; n++) {
    const x = (rnd() - 0.5) * 2 * (city.halfWid + 60), z = (rnd() - 0.5) * 2 * (city.halfLen + 60), a = (Math.atan2(z, x) + TAU) % TAU, r = Math.hypot(x, z / 1.08);
    if (r < 452 || Math.hypot(x - FAIR.x, z - FAIR.z) < 165 || Math.hypot(x - STAD.x, z - STAD.z) < 115) continue;
    if (GATE.some(([gx, gz]) => Math.abs(x * gz - z * gx) < 22 && x * gx + z * gz > 0)) continue;
    c++; set({ x, z, yaw: -a }); if (c % 4) tree(0, 0, 0.8 + rnd() * 0.7); else if (Math.abs(x) < city.halfWid - 10 && Math.abs(z) < city.halfLen - 10) house(0, 0, rnd() * 3);
  }
  for (const i of [2, 3, 9, 11, 15]) for (let q = 0; q < 16; q++) { set(spot(RINGS[4] + 16 + rnd() * 60, ((i + 0.08 + rnd() * 0.84) / 16) * TAU)); tree(0, 0, 0.8 + rnd() * 0.6); }
  set(HOME);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const [day, lit] = facade();
  const wall = new THREE.MeshLambertMaterial({ map: day, vertexColors: true, emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 0 });
  const bm = new THREE.Mesh(g, wall); bm.castShadow = bm.receiveShadow = true; G.add(bm);
  let fairAt = null;

  // --- cathédrale sur sa place
  {
    const x = 0, z = 0; frame(CATH); B(62, 0.3, 66, 0xd9d2c0, 0, 0.16, 4);
    const S = 0xe6dcc4, R = 0x5f7f98;
    B(16, 18, 46, S, x, 9, z + 4); B(30, 16, 12, S, x, 8, z - 2);
    for (const [w, d, rx, ry] of [[12, 46, z + 4, 0], [12, 30, z - 2, Math.PI / 2]]) parts.push({ geo: prism(d, w + (ry ? 0 : 4), 8), color: R, matrix: xform(x, ry ? 16 : 18, rx, Math.PI / 2 - ry) });
    for (const s of [-1, 1]) { B(7, 34, 7, S, x + s * 7.5, 17, z + 26); parts.push({ geo: new THREE.ConeGeometry(5, 16, 4), color: R, matrix: xform(x + s * 7.5, 42, z + 26, Math.PI / 4) }); }
    parts.push({ geo: new THREE.ConeGeometry(2.4, 22, 6), color: R, matrix: xform(x, 36, z - 2) });
    C(3.4, 3.4, 0.4, 0x8e2a3a, x, 12, z + 29.8, 12);
    collide(x, z + 4, 8, 23, 24); collide(x, z - 2, 15, 6, 22); collide(x, z + 26, 11.5, 3.5, 48);
  }
  // --- parc : pelouse, étang, allées, kiosque
  {
    const x = 0, z = 0; frame(PARK); C(74, 74, 0.3, 0x79b858, 0, 0.16, 0, 36);
    C(34, 34, 0.3, 0x4f9fd0, x + 20, 0.2, z - 10, 20); C(36, 36, 0.28, 0xd9cfa8, x + 20, 0.18, z - 10, 20);
    for (const ry of [Math.PI / 4, -Math.PI / 4]) B(5, 0.34, 142, 0xd9cfa8, x, 0.16, z, ry);
    C(5, 5.4, 0.8, 0xe8e4d8, x - 30, 0.6, z + 30, 8); parts.push({ geo: new THREE.ConeGeometry(6, 3, 8), color: 0x2f8a5a, matrix: xform(x - 30, 6.4, z + 30) });
    for (let k = 0; k < 8; k++) C(0.18, 0.18, 4, 0xf4f4ee, x - 30 + Math.cos(k * 0.785) * 4.6, 3, z + 30 + Math.sin(k * 0.785) * 4.6, 5);
    for (let k = 0; k < 90; k++) { const a = (rnd() - 0.5) * 140, b = (rnd() - 0.5) * 140; if (Math.hypot(a, b) < 70 && Math.hypot(a - 20, b + 10) > 42 && Math.hypot(a + 30, b - 30) > 10) tree(x + a, z + b, 0.8 + rnd() * 0.7); }
  }
  // --- stade
  {
    const x = 0, z = 0; frame(STAD); B(150, 0.3, 176, 0xb8b6b0, 0, 0.16, 0);
    const prof = [[46, 0], [46, 2], [62, 14], [66, 14], [66, 20], [60, 21.5], [61, 20], [65, 19], [65, 0]].map(([a, b]) => new THREE.Vector2(a, b));
    parts.push({ geo: new THREE.LatheGeometry(prof, 28), color: 0xdfe3e6, matrix: xform(x, 0.3, z, 0, 1, 1, 1.22) });
    for (let k = 0; k < 4; k++) parts.push({ geo: new THREE.LatheGeometry([[48 + k * 3.6, 3.6 + k * 2.6], [50.6 + k * 3.6, 5.6 + k * 2.6]].map(([a, b]) => new THREE.Vector2(a, b)), 28), color: k % 2 ? 0xd8312b : 0x2f5fa8, matrix: xform(x, 0.4, z, 0, 1, 1, 1.22) });
    B(62, 0.2, 94, 0x5cae3a, x, 0.42, z); for (let k = -4; k <= 4; k += 2) B(62, 0.22, 9.4, 0x4f9e33, x, 0.43, z + k * 9.4);
    const L = (w, d, a, b) => B(w, 0.06, d, 0xf4f4ee, x + a, 0.6, z + b);
    L(60, 0.5, 0, 0); for (const s of [-1, 1]) { L(60, 0.5, 0, s * 45); L(0.5, 90, s * 30, 0); L(32, 0.5, 0, s * 30); for (const u of [-16, 16]) L(0.5, 15, u, s * 37.5); B(7.4, 0.2, 0.2, 0xf4f4ee, x, 2.9, z + s * 45.2); for (const u of [-3.7, 3.7]) B(0.2, 2.6, 0.2, 0xf4f4ee, x + u, 1.6, z + s * 45.2); }
    parts.push({ geo: new THREE.TorusGeometry(9, 0.25, 4, 24).rotateX(Math.PI / 2), color: 0xf4f4ee, matrix: xform(x, 0.55, z) });
    for (const [a, b] of [[-66, -72], [66, -72], [-66, 72], [66, 72]]) { C(0.6, 1, 36, 0x8d959d, x + a, 18, z + b, 6); B(9, 5, 1, 0x3a3f45, x + a, 37, z + b, Math.atan2(-a, -b)); lamp(x + a, 37, z + b); lamp(x + a * 0.97, 38.5, z + b * 0.97); cyl(x + a, z + b, 1.4, 40); }
    for (let k = 0; k < 28; k++) { const a = (k / 28) * 6.283; collide(x + Math.cos(a) * 60, z + Math.sin(a) * 60 * 1.22, 6, 8, 21, -a); }
  }
  // --- fête foraine
  const fair = [], spin = [];
  {
    const x = 0, z = -4; const F = frame(FAIR); B(168, 0.3, 270, 0xcbb994, 0, 0.16, 0);
    // grande roue
    const wheel = new THREE.Group(), wp = [], R = 27, CAB = [0xd8312b, 0xf2c230, 0x2f5fa8, 0x2f8a5a, 0x8e5cc9, 0xf08a2c];
    for (const zz of [-1.6, 1.6]) { wp.push({ geo: new THREE.TorusGeometry(R, 0.35, 5, 36), color: 0xf4f4ee, matrix: xform(0, 0, zz) }); for (let k = 0; k < 12; k++) wp.push({ geo: new THREE.BoxGeometry(0.3, R * 2, 0.3), color: 0xd9dcdf, matrix: xform(0, 0, zz, 0, 1, 1, 1, 0, (k * Math.PI) / 12) }); }
    wp.push({ geo: new THREE.CylinderGeometry(2, 2, 5, 12).rotateX(Math.PI / 2), color: 0xd8312b, matrix: xform(0, 0, 0) });
    wheel.add(new THREE.Mesh(mergeColored(wp), lam()));
    const cabs = [], bulbs = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * 6.283, m = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(2.6, 2.2, 2.6), color: CAB[k % 6], matrix: xform(0, -2, 0) }, { geo: new THREE.BoxGeometry(2.64, 0.8, 2.2), color: 0x2c4558, matrix: xform(0, -1.6, 0) }, { geo: new THREE.ConeGeometry(2, 0.9, 4), color: 0xf4f4ee, matrix: xform(0, -0.5, 0, Math.PI / 4) }]), lam());
      m.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); wheel.add(m); cabs.push(m); bulbs.push(Math.cos(a) * R, Math.sin(a) * R, 2.2, Math.cos(a + 0.17) * R, Math.sin(a + 0.17) * R, 2.2);
    }
    wheel.add(lightsPoints(bulbs, 0xffd34d, 2.6));
    wheel.position.set(x + 20, 32, z + 78); F.add(wheel);
    spin.push((t) => { wheel.rotation.z = t * 0.12; for (const c of cabs) c.rotation.z = -wheel.rotation.z; });
    for (const s of [-1, 1]) for (const zz of [-4, 4]) parts.push({ geo: new THREE.BoxGeometry(1, 35, 1), color: 0xd9dcdf, matrix: xform(x + 20 + s * 7, 16.2, z + 78 + zz, 0, 1, 1, 1, 0, s * 0.42) });
    collide(x + 20, z + 78, 29, 4, 60);
    // montagnes russes : boucle fermée, rails, poteaux, wagonnets
    const pts = [[-70, 4, -110], [-70, 24, -60], [-66, 30, -30], [-52, 6, -4], [-30, 18, 10], [-8, 5, -8], [10, 22, -30], [30, 8, -10], [56, 16, -24], [64, 4, -60], [52, 14, -96], [30, 3, -112], [8, 12, -84], [-14, 4, -66], [-34, 14, -96], [-50, 3, -116]].map(([a, b, c]) => new THREE.Vector3(x + a, b, z + c));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    for (const o of [-0.7, 0.7]) parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve.getSpacedPoints(120).slice(0, 120).map((p, k) => { const t = curve.getTangentAt(k / 120), l = Math.hypot(t.x, t.z) || 1; return new THREE.Vector3(p.x - (t.z / l) * o, p.y, p.z + (t.x / l) * o); }), true), 240, 0.2, 5, true), color: 0xd8312b });
    for (let k = 0; k < 70; k++) { const p = curve.getPointAt(k / 70); C(0.25, 0.3, p.y, 0xf4f4ee, p.x, p.y / 2, p.z, 5); if (k % 4 === 0) lamp(p.x, p.y + 0.4, p.z); }
    const carts = [];
    for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(1.7, 1, 2.6), color: k ? 0xf2c230 : 0x2f5fa8, matrix: xform(0, 0.8, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.7, 0.4), color: 0xd8312b, matrix: xform(-0.4, 1.5, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.7, 0.4), color: 0x2f8a5a, matrix: xform(0.4, 1.5, 0) }]), lam()); F.add(m); carts.push(m); }
    const Lc = curve.getLength(), state = { s: 0, v: 8 };
    spin.push((t, dt) => {
      const u0 = (state.s / Lc) % 1, tg = curve.getTangentAt(u0);
      state.v = Math.max(6, Math.min(26, state.v + (-9 * tg.y - 0.02 * (state.v - 9)) * dt)); state.s += state.v * dt;
      carts.forEach((m, k) => { const u = (((state.s - k * 3.1) / Lc) % 1 + 1) % 1, p = curve.getPointAt(u), q = curve.getTangentAt(u); m.position.copy(p); m.quaternion.setFromRotationMatrix(_m.lookAt(p, _p.copy(p).add(q), UP)); });
    });
    collide(x, z - 55, 76, 66, 14);
    // manège, chapiteaux, tour de chute, stands
    const car = new THREE.Group(), cp = [{ geo: new THREE.ConeGeometry(10, 4, 14), color: 0xd8312b, matrix: xform(0, 8, 0) }, { geo: new THREE.CylinderGeometry(9.4, 9.4, 0.6, 14), color: 0xf2c230, matrix: xform(0, 1, 0) }, { geo: new THREE.CylinderGeometry(1, 1, 7, 8), color: 0xf4f4ee, matrix: xform(0, 4, 0) }, { geo: new THREE.CylinderGeometry(10, 10, 1, 14, 1, true), color: 0xf4f4ee, matrix: xform(0, 5.8, 0) }];
    for (let k = 0; k < 10; k++) { const a = k * 0.628; cp.push({ geo: new THREE.BoxGeometry(0.6, 1.1, 1.8), color: [0xf4f4ee, 0x8a5a33, 0x2b2e33][k % 3], matrix: xform(Math.cos(a) * 7, 2.4, Math.sin(a) * 7, -a) }, { geo: new THREE.CylinderGeometry(0.1, 0.1, 6, 5), color: 0xd9a92b, matrix: xform(Math.cos(a) * 7, 4, Math.sin(a) * 7) }); }
    car.add(new THREE.Mesh(mergeColored(cp), lam())); car.position.set(x - 45, 0, z + 60); F.add(car); spin.push((t) => { car.rotation.y = t * 0.6; });
    cyl(x - 45, z + 60, 10, 10);
    for (const [a, b, r, c] of [[-50, 108, 16, 0xd8312b], [62, 30, 10, 0x2f5fa8], [66, 120, 9, 0x2f8a5a], [-70, 20, 9, 0xf08a2c]]) { for (let k = 0; k < 12; k++) parts.push({ geo: new THREE.ConeGeometry(r, r * 0.8, 1, 1, true, (k / 12) * 6.283, 6.283 / 12), color: k % 2 ? c : 0xf4f4ee, matrix: xform(x + a, r * 0.4 + 5, z + b) }, { geo: new THREE.CylinderGeometry(r * 0.96, r * 0.96, 5, 1, 1, true, (k / 12) * 6.283, 6.283 / 12), color: k % 2 ? 0xf4f4ee : c, matrix: xform(x + a, 2.5, z + b) }); cyl(x + a, z + b, r, 5 + r * 0.6); }
    C(1.2, 1.6, 46, 0x2f5fa8, x + 68, 23, z + 70, 8); redl(x + 68, 47, z + 70); cyl(x + 68, z + 70, 4, 47);
    const drop = new THREE.Mesh(mergeColored([{ geo: new THREE.TorusGeometry(3.2, 0.8, 5, 12).rotateX(Math.PI / 2), color: 0xf2c230, matrix: xform() }]), lam()); F.add(drop);
    spin.push((t) => { const u = (t % 16) / 16; drop.position.set(x + 68, u < 0.6 ? 3 + 38 * u / 0.6 : u < 0.72 ? 41 : u < 0.82 ? 41 - 38 * ((u - 0.72) / 0.1) ** 2 : 3, z + 70); });
    for (let k = 0; k < 12; k++) { const a = x - 74 + (k % 6) * 13, b = z + 22 + Math.floor(k / 6) * 12, c = pick([0xd8312b, 0x2f5fa8, 0xf2c230, 0x2f8a5a]); B(5, 2.6, 4, 0xf4ead6, a, 1.5, b); B(5.6, 0.4, 5.2, c, a, 3.1, b); lamp(a, 3.4, b); }
    fairAt = (a, b) => world(a, b);
  }
  // --- lampadaires le long des boulevards, arbres d'alignement sur les avenues
  set(HOME);
  for (let k = 1; k < 5; k++) { const n = Math.round(RINGS[k] * TAU / 44); for (let i = 0; i < n; i++) { const p = P(RINGS[k] + 7, (i / n) * TAU, {}); if (LOTS.some((l) => k > l.k0 && k <= l.k1 && (((i / n) * l.N - l.s + l.N) % l.N) < l.n)) continue; C(0.1, 0.14, 7, 0x3a3f45, p.x, 3.5, p.z, 5); B(0.9, 0.25, 0.5, 0x2b2e33, p.x, 7, p.z); lamp(p.x, 6.8, p.z); } }
  for (const pts of radial) for (const p of pts.slice(1, -1)) { const l = Math.hypot(p.x, p.z); for (const s of [-1, 1]) tree(p.x - (p.z / l) * s * 8, p.z + (p.x / l) * s * 8, 0.55); }
  const mesh = new THREE.Mesh(mergeColored(raw), lam({ side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = true;
  G.add(mesh, lightsPoints(red, 0xff3020, 6), lightsPoints(lamps, 0xffe2a0, 4.5));
  const tg = mergeColored([{ geo: new THREE.CylinderGeometry(0.35, 0.5, 3, 5, 1, true), color: 0x7a5a3c, matrix: xform(0, 1.5, 0) }, { geo: new THREE.IcosahedronGeometry(2.9, 0), color: 0x6fb850, matrix: xform(0, 5.2, 0, 0, 1, 0.9, 1) }]);
  const tm = new THREE.InstancedMesh(tg, lam(), trees.length);
  trees.forEach(([x, z, s], i) => tm.setMatrixAt(i, _m.compose(_p.set(x, 0.1, z), _q.setFromAxisAngle(UP, i), _s.setScalar(s))));
  tm.castShadow = true; tm.frustumCulled = false; G.add(tm);

  // --- circulation : les voitures tournent sur les boulevards, dans les deux sens ; promeneurs sur les trottoirs
  const carGeo = mergeColored([{ geo: new THREE.BoxGeometry(1.8, 0.7, 4.3), color: 0xffffff, matrix: xform(0, 0.75, 0) }, { geo: new THREE.BoxGeometry(1.6, 0.6, 2.2), color: 0x3a5a70, matrix: xform(0, 1.4, 0.2) }, { geo: new THREE.BoxGeometry(1.9, 0.5, 0.7), color: 0x1b1c1e, matrix: xform(0, 0.35, -1.4) }, { geo: new THREE.BoxGeometry(1.9, 0.5, 0.7), color: 0x1b1c1e, matrix: xform(0, 0.35, 1.4) }]);
  const N = 84, cars = new THREE.InstancedMesh(carGeo, lam(), N), loops = [], tracks = [];
  for (let k = 0; k < 5; k++) for (const d of [1, -1]) { // à droite : le sens des aiguilles d'une montre roule à l'intérieur
    const pts = ring(RINGS[k] - d * 2.9, 160), len = [0]; pts.forEach((p, i) => { const q = pts[(i + 1) % 160]; len.push(len[i] + Math.hypot(q.x - p.x, q.z - p.z)); });
    tracks.push({ pts, len, total: len[160], d });
  }
  for (let k = 0; k < N; k++) {
    const t = tracks[k % tracks.length];
    loops.push({ t, s: (Math.floor(k / tracks.length) + 0.3 * rnd()) * t.total / Math.ceil(N / tracks.length), v: 9 + (k % tracks.length) * 0.35 });
    cars.setColorAt(k, _c.setHex(pick([0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0x9aa3ab, 0xf2c230, 0x2f8a5a])));
  }
  cars.frustumCulled = false; cars.castShadow = true; G.add(cars);
  const walkers = [];
  for (let n = 0; n < 190; n++) {
    const k = Math.floor(rnd() * 5), i = Math.floor(rnd() * SECT[k]); if (gone(k, i)) continue;
    const a0 = ((i + 0.06) / SECT[k]) * TAU, a1 = ((i + 0.94) / SECT[k]) * TAU, r0 = RINGS[k] + 9, r1 = RINGS[k + 1] - 9, lp = [];
    for (let u = 0; u <= 5; u++) lp.push(P(r1, a0 + (a1 - a0) * (u / 5), {})); for (let u = 5; u >= 0; u--) lp.push(P(r0, a0 + (a1 - a0) * (u / 5), {}));
    if (!inLot(k, i)) walkers.push({ loop: lp.map((p) => ({ x: city.x + p.x, z: city.z + p.z })) });
  }
  for (let k = 0; k < 40; k++) { const c = fairAt((rnd() - 0.5) * 130, 10 + rnd() * 110), r = 6 + rnd() * 10; walkers.push({ loop: [0, 1, 2, 3].map((q) => ({ x: c.x + Math.cos(q * 1.57) * r, z: c.z + Math.sin(q * 1.57) * r })) }); }
  for (let k = 0; k < 24; k++) { const a = rnd() * TAU, r = 20 + rnd() * 20; walkers.push({ loop: [0, 1, 2, 3, 4, 5].map((q) => ({ x: city.x + Math.cos(a + q) * r, z: city.z + Math.sin(a + q) * r })) }); }
  const people = new People(scene, walkers, () => Y + 0.3, 5);

  return {
    update(dt, t, night, cam) {
      wall.emissiveIntensity = Math.min(1, night * 1.4);
      const d = cam ? Math.hypot(cam.x - city.x, cam.z - city.z) : 0;
      people.update(dt, t, cam);
      if (d > 5000) return;
      for (const f of spin) f(t, dt);
      loops.forEach((o, k) => {
        const { pts, len, total, d: dir } = o.t;
        o.s = (o.s + o.v * dir * dt + total) % total;
        let lo = 0, hi = 160; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (len[m] <= o.s) lo = m; else hi = m; }
        const a = pts[lo], b = pts[(lo + 1) % 160], f = (o.s - len[lo]) / (len[lo + 1] - len[lo] || 1);
        cars.setMatrixAt(k, _m.compose(_p.set(a.x + (b.x - a.x) * f, 0.2, a.z + (b.z - a.z) * f), _q.setFromAxisAngle(UP, Math.atan2((a.x - b.x) * dir, (a.z - b.z) * dir)), _s.setScalar(1)));
      });
      cars.instanceMatrix.needsUpdate = true;
    },
  };
}
