import * as THREE from 'three';
import { heightAt, normalAt, flatInfo, BIG, HALF } from './terrain.js';
import { occupied } from './country.js';
import { Effects } from '../fx.js';
import { mulberry32, mergeColored, xform, clamp } from '../util.js';

// Faune sauvage : bancs de dauphins qui bondissent près des côtes, baleines qui soufflent au large et
// sondent en montrant la queue, hardes de cerfs à l'orée des forêts (qui détalent si on les frôle).
// Repère des animaux : -Z vers l'avant.

const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _n = new THREE.Vector3();
const lam = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const NEAR = 4000; // au-delà, on ne fait plus bouger les bêtes (elles restent où elles sont)

function dolphinGeo() {
  const G = 0x7f8e9c, W = 0xdfe6ea;
  return mergeColored([
    { geo: new THREE.IcosahedronGeometry(1, 1), color: G, matrix: xform(0, 0, 0, 0, 0.42, 0.42, 1.25) },
    { geo: new THREE.IcosahedronGeometry(1, 1), color: W, matrix: xform(0, -0.13, -0.1, 0, 0.34, 0.3, 1.05) },
    { geo: new THREE.ConeGeometry(0.1, 0.55, 5), color: G, matrix: xform(0, -0.05, -1.45, 0, 1, 1, 1, -Math.PI / 2) },  // rostre
    { geo: new THREE.BoxGeometry(0.06, 0.45, 0.4), color: G, matrix: xform(0, 0.48, 0.1, 0, 1, 1, 1, -0.5) },          // aileron
    { geo: new THREE.BoxGeometry(0.9, 0.05, 0.3), color: G, matrix: xform(0, 0, 1.35) },                               // nageoire caudale
    { geo: new THREE.BoxGeometry(0.75, 0.05, 0.25), color: G, matrix: xform(0, -0.2, -0.45, 0, 1, 1, 1, 0, 0) },
  ]);
}
function whaleGeo() {
  const D = 0x3f4a58, B = 0x8f9aa6;
  return mergeColored([
    { geo: new THREE.IcosahedronGeometry(1, 1), color: D, matrix: xform(0, 0, 0, 0, 2.4, 2.1, 8) },
    { geo: new THREE.IcosahedronGeometry(1, 1), color: B, matrix: xform(0, -0.8, -1.5, 0, 2.0, 1.5, 6) },
    { geo: new THREE.BoxGeometry(4.5, 0.25, 1.5), color: D, matrix: xform(0, -1, -2.5) },             // nageoires
    { geo: new THREE.ConeGeometry(0.6, 1.4, 5), color: D, matrix: xform(0, 1.9, 3.5, 0, 1, 1, 1, -0.4) },
  ]);
}
function flukeGeo() {
  const D = 0x3f4a58;
  return mergeColored([
    { geo: new THREE.CylinderGeometry(0.5, 0.9, 5, 6), color: D, matrix: xform(0, 2.5, 0) },
    { geo: new THREE.BoxGeometry(6, 1.8, 0.35), color: D, matrix: xform(0, 5.4, 0) },
  ]);
}
function deerGeo(stag) {
  const B = 0x8a5a33, L = 0xd9c3a0, K = 0x3a2a1e;
  const parts = [
    { geo: new THREE.BoxGeometry(0.75, 0.75, 1.7), color: B, matrix: xform(0, 1.25, 0) },
    { geo: new THREE.BoxGeometry(0.35, 0.9, 0.35), color: B, matrix: xform(0, 1.85, -0.85, 0, 1, 1, 1, 0.45) },   // cou
    { geo: new THREE.BoxGeometry(0.32, 0.32, 0.6), color: B, matrix: xform(0, 2.3, -1.15) },                     // tête
    { geo: new THREE.BoxGeometry(0.3, 0.3, 0.12), color: L, matrix: xform(0, 1.35, 0.86) },                      // miroir blanc
    { geo: new THREE.BoxGeometry(0.1, 0.2, 0.1), color: K, matrix: xform(0, 2.25, -1.47) },
  ];
  for (const s of [-1, 1]) parts.push({ geo: new THREE.BoxGeometry(0.08, 0.25, 0.15), color: B, matrix: xform(s * 0.18, 2.5, -1.0, 0, 1, 1, 1, 0, s * 0.5) });
  for (const [x, z] of [[-0.25, -0.65], [0.25, -0.65], [-0.25, 0.65], [0.25, 0.65]]) parts.push({ geo: new THREE.BoxGeometry(0.14, 0.95, 0.14), color: B, matrix: xform(x, 0.48, z) });
  if (stag) for (const s of [-1, 1]) {
    parts.push({ geo: new THREE.CylinderGeometry(0.03, 0.05, 0.9, 4), color: L, matrix: xform(s * 0.25, 2.85, -1.05, 0, 1, 1, 1, -0.2, s * 0.35) });
    parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.04, 0.4, 4), color: L, matrix: xform(s * 0.33, 2.9, -1.3, 0, 1, 1, 1, -0.9, s * 0.2) });
    parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.04, 0.35, 4), color: L, matrix: xform(s * 0.42, 3.2, -1.05, 0, 1, 1, 1, 0.3, s * 0.6) });
  }
  return mergeColored(parts);
}

/** Cercle de nage : toute la trajectoire dans une eau d'une profondeur comprise entre min et max. */
function seaLoop(rnd, minD, maxD, rMin, rMax, others, gap) {
  const span = HALF * 1.85;
  for (let k = 0; k < 3000; k++) {
    const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span, r = rMin + rnd() * (rMax - rMin);
    if (others.some((o) => Math.hypot(o.cx - x, o.cz - z) < gap)) continue;
    let ok = true;
    for (let a = 0; a < 6.283 && ok; a += 0.4) {
      const h = heightAt(x + Math.cos(a) * r, z + Math.sin(a) * r);
      ok = h < -minD && h > -maxD;
    }
    if (ok) return { cx: x, cz: z, r };
  }
  return null;
}

export function buildFauna(scene, trees, villages) {
  const rnd = mulberry32(8080);
  const splash = new Effects(scene, { max: 260 });
  const spray = new Effects(scene, { max: 160, opacity: 0.6, drag: 0.8 });

  // ------------------------------------------------------------------ dauphins
  const dGeo = dolphinGeo(), dMat = lam();
  const pods = [];
  for (let i = 0; i < (BIG ? 9 : 4); i++) {
    const loop = seaLoop(rnd, 6, 45, 250, 600, pods, 1500);
    if (!loop) continue;
    const members = [];
    const n = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(dGeo, dMat); m.castShadow = true; scene.add(m);
      members.push({ m, ox: (rnd() - 0.5) * 14, oz: (rnd() - 0.5) * 18, jump: rnd() * 8, jt: -1, ph: rnd() * 6 });
    }
    pods.push({ ...loop, a: rnd() * 6.28, dir: rnd() < 0.5 ? 1 : -1, sp: 7 + rnd() * 3, members });
  }

  // ------------------------------------------------------------------ baleines
  const wGeo = whaleGeo(), fGeo = flukeGeo(), wMat = lam();
  const whales = [];
  for (let i = 0; i < (BIG ? 3 : 2); i++) {
    const loop = seaLoop(rnd, 35, 400, 700, 1300, whales, 3000);
    if (!loop) continue;
    const body = new THREE.Mesh(wGeo, wMat), fluke = new THREE.Mesh(fGeo, wMat);
    body.castShadow = true; fluke.visible = false;
    scene.add(body, fluke);
    whales.push({ ...loop, a: rnd() * 6.28, dir: rnd() < 0.5 ? 1 : -1, body, fluke, t: rnd() * 60, blow: 2 });
  }

  // ------------------------------------------------------------------ cerfs
  const herds = [];
  const stagGeo = deerGeo(true), hindGeo = deerGeo(false), cMat = lam();
  const meadow = (x, z) => {
    const h = heightAt(x, z);
    if (h < 25 || h > 520 || normalAt(x, z, _n).y < 0.9 || flatInfo(x, z).w > 0) return false;
    if (BIG && occupied(x, z)) return false;
    return !villages.some((v) => Math.hypot(x - v.x, z - v.z) < v.r + 150);
  };
  for (let t = 0; t < 6000 && herds.length < (BIG ? 14 : 6) && trees.length; t++) {
    // à l'orée du bois : un arbre, puis un peu à côté (là où il n'y a plus d'arbre)
    const tr = trees[Math.floor(rnd() * trees.length)], a = rnd() * 6.28;
    const x = tr.x + Math.cos(a) * 30, z = tr.z + Math.sin(a) * 30;
    if (!meadow(x, z) || herds.some((h) => Math.hypot(h.x - x, h.z - z) < 900)) continue;
    const animals = [];
    for (let k = 0, tries = 0; k < 3 + Math.floor(rnd() * 4) && tries < 40; tries++) {
      const ax = x + (rnd() - 0.5) * 30, az = z + (rnd() - 0.5) * 30;
      if (!meadow(ax, az)) continue;
      const m = new THREE.Mesh(k === 0 ? stagGeo : hindGeo, cMat); m.castShadow = true; scene.add(m);
      animals.push({ m, x: ax, z: az, yaw: rnd() * 6.28, tx: ax, tz: az, wait: rnd() * 8, run: 0, ph: rnd() * 6 });
      k++;
    }
    if (animals.length >= 2) herds.push({ x, z, R: 35, animals });
    else for (const an of animals) scene.remove(an.m);
  }
  const placeDeer = (d) => {
    const y = heightAt(d.x, d.z) + (d.run > 0 ? Math.abs(Math.sin(d.ph)) * 0.6 : 0);
    d.m.position.set(d.x, y, d.z); d.m.rotation.set(d.run > 0 ? Math.sin(d.ph) * 0.15 : 0, d.yaw, 0, 'YXZ');
  };
  for (const h of herds) for (const d of h.animals) placeDeer(d);

  return {
    pods, whales, herds,
    update(dt, t, cam) {
      const cx = cam ? cam.x : 0, cz = cam ? cam.z : 0, cy = cam ? cam.y : 0;
      // dauphins : le banc tourne en rond ; chacun bondit de temps en temps hors de l'eau
      for (const pd of pods) {
        if (cam && Math.hypot(pd.cx - cx, pd.cz - cz) > NEAR + pd.r) continue;
        pd.a += (pd.dir * pd.sp * dt) / pd.r;
        const hx = pd.cx + Math.cos(pd.a) * pd.r, hz = pd.cz + Math.sin(pd.a) * pd.r;
        const tx = -Math.sin(pd.a) * pd.dir, tz = Math.cos(pd.a) * pd.dir, yaw = Math.atan2(-tx, -tz);
        for (const d of pd.members) {
          const x = hx + tx * d.oz - tz * d.ox, z = hz + tz * d.oz + tx * d.ox;
          let y = -0.22 + Math.sin(t * 2 + d.ph) * 0.18, pitch = Math.cos(t * 2 + d.ph) * 0.15;
          if (d.jt < 0 && (d.jump -= dt) <= 0) { d.jt = 0; d.jump = 2 + Math.random() * 6; }
          if (d.jt >= 0) {
            d.jt += dt;
            const T = 1.3, u = d.jt / T;
            y = -0.4 + 4 * u * (1 - u) * 3.4; pitch = (0.5 - u) * 1.6;
            if (d.jt < dt * 1.5 || (u >= 1 && d.jt - dt < T)) {
              for (let k = 0; k < 10; k++) splash.emit(_p.set(x, 0.2, z), _v.set((Math.random() - 0.5) * 4, 3 + Math.random() * 4, (Math.random() - 0.5) * 4), 0.7, 0.25 + Math.random() * 0.25, 0xffffff, 0, 12);
            }
            if (u >= 1) d.jt = -1;
          }
          d.m.position.set(x, y, z);
          d.m.rotation.set(pitch, yaw, 0, 'YXZ');
        }
      }
      // baleines : nagent en surface en soufflant, puis sondent en montrant la queue
      for (const w of whales) {
        if (cam && Math.hypot(w.cx - cx, w.cz - cz) > NEAR * 1.5 + w.r) continue;
        w.a += (w.dir * 2.6 * dt) / w.r; w.t += dt;
        const x = w.cx + Math.cos(w.a) * w.r, z = w.cz + Math.sin(w.a) * w.r;
        const tx = -Math.sin(w.a) * w.dir, tz = Math.cos(w.a) * w.dir, yaw = Math.atan2(-tx, -tz);
        const cyc = w.t % 75; // 0-40 s en surface, 40-48 s plongée, puis sous l'eau
        let y = -1.4, pitch = 0;
        w.fluke.visible = false;
        if (cyc < 40) {
          y = -1.4 + Math.sin(w.t * 0.5) * 0.25;
          if ((w.blow -= dt) <= 0) { // souffle
            w.blow = 7 + Math.random() * 4;
            for (let k = 0; k < 40; k++) spray.emit(_p.set(x - tx * 6, 2, z - tz * 6), _v.set((Math.random() - 0.5) * 2, 9 + Math.random() * 6, (Math.random() - 0.5) * 2), 1.6 + Math.random(), 0.6 + Math.random() * 0.7, 0xf4f8fb, 1.2, 4);
          }
        } else if (cyc < 48) {
          const u = (cyc - 40) / 8;
          y = -1.4 - u * 14; pitch = -0.35 * Math.sin(u * Math.PI);
          // la queue se dresse hors de l'eau, puis s'enfonce
          w.fluke.visible = true;
          const fy = -2 + Math.sin(u * Math.PI) * 4.5;
          w.fluke.position.set(x - tx * 14, fy, z - tz * 14);
          w.fluke.rotation.set(-0.3 * (1 - u), yaw, 0, 'YXZ');
          if (Math.abs(u - 0.9) < dt / 8) for (let k = 0; k < 30; k++) splash.emit(_p.set(x - tx * 14, 0.3, z - tz * 14), _v.set((Math.random() - 0.5) * 6, 4 + Math.random() * 6, (Math.random() - 0.5) * 6), 1, 0.4 + Math.random() * 0.4, 0xffffff, 0, 12);
        } else y = -18;
        w.body.visible = y > -14;
        w.body.position.set(x, y, z);
        w.body.rotation.set(pitch, yaw, 0, 'YXZ');
      }
      // cerfs : broutent ; si un appareil passe bas et tout près, la harde s'enfuit en bondissant
      for (const h of herds) {
        if (cam && Math.hypot(h.x - cx, h.z - cz) > NEAR) continue;
        const scare = cam && Math.hypot(h.x - cx, h.z - cz) < 160 && cy - heightAt(h.x, h.z) < 90;
        for (const d of h.animals) {
          if (scare && d.run <= 0) {
            d.run = 5 + Math.random() * 2;
            const away = Math.atan2(d.x - cx, d.z - cz) + (Math.random() - 0.5) * 0.6;
            d.tx = d.x + Math.sin(away) * 120; d.tz = d.z + Math.cos(away) * 120;
          }
          if (d.run > 0) d.run -= dt;
          else if (d.wait > 0) { d.wait -= dt; continue; }
          const dx = d.tx - d.x, dz = d.tz - d.z, dist = Math.hypot(dx, dz);
          if (dist < 0.6 && d.run <= 0) {
            d.wait = 3 + Math.random() * 10;
            const a = Math.random() * 6.28, r = Math.random() * h.R;
            if (meadow(h.x + Math.cos(a) * r, h.z + Math.sin(a) * r)) { d.tx = h.x + Math.cos(a) * r; d.tz = h.z + Math.sin(a) * r; }
            continue;
          }
          const want = Math.atan2(-dx, -dz);
          let dy = want - d.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          d.yaw += clamp(dy, -dt * 3, dt * 3);
          const sp = d.run > 0 ? 11 : 0.9;
          if (Math.abs(dy) < 0.8 && dist > 0.3) {
            const st = Math.min(dist, sp * dt), nx = d.x + (dx / dist) * st, nz = d.z + (dz / dist) * st;
            if (heightAt(nx, nz) > 3) { d.x = nx; d.z = nz; } else d.run = 0;
          }
          if (d.run > 0) d.ph += dt * 9;
          placeDeer(d);
        }
        // la harde se reforme là où elle s'est arrêtée
        if (h.animals.every((d) => d.run <= 0) && scare === false) {
          h.x += (h.animals[0].x - h.x) * Math.min(1, dt * 0.2); h.z += (h.animals[0].z - h.z) * Math.min(1, dt * 0.2);
        }
      }
      splash.update(dt); spray.update(dt);
    },
  };
}
