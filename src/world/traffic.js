import * as THREE from 'three';
import { heightAt, BIG } from './terrain.js';
import { country } from './country.js';
import { lightsPoints } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { mulberry32, mergeColored, xform } from '../util.js';
import { Puffs } from './puffs.js';

// Circulation de la grande île : voitures, camionnettes, camions et cars sur les routes goudronnées, et un
// petit train à vapeur qui fait le tour de l'île en s'arrêtant à chaque gare. Repère des véhicules : -Z vers l'avant.

const STEP = 8; // espacement des points des routes et de la voie (m)
const _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3();
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });

/** Position, cap et pente le long d'une polyligne à l'abscisse s (en nombre de points), en boucle ou non. */
function along(pts, s, loop, out) {
  const n = pts.length;
  let i = Math.floor(s), f = s - i;
  if (loop) { i = ((i % n) + n) % n; } else if (i >= n - 1) { i = n - 2; f = 1; } else if (i < 0) { i = 0; f = 0; }
  const a = pts[i], b = pts[(i + 1) % n];
  out.x = a.x + (b.x - a.x) * f; out.z = a.z + (b.z - a.z) * f;
  out.dx = b.x - a.x; out.dz = b.z - a.z;
  if (a.y !== undefined) out.y = a.y + (b.y - a.y) * f;
  return out;
}

// --------------------------------------------------------------------------- voitures
const CAR_COLORS = [0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0x9aa3ab, 0xf2c230, 0x2f8a5a, 0x8e1f3a, 0x5fb8d8];
function carMesh(kind, color) {
  const parts = [], K = 0x1b1c1e, G = 0x3a5a70;
  const B = (w, h, d, c, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  const wheels = (xs, zs, r) => { for (const x of xs) for (const z of zs) parts.push({ geo: new THREE.CylinderGeometry(r, r, 0.3, 8).rotateZ(Math.PI / 2), color: K, matrix: xform(x, r, z) }); };
  let front = -2.2, back = 2.2, top = 1.4;
  if (kind === 'car') {
    B(1.8, 0.7, 4.3, color, 0, 0.75, 0); B(1.6, 0.6, 2.2, G, 0, 1.4, 0.2); B(1.62, 0.08, 2.0, color, 0, 1.72, 0.25);
    wheels([-0.85, 0.85], [-1.4, 1.4], 0.34);
  } else if (kind === 'van') {
    B(1.9, 1.9, 4.8, color, 0, 1.3, 0); B(1.86, 0.6, 0.1, G, 0, 1.75, -2.41); B(1.92, 0.5, 2.6, G, 0, 1.75, -0.9);
    wheels([-0.9, 0.9], [-1.6, 1.6], 0.38); front = -2.45; back = 2.45; top = 2.25;
  } else if (kind === 'truck') {
    B(2.3, 2.2, 2.2, color, 0, 1.6, -3.4); B(2.2, 0.7, 0.1, G, 0, 2.1, -4.51);
    B(2.4, 2.8, 6.4, 0xeeeeea, 0, 2.1, 0.9); B(2.2, 0.4, 8.6, 0x3a3f45, 0, 0.6, -0.2);
    wheels([-1.05, 1.05], [-3.3, 1.2, 2.8], 0.5); front = -4.55; back = 4.1; top = 3.5;
  } else { // car (autocar)
    B(2.5, 2.8, 11, color, 0, 1.9, 0); B(2.54, 0.9, 9.6, G, 0, 2.3, 0.3); B(2.4, 1.2, 0.1, G, 0, 2.2, -5.51);
    B(2.52, 0.3, 11.02, 0xf4f4ee, 0, 1.1, 0);
    wheels([-1.15, 1.15], [-3.6, 3.6], 0.5); front = -5.5; back = 5.5; top = 3.3;
  }
  const mesh = new THREE.Mesh(mergeColored(parts), lam());
  mesh.castShadow = true;
  mesh.add(lightsPoints([-0.6, 0.85, front - 0.05, 0.6, 0.85, front - 0.05], 0xfff4c8, 1.5)); // phares
  mesh.add(lightsPoints([-0.7, 0.9, back + 0.05, 0.7, 0.9, back + 0.05], 0xff3020, 1.1));   // feux arrière
  mesh.userData.top = top;
  return mesh;
}

// --------------------------------------------------------------------------- voie ferrée
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
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const track = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: ballastTexture(), side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  track.receiveShadow = true;
  scene.add(track);
  // passages à niveau : croix de Saint-André de chaque côté de la voie
  for (const path of country.roads) {
    let last = -99;
    path.forEach((r, k) => {
      if (k - last < 12) return;
      const i = P.findIndex((q) => Math.abs(q.x - r.x) < 6 && Math.abs(q.z - r.z) < 6 && Math.abs(q.y - heightAt(q.x, q.z)) < 2);
      if (i < 0) return;
      last = k;
      const a = path[Math.max(0, k - 2)], b = path[Math.min(path.length - 1, k + 2)], L = Math.hypot(b.x - a.x, b.z - a.z) || 1, ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, ry = Math.atan2(ux, uz);
      for (const s of [-1, 1]) {
        const x = r.x + ux * s * 8 - uz * s * 5, z = r.z + uz * s * 8 + ux * s * 5, y = heightAt(x, z);
        parts.push({ geo: new THREE.BoxGeometry(0.2, 4, 0.2), color: 0xd9dcdf, matrix: xform(x, y + 2, z, ry) });
        for (const t of [-0.7, 0.7]) parts.push({ geo: new THREE.BoxGeometry(2.2, 0.35, 0.12), color: t > 0 ? 0xf4f4ee : 0xd8312b, matrix: xform(x, y + 3.7, z, ry, 1, 1, 1, 0, t) });
      }
    });
  }
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

// ---------------------------------------------------------------------------
export function buildTraffic(scene) {
  if (!BIG) return { update() {}, cars: [], train: null };
  const rnd = mulberry32(5150), _a = {}, _b = {};

  // voitures : réparties sur les routes goudronnées, dans les deux sens
  const cars = [];
  const roads = country.roads.filter((r) => r.paved && r.length > 20);
  for (const path of roads) {
    const count = Math.max(2, Math.round(path.length / 120));
    for (let k = 0; k < count; k++) {
      const r = rnd(), kind = r < 0.6 ? 'car' : r < 0.8 ? 'van' : r < 0.93 ? 'truck' : 'bus';
      const color = kind === 'bus' ? [0xf2c230, 0x2f5fa8, 0xf4f4ee][Math.floor(rnd() * 3)] : CAR_COLORS[Math.floor(rnd() * CAR_COLORS.length)];
      const mesh = carMesh(kind, color);
      scene.add(mesh);
      const vmax = kind === 'car' ? 17 + rnd() * 6 : kind === 'van' ? 15 + rnd() * 3 : 12 + rnd() * 3;
      cars.push({ path, mesh, s: rnd() * (path.length - 1), dir: rnd() < 0.5 ? 1 : -1, v: vmax * 0.5, vmax, wait: 0, kind });
    }
  }

  // le petit train : locomotive à vapeur, tender et cinq voitures en bois
  let train = null, smoke = null;
  const rail = country.rail;
  if (rail && rail.pts.length > 50) {
    buildRail(scene, rail);
    const units = [trainUnit(scene, locoMesh(), 5.8), trainUnit(scene, tenderMesh(), 2.9)];
    [0xc8402f, 0x2f5fa8, 0xf2a22c, 0x2f8a5a, 0x8e1f3a].forEach((c, k) => units.push(trainUnit(scene, coachMesh(c, k === 4), 5.6)));
    let off = -units[0].half;
    for (const u of units) { off += u.half; u.off = off; off += u.half; } // distance du milieu derrière celui de la locomotive
    smoke = new Puffs(scene, 60, { opacity: 0.85 });
    const st0 = rail.stations[0];
    train = { units, pos: units[0].mesh.position, puff: 0, s: st0 ? st0.i : 0, v: 0, vmax: 20, wait: 12, next: 1, n: rail.pts.length };
  }

  const place = (mesh, x, y, z, yaw, pitch) => {
    mesh.position.set(x, y, z);
    mesh.rotation.copy(_e.set(pitch, yaw, 0, 'YXZ'));
  };

  return {
    cars, train,
    update(dt, cam) {
      // voitures : roulent à droite, ralentissent dans les villages et dans les virages, font demi-tour au bout
      for (const c of cars) {
        const n = c.path.length - 1;
        if (c.wait > 0) { c.wait -= dt; continue; }
        along(c.path, c.s, false, _a);
        const inVillage = country.villages.some((v) => Math.abs(v.x - _a.x) < v.r && Math.abs(v.z - _a.z) < v.r && Math.hypot(v.x - _a.x, v.z - _a.z) < v.r);
        const ahead = along(c.path, c.s + c.dir * 3, false, _b);
        const turn = Math.abs(Math.atan2(_a.dx * ahead.dz - _a.dz * ahead.dx, _a.dx * ahead.dx + _a.dz * ahead.dz));
        const want = Math.min(c.vmax * (inVillage ? 0.5 : 1), 6 + 12 / Math.max(0.05, turn * 3));
        c.v += Math.max(-4 * dt, Math.min(2 * dt, want - c.v));
        c.s += (c.dir * c.v * dt) / STEP;
        if (c.s <= 0 || c.s >= n) { c.s = Math.max(0, Math.min(n, c.s)); c.dir *= -1; c.wait = 3 + rnd() * 6; c.v = 3; }
        if (cam && (Math.abs(c.mesh.position.x - cam.x) > 6000 || Math.abs(c.mesh.position.z - cam.z) > 6000)) continue;
        along(c.path, c.s, false, _a);
        let fx = _a.dx * c.dir, fz = _a.dz * c.dir; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
        const x = _a.x - fz * 1.9, z = _a.z + fx * 1.9; // voie de droite
        const y0 = heightAt(x - fx * 1.5, z - fz * 1.5), y1 = heightAt(x + fx * 1.5, z + fz * 1.5);
        place(c.mesh, x, (y0 + y1) / 2 + 0.32, z, Math.atan2(-fx, -fz), Math.atan2(y1 - y0, 3));
      }
      // train : accélère, roule à 70 km/h, freine pour s'arrêter à quai, repart après un moment
      if (train) {
        const T = train, P = rail.pts, st = rail.stations;
        if (T.wait > 0) T.wait -= dt;
        else {
          const target = st[T.next % st.length];
          let d = ((target.i - T.s) % T.n + T.n) % T.n * STEP; // distance jusqu'au quai suivant
          const want = Math.min(T.vmax, Math.sqrt(2 * 0.55 * Math.max(0, d - 2)) + 0.6);
          T.v += Math.max(-1.2 * dt, Math.min(0.5 * dt, want - T.v));
          T.s = (T.s + (T.v * dt) / STEP) % T.n;
          d = ((target.i - T.s) % T.n + T.n) % T.n * STEP;
          if (d < 1.5 || d > (T.n - 3) * STEP) { T.v = 0; T.wait = 20; T.next++; }
        }
        for (const { mesh, half, off } of T.units) {
          const s0 = T.s - off / STEP, sf = s0 + (half * 0.7) / STEP, sb = s0 - (half * 0.7) / STEP;
          along(P, sf, true, _a); const fx = _a.x, fz = _a.z, fy = _a.y;
          along(P, sb, true, _b);
          const dx = fx - _b.x, dz = fz - _b.z;
          place(mesh, (fx + _b.x) / 2, (fy + _b.y) / 2 + 0.35, (fz + _b.z) / 2, Math.atan2(-dx, -dz), Math.atan2(fy - _b.y, Math.hypot(dx, dz)));
        }
        // panache de vapeur (rien à dessiner de loin, ni dans un tunnel)
        const loco = T.units[0].mesh;
        const near = cam && Math.hypot(T.pos.x - cam.x, T.pos.z - cam.z) < 4000 && heightAt(T.pos.x, T.pos.z) < T.pos.y + 3;
        if (near && (T.puff -= dt) <= 0) {
          T.puff = T.v > 1 ? 0.12 : 0.6;
          _p.set(0, 5.6, -4.5).applyMatrix4(loco.matrixWorld);
          smoke.emit(_p.x, _p.y, _p.z, (rnd() - 0.5) * 1.5, 3 + rnd() * 1.5 + T.v * 0.05, (rnd() - 0.5) * 1.5, 0.45, 1.5 + rnd() * 0.8, 3.5, T.v > 1 ? 0xe4e4e2 : 0xffffff);
        }
        smoke.update(dt, 0.6);
      }
    },
  };
}
