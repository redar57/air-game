import * as THREE from 'three';
import { heightAt, flatInfo, DAM, BIG, highWaters, alongRange, fromRange, canyonAxis, riverDist } from './terrain.js';
import { occupied } from './country.js';
import { keepOut, peaks } from './places.js';
import { addBox, addCustom } from './colliders.js';
import { lightsPoints } from './airfields.js';
import { kit } from './ports.js';
import { Puffs } from './puffs.js';
import { mergeColored, xform, smoothstep, lerp } from '../util.js';

// Barrage-voûte en travers du canyon, sa retenue (on peut s'y poser en hydravion), la centrale à son pied, la rivière en
// aval, les évacuateurs qui crachent de l'eau et une cascade qui tombe de la falaise dans le lac.

const C = 12, W0 = 520, LEN = 980; // maille et étendue de la recherche de la retenue
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const hAt = (u, v) => { const p = fromRange(u, v); return heightAt(p.x, p.z); };

/** Remplit la vallée en amont du barrage (après la construction du relief, avant les arbres). */
export function planDam() {
  const L = DAM.level, u0 = DAM.u0, v0 = canyonAxis(u0);
  // largeur du canyon au droit du barrage
  let a = v0, b = v0;
  while (hAt(u0, a) < L + 5 && v0 - a < 320) a -= 3;
  while (hAt(u0, b) < L + 5 && b - v0 < 320) b += 3;
  const half = (b - a) / 2, vm = (a + b) / 2, bulge = 24;
  /** Position de la face amont du barrage (u) à l'abscisse v. */
  const crest = (v) => u0 + bulge * (1 - Math.min(1, ((v - vm) / half) ** 2));
  const n = Math.round(LEN / C), m = Math.round((2 * W0) / C), wet = new Uint8Array(n * m), U = (i) => u0 + (i + 0.5) * C, V = (j) => -W0 + (j + 0.5) * C;
  const stack = [Math.round(60 / C) * m + Math.round((v0 + W0) / C)];
  let leak = false, count = 0;
  while (stack.length) {
    const k = stack.pop(), j = k % m, i = (k - j) / m;
    if (wet[k] || U(i) < crest(V(j)) - 2 || hAt(U(i), V(j)) > L) continue;
    wet[k] = 1; count++;
    if (i === n - 1 || j === 0 || j === m - 1) { leak = true; continue; }
    if (i > 0) stack.push(k - m);
    stack.push(k + m, k - 1, k + 1);
  }
  const has = (x, z) => {
    const p = alongRange(x, z), i = Math.floor((p.u - u0) / C), j = Math.floor((p.v + W0) / C);
    return i >= 0 && j >= 0 && i < n && j < m && wet[i * m + j] === 1;
  };
  highWaters.push({ level: L, has });
  const c = fromRange(u0, vm);
  keepOut.push(has, (x, z) => { const p = alongRange(x, z); return Math.abs(p.u - u0 + 60) < 110 && Math.abs(p.v - vm) < half + 20; },
    (x, z) => riverDist(x, z) < 34);
  planLine(u0, vm);
  peaks.dam = { name: 'Barrage', x: c.x, z: c.z, u0, vm, half, crest, wet, n, m, U, V, leak, count };
}

/** Tracé de la ligne à haute tension : le long de la vallée, puis jusqu'à un poste électrique près de la ville. */
export const grid = { pylons: [], post: null };
function planLine(u0) {
  const way = [], turn = BIG ? -4300 : -1800;
  for (let u = u0 - 150; u > turn; u -= 60) { const p = fromRange(u, canyonAxis(u) + 62); way.push([p.x, p.z]); }
  way.push(...(BIG ? [[-1950, -3600], [-2100, -3000], [-2600, -1800], [-2900, -600], [-2700, 800], [-2500, 2000]] : [[-1060, -1330], [-1130, -1000], [-1000, -480], [-1080, 250], [-1180, 900], [-950, 1450], [-400, 1800]]));
  // poste : l'endroit le plus plat près du bout de la ligne
  const [ex, ez] = BIG ? [-2380, 2600] : [60, 2080];
  let best = null;
  for (let x = ex - 260; x <= ex + 260; x += 20) for (let z = ez - 260; z <= ez + 260; z += 20) {
    let lo = Infinity, hi = -Infinity, ok = true;
    for (const a of [-34, 0, 34]) for (const b of [-28, 0, 28]) { const h = heightAt(x + a, z + b); lo = Math.min(lo, h); hi = Math.max(hi, h); if (flatInfo(x + a, z + b).w > 0 || occupied(x + a, z + b)) ok = false; }
    const cost = hi - lo + Math.hypot(x - ex, z - ez) * 0.012;
    if (ok && lo > 4 && (!best || cost < best.cost)) best = { x, z, y: hi, lo, cost };
  }
  if (best) { const [lx, lz] = way[way.length - 1]; best.yaw = Math.atan2(lx - best.x, lz - best.z); grid.post = best; way.push([best.x + Math.sin(best.yaw) * 45, best.z + Math.cos(best.yaw) * 45]); }
  // pylônes à intervalles réguliers, décalés s'ils tombent sur une route, un champ ou un terrain
  const len = [0]; for (let i = 1; i < way.length; i++) len.push(len[i - 1] + Math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]));
  const total = len[len.length - 1], at = (s) => { let i = 0; while (i < way.length - 2 && len[i + 1] < s) i++; const t = (s - len[i]) / (len[i + 1] - len[i] || 1); return [lerp(way[i][0], way[i + 1][0], t), lerp(way[i][1], way[i + 1][1], t)]; };
  const n = Math.round(total / 175);
  for (let k = 0; k <= n; k++) {
    let [x, z] = at((k / n) * total);
    if (k < n) for (const d of [0, 18, -18, 36, -36, 54]) { const [a, b] = at((k / n) * total + d); if (!occupied(a, b) && flatInfo(a, b).w < 0.3) { x = a; z = b; break; } }
    grid.pylons.push({ x, z, y: heightAt(x, z), h: 27 });
  }
  // les câbles restent à 12 m du sol au moins : on rehausse les pylônes qui encadrent une bosse
  for (let it = 0; it < 4; it++) for (let k = 0; k < n; k++) {
    const A = grid.pylons[k], E = grid.pylons[k + 1];
    let miss = 0;
    for (let t = 0.1; t < 0.95; t += 0.1) miss = Math.max(miss, heightAt(lerp(A.x, E.x, t), lerp(A.z, E.z, t)) + 12 - (lerp(A.y + A.h * 0.82, E.y + E.h * 0.82, t) - 28 * t * (1 - t)));
    if (miss > 0) for (const p of [A, E]) p.h = Math.min(58, p.h + miss * 0.7);
  }
  keepOut.push((x, z) => grid.pylons.some((p, k) => { const q = grid.pylons[k + 1] || p, dx = q.x - p.x, dz = q.z - p.z, t = Math.max(0, Math.min(1, ((x - p.x) * dx + (z - p.z) * dz) / (dx * dx + dz * dz || 1))); return Math.abs(p.x + dx * t - x) + Math.abs(p.z + dz * t - z) < 16; }),
    (x, z) => !!grid.post && Math.hypot(x - grid.post.x, z - grid.post.z) < 60);
}

/** Pylônes, câbles et poste électrique ; `start` : départ de la ligne à la centrale. */
function buildLine(scene, start) {
  const K = kit(), ST = 0x8f979d, lights = [], P = grid.pylons, tops = [];
  P.forEach((p, k) => {
    const a = P[Math.max(0, k - 1)], b = P[Math.min(P.length - 1, k + 1)], yaw = Math.atan2(b.x - a.x, b.z - a.z), h = p.h;
    K.parts.push({ geo: new THREE.CylinderGeometry(0.4, 2 + h * 0.015, h + 1, 4), color: ST, matrix: xform(p.x, p.y + h / 2 - 0.5, p.z, yaw + Math.PI / 4) });
    for (const f of [0.68, 0.82, 0.95]) K.parts.push({ geo: new THREE.BoxGeometry(13 - f * 4, 0.4, 0.5), color: ST, matrix: xform(p.x, p.y + h * f, p.z, yaw) });
    addBox(p.x, p.z, yaw, 1.5, 1.5, p.y - 1, p.y + h); if (k % 2 === 0) lights.push(p.x, p.y + h, p.z);
    tops.push({ x: p.x, y: p.y + h * 0.82, z: p.z, rx: Math.cos(yaw), rz: -Math.sin(yaw) });
  });
  const ends = [{ ...start, rx: tops[0].rx, rz: tops[0].rz }, ...tops], D = grid.post;
  if (D) {
    // poste électrique : dalle, portiques, transformateurs, bâtiment, clôture
    const c = Math.cos(D.yaw), s = Math.sin(D.yaw), Y = D.y + 0.3, at = (x, z) => [D.x + x * c + z * s, D.z - x * s + z * c];
    const B = (w, h, d, col, x, y, z, ry = 0) => { const [a, b] = at(x, z); K.parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: col, matrix: xform(a, Y + y, b, D.yaw + ry) }); };
    B(66, D.y - D.lo + 3, 54, 0xb9b4a6, 0, -(D.y - D.lo + 3) / 2, 0);
    for (const z of [20, 4]) { for (const x of [-12, 0, 12]) B(0.7, 12, 0.7, ST, x, 6, z); B(25, 0.7, 0.7, ST, 0, 11.6, z); for (const x of [-8, 0, 8]) B(0.35, 2.2, 0.35, 0x6b4f3a, x, 10.2, z); }
    for (const x of [-18, -6, 6, 18]) { B(6, 5, 7, 0x7f9aa8, x, 2.5, -8); for (const a of [-1.6, 0, 1.6]) B(0.5, 2.6, 0.5, 0x6b4f3a, x + a, 6.2, -8); B(1, 4, 6, 0x5f7a88, x + 3.4, 2.4, -8); }
    B(20, 5, 8, 0xf2f2ee, -18, 2.5, -20); B(21, 0.6, 9, 0xb9472f, -18, 5.2, -20); for (const x of [-25, -20, -15, -10]) B(2, 1.4, 8.1, 0x2f4f66, x, 3, -20);
    for (const q of [-1, 1]) { for (const y of [0.6, 1.3, 2]) { B(64, 0.08, 0.08, 0x9aa0a6, 0, y, q * 26); B(0.08, 0.08, 52, 0x9aa0a6, q * 32, y, 0); } for (let x = -32; x <= 32; x += 8) B(0.16, 2.4, 0.16, 0x9aa0a6, x, 1.2, q * 26); for (let z = -24; z <= 24; z += 8) B(0.16, 2.4, 0.16, 0x9aa0a6, q * 32, 1.2, z); }
    addBox(D.x, D.z, D.yaw, 33, 27, D.lo - 3, Y + 6);
    const [gx, gz] = at(0, 20); ends.push({ x: gx, y: Y + 10.8, z: gz, rx: c, rz: -s });
    // départs vers la ville : poteaux plus petits
    lights.push(gx, Y + 12.4, gz);
  }
  for (let k = 0; k + 1 < ends.length; k++) for (const o of [-4.2, 0, 4.2]) {
    const A = ends[k], E = ends[k + 1], sag = Math.min(7, Math.hypot(E.x - A.x, E.z - A.z) * 0.04);
    const a = new THREE.Vector3(A.x + A.rx * o, A.y, A.z + A.rz * o), b = new THREE.Vector3(E.x + E.rx * o, E.y, E.z + E.rz * o), m = a.clone().add(b).multiplyScalar(0.5); m.y -= sag * 2;
    K.parts.push({ geo: new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, m, b), 8, 0.12, 3), color: 0x2b2e33 });
  }
  scene.add(K.mesh(), lightsPoints(lights, 0xff3020, 5));
}

/** Texture d'eau qui court : stries blanches. */
function flow(light) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 128; const g = cv.getContext('2d');
  g.fillStyle = light ? '#e6f4fb' : '#4f9fc8'; g.fillRect(0, 0, 64, 128);
  for (let i = 0; i < 90; i++) { g.fillStyle = light ? (i % 3 ? 'rgba(255,255,255,.8)' : 'rgba(120,180,215,.5)') : 'rgba(255,255,255,.28)'; const y = Math.random() * 128, b = [Math.random() * 64, y, 1 + Math.random() * 3, 8 + Math.random() * 26]; g.fillRect(...b); b[1] -= 128; g.fillRect(...b); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function buildDam(scene, seaMat) {
  const D = peaks.dam; if (!D) return null;
  const L = DAM.level, { u0, vm, half, crest, wet, n, m } = D, ticks = [];
  // --- plan d'eau (une case de plus tout autour : le bord passe sous le relief)
  const pos = [], on = (i, j) => i >= 0 && j >= 0 && i < n && j < m && wet[i * m + j];
  for (let i = -1; i <= n; i++) for (let j = 0; j < m; j++) {
    if (!on(i, j) && !on(i - 1, j) && !on(i + 1, j) && !on(i, j - 1) && !on(i, j + 1)) continue;
    const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([a, b]) => { const v = -W0 + b * C, u = Math.max(u0 + a * C, crest(v) - 1), p = fromRange(u, v); return [p.x, L, p.z]; });
    pos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
  }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  wg.setAttribute('normal', new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  const lake = new THREE.Mesh(wg, seaMat); lake.renderOrder = -1; scene.add(lake);

  // --- voûte : parement amont vertical, couronnement, parement aval incliné
  const parts = [], N = 30, CO = 0xc3c6c2, top = L + 4.5, ring = [];
  for (let k = 0; k <= N; k++) {
    const t = (k / N) * 2 - 1, v = vm + t * (half + 8), u = crest(v), y0 = Math.min(hAt(u, v), hAt(u - 30, v)) - 8;
    const pt = (du, y) => { const p = fromRange(u + du, v); return [p.x, y, p.z]; };
    ring.push({ a: pt(0, y0), b: pt(0, top), c: pt(-8, top), d: pt(-8 - Math.max(0, top - y0) * 0.24, y0), v, u });
  }
  const quad = (p, q, r, s, color) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute([...p, ...q, ...r, ...p, ...r, ...s], 3)); parts.push({ geo: g, color }); };
  for (let k = 0; k < N; k++) {
    const A = ring[k], E = ring[k + 1];
    quad(A.a, A.b, E.b, E.a, 0xaeb2ae); quad(A.b, A.c, E.c, E.b, 0x7c8084); quad(A.c, A.d, E.d, E.c, k % 2 ? CO : 0xbabdb9);
    for (const [P, Q] of [[A.b, E.b], [A.c, E.c]]) quad(P, [P[0], P[1] + 1.1, P[2]], [Q[0], Q[1] + 1.1, Q[2]], Q, 0xd9dbd8);
  }
  const wallMesh = new THREE.Mesh(mergeColored(parts), lam({ side: THREE.DoubleSide })); wallMesh.castShadow = wallMesh.receiveShadow = true; scene.add(wallMesh);
  const c = fromRange(u0, vm);
  addCustom(c.x, c.z, half + 30, -5, top + 1, (x, y, z) => { const p = alongRange(x, z); if (Math.abs(p.v - vm) > half + 6) return false; const u = crest(p.v); return p.u < u && p.u > u - 8 - (top - y) * 0.24; });

  // --- vannes, tours de prise d'eau, centrale, pylônes ; repère local : Z = amont (u), X = en travers (v ou -v)
  const o0 = fromRange(0, 0), eu = fromRange(1, 0), ev = fromRange(0, 1);
  const yaw = Math.atan2(eu.x - o0.x, eu.z - o0.z), dirV = Math.sign((ev.x - o0.x) * Math.cos(yaw) - (ev.z - o0.z) * Math.sin(yaw));
  const K = kit(), G = new THREE.Group(); G.position.set(c.x, 0, c.z); G.rotation.y = yaw; scene.add(G);
  const fl = hAt(u0 - 70, vm), WH = 0xf2f2ee, GL = 0x2f4f66, ST = 0x8f979d, lights = [];
  const collide = (x, z, hw, hd, h, y = fl) => { const p = fromRange(u0 + z, vm + x * dirV); addBox(p.x, p.z, yaw, hw, hd, y - 3, y + h); };
  const bu = crest(vm) - u0;
  for (let i = -2; i <= 2; i++) K.B(1.6, 7, 9, 0xb0b4b0, i * 9, top + 1.5, bu - 4);
  K.B(40, 1.2, 4, ST, 0, top + 5.4, bu - 4);
  for (const s of [-1, 1]) { const z = crest(vm + s * half * 0.5 * dirV) - u0 + 5; K.C(3.4, 3.4, 46, 0xb8bcb8, s * half * 0.5, top - 16, z, 12); K.parts.push({ geo: new THREE.ConeGeometry(4.4, 3, 12), color: 0x5f7f98, matrix: xform(s * half * 0.5, top + 8.4, z) }); collide(s * half * 0.5, z, 3, 3, top - fl + 10); }
  // centrale : salle des machines vitrée, transformateurs, conduites forcées
  const px = -half * 0.12, pz = -78;
  K.B(58, 15, 18, WH, px, fl + 6.5, pz); K.B(58.4, 5, 18.4, GL, px, fl + 9, pz); K.B(60, 1, 20, 0x5f7f98, px, fl + 14.4, pz); K.B(62, 2, 22, CO, px, fl + 0.4, pz); collide(px, pz, 29, 9, 16);
  for (let i = 0; i < 3; i++) K.parts.push({ geo: new THREE.CylinderGeometry(2.2, 2.2, 46, 10), color: 0x7f9aa8, matrix: xform(px - 16 + i * 16, fl + 15, pz + 26, 0, 1, 1, 1, 0.85) });
  for (let i = 0; i < 4; i++) { const x = px + 42 + i * 7; K.B(4, 4, 5, ST, x, fl + 2, pz + 2); for (const a of [-1.2, 0, 1.2]) K.C(0.25, 0.35, 2.4, 0x6b4f3a, x + a, fl + 5, pz + 2, 6); }
  { const w = fromRange(u0 + pz + 2, vm + (px + 52) * dirV); buildLine(scene, { x: w.x, y: fl + 5, z: w.z }); }
  G.add(K.mesh(), lightsPoints(lights, 0xff3020, 5));
  const dl = []; for (let k = 1; k < N; k += 2) dl.push(ring[k].b[0], top + 2.2, ring[k].b[2]);
  scene.add(lightsPoints(dl, 0xffe2a0, 5));

  // --- eau vive : rubans posés sur des points (x, y, z), texture qui défile
  const side = (p, q) => { const h = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1; return [-(q[2] - p[2]) / h, (q[0] - p[0]) / h]; };
  const ribbon = (pts, w0, w1, tex, speed, opacity = 1) => {
    const P = [], uvs = []; let len = 0;
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = pts[i], E = pts[i + 1], l = Math.hypot(E[0] - A[0], E[1] - A[1], E[2] - A[2]);
      const s0 = side(pts[Math.max(0, i - 1)], E), s1 = side(A, pts[Math.min(pts.length - 1, i + 2)]), a = lerp(w0, w1, i / (pts.length - 1)) / 2, b = lerp(w0, w1, (i + 1) / (pts.length - 1)) / 2;
      const p1 = [A[0] - s0[0] * a, A[1], A[2] - s0[1] * a], p2 = [A[0] + s0[0] * a, A[1], A[2] + s0[1] * a], p3 = [E[0] - s1[0] * b, E[1], E[2] - s1[1] * b], p4 = [E[0] + s1[0] * b, E[1], E[2] + s1[1] * b];
      const v0 = len / 22, v1 = (len + l) / 22;
      P.push(...p1, ...p2, ...p3, ...p2, ...p4, ...p3); uvs.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1); len += l;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.computeVertexNormals();
    const t = tex.clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, Math.round(w0 / 8)), 1);
    scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })));
    ticks.push((dt) => { t.offset.y -= dt * speed; });
  };
  const white = flow(true), blue = flow(false), mist = new Puffs(scene, 90, { opacity: 0.4 }), sprays = [];
  // évacuateurs : quatre jets qui tombent du couronnement
  for (let i = -1.5; i <= 1.5; i++) {
    const v = vm + i * 9, pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12, p = fromRange(crest(v) - 8 - t * 34, v); pts.push([p.x, lerp(top - 3, fl + 0.5, t * t), p.z]); }
    ribbon(pts, 6, 9, white, 1.5, 0.92);
  }
  const pool = fromRange(u0 - 24, vm); sprays.push({ x: pool.x, y: fl + 2, z: pool.z, r: 18, n: 12, s: 7 });
  // rivière en aval
  const river = [];
  for (let u = u0 - 20; u > DAM.mouth - 60; u -= 14) {
    const k = smoothstep(u0 - 20, u0 - 160, u), v = canyonAxis(u) * k + vm * (1 - k), p = fromRange(u, v), q = fromRange(u - 4, canyonAxis(u - 4) * k + vm * (1 - k));
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1, w = lerp(8, 18, (u0 - u) / (u0 - DAM.mouth)), nx = -(q.z - p.z) / l * w, nz = (q.x - p.x) / l * w;
    const h = Math.max(heightAt(p.x, p.z), heightAt(p.x + nx, p.z + nz), heightAt(p.x - nx, p.z - nz));
    if (h < 0.15 && u < DAM.mouth + 900) break;
    river.push([p.x, h + 0.4, p.z]);
  }
  D.river = river;
  if (river.length > 4) ribbon(river, 20, 42, blue, 0.35);
  // cascade naturelle : du haut de la paroi jusqu'à la retenue
  let best = null;
  for (let u = u0 + 130; u < u0 + 520; u += 20) for (const s of [-1, 1]) {
    const ax = canyonAxis(u); let foot = null;
    for (let d = 40; d < 340; d += 4) {
      const h = hAt(u, ax + s * d);
      if (foot === null && h > L) foot = d;
      if (foot !== null && d - foot > 24 && d - foot < 150) { const drop = h - L, slope = drop / (d - foot); if (drop > 70 && drop < 210 && (!best || slope > best.slope)) best = { u, s, foot, d, slope }; }
    }
  }
  if (best) {
    const pts = [];
    for (let k = 0; k <= 24; k++) { const d = lerp(best.d + 26, best.foot - 6, k / 24), p = fromRange(best.u, canyonAxis(best.u) + best.s * d); pts.push([p.x, Math.max(heightAt(p.x, p.z) + 1.6, L + 0.2), p.z]); }
    ribbon(pts, 7, 15, white, 1.1, 0.95);
    const e = pts[pts.length - 1]; sprays.push({ x: e[0], y: L + 1, z: e[2], r: 9, n: 7, s: 5 }); D.fall = { x: e[0], z: e[2], slope: best.slope };
  }
  return {
    update(dt, cam) {
      for (const f of ticks) f(dt);
      if (cam && Math.hypot(cam.x - c.x, cam.z - c.z) > 4000) return;
      for (const s of sprays) if (Math.random() < dt * s.n) mist.emit(s.x + (Math.random() - 0.5) * s.r * 2, s.y, s.z + (Math.random() - 0.5) * s.r * 2, (Math.random() - 0.5) * 3, 2 + Math.random() * 3, (Math.random() - 0.5) * 3, 1.5, s.s, 3.2, 0xffffff);
      mist.update(dt);
    },
  };
}
