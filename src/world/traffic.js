import * as THREE from 'three';
import { heightAt, BIG } from './terrain.js';
import { country } from './country.js';
import { lightsPoints } from './airfields.js';
import { mulberry32, mergeColored, xform } from '../util.js';
import { buildTrains } from './trains.js';

// Circulation de la grande île : voitures, camionnettes, camions et cars sur les routes goudronnées, et un
// petit train à vapeur qui fait le tour de l'île en s'arrêtant à chaque gare. Repère des véhicules : -Z vers l'avant.

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

  const rails = buildTrains(scene, rnd);

  const place = (mesh, x, y, z, yaw, pitch) => {
    mesh.position.set(x, y, z);
    mesh.rotation.copy(_e.set(pitch, yaw, 0, 'YXZ'));
  };

  return {
    cars, rails, train: rails && rails.train,
    update(dt, cam) {
      // voitures : roulent à droite, ralentissent dans les villages et dans les virages, font demi-tour au bout
      for (const c of cars) {
        const n = c.path.length - 1;
        if (c.wait > 0) { c.wait -= dt; continue; }
        // ne rentre pas dans la voiture de devant, et s'arrête devant une barrière fermée
        let room = Infinity;
        for (const o of cars) if (o !== c && o.path === c.path && o.dir === c.dir) { const g = (o.s - c.s) * c.dir * STEP; if (g > 0 && g < room) room = g - 9 - (o.kind === 'truck' || o.kind === 'bus' ? 5 : 0); }
        for (const x of c.path.crossings || []) if (x.closed > 0.12) { const g = (x.k - c.s) * c.dir * STEP - x.off - 3; if (g > -4 && g < room) room = g; }
        along(c.path, c.s, false, _a);
        const inVillage = country.villages.some((v) => Math.abs(v.x - _a.x) < v.r && Math.abs(v.z - _a.z) < v.r && Math.hypot(v.x - _a.x, v.z - _a.z) < v.r);
        const ahead = along(c.path, c.s + c.dir * 3, false, _b);
        const turn = Math.abs(Math.atan2(_a.dx * ahead.dz - _a.dz * ahead.dx, _a.dx * ahead.dx + _a.dz * ahead.dz));
        const want = Math.min(Math.sqrt(2 * 3.5 * Math.max(0, room - 1)), c.vmax * (inVillage ? 0.5 : 1), 6 + 12 / Math.max(0.05, turn * 3));
        c.v += Math.max(-6 * dt, Math.min(2 * dt, want - c.v));
        c.s += (c.dir * c.v * dt) / STEP;
        if (c.s <= 0 || c.s >= n) { c.s = Math.max(0, Math.min(n, c.s)); c.dir *= -1; c.wait = 3 + rnd() * 6; c.v = 3; }
        if (cam && (Math.abs(c.mesh.position.x - cam.x) > 6000 || Math.abs(c.mesh.position.z - cam.z) > 6000)) continue;
        along(c.path, c.s, false, _a);
        let fx = _a.dx * c.dir, fz = _a.dz * c.dir; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
        const x = _a.x - fz * 1.9, z = _a.z + fx * 1.9; // voie de droite
        const li = Math.max(0, Math.min(n - 1, Math.floor(c.s))), up = c.path.lift[li] + (c.path.lift[li + 1] - c.path.lift[li]) * (c.s - li);
        const y0 = heightAt(x - fx * 1.5, z - fz * 1.5) + up, y1 = heightAt(x + fx * 1.5, z + fz * 1.5) + up;
        place(c.mesh, x, (y0 + y1) / 2 + 0.32, z, Math.atan2(-fx, -fz), Math.atan2(y1 - y0, 3));
      }
      if (rails) rails.update(dt, cam);
    },
  };
}
