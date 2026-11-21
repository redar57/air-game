import * as THREE from 'three';
import { heightAt, normalAt, flatInfo, BIG } from './terrain.js';
import { occupied } from './country.js';
import { lightsPoints } from './airfields.js';
import { Effects } from '../fx.js';
import { mulberry32, mergeColored, xform } from '../util.js';

// Vie au sol : troupeaux qui paissent, tracteurs sur les chemins, fumée des cheminées,
// fenêtres et lampadaires allumés la nuit. Repère des animaux et tracteurs : -Z vers l'avant.

const _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _p = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color();
const NEAR = 3500; // au-delà, on ne fait plus bouger bêtes et tracteurs

const lam = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

function cowGeo() {
  const W = 0xffffff, D = 0x3a302a, P = 0xe8b4a8;
  const parts = [
    { geo: new THREE.BoxGeometry(1.15, 1.05, 2.3), color: W, matrix: xform(0, 1.3, 0) },
    { geo: new THREE.BoxGeometry(0.6, 0.62, 0.8), color: W, matrix: xform(0, 1.6, -1.45, 0, 1, 1, 1, -0.35) },
    { geo: new THREE.BoxGeometry(0.5, 0.3, 0.25), color: P, matrix: xform(0, 1.4, -1.86) },
    { geo: new THREE.BoxGeometry(0.9, 0.08, 0.1), color: 0xe9e2cf, matrix: xform(0, 1.95, -1.3) },
    { geo: new THREE.BoxGeometry(0.08, 0.9, 0.08), color: W, matrix: xform(0, 1.15, 1.18, 0, 1, 1, 1, 0.15) },
  ];
  for (const [x, z] of [[-0.38, -0.85], [0.38, -0.85], [-0.38, 0.85], [0.38, 0.85]]) {
    parts.push({ geo: new THREE.BoxGeometry(0.24, 0.85, 0.24), color: W, matrix: xform(x, 0.42, z) });
    parts.push({ geo: new THREE.BoxGeometry(0.26, 0.12, 0.26), color: D, matrix: xform(x, 0.06, z) });
  }
  return mergeColored(parts);
}

function sheepGeo() {
  const W = 0xffffff, D = 0x2e2a28;
  const parts = [
    { geo: new THREE.IcosahedronGeometry(0.7, 0), color: W, matrix: xform(0, 0.95, 0, 0, 0.9, 0.75, 1.25) },
    { geo: new THREE.BoxGeometry(0.32, 0.38, 0.48), color: D, matrix: xform(0, 1.05, -0.88, 0, 1, 1, 1, -0.3) },
  ];
  for (const [x, z] of [[-0.25, -0.45], [0.25, -0.45], [-0.25, 0.45], [0.25, 0.45]]) {
    parts.push({ geo: new THREE.BoxGeometry(0.13, 0.6, 0.13), color: D, matrix: xform(x, 0.3, z) });
  }
  return mergeColored(parts);
}

function tractorMesh(rnd, trailer) {
  const R = [0xc8402f, 0x2f7a3a, 0x2f5fa8][Math.floor(rnd() * 3)], K = 0x1b1c1e, G = 0x9fc6dc, Y = 0xf2c230;
  const parts = [
    { geo: new THREE.BoxGeometry(1.1, 0.9, 2.2), color: R, matrix: xform(0, 1.25, -0.9) },     // capot
    { geo: new THREE.BoxGeometry(1.5, 0.5, 1.5), color: R, matrix: xform(0, 1.15, 0.7) },      // châssis arrière
    { geo: new THREE.BoxGeometry(1.4, 1.35, 1.3), color: G, matrix: xform(0, 2.1, 0.7) },      // cabine vitrée
    { geo: new THREE.BoxGeometry(1.6, 0.12, 1.5), color: R, matrix: xform(0, 2.84, 0.7) },     // toit
    { geo: new THREE.CylinderGeometry(0.07, 0.07, 1.1), color: K, matrix: xform(0.35, 2.1, -1.4) }, // pot d'échappement
    { geo: new THREE.BoxGeometry(0.9, 0.3, 0.1), color: 0x6b6f73, matrix: xform(0, 1.2, -2.02) },
  ];
  for (const s of [-1, 1]) {
    parts.push({ geo: new THREE.CylinderGeometry(0.85, 0.85, 0.5, 12).rotateZ(Math.PI / 2), color: K, matrix: xform(s * 0.98, 0.85, 0.75) });
    parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.42, 0.5, 10).rotateZ(Math.PI / 2), color: Y, matrix: xform(s * 1.0, 0.85, 0.75, 0, 0.6, 0.6, 0.6) });
    parts.push({ geo: new THREE.CylinderGeometry(0.48, 0.48, 0.3, 10).rotateZ(Math.PI / 2), color: K, matrix: xform(s * 0.72, 0.48, -1.5) });
  }
  if (trailer) {
    parts.push({ geo: new THREE.BoxGeometry(2.1, 0.3, 4), color: 0x8a5a33, matrix: xform(0, 1.0, 4.1) });
    parts.push({ geo: new THREE.BoxGeometry(0.15, 0.15, 1.2), color: K, matrix: xform(0, 0.9, 1.9) });
    for (const s of [-1, 1]) parts.push({ geo: new THREE.CylinderGeometry(0.5, 0.5, 0.3, 10).rotateZ(Math.PI / 2), color: K, matrix: xform(s * 1.0, 0.5, 4.1) });
    for (let k = 0; k < 4; k++) { // ballots de foin
      parts.push({ geo: new THREE.CylinderGeometry(0.62, 0.62, 0.95, 10).rotateZ(Math.PI / 2), color: 0xd9b55a, matrix: xform(k % 2 ? 0.5 : -0.5, 1.8, k < 2 ? 3.3 : 4.9) });
    }
  }
  const mesh = new THREE.Mesh(mergeColored(parts), lam());
  mesh.castShadow = true;
  // phares, allumés la nuit
  mesh.add(lightsPoints([-0.4, 1.3, -2.05, 0.4, 1.3, -2.05], 0xfff4c8, 1.6));
  return mesh;
}

/** Halo lumineux doux autour des lampes (s'ajoute à ce qu'il y a derrière). */
function halo(positions, color, size) {
  const pts = lightsPoints(positions, color, size);
  pts.material.blending = THREE.AdditiveBlending;
  pts.material.map = haloTex();
  return pts;
}
let _halo = null;
function haloTex() {
  if (_halo) return _halo;
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  _halo = new THREE.CanvasTexture(cv);
  return _halo;
}

/** Endroit dégagé pour un pré : pas d'eau, pas de pente, ni piste, ni chemin, ni champ, ni maison. */
function pasture(x, z, villages) {
  const h = heightAt(x, z);
  if (h < 5 || h > 380 || normalAt(x, z, _n).y < 0.95 || flatInfo(x, z).w > 0) return false;
  if (BIG && occupied(x, z)) return false;
  return !villages.some((v) => Math.hypot(x - v.x, z - v.z) < v.r + 30);
}

export function buildLife(scene, villages, roads) {
  const rnd = mulberry32(4242);

  // ------------------------------------------------------------------ troupeaux
  const herds = [];
  const spots = [];
  for (const v of villages) {
    const n = BIG ? 2 : 3;
    for (let k = 0; k < n; k++) spots.push(v);
  }
  for (const v of spots) {
    for (let t = 0; t < 200; t++) {
      const a = rnd() * 6.283, d = v.r + 120 + rnd() * 300, x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      if (!pasture(x, z, villages) || herds.some((h) => Math.hypot(h.x - x, h.z - z) < 250)) continue;
      const kind = herds.length % 2 ? 'sheep' : 'cow', R = kind === 'cow' ? 38 : 28, animals = [];
      for (let i = 0, tries = 0; i < (kind === 'cow' ? 7 : 11) && tries < 60; tries++) {
        const ax = x + (rnd() - 0.5) * R * 1.6, az = z + (rnd() - 0.5) * R * 1.6;
        if (!pasture(ax, az, villages)) continue;
        animals.push({ x: ax, z: az, yaw: rnd() * 6.283, tx: ax, tz: az, wait: rnd() * 10, sp: (kind === 'cow' ? 0.6 : 0.8) * (0.8 + rnd() * 0.4) });
        i++;
      }
      if (animals.length >= 3) herds.push({ x, z, R, kind, animals });
      break;
    }
  }
  const mkIM = (geo, list, colors) => {
    const im = new THREE.InstancedMesh(geo, lam(), Math.max(1, list.length));
    im.count = list.length;
    list.forEach((a, i) => im.setColorAt(i, _c.set(colors[Math.floor(rnd() * colors.length)])));
    im.castShadow = true; im.frustumCulled = false;
    scene.add(im);
    return im;
  };
  const cows = herds.filter((h) => h.kind === 'cow').flatMap((h) => h.animals);
  const sheep = herds.filter((h) => h.kind === 'sheep').flatMap((h) => h.animals);
  const cowIM = mkIM(cowGeo(), cows, [0x8a5a3a, 0xf2efe6, 0x2e2a28, 0xd9c7a0, 0xa86a3e]);
  const sheepIM = mkIM(sheepGeo(), sheep, [0xf4f1e8, 0xeae3d2, 0xf8f6f0, 0x8a7a6a]);
  const place = (im, list) => {
    list.forEach((a, i) => {
      _q.setFromEuler(_e.set(0, a.yaw, 0));
      _m.compose(_p.set(a.x, heightAt(a.x, a.z) - 0.05, a.z), _q, _s);
      im.setMatrixAt(i, _m);
    });
    im.instanceMatrix.needsUpdate = true;
  };
  place(cowIM, cows); place(sheepIM, sheep);

  // ------------------------------------------------------------------ tracteurs
  const tractors = [];
  if (BIG) {
    const usable = roads.filter((r) => r.length > 60);
    for (let k = 0; k < Math.min(6, usable.length); k++) {
      const path = usable[k], mesh = tractorMesh(rnd, k % 2 === 0);
      scene.add(mesh);
      tractors.push({ path, mesh, s: rnd() * (path.length - 1), dir: rnd() < 0.5 ? 1 : -1, wait: 0, sp: 4 + rnd() * 1.5 });
    }
  }

  // ------------------------------------------------------------------ fenêtres, lampadaires, cheminées
  const win = [], lamps = [], posts = [], chimneys = [];
  for (const v of villages) {
    const houses = v.houses || [];
    houses.forEach((hs, i) => {
      const c = Math.cos(hs.ry), s = Math.sin(hs.ry), y = hs.y + hs.h * 0.45;
      // une fenêtre éclairée sur chaque grande façade (pas toutes les maisons)
      for (const side of [1, -1]) {
        if (rnd() < 0.3) continue;
        const off = (rnd() - 0.5) * hs.w * 0.5, out = side * (hs.d / 2 + 0.15);
        win.push(hs.x + c * off + s * out, y, hs.z - s * off + c * out);
      }
      if (hs.chimney) chimneys.push({ ...hs.chimney, v, t: rnd() * 2 });
      if (i % 3 === 1) { // lampadaire au bord de la maison
        const lx = hs.x + c * (hs.w / 2 + 5), lz = hs.z - s * (hs.w / 2 + 5);
        posts.push([lx, heightAt(lx, lz), lz]);
      }
    });
  }
  // lampadaires le long des chemins à l'approche des villages
  for (const path of roads) {
    for (let i = 0; i < path.length; i += 5) {
      const p = path[i];
      if (!villages.some((v) => Math.hypot(p.x - v.x, p.z - v.z) < v.r * 1.25)) continue;
      const a = path[Math.max(0, i - 1)], b = path[Math.min(path.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
      const lx = p.x - dz * 5, lz = p.z + dx * 5;
      posts.push([lx, heightAt(lx, lz), lz]);
    }
  }
  if (posts.length) {
    const parts = [];
    for (const [x, y, z] of posts) {
      parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.16, 5.2, 5), color: 0x3a3f45, matrix: xform(x, y + 2.6, z) });
      parts.push({ geo: new THREE.BoxGeometry(0.6, 0.25, 0.6), color: 0x2b2e33, matrix: xform(x, y + 5.3, z) });
      lamps.push(x, y + 5.0, z);
    }
    scene.add(new THREE.Mesh(mergeColored(parts), lam()));
    scene.add(lightsPoints(lamps, 0xffe2a0, 4.5));
    scene.add(halo(lamps, 0x6a4c18, 22));
  }
  if (win.length) { scene.add(lightsPoints(win, 0xffc870, 3.4)); scene.add(halo(win, 0x4a3010, 11)); }
  const smoke = new Effects(scene, { max: 420, opacity: 0.35, drag: 0.6 });

  return {
    herds, tractors, chimneys,
    update(dt, t, night, cam) {
      const cx = cam ? cam.x : 0, cz = cam ? cam.z : 0;
      // bêtes : marchent un peu vers un coin d'herbe, puis broutent un moment
      let moved = false;
      for (const h of herds) {
        if (cam && Math.hypot(h.x - cx, h.z - cz) > NEAR) continue;
        for (const a of h.animals) {
          if (a.wait > 0) { a.wait -= dt; continue; }
          const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
          if (d < 0.5) {
            a.wait = 4 + Math.random() * 14;
            for (let k = 0; k < 6; k++) {
              const ang = Math.random() * 6.283, r = Math.random() * h.R;
              const tx = h.x + Math.cos(ang) * r, tz = h.z + Math.sin(ang) * r;
              if (pasture(tx, tz, villages)) { a.tx = tx; a.tz = tz; break; }
            }
            continue;
          }
          const want = Math.atan2(-dx, -dz);
          let dy = want - a.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          a.yaw += Math.max(-dt * 1.2, Math.min(dt * 1.2, dy));
          if (Math.abs(dy) < 0.6) { const st = Math.min(d, a.sp * dt); a.x += (dx / d) * st; a.z += (dz / d) * st; }
          moved = true;
        }
      }
      if (moved) { place(cowIM, cows); place(sheepIM, sheep); }

      // tracteurs : font l'aller-retour sur leur chemin, avec une pause à chaque bout
      for (const tr of tractors) {
        const n = tr.path.length - 1;
        if (tr.wait > 0) tr.wait -= dt;
        else {
          tr.s += (tr.dir * tr.sp * dt) / 8; // points du chemin espacés de 8 m
          if (tr.s <= 0 || tr.s >= n) { tr.s = Math.max(0, Math.min(n, tr.s)); tr.dir *= -1; tr.wait = 8 + Math.random() * 10; }
        }
        const i = Math.min(n - 1, Math.floor(tr.s)), f = tr.s - i, a = tr.path[i], b = tr.path[i + 1];
        const x = a.x + (b.x - a.x) * f, z = a.z + (b.z - a.z) * f;
        const fx = (b.x - a.x) * tr.dir, fz = (b.z - a.z) * tr.dir;
        // le tracteur reste sur le bord droit du chemin
        const L = Math.hypot(fx, fz) || 1, ox = (-fz / L) * 1.2, oz = (fx / L) * 1.2;
        tr.mesh.position.set(x + ox, heightAt(x + ox, z + oz) + 0.25, z + oz);
        const yaw = Math.atan2(-fx, -fz);
        if (tr.mesh.userData.yaw === undefined) tr.mesh.userData.yaw = yaw;
        let dy = yaw - tr.mesh.userData.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        tr.mesh.userData.yaw += dy * Math.min(1, dt * 3);
        tr.mesh.rotation.y = tr.mesh.userData.yaw;
      }

      // fumée des cheminées (près de la caméra), plus fournie le soir et la nuit
      const every = night > 0.2 ? 0.45 : 1.1;
      for (const ch of chimneys) {
        if (cam && Math.hypot(ch.x - cx, ch.z - cz) > 2500) continue;
        if ((ch.t -= dt) > 0) continue;
        ch.t = every * (0.7 + Math.random() * 0.6);
        _v.set(1.2 + Math.random(), 2.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.8);
        smoke.emit(_p.set(ch.x, ch.y, ch.z), _v, 5 + Math.random() * 2, 0.7 + Math.random() * 0.3,
          night > 0.5 ? 0x8a9098 : Math.random() < 0.5 ? 0xd6d6d2 : 0xbfc0bc, 0.75, -0.1);
      }
      smoke.update(dt);
    },
  };
}
