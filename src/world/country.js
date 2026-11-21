import * as THREE from 'three';
import { heightAt, normalAt, HALF, BIG } from './terrain.js';
import { runways, seaBase } from './airfields.js';
import { toLocal, toWorld } from '../util.js';

// Campagne de la grande île : quelques villages reliés par des chemins de terre, et les champs de la Prairie
// (que l'épandeur traite). Les chemins suivent le relief : ils sont tracés par une recherche de plus court
// chemin (A*) qui évite l'eau, les fortes pentes et les pistes.

export const country = {
  villages: [], // { name, x, z, r, count, seed }
  roads: [],    // polylignes [{x, z}]
  fields: [],   // champs (voir Field)
};

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
function findPath(a, b) {
  const n = Math.round((2 * HALF) / G), N = n * n;
  const idx = (x, z) => Math.round((x + HALF) / G) + Math.round((z + HALF) / G) * n;
  const pos = (k) => [-HALF + (k % n) * G, -HALF + Math.floor(k / n) * G];
  const hgt = new Float32Array(N).fill(NaN);
  const H = (k) => { if (Number.isNaN(hgt[k])) { const [x, z] = pos(k); hgt[k] = heightAt(x, z); } return hgt[k]; };
  const onRunway = (x, z) => runways.some((rw) => { const l = toLocal(rw, x, z, {}); return Math.abs(l.x) < rw.halfWid && Math.abs(l.z) < rw.halfLen; });
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
/** Prévoit villages, chemins et champs (avant les arbres, qui évitent les chemins et les champs). */
export function planCountry() {
  if (!BIG) return;
  ON = Math.ceil((2 * HALF) / OCC);
  occ = new Uint8Array(ON * ON);
  const rw = (id) => runways.find((r) => r.id === id);
  const V = (name, x, z, count, seed) => ({ name, x, z, r: 120 + count * 7, count, seed });
  const lac = V('Village du Lac', 2950, 250, 16, 11), sud = V('Bourg du Sud', -1500, 4700, 22, 12);
  const port = V('Port de la Baie', -5000, 1800, 14, 13), col = V('Hameau du Col', -1700, -3300, 8, 14);
  const pre = V('Village de la Prairie', 9000, 1500, 12, 15);
  country.villages.push(lac, sud, port, col, pre);
  const ap = rw('aeroport'), pr = rw('prairie'), bz = rw('baie');
  const end = (r, f) => { const w = {}; toWorld(r, r.width / 2 + 60, f * r.length / 2, w); return w; };
  const links = [[end(ap, -0.6), lac], [lac, pre], [pre, end(pr, 0.55)], [lac, sud], [sud, port], [port, end(bz, 0.4)], [lac, col]];
  if (seaBase.active) links.push([lac, toWorld(seaBase, 70, -125, {})]);
  for (const [a, b] of links) {
    const path = findPath(a, b);
    if (path) { country.roads.push(path); for (const p of path) mark(p.x, p.z, 6, 1); }
  }
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

/** Construit chemins et champs. */
export function buildCountry(scene) {
  if (!BIG) return;
  const roadMat = new THREE.MeshLambertMaterial({ color: 0xc9b07e, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  for (const path of country.roads) {
    const pos = [], W = 2.6;
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const p = path[i], lx = p.x - dz * W, lz = p.z + dx * W, rx = p.x + dz * W, rz = p.z - dx * W;
      pos.push([lx, heightAt(lx, lz) + 0.3, lz, rx, heightAt(rx, rz) + 0.3, rz]);
    }
    const arr = [];
    for (let i = 0; i < pos.length - 1; i++) {
      const [ax, ay, az, bx, by, bz] = pos[i], [cx, cy, cz, ex, ey, ez] = pos[i + 1];
      arr.push(ax, ay, az, cx, cy, cz, bx, by, bz, bx, by, bz, cx, cy, cz, ex, ey, ez);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, roadMat);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  for (const f of country.fields) scene.add(f.build());
}

/** Fait repousser les champs traités. */
export function updateCountry(dt) {
  for (const f of country.fields) f.update(dt);
}

