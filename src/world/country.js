import * as THREE from 'three';
import { heightAt, normalAt, groundHeight, setCorridor, riverDist, HALF, BIG } from './terrain.js';
import { runways, seaBase } from './airfields.js';
import { city, cityPort, fishPort, circuit, castle } from './places.js';
import { toLocal, toWorld, lerp, smoothstep } from '../util.js';

// Campagne de la grande île : quelques villages reliés par des chemins de terre, et les champs de la Prairie
// (que l'épandeur traite). Les chemins suivent le relief : ils sont tracés par une recherche de plus court
// chemin (A*) qui évite l'eau, les fortes pentes et les pistes.

export const country = {
  villages: [], // { name, x, z, r, count, seed }
  roads: [],    // polylignes [{x, z}] ; .paved = route goudronnée (sinon chemin de terre)
  rail: null,   // voie ferrée en boucle : { pts: [{x, z, y, g}], stations: [{ i, name, side }] } (points tous les 8 m)
  fields: [],   // champs (voir Field)
};

// Hauteur du sol utilisée pendant le tracé : le relief est tracé avant la construction de la grille.
let hf = heightAt;

// Grille d'occupation (cases de 10 m) : 1 chemin, 2 champ. Les arbres l'évitent, les maisons évitent les chemins.
const OCC = 10;
let occ = null, ON = 0;
export function occupied(x, z) {
  if (!occ) return 0;
  const i = Math.floor((x + HALF) / OCC), j = Math.floor((z + HALF) / OCC);
  return i < 0 || j < 0 || i >= ON || j >= ON ? 0 : occ[i + j * ON];
}
function mark(x, z, r, v) {
  const i0 = Math.floor((x - r + HALF) / OCC), i1 = Math.floor((x + r + HALF) / OCC);
  const j0 = Math.floor((z - r + HALF) / OCC), j1 = Math.floor((z + r + HALF) / OCC);
  for (let j = Math.max(0, j0); j <= Math.min(ON - 1, j1); j++) {
    for (let i = Math.max(0, i0); i <= Math.min(ON - 1, i1); i++) occ[i + j * ON] = Math.max(occ[i + j * ON], v);
  }
}

// ---------------------------------------------------------------------------
// Tracé des chemins (A* sur une grille de 100 m)
const G = 100;
const railCells = new Set(); // cases de 100 m où passe la voie ferrée
function findPath(a, b) {
  const n = Math.round((2 * HALF) / G), N = n * n;
  const idx = (x, z) => Math.round((x + HALF) / G) + Math.round((z + HALF) / G) * n;
  const pos = (k) => [-HALF + (k % n) * G, -HALF + Math.floor(k / n) * G];
  const hgt = new Float32Array(N).fill(NaN);
  const H = (k) => { if (Number.isNaN(hgt[k])) { const [x, z] = pos(k); hgt[k] = hf(x, z); } return hgt[k]; };
  const onRunway = (x, z) => [...runways, circuit, castle].some((rw) => { const l = toLocal(rw, x, z, {}); return Math.abs(l.x) < rw.halfWid && Math.abs(l.z) < rw.halfLen; });
  const start = idx(a.x, a.z), goal = idx(b.x, b.z), [gx, gz] = pos(goal);
  const g = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const heap = [];
  const push = (k, f) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
    }
    return top;
  };
  g[start] = 0; push(start, 0);
  while (heap.length) {
    const [, k] = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === goal) break;
    const ci = k % n, cj = Math.floor(k / n), h0 = H(k);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const i = ci + di, j = cj + dj;
      if (i < 1 || j < 1 || i >= n - 1 || j >= n - 1) continue;
      const k2 = i + j * n;
      if (done[k2]) continue;
      const h = H(k2);
      if (h < 2) continue; // pas de chemin dans l'eau
      const [x, z] = pos(k2), d = G * Math.hypot(di, dj), slope = Math.abs(h - h0) / d;
      let cost = d * (1 + slope * slope * 400 + Math.max(0, h - 250) / 60);
      if (railCells.has(k2)) cost *= 4;
      if (k2 !== goal && onRunway(x, z)) cost *= 30;
      const ng = g[k] + cost;
      if (ng < g[k2]) { g[k2] = ng; from[k2] = k; push(k2, ng + Math.hypot(x - gx, z - gz)); }
    }
  }
  if (from[goal] < 0) return null;
  const pts = [];
  for (let k = goal; k >= 0; k = from[k]) { const [x, z] = pos(k); pts.push({ x, z }); }
  pts.reverse();
  pts[0] = { x: a.x, z: a.z }; pts[pts.length - 1] = { x: b.x, z: b.z };
  // lissage (Chaikin), puis rééchantillonnage tous les 8 m
  let p = pts;
  for (let it = 0; it < 3; it++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const A = p[i], B = p[i + 1];
      q.push({ x: A.x * 0.75 + B.x * 0.25, z: A.z * 0.75 + B.z * 0.25 }, { x: A.x * 0.25 + B.x * 0.75, z: A.z * 0.25 + B.z * 0.75 });
    }
    q.push(p[p.length - 1]); p = q;
  }
  const out = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const A = p[i - 1], B = p[i], d = Math.hypot(B.x - A.x, B.z - A.z);
    for (let s = 8 - acc; s < d; s += 8) out.push({ x: A.x + (B.x - A.x) * (s / d), z: A.z + (B.z - A.z) * (s / d) });
    acc = (acc + d) % 8;
  }
  out.push(p[p.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------
/** Champ cultivé : une grille de cases de 10 m posée sur le relief ; l'épandage fait verdir les cases. */
const DRY = [new THREE.Color(0xd2b85c), new THREE.Color(0xc4a84e)], GREEN = [new THREE.Color(0x5cae3a), new THREE.Color(0x4f9e33)];
const REGROW = 600; // secondes avant qu'une case traitée redevienne à traiter
class Field {
  constructor(x, z, yaw, w, l) {
    this.x = x; this.z = z; this.yaw = yaw; this.hw = w / 2; this.hl = l / 2;
    this.nx = Math.round(w / 10); this.nz = Math.round(l / 10);
    this.left = new Float32Array(this.nx * this.nz); // temps restant avant repousse (0 = à traiter)
  }
  build() {
    const { nx, nz } = this, pos = new Float32Array(nx * nz * 18), _w = { x: 0, z: 0 };
    const cw = (2 * this.hw) / nx, cl = (2 * this.hl) / nz;
    const P = (lx, lz) => { toWorld(this, lx, lz, _w); return [_w.x, heightAt(_w.x, _w.z) + 0.35, _w.z]; };
    let o = 0;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x0 = -this.hw + i * cw, z0 = -this.hl + j * cl;
      const a = P(x0, z0), b = P(x0 + cw, z0), c = P(x0, z0 + cl), d = P(x0 + cw, z0 + cl);
      for (const v of [a, c, b, b, c, d]) { pos.set(v, o); o += 3; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nx * nz * 18), 3));
    geo.computeVertexNormals();
    this.mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    this.mesh.receiveShadow = true;
    for (let k = 0; k < nx * nz; k++) this.paint(k);
    return this.mesh;
  }
  paint(k) {
    const row = Math.floor(k / this.nx) % 2, c = (this.left[k] > 0 ? GREEN : DRY)[row], col = this.mesh.geometry.attributes.color;
    for (let v = 0; v < 6; v++) col.setXYZ(k * 6 + v, c.r, c.g, c.b);
    col.needsUpdate = true;
  }
  /** Traite les cases à moins de r mètres de (x, z) ; renvoie le nombre de cases nouvellement traitées. */
  spray(x, z, r) {
    const l = toLocal(this, x, z, {});
    if (Math.abs(l.x) > this.hw + r || Math.abs(l.z) > this.hl + r) return 0;
    const cw = (2 * this.hw) / this.nx, cl = (2 * this.hl) / this.nz;
    let n = 0;
    for (let j = Math.max(0, Math.floor((l.z - r + this.hl) / cl)); j <= Math.min(this.nz - 1, Math.floor((l.z + r + this.hl) / cl)); j++) {
      for (let i = Math.max(0, Math.floor((l.x - r + this.hw) / cw)); i <= Math.min(this.nx - 1, Math.floor((l.x + r + this.hw) / cw)); i++) {
        const cx = -this.hw + (i + 0.5) * cw, cz = -this.hl + (j + 0.5) * cl;
        if (Math.hypot(cx - l.x, cz - l.z) > r) continue;
        const k = i + j * this.nx;
        if (this.left[k] <= 0) { n++; this.left[k] = REGROW; this.paint(k); } else this.left[k] = REGROW;
      }
    }
    return n;
  }
  update(dt) {
    for (let k = 0; k < this.left.length; k++) {
      if (this.left[k] > 0 && (this.left[k] -= dt) <= 0) { this.left[k] = 0; this.paint(k); }
    }
  }
  get treated() { let n = 0; for (const t of this.left) if (t > 0) n++; return n; }
}

/** Part (0..1) des cases de champ actuellement traitées. */
export function treatedShare() {
  let t = 0, n = 0;
  for (const f of country.fields) { t += f.treated; n += f.left.length; }
  return n ? t / n : 0;
}

// ---------------------------------------------------------------------------
/**
 * Trace villages, routes et voie ferrée, AVANT la construction du relief : la voie creuse ses déblais et
 * monte ses remblais dans la grille de hauteurs.
 */
export function planRoutes() {
  if (!BIG) return;
  ON = Math.ceil((2 * HALF) / OCC);
  occ = new Uint8Array(ON * ON);
  hf = groundHeight;
  const rw = (id) => runways.find((r) => r.id === id);
  const V = (name, x, z, count, seed) => ({ name, x, z, r: 120 + count * 7, count, seed });
  const lac = V('Village du Lac', 2950, 250, 16, 11), sud = V('Bourg du Sud', -1500, 4700, 22, 12);
  const port = V('Port de la Baie', -5000, 1800, 14, 13), col = V('Hameau du Col', -1700, -3300, 8, 14);
  const pre = V('Village de la Prairie', 9000, 1500, 12, 15);
  // la grande ville compte comme un bourg (étiquette, voitures au pas, arbres écartés), mais ses rues sont à part
  const ville = { name: 'Grande Ville', x: city.x, z: city.z, r: 520, count: 0, seed: 16, city: true };
  country.villages.push(lac, sud, port, col, pre, ville);
  for (let x = -city.halfWid; x <= city.halfWid; x += 20) for (let z = -city.halfLen; z <= city.halfLen; z += 20) if (Math.hypot(x / city.halfWid, z / city.halfLen) < 1.03) mark(city.x + x, city.z + z, 12, 3);
  for (const p of [cityPort, fishPort, circuit, castle]) { const w = {}; for (let a = -p.halfWid; a <= p.halfWid; a += 15) for (let b = -p.halfLen; b <= p.halfLen; b += 15) { toWorld(p, a, b, w); mark(w.x, w.z, 10, 3); } }
  const ap = rw('aeroport'), pr = rw('prairie'), bz = rw('baie');
  const end = (r, f) => { const w = {}; toWorld(r, r.width / 2 + 60, f * r.length / 2, w); return w; };
  // la voie d'abord : les routes la traversent mais évitent de la longer
  planRail([...[sud, port, pre].map((v) => [v.name, v.x, v.z]), ['Grande Ville', city.x - city.halfWid, city.z], ["Aéroport", ap.x, ap.z], ['Plage du Nord', 1500, -8500], ['Cap du Nord-Est', 10500, -3200], ['Pied du Volcan', -11500, -3500]]);
  const gate = (a, b) => ({ x: city.x + a * city.halfWid, z: city.z + b * city.halfLen });
  // routes goudronnées entre les bourgs et les terrains, chemins de terre vers le col et la base nautique
  const links = [[end(ap, -0.6), lac, 1], [lac, pre, 1], [pre, end(pr, 0.55), 1], [lac, sud, 1], [sud, gate(0, 1), 1], [lac, gate(1, 0), 1], [gate(0, -1), port, 1], [gate(-1, 0), { x: cityPort.x + 20, z: cityPort.z }, 1], [port, toWorld(fishPort, 40, 0, {}), 1], [port, end(bz, 0.4), 1], [lac, col, 0], [lac, toWorld(castle, 0, 74, {}), 0], [lac, toWorld(circuit, 60, 335, {}), 1]];
  if (seaBase.active) links.push([lac, toWorld(seaBase, 70, -125, {}), 0]);
  for (const [a, b, paved] of links) {
    const path = findPath(a, b);
    if (path) { path.paved = !!paved; country.roads.push(path); for (const p of path) mark(p.x, p.z, paved ? 8 : 6, 1); }
  }
  hf = heightAt;
}

/** Prévoit les champs (après le relief, avant les arbres, qui évitent les chemins et les champs). */
export function planCountry() {
  if (!BIG) return;
  const pr = runways.find((r) => r.id === 'prairie'), pre = country.villages.find((v) => v.name === 'Village de la Prairie');
  // champs de la Prairie : de l'autre côté de la clôture, et autour du village
  const _w = {}, side = pr.width / 2;
  for (const [lx, lz, w, l] of [[-side - 120, -170, 150, 260], [-side - 120, 160, 150, 300], [-side - 300, -40, 170, 420], [side + 160, -230, 140, 200]]) {
    toWorld(pr, lx, lz, _w);
    country.fields.push(new Field(_w.x, _w.z, pr.yaw, w, l));
  }
  for (const [dx, dz, w, l, yaw] of [[-420, 260, 140, 240, 0.3], [380, -320, 160, 220, -0.4], [120, 480, 120, 260, 1.2]]) {
    country.fields.push(new Field(pre.x + dx, pre.z + dz, yaw, w, l));
  }
  country.fields = country.fields.filter((f) => {
    // on écarte un champ qui tomberait dans l'eau, sur un chemin ou sur une pente trop raide
    const n = new THREE.Vector3(), w = {};
    for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      toWorld(f, a * f.hw, b * f.hl, w);
      if (heightAt(w.x, w.z) < 3 || normalAt(w.x, w.z, n).y < 0.9 || occupied(w.x, w.z) === 1) return false;
    }
    return true;
  });
  for (const f of country.fields) {
    const w = {};
    for (let a = -f.hw; a <= f.hw; a += 8) for (let b = -f.hl; b <= f.hl; b += 8) { toWorld(f, a, b, w); mark(w.x, w.z, 4, 2); }
  }
}

/**
 * Boucle qui fait le tour de l'île à bonne distance de la côte : courbe de niveau d'une carte « terre / mer »
 * floutée. Une courbe de niveau ne se recoupe jamais, et le flou arrondit tous ses virages.
 */
function coastLoop() {
  const C = 100, n = Math.round((2 * HALF) / C) + 1, at = (i) => -HALF + i * C;
  // la mer : tout ce qui communique avec le bord de la carte (le lac compte comme de la terre)
  const sea = new Uint8Array(n * n), stack = [0];
  sea[0] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % n, j = (k - i) / n;
    for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = i + a, y = j + b, q = x + y * n;
      if (x < 0 || y < 0 || x >= n || y >= n || sea[q] || hf(at(x), at(y)) > 2) continue;
      sea[q] = 1; stack.push(q);
    }
  }
  let m = new Float32Array(n * n);
  const l = {};
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = at(i), z = at(j);
    const strip = [...runways, circuit].some((r) => { toLocal(r, x, z, l); return Math.abs(l.x) < r.halfWid + RAIL.clear && Math.abs(l.z) < r.halfLen + RAIL.clear; });
    const dock = [cityPort, fishPort].some((r) => { toLocal(r, x, z, l); return Math.abs(l.x) < r.halfWid + 45 && Math.abs(l.z) < r.halfLen + 45; });
    m[i + j * n] = sea[i + j * n] || strip || dock ? 0 : 1;
  }
  for (let it = 0; it < 3; it++) for (const d of [1, n]) { // trois moyennes glissantes = flou gaussien
    const o = new Float32Array(n * n), R = RAIL.blur;
    for (let k = 0; k < n * n; k++) { let t = 0; for (let r = -R; r <= R; r++) t += m[k + r * d] || 0; o[k] = t / (2 * R + 1); }
    m = o;
  }
  // courbes de niveau : on relie les bords de case traversés (chaque bord est partagé par deux cases au plus)
  const L = RAIL.level, link = new Map(), P = new Map();
  const add = (a, b) => { for (const [u, v] of [[a, b], [b, a]]) (link.get(u) || link.set(u, []).get(u)).push(v); };
  const edge = (i, j, vert) => {
    const k = i + j * n, q = vert ? k + n : k + 1, A = m[k], B = m[q];
    if ((A > L) === (B > L)) return null;
    const key = k * 2 + (vert ? 1 : 0), f = (L - A) / (B - A);
    if (!P.has(key)) P.set(key, vert ? { x: at(i), z: at(j) + f * C } : { x: at(i) + f * C, z: at(j) });
    return key;
  };
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const e = [edge(i, j, 0), edge(i + 1, j, 1), edge(i, j + 1, 0), edge(i, j, 1)].filter((v) => v !== null);
    if (e.length === 2) add(e[0], e[1]);
    else if (e.length === 4) { add(e[0], e[3]); add(e[1], e[2]); }
  }
  // la plus grande boucle fermée
  let best = [], bestA = 0;
  const seen = new Set();
  for (const s of link.keys()) {
    if (seen.has(s)) continue;
    const loop = [];
    let k = s;
    while (k !== undefined && !seen.has(k)) { seen.add(k); loop.push(P.get(k)); k = link.get(k).find((q) => !seen.has(q)); }
    let A = 0;
    loop.forEach((p, i) => { const q = loop[(i + 1) % loop.length]; A += p.x * q.z - q.x * p.z; });
    if (Math.abs(A) > bestA) { bestA = Math.abs(A); best = loop; }
  }
  return best;
}

/** Rééchantillonne une boucle fermée à pas constant (proche de `step`). */
function resampleLoop(p, step) {
  const len = [0];
  p.forEach((a, i) => { const b = p[(i + 1) % p.length]; len.push(len[i] + Math.hypot(b.x - a.x, b.z - a.z)); });
  const total = len[p.length], n = Math.round(total / step), out = [];
  for (let k = 0, i = 0; k < n; k++) {
    const s = (k * total) / n;
    while (len[i + 1] < s) i++;
    const a = p[i], b = p[(i + 1) % p.length], f = (s - len[i]) / (len[i + 1] - len[i] || 1);
    out.push({ x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f });
  }
  return out;
}
/** Moyenne glissante en boucle de demi-largeur W (en points), `times` fois. */
function smoothRing(v, W, times) {
  const n = v.length;
  for (let it = 0; it < times; it++) {
    let sum = 0;
    for (let k = -W; k <= W; k++) sum += v[(k + n) % n];
    const o = new Array(n);
    for (let i = 0; i < n; i++) { o[i] = sum / (2 * W + 1); sum += v[(i + W + 1) % n] - v[(i - W + n) % n]; }
    v = o;
  }
  return v;
}

/**
 * Voie ferrée qui fait le tour de l'île, le long de la côte. Son altitude est une version adoucie de celle du
 * sol : remblais et viaducs dans les creux, tranchées et tunnels dans les bosses.
 */
const RAIL = { blur: 4, level: 0.62, clear: 300, cut: 22, grade: 0.045 };
function planRail(stops) {
  let p = resampleLoop(coastLoop(), 8);
  const sx = smoothRing(p.map((q) => q.x), 16, 3), sz = smoothRing(p.map((q) => q.z), 16, 3);
  p = resampleLoop(sx.map((x, i) => ({ x, z: sz[i] })), 8);
  const n = p.length, g = p.map((q) => hf(q.x, q.z));
  // pente limitée : milieu entre l'enveloppe qui creuse et celle qui remblaie
  const soft = smoothRing(g.map((h) => Math.max(h, 5)), 8, 2), lo = soft.slice(), up = soft.slice(), dy = RAIL.grade * 8;
  for (let k = 0; k < 4 * n; k++) {
    const i = k < 2 * n ? k % n : n - 1 - (k % n), j = k < 2 * n ? (i - 1 + n) % n : (i + 1) % n;
    lo[i] = Math.min(lo[i], lo[j] + dy); up[i] = Math.max(up[i], up[j] - dy);
  }
  const y = smoothRing(lo.map((v, i) => (v + up[i]) / 2), 8, 2).map((h) => Math.max(5, h));
  // déblais et remblais : le relief est ramené au niveau de la voie sur une bande de part et d'autre,
  // avec des talus ; au-delà de RAIL.cut mètres d'écart on laisse le relief (viaduc ou tunnel)
  const CELL = 64, cells = new Map();
  p.forEach((q, i) => {
    const key = Math.floor(q.x / CELL) * 100003 + Math.floor(q.z / CELL);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  setCorridor((x, z, h) => {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    let best = Infinity, bi = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = cells.get((cx + a) * 100003 + cz + b);
      if (list) for (const i of list) { const d = (p[i].x - x) ** 2 + (p[i].z - z) ** 2; if (d < best) { best = d; bi = i; } }
    }
    if (bi < 0) return h;
    if (riverDist(x, z) < 75) return h; // la voie enjambe la rivière
    const d = Math.sqrt(best), ty = y[bi] - 0.7, dh = Math.abs(ty - h);
    if (g[bi] < 1 || Math.abs(y[bi] - g[bi]) > RAIL.cut) return h;
    return lerp(h, ty, 1 - smoothstep(30, 40 + dh * 2.2, d));
  });
  // gares : au point de la voie le plus proche de chaque lieu desservi
  const stations = stops.map(([name, x, z]) => {
    let bi = 0, bd = Infinity;
    p.forEach((q, i) => {
      // voie d'évitement de part et d'autre du quai : on évite viaducs et tunnels sur toute sa longueur
      let gap = 0;
      for (let k = -22; k <= 22; k += 4) gap = Math.max(gap, Math.abs(y[(i + k + n) % n] - g[(i + k + n) % n]));
      const d = Math.hypot(q.x - x, q.z - z) + (gap > 10 ? 900 : gap > 5 ? 300 : 0);
      if (d < bd) { bd = d; bi = i; }
    });
    return { name, i: bi };
  }).sort((a, b) => a.i - b.i);
  country.rail = { pts: p.map((q, i) => ({ x: q.x, z: q.z, y: y[i], g: g[i] })), stations };
  for (const q of p) { mark(q.x, q.z, 9, 1); railCells.add(Math.round((q.x + HALF) / G) + Math.round((q.z + HALF) / G) * Math.round((2 * HALF) / G)); }
}

/** Construit chemins et champs. */
export function buildCountry(scene) {
  if (!BIG) return;
  const roadMat = new THREE.MeshLambertMaterial({ color: 0xc9b07e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const asphalt = new THREE.MeshLambertMaterial({ map: asphaltTexture(), polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const path of country.roads) {
    // aux passages à niveau, la route monte en pente douce à hauteur des rails
    path.lift = new Float32Array(path.length);
    path.forEach((p, i) => {
      for (const q of country.rail ? country.rail.pts : []) {
        if (Math.abs(q.x - p.x) > 45 || Math.abs(q.z - p.z) > 45) continue;
        const up = q.y - heightAt(q.x, q.z);
        if (up > 0 && up < 5) path.lift[i] = Math.max(path.lift[i], up * smoothstep(44, 9, Math.hypot(q.x - p.x, q.z - p.z)));
      }
    });
    const pos = [], W = path.paved ? 3.8 : 2.6;
    const len = [0];
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const p = path[i], lx = p.x - dz * W, lz = p.z + dx * W, rx = p.x + dz * W, rz = p.z - dx * W;
      pos.push([lx, heightAt(lx, lz) + 0.3 + path.lift[i], lz, rx, heightAt(rx, rz) + 0.3 + path.lift[i], rz]);
      if (i) len.push(len[i - 1] + Math.hypot(p.x - path[i - 1].x, p.z - path[i - 1].z));
    }
    const arr = [], uv = [];
    for (let i = 0; i < pos.length - 1; i++) {
      const [ax, ay, az, bx, by, bz] = pos[i], [cx, cy, cz, ex, ey, ez] = pos[i + 1];
      arr.push(ax, ay, az, cx, cy, cz, bx, by, bz, bx, by, bz, cx, cy, cz, ex, ey, ez);
      const v0 = len[i] / 16, v1 = len[i + 1] / 16;
      uv.push(0, v0, 0, v1, 1, v0, 1, v0, 0, v1, 1, v1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, path.paved ? asphalt : roadMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const f of country.fields) scene.add(f.build());
}

/** Bitume : bas-côtés clairs et ligne médiane discontinue (la texture se répète tous les 16 m). */
function asphaltTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#55585d'; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 500; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.08)'; g.fillRect(Math.random() * 64, Math.random() * 128, 2, 2); }
  g.fillStyle = '#b9a77e'; g.fillRect(0, 0, 4, 128); g.fillRect(60, 0, 4, 128);
  g.fillStyle = '#e9e7df'; g.fillRect(6, 0, 2, 128); g.fillRect(56, 0, 2, 128); g.fillRect(31, 0, 2, 72);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** Fait repousser les champs traités. */
export function updateCountry(dt) {
  for (const f of country.fields) f.update(dt);
}

