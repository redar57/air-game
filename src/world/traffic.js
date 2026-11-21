import * as THREE from 'three';
import { heightAt, BIG } from './terrain.js';
import { country } from './country.js';
import { lightsPoints } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { mulberry32, mergeColored, xform } from '../util.js';

// Circulation de la grande île : voitures, camionnettes, camions et cars sur les routes goudronnées, et un
// train de voyageurs qui fait le tour de l'île en s'arrêtant à chaque gare. Repère des véhicules : -Z vers l'avant.

const STEP = 8; // espacement des points des routes et de la voie (m)
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
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

function wagonMesh(loco, color) {
  const parts = [], G = 0x2c4558, K = 0x26292d;
  const B = (w, h, d, c, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  if (loco) {
    B(2.9, 2.6, 15, color, 0, 2.3, 0.5); B(3.0, 1.1, 3.2, G, 0, 3.1, -5.3); B(2.95, 0.35, 15.1, 0xf2c230, 0, 1.3, 0.5);
    B(2.4, 0.5, 13, 0x5a5f66, 0, 3.85, 0.8); B(2.9, 0.5, 0.2, K, 0, 1.6, -7.05);
  } else {
    B(2.9, 2.9, 15.4, color, 0, 2.45, 0); B(2.95, 0.9, 13, G, 0, 2.9, 0); B(2.7, 0.35, 15.4, 0xc9cdd2, 0, 4.05, 0);
    B(2.95, 0.3, 15.45, 0xf4f1ea, 0, 1.55, 0);
  }
  for (const z of [-5, 5]) { B(2.2, 0.8, 3, K, 0, 0.75, z); }
  const mesh = new THREE.Mesh(mergeColored(parts), lam());
  mesh.castShadow = true;
  if (loco) mesh.add(lightsPoints([0, 3.2, -7.1, -0.9, 1.6, -7.1, 0.9, 1.6, -7.1], 0xfff4c8, 2.2));
  else { const w = []; for (let z = -6; z <= 6; z += 3) w.push(-1.5, 2.9, z, 1.5, 2.9, z); mesh.add(lightsPoints(w, 0xffd890, 1.6)); }
  return mesh;
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

  // le train : une locomotive et cinq voitures
  let train = null;
  const rail = country.rail;
  if (rail && rail.pts.length > 50) {
    buildRail(scene, rail);
    const cars_ = [wagonMesh(true, 0xc8402f)];
    for (let k = 0; k < 5; k++) cars_.push(wagonMesh(false, k % 2 ? 0x2f6b47 : 0x2f5fa8));
    for (const m of cars_) scene.add(m);
    const st0 = rail.stations[0];
    train = { meshes: cars_, s: st0 ? st0.i - 0.5 : 0, v: 0, vmax: 24, wait: 12, next: 1, n: rail.pts.length };
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
      // train : accélère, roule à 85 km/h, freine pour s'arrêter à quai, repart après un moment
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
        T.meshes.forEach((m, k) => {
          const s0 = T.s - k * (16 / STEP), sf = s0 + 6 / STEP, sb = s0 - 6 / STEP;
          along(P, sf, true, _a); const fx = _a.x, fz = _a.z, fy = _a.y;
          along(P, sb, true, _b);
          const dx = fx - _b.x, dz = fz - _b.z;
          place(m, (fx + _b.x) / 2, (fy + _b.y) / 2 + 0.35, (fz + _b.z) / 2, Math.atan2(-dx, -dz), Math.atan2(fy - _b.y, Math.hypot(dx, dz)));
        });
      }
    },
  };
}
