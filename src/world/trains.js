import * as THREE from 'three';
import { heightAt } from './terrain.js';
import { country } from './country.js';
import { lightsPoints } from './airfields.js';
import { addBox } from './colliders.js';
import { mergeColored, xform, smoothstep } from '../util.js';
import { Puffs } from './puffs.js';

// Voie ferrée de la grande île : la voie et ses ouvrages, les gares à double voie, les passages à niveau, et deux trains
// qui tournent en sens inverse (le petit train à vapeur et un train de marchandises). La ligne est à voie unique entre
// les gares : un train ne quitte une gare que si le tronçon suivant est libre ; ils se croisent donc en gare.

export const STEP = 8; // espacement des points de la voie (m)
const SIDE = 5.4;      // écart de la voie d'évitement (à gauche de la voie principale)
const FLAT = 14, RAMP = 9; // longueur (en points) de l'évitement de part et d'autre de la gare, et de ses aiguillages
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3();
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
/** Décalage latéral de la voie d'évitement au point i (0 hors gare). */
function siding(rail, i) {
  const n = rail.pts.length;
  let k = 0;
  for (const st of rail.stations) { const d = Math.abs(((i - st.i + n * 1.5) % n) - n / 2); if (d < FLAT + RAMP) k = Math.max(k, smoothstep(FLAT + RAMP, FLAT, d)); }
  return k * SIDE;
}

function ballastTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#8b857a'; g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 400; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.12)'; g.fillRect(Math.random() * 64, Math.random() * 64, 2, 2); }
  g.fillStyle = '#5e4a36';
  for (let y = 4; y < 64; y += 16) g.fillRect(8, y, 48, 6); // traverses
  g.fillStyle = '#6f7378'; g.fillRect(17, 0, 3, 64); g.fillRect(44, 0, 3, 64); // rails
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

function buildRail(scene, rail) {
  const P = rail.pts, n = P.length, W = 2.4;
  const pos = [], uv = [], parts = [];
  const side = (i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1;
    return [dx / d, dz / d];
  };
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, [ax, az] = side(i), [bx, bz] = side(j), p = P[i], q = P[j];
    const y0 = p.y + 0.35, y1 = q.y + 0.35, v0 = i * STEP / 6, v1 = v0 + STEP / 6;
    pos.push(p.x - az * W, y0, p.z + ax * W, q.x - bz * W, y1, q.z + bx * W, p.x + az * W, y0, p.z - ax * W,
      p.x + az * W, y0, p.z - ax * W, q.x - bz * W, y1, q.z + bx * W, q.x + bz * W, y1, q.z - bx * W);
    uv.push(0, v0, 0, v1, 1, v0, 1, v0, 0, v1, 1, v1);
    // viaduc : piles régulières là où la voie passe haut au-dessus du sol ou de l'eau
    const ground = Math.max(heightAt(p.x, p.z), -12), hgt = p.y - ground;
    if (hgt > 3 && i % 4 === 0) {
      const ry = Math.atan2(ax, az);
      parts.push({ geo: new THREE.BoxGeometry(4.2, hgt, 2), color: 0xb8b0a2, matrix: xform(p.x, ground + hgt / 2 - 0.4, p.z, ry) });
      addBox(p.x, p.z, ry, 2.1, 1, ground - 1, p.y);
    }
    if (hgt > 1.5) { // tablier sous la voie
      const ry = Math.atan2(ax, az);
      parts.push({ geo: new THREE.BoxGeometry(5.6, 1.1, STEP + 0.4), color: 0xa39b8d, matrix: xform((p.x + q.x) / 2, (p.y + q.y) / 2 - 0.3, (p.z + q.z) / 2, ry, 1, 1, 1, Math.atan2(p.y - q.y, STEP)) });
    }
    // tunnel : portail en pierre à l'entrée et à la sortie
    const inT = (k) => { const q = P[(k + n) % n]; return heightAt(q.x, q.z) - q.y > 4; };
    if (inT(i) !== inT(i - 1)) {
      const ry = Math.atan2(ax, az), y = p.y;
      for (const s of [-1, 1]) parts.push({ geo: new THREE.BoxGeometry(1.6, 7, 3), color: 0x8f8678, matrix: xform(p.x + s * az * 3.4, y + 3.3, p.z - s * ax * 3.4, ry) });
      parts.push({ geo: new THREE.BoxGeometry(8.4, 1.8, 3), color: 0x8f8678, matrix: xform(p.x, y + 7.2, p.z, ry) });
      parts.push({ geo: new THREE.BoxGeometry(5.2, 5.6, 0.2), color: 0x15171a, matrix: xform(p.x + (inT(i) ? ax : -ax) * 1.6, y + 2.9, p.z + (inT(i) ? az : -az) * 1.6, ry) });
    }
  }
  // voies d'évitement des gares, à gauche de la voie principale
  for (const st of rail.stations) for (let k = -FLAT - RAMP; k < FLAT + RAMP; k++) {
    const i = (st.i + k + n) % n, j = (i + 1) % n, [ax, az] = side(i), [bx, bz] = side(j), p = P[i], q = P[j], o0 = siding(rail, i), o1 = siding(rail, j);
    const px = p.x + az * o0, pz = p.z - ax * o0, qx = q.x + bz * o1, qz = q.z - bx * o1, y0 = p.y + 0.33, y1 = q.y + 0.33, v0 = i * STEP / 6, v1 = v0 + STEP / 6;
    pos.push(px - az * W, y0, pz + ax * W, qx - bz * W, y1, qz + bx * W, px + az * W, y0, pz - ax * W, px + az * W, y0, pz - ax * W, qx - bz * W, y1, qz + bx * W, qx + bz * W, y1, qz - bx * W);
    uv.push(0, v0, 0, v1, 1, v0, 1, v0, 0, v1, 1, v1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const track = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: ballastTexture(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  track.receiveShadow = true;
  scene.add(track);
  // gares : quai, abri et panneau, sur le côté droit de la voie
  const lamps = [];
  for (const st of rail.stations) {
    const p = P[st.i], [ax, az] = side(st.i), ry = Math.atan2(ax, az), ox = -az * 6.5, oz = ax * 6.5;
    const x = p.x + ox, z = p.z + oz, y = p.y;
    parts.push({ geo: new THREE.BoxGeometry(5, 1, 70), color: 0xc9c3b6, matrix: xform(x, y, z, ry) });
    parts.push({ geo: new THREE.BoxGeometry(6, 4.2, 14), color: 0xf0e2c4, matrix: xform(x - az * 4, y + 2.6, z + ax * 4, ry) });
    parts.push({ geo: new THREE.BoxGeometry(7.4, 0.5, 16), color: 0xb9472f, matrix: xform(x - az * 4, y + 4.9, z + ax * 4, ry) });
    parts.push({ geo: new THREE.BoxGeometry(3.4, 0.25, 30), color: 0x5a5f66, matrix: xform(x, y + 3.4, z, ry) });
    for (const k of [-12, 12]) parts.push({ geo: new THREE.BoxGeometry(0.25, 3, 0.25), color: 0x5a5f66, matrix: xform(x + ax * k, y + 1.9, z + az * k, ry) });
    addBox(x - az * 4, z + ax * 4, ry, 3.2, 7.5, y, y + 5.2);
    st.x = x; st.z = z;
    for (const k of [-25, 0, 25]) lamps.push(x + ax * k, y + 3.6, z + az * k);
  }
  if (parts.length) scene.add(new THREE.Mesh(mergeColored(parts), lam()));
  if (lamps.length) scene.add(lightsPoints(lamps, 0xffe2a0, 4));
}

/** Petite locomotive à vapeur : chaudière, dôme, cheminée évasée, cabine, roues rouges et chasse-bœufs. */
function locoMesh() {
  const parts = [], N = 0x1f2b2a, GR = 0x2f6b47, R = 0xc8402f, L = 0xd9a92b, K = 0x26292d;
  const B = (w, h, d, c, x, y, z, rx = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, 0, 1, 1, 1, rx) });
  const tubeZ = (r, d, c, y, z) => parts.push({ geo: new THREE.CylinderGeometry(r, r, d, 12).rotateX(Math.PI / 2), color: c, matrix: xform(0, y, z) });
  const C = (rt, rb, h, c, y, z) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, 10), color: c, matrix: xform(0, y, z) });
  B(2.3, 0.4, 10.4, K, 0, 1.25, 0);
  tubeZ(1.1, 5.6, GR, 2.55, -1.2); tubeZ(1.16, 1.3, N, 2.55, -4.5);
  for (const z of [-2.8, -1.2, 0.4]) tubeZ(1.14, 0.18, L, 2.55, z); // cerclages de laiton
  C(0.75, 0.4, 1.0, N, 4.9, -4.5); C(0.4, 0.45, 1.2, N, 4, -4.5);   // cheminée évasée
  C(0.42, 0.5, 0.7, L, 3.85, -2); parts.push({ geo: new THREE.SphereGeometry(0.42, 8, 6), color: L, matrix: xform(0, 4.2, -2) });
  C(0.12, 0.12, 0.7, L, 3.9, 0.2);                                   // sifflet
  B(2.7, 2.5, 2.8, R, 0, 2.7, 3); B(2.74, 0.9, 1.7, 0x2c4558, 0, 3.3, 3); B(3.1, 0.3, 3.5, N, 0, 4.1, 3);
  B(2.6, 0.5, 0.4, R, 0, 1.2, -5.3); B(2.2, 0.9, 0.2, K, 0, 0.65, -5.75, 0.5);
  for (const s of [-1, 1]) {
    for (const z of [-0.9, 0.9, 2.7]) parts.push({ geo: new THREE.CylinderGeometry(0.78, 0.78, 0.22, 12).rotateZ(Math.PI / 2), color: R, matrix: xform(s * 1.1, 0.8, z) });
    for (const z of [-4.4, -3.2]) parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.42, 0.2, 10).rotateZ(Math.PI / 2), color: R, matrix: xform(s * 1.1, 0.45, z) });
    B(0.12, 0.2, 4.6, L, s * 1.28, 0.8, 0.6); B(0.5, 0.7, 1.4, N, s * 1.2, 1.05, -3.5); // bielles, cylindres
  }
  tubeZ(0.3, 0.4, L, 3.75, -5.1);
  return { parts, lights: [[0, 3.75, -5.4], 0xfff4c8, 3] };
}
function tenderMesh() {
  const parts = [], B = (w, h, d, c, x, y, z, ry = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry) });
  B(2.3, 0.4, 5.4, 0x26292d, 0, 1.0, 0); B(2.5, 1.6, 5, 0x2f6b47, 0, 2, 0); B(2.54, 0.15, 5.04, 0xd9a92b, 0, 2.6, 0);
  for (let k = 0; k < 7; k++) B(1.1, 0.8, 1.1, 0x17191b, ((k % 2) - 0.5) * 1.1, 2.85 + (k % 3) * 0.12, -1.8 + k * 0.6, k);
  wheelsZ(parts, [-1.5, 1.5]);
  return { parts, lights: null };
}
function wheelsZ(parts, zs) {
  for (const z of zs) for (const x of [-1.1, 1.1]) parts.push({ geo: new THREE.CylinderGeometry(0.45, 0.45, 0.2, 10).rotateZ(Math.PI / 2), color: 0x26292d, matrix: xform(x, 0.45, z) });
}
/** Voiture en bois à plateformes et toit bombé ; last : avec lanterne rouge de queue. */
function coachMesh(color, last) {
  const parts = [], G = 0x2c4558, I = 0xf2ead2;
  const B = (w, h, d, c, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  B(2.5, 0.35, 10.6, 0x26292d, 0, 1, 0); B(2.5, 1.1, 8.4, color, 0, 1.75, 0); B(2.4, 1.1, 8.3, G, 0, 2.8, 0);
  for (let z = -4.1; z <= 4.2; z += 1.37) B(2.52, 1.1, 0.3, I, 0, 2.8, z);
  B(2.52, 0.2, 8.42, I, 0, 2.32, 0); B(2.52, 0.25, 8.42, I, 0, 3.4, 0);
  parts.push({ geo: new THREE.CylinderGeometry(1.45, 1.45, 10.8, 10, 1, false, -Math.PI / 2, Math.PI), color: 0x8a3f30, matrix: xform(0, 3.45, 0, 0, 1, 1, 0.42, -Math.PI / 2) });
  for (const z of [-5.1, 5.1]) { B(2.4, 0.1, 0.1, 0xd9a92b, 0, 2.1, z); for (const x of [-1.15, 1.15]) { B(0.1, 2.4, 0.1, 0x26292d, x, 2.3, z); } }
  wheelsZ(parts, [-3.9, -2.7, 2.7, 3.9]);
  const w = []; for (let z = -3.4; z <= 3.5; z += 1.37) w.push(-1.3, 2.8, z, 1.3, 2.8, z);
  return { parts, lights: last ? [[0, 2.2, 5.4], 0xff3020, 2] : null, windows: w };
}
function trainUnit(scene, o, half) {
  const mesh = new THREE.Mesh(mergeColored(o.parts), lam());
  mesh.castShadow = true;
  if (o.lights) mesh.add(lightsPoints(...o.lights));
  if (o.windows) mesh.add(lightsPoints(o.windows, 0xffd890, 1.3));
  scene.add(mesh);
  return { mesh, half };
}


/** Wagons de marchandises : couvert, citerne, plat à conteneur, tombereau, grumier. */
function freightMesh(kind, color) {
  const parts = [], K = 0x26292d;
  const B = (w, h, d, c, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  B(2.5, 0.35, 11.6, K, 0, 1, 0);
  wheelsZ(parts, [-4.4, -3.2, 3.2, 4.4]);
  if (kind === 'box') { B(2.7, 2.7, 11, color, 0, 2.5, 0); B(2.76, 2.2, 2.6, 0x4a4038, 0, 2.4, 0); for (let z = -5; z <= 5; z += 1.25) B(2.78, 2.6, 0.12, color, 0, 2.5, z); B(2.4, 0.3, 11, 0x9aa0a6, 0, 3.95, 0); }
  else if (kind === 'tank') { parts.push({ geo: new THREE.CylinderGeometry(1.3, 1.3, 10.4, 12).rotateX(Math.PI / 2), color, matrix: xform(0, 2.5, 0) }); parts.push({ geo: new THREE.CylinderGeometry(0.45, 0.45, 0.6, 8), color: K, matrix: xform(0, 3.9, 0) }); for (const z of [-3.6, 3.6]) B(2.4, 0.8, 0.5, K, 0, 1.4, z); }
  else if (kind === 'flat') { B(2.6, 2.6, 5.2, color, 0, 2.5, -2.8); B(2.6, 2.6, 5.2, 0xc8402f, 0, 2.5, 2.8); for (const z of [-5.2, -4, -2.8, -1.6, 0.6, 1.8, 3, 4.2, 5.2]) B(2.66, 2.2, 0.12, z < 0 ? 0x24406b : 0x8e2a20, 0, 2.5, z); }
  else if (kind === 'hopper') { B(2.7, 1.7, 11, color, 0, 2.1, 0); for (let z = -4.6; z <= 4.6; z += 1.3) parts.push({ geo: new THREE.IcosahedronGeometry(1.1, 0), color: 0x17191b, matrix: xform(0, 2.8, z, z) }); }
  else { for (let k = 0; k < 7; k++) parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.45, 10, 7).rotateX(Math.PI / 2), color: k % 2 ? 0x8a6a44 : 0x7a5a38, matrix: xform(((k % 4) - 1.5) * 0.82 + (k > 3 ? 0.4 : 0), 1.65 + (k > 3 ? 0.72 : 0), 0) }); for (const z of [-4, 0, 4]) for (const x of [-1.25, 1.25]) B(0.15, 1.8, 0.2, K, x, 2, z); }
  return { parts, lights: null };
}
/** Locomotive diesel de ligne (bleue et jaune). */
function dieselMesh() {
  const parts = [], BL = 0x2f5fa8, Y = 0xf2c230, K = 0x26292d;
  const B = (w, h, d, c, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  B(2.6, 0.5, 14.6, K, 0, 1.15, 0); B(2.7, 2.7, 3.2, BL, 0, 2.8, -4.6); B(2.74, 0.9, 1.9, 0x2c4558, 0, 3.4, -4.9); B(2.4, 0.9, 0.1, 0x2c4558, 0, 3.4, -6.22);
  B(2.9, 0.25, 3.5, K, 0, 4.25, -4.6); B(1.9, 2.3, 9.4, BL, 0, 2.55, 2); B(1.94, 0.5, 9.5, Y, 0, 1.7, 2); B(2.72, 0.5, 3.3, Y, 0, 1.75, -4.6); B(2.2, 1.2, 1.6, Y, 0, 2, -6.6);
  for (let z = -1.5; z < 6; z += 1.5) B(1.96, 0.9, 0.9, K, 0, 2.9, z);
  parts.push({ geo: new THREE.CylinderGeometry(0.3, 0.3, 0.6, 8), color: K, matrix: xform(0, 3.9, 1) });
  for (const s of [-1, 1]) { B(0.06, 0.9, 10, 0xd9dcdf, s * 1.28, 1.9, 2); B(0.3, 0.3, 0.1, 0xffffff, s * 0.8, 2.2, -7.42); }
  wheelsZ(parts, [-5.4, -4.2, -3, 3, 4.2, 5.4]);
  return { parts, lights: [[-0.8, 2.2, -7.5, 0.8, 2.2, -7.5, 0, 3.9, -6.3], 0xfff4c8, 2.6] };
}

/** Position le long de la voie (abscisse en points), décalée de `lat` mètres vers la gauche. */
function at(P, s, lat, out) {
  const n = P.length;
  let i = Math.floor(s); const f = s - i;
  i = ((i % n) + n) % n;
  const a = P[i], b = P[(i + 1) % n], dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
  out.x = a.x + dx * f + (dz / L) * lat; out.z = a.z + dz * f - (dx / L) * lat; out.y = a.y + (b.y - a.y) * f;
  return out;
}

// --------------------------------------------------------------------------- passages à niveau
/** Trouve les croisements routes / voie et construit croix, feux et barrières. Chaque route reçoit ses `crossings`. */
function buildCrossings(scene, rail) {
  const P = rail.pts, n = P.length, parts = [], out = [];
  const red = new THREE.MeshBasicMaterial({ color: 0xff2a1a }), dark = new THREE.MeshBasicMaterial({ color: 0x3a1210 });
  const armGeo = (() => { const a = []; for (let k = 0; k < 6; k++) a.push({ geo: new THREE.BoxGeometry(1.2, 0.22, 0.14), color: k % 2 ? 0xd8312b : 0xf4f4ee, matrix: xform(0.6 + k * 1.2, 0, 0) }); a.push({ geo: new THREE.BoxGeometry(0.9, 0.5, 0.5), color: 0x3a3f45, matrix: xform(-0.4, 0, 0) }); return mergeColored(a); })();
  const lamp = new THREE.SphereGeometry(0.24, 8, 6);
  for (const path of country.roads) {
    path.crossings = [];
    let last = -99;
    path.forEach((r, k) => {
      if (k - last < 12) return;
      let i = -1, bd = 6.5;
      for (let j = 0; j < n; j++) { const q = P[j]; if (Math.abs(q.x - r.x) < 7 && Math.abs(q.z - r.z) < 7) { const d = Math.hypot(q.x - r.x, q.z - r.z); if (d < bd) { bd = d; i = j; } } }
      if (i < 0 || Math.abs(P[i].y - heightAt(P[i].x, P[i].z)) > 5) return;
      last = k;
      const a = path[Math.max(0, k - 2)], b = path[Math.min(path.length - 1, k + 2)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
      const t0 = P[(i - 1 + n) % n], t1 = P[(i + 1) % n], T = Math.hypot(t1.x - t0.x, t1.z - t0.z), sin = Math.abs((ux * (t1.z - t0.z) - uz * (t1.x - t0.x)) / T);
      const off = Math.min(16, 8 / Math.max(sin, 0.4)); // recul des barrières, plus grand si la route croise en biais
      const c = { i, k, path, x: P[i].x, y: P[i].y, z: P[i].z, off: off + 3, closed: 0, shut: false, arms: [], lamps: [] };
      for (const s of [-1, 1]) {
        // sens d'approche : s = -1 vient de l'amont de la route, sa voie de droite est du côté (-uz, ux) * -s
        const fx = -s * ux, fz = -s * uz, rx = -fz, rz = fx;
        const x = r.x + ux * s * off + rx * 5, z = r.z + uz * s * off + rz * 5, y = heightAt(x, z) + path.lift[k] * 0.7, ry = Math.atan2(fx, fz);
        parts.push({ geo: new THREE.BoxGeometry(0.22, 4.4, 0.22), color: 0xd9dcdf, matrix: xform(x, y + 2.2, z, ry) });
        for (const t of [-0.7, 0.7]) parts.push({ geo: new THREE.BoxGeometry(2.2, 0.35, 0.12), color: t > 0 ? 0xf4f4ee : 0xd8312b, matrix: xform(x, y + 4.1, z, ry, 1, 1, 1, 0, t) });
        parts.push({ geo: new THREE.BoxGeometry(1.6, 0.7, 0.2), color: 0x1b1c1e, matrix: xform(x, y + 3.1, z, ry) });
        for (const d of [-0.45, 0.45]) { const m = new THREE.Mesh(lamp, dark); m.position.set(x + Math.cos(ry) * d - Math.sin(ry) * 0.16, y + 3.1, z - Math.sin(ry) * d - Math.cos(ry) * 0.16); scene.add(m); c.lamps.push(m); }
        const arm = new THREE.Group(), bar = new THREE.Mesh(armGeo, lam());
        arm.position.set(x - rx * 0.6, y + 1.3, z - rz * 0.6); arm.rotation.y = Math.atan2(rz, -rx); // s'abaisse en travers de la route
        bar.castShadow = true; arm.add(bar); scene.add(arm); c.arms.push(bar);
      }
      path.crossings.push(c); out.push(c);
    });
  }
  if (parts.length) scene.add(new THREE.Mesh(mergeColored(parts), lam()));
  return { list: out, red, dark };
}

export function buildTrains(scene, rnd) {
  const rail = country.rail;
  if (!rail || rail.pts.length < 50) return null;
  buildRail(scene, rail);
  const X = buildCrossings(scene, rail), P = rail.pts, n = P.length, st = rail.stations, S = st.length;
  const make = (list, o) => {
    let off = -list[0].half;
    for (const u of list) { off += u.half; u.off = off; off += u.half; } // distance du milieu derrière celui de la locomotive
    return { units: list, pos: list[0].mesh.position, len: off, v: 0, wait: 5, hold: -1, horn: 0, ...o };
  };
  const U = (o, half) => trainUnit(scene, o, half);
  const steam = make([U(locoMesh(), 5.8), U(tenderMesh(), 2.9), ...[0xc8402f, 0x2f5fa8, 0xf2a22c, 0x2f8a5a, 0x8e1f3a].map((c, k) => U(coachMesh(c, k === 4), 5.6))],
    { kind: 'steam', dir: 1, vmax: 20, s: st[0].i + 4, at: 0, stopAt: 4, puff: 0 });
  const F = [['box', 0x8a3f30], ['tank', 0xd9dcdf], ['flat', 0x2f5fa8], ['hopper', 0x5f676f], ['log'], ['flat', 0x2f8a5a], ['tank', 0x2b2e33], ['box', 0xa8743f]];
  const far = Math.floor(S / 2);
  const freight = make([U(dieselMesh(), 7.5), ...F.map(([k, c]) => U(freightMesh(k, c), 6.1))], { kind: 'freight', dir: -1, vmax: 17, s: st[far].i - 7, at: far, stopAt: -7, puff: 0 });
  const trains = [steam, freight];
  const smoke = new Puffs(scene, 80, { opacity: 0.85 });
  const _a = {}, _b = {};
  const blocks = new Array(S).fill(null); // tronçon k : de la gare k à la gare k + 1
  const mod = (v, m) => ((v % m) + m) % m;

  function drive(T, dt) {
    // gare visée : la suivante dans le sens de marche (T.at = dernière gare quittée ou atteinte)
    const next = mod(T.at + T.dir, S), block = T.dir > 0 ? T.at : next;
    if (T.wait > 0) { T.wait -= dt; T.v = 0; return; }
    if (T.hold < 0) { // en gare : attend que le tronçon soit libre
      if (blocks[block]) { T.v = 0; T.red = true; return; }
      blocks[block] = T; T.hold = block; T.red = false;
      T.horn = 1; // coup de sifflet au départ
    }
    const goal = st[next].i + T.stopAt;
    const dist = () => mod((goal - T.s) * T.dir, n) * STEP;
    let d = dist();
    if (d > (n - 6) * STEP) d = 0;
    // marchandises : passe sans s'arrêter si le tronçon d'après est libre
    const block2 = T.dir > 0 ? next : mod(next - 1, S);
    let through = T.kind === 'freight' && !blocks[block2];
    const want = through ? Math.min(T.vmax, d < 260 ? 11 : T.vmax) : Math.min(T.vmax, Math.sqrt(2 * 0.5 * Math.max(0, d - 1)) + 0.5);
    T.v += Math.max(-1.3 * dt, Math.min(0.4 * dt, want - T.v));
    const step = (T.v * dt) / STEP;
    T.s = mod(T.s + T.dir * step, n);
    if (d < 1.5 || d <= T.v * dt + 0.5) {
      blocks[T.hold] = null; T.hold = -1; T.at = next;
      if (through) { blocks[block2] = T; T.hold = block2; }
      else { T.v = 0; T.wait = T.kind === 'steam' ? 20 : 4; }
    }
  }
  /** Distance (m) restant jusqu'au croisement dans le sens de marche ; négative quand la tête l'a dépassé. */
  const ahead = (T, i) => { let d = mod((i - T.s) * T.dir, n) * STEP; if (d > (n * STEP) / 2) d -= n * STEP; return d; };

  return {
    trains, crossings: X.list, train: steam, freight,
    update(dt, cam) {
      for (const T of trains) {
        drive(T, dt);
        const lat = T.kind === 'freight';
        for (const { mesh, half, off } of T.units) {
          const s0 = T.s - (T.dir * off) / STEP, h = (T.dir * half * 0.7) / STEP;
          at(P, s0 + h, lat ? siding(rail, s0 + h) : 0, _a); const fx = _a.x, fz = _a.z, fy = _a.y;
          at(P, s0 - h, lat ? siding(rail, s0 - h) : 0, _b);
          const dx = fx - _b.x, dz = fz - _b.z;
          mesh.position.set((fx + _b.x) / 2, (fy + _b.y) / 2 + 0.35, (fz + _b.z) / 2);
          mesh.rotation.copy(_e.set(Math.atan2(fy - _b.y, Math.hypot(dx, dz)), Math.atan2(-dx, -dz), 0, 'YXZ'));
        }
        // panache (rien à dessiner de loin, ni dans un tunnel)
        const loco = T.units[0].mesh, near = cam && Math.hypot(T.pos.x - cam.x, T.pos.z - cam.z) < 4000 && heightAt(T.pos.x, T.pos.z) < T.pos.y + 3;
        if (near && (T.puff -= dt) <= 0) {
          loco.updateMatrixWorld();
          if (T.kind === 'steam') {
            T.puff = T.v > 1 ? 0.12 : 0.6;
            _p.set(0, 5.6, -4.5).applyMatrix4(loco.matrixWorld);
            smoke.emit(_p.x, _p.y, _p.z, (rnd() - 0.5) * 1.5, 3 + rnd() * 1.5 + T.v * 0.05, (rnd() - 0.5) * 1.5, 0.45, 1.5 + rnd() * 0.8, 3.5, T.v > 1 ? 0xe4e4e2 : 0xffffff);
          } else {
            T.puff = 0.3;
            _p.set(0, 4.4, 1).applyMatrix4(loco.matrixWorld);
            smoke.emit(_p.x, _p.y, _p.z, 0, 2, 0, 0.25, 0.8, 1.6, 0x6b6e72);
          }
        }
      }
      smoke.update(dt, 0.6);
      // passages à niveau : se ferment une douzaine de secondes avant le train, s'ouvrent derrière lui
      const blink = Math.floor(performance.now() / 450) % 2;
      for (const c of X.list) {
        let shut = false;
        for (const T of trains) {
          const d = ahead(T, c.i), was = c['d' + T.kind];
          if (d < Math.max(70, T.v * 13) && d > -T.len - 18 && (T.v > 0.2 || d < 30)) shut = true;
          if (was !== undefined && was > 320 && d <= 320 && T.v > 5) T.horn = 2; // siffle avant le passage
          c['d' + T.kind] = d;
        }
        c.shut = shut;
        c.closed += Math.max(-dt * 0.45, Math.min(dt * 0.35, (shut ? 1 : 0) - c.closed));
        for (const b of c.arms) b.rotation.z = (1 - smoothstep(0, 1, c.closed)) * 1.42;
        c.lamps.forEach((m, k) => { m.material = shut && k % 2 === blink ? X.red : X.dark; });
      }
    },
  };
}
