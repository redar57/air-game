import * as THREE from 'three';
import { heightAt, normalAt, flatInfo, LAKE, BIG, HALF } from './terrain.js';
import { city, cityPort, fishPort } from './places.js';
import { runways, launchSite } from './airfields.js';
import { country, occupied } from './country.js';
import { kit } from './ports.js';
import { palms } from './islets.js';
import { People } from './people.js';
import { mergeColored, xform, mulberry32 } from '../util.js';

// Plages (parasols, serviettes, baigneurs, postes de secours, surfeurs sur leurs vagues), voiliers légers et planches à
// voile au large des plages et sur le lac, promeneurs dans les villages et sur les chemins.

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _c = new THREE.Color(), _n = new THREE.Vector3();
const COLORS = [0xd8312b, 0x2f7fdc, 0xffd34d, 0x2fae7a, 0xf08a2c, 0x8e5cc9, 0xfbfbf8, 0xe0457b];
const tri = (...v) => new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(v, 3));

/** Dériveur (proue -Z), planche à voile, canoë : le blanc prend la couleur de l'instance. */
function craftGeo(kind) {
  const man = (x, y, z, rx = 0, rz = 0) => [{ geo: new THREE.BoxGeometry(0.42, 1.1, 0.35), color: 0x3a3f45, matrix: xform(x, y, z, 0, 1, 1, 1, rx, rz) }, { geo: new THREE.BoxGeometry(0.28, 0.3, 0.28), color: 0xc98f70, matrix: xform(x - Math.sin(rz) * 0.75, y + 0.75 * Math.cos(rz), z) }];
  if (kind === 'dinghy') return mergeColored([
    { geo: new THREE.CylinderGeometry(0.85, 0.5, 4.6, 6, 1).rotateX(Math.PI / 2).scale(1, 0.55, 1), color: 0xffffff, matrix: xform(0, 0.2, 0.2) }, { geo: new THREE.ConeGeometry(0.5, 1.5, 6).rotateX(-Math.PI / 2).scale(1, 0.9, 1), color: 0xffffff, matrix: xform(0, 0.2, -2.8) },
    { geo: new THREE.CylinderGeometry(0.05, 0.06, 7, 5), color: 0x9a9fa4, matrix: xform(0, 3.7, -0.8) }, { geo: tri(0, 1, -0.7, 0, 7, -0.8, 0, 1, 2.2), color: 0xffffff, matrix: xform() }, { geo: tri(0, 0.8, -1, 0, 5.4, -0.9, 0, 0.8, -3.1), color: 0xf4f4ee, matrix: xform() }, { geo: new THREE.BoxGeometry(0.08, 0.08, 3), color: 0x9a9fa4, matrix: xform(0, 0.95, 0.7) },
    ...man(0.75, 0.9, 0.9, 0, -0.35),
  ]);
  if (kind === 'windsurf') return mergeColored([
    { geo: new THREE.BoxGeometry(0.7, 0.16, 3.2), color: 0xf4f4ee, matrix: xform(0, 0.1, 0) }, { geo: tri(0.05, 0.3, -0.4, 0.5, 4.6, 0.1, 0.1, 1, 2, 0.5, 4.6, 0.1, 0.9, 3.2, 1.7, 0.1, 1, 2), color: 0xffffff, matrix: xform() },
    { geo: new THREE.CylinderGeometry(0.03, 0.04, 4.5, 4), color: 0x9a9fa4, matrix: xform(0.27, 2.4, -0.15, 0, 1, 1, 1, 0.11, -0.1) }, ...man(-0.75, 1, 0.5, 0, 0.4),
  ]);
  return mergeColored([{ geo: new THREE.ConeGeometry(0.45, 2.4, 6).rotateX(-Math.PI / 2).scale(1, 0.6, 1), color: 0xffffff, matrix: xform(0, 0.15, -1.2) }, { geo: new THREE.ConeGeometry(0.45, 2.4, 6).rotateX(Math.PI / 2).scale(1, 0.6, 1), color: 0xffffff, matrix: xform(0, 0.15, 1.2) }, ...man(0, 0.75, 0.2), { geo: new THREE.BoxGeometry(2.4, 0.06, 0.06), color: 0x8a5a33, matrix: xform(0, 1, -0.3, 0.3, 1, 1, 1, 0, 0.4) }]);
}

/** Flotte de petites voiles : chacune décrit une boucle ondulante autour de son mouillage. */
class Sails {
  constructor(scene, kind, list) {
    this.list = list; this.kind = kind;
    this.im = new THREE.InstancedMesh(craftGeo(kind), lam({ side: THREE.DoubleSide }), Math.max(1, list.length));
    this.im.count = list.length; this.im.frustumCulled = false; this.im.castShadow = true;
    list.forEach((b, i) => this.im.setColorAt(i, _c.setHex(COLORS[(i * 3 + 1) % COLORS.length])));
    scene.add(this.im);
  }
  at(b, th) { const r = 1 + 0.18 * Math.sin(th * 3 + b.ph); return [b.x + Math.cos(th) * b.rx * r, b.z + Math.sin(th) * b.rz * r]; }
  update(t) {
    this.list.forEach((b, i) => {
      const th = b.ph + (t * b.v) / Math.max(b.rx, b.rz), d = Math.sign(b.v) * 0.04, [x, z] = this.at(b, th), [u, w] = this.at(b, th + d);
      const yaw = Math.atan2(x - u, z - w), k = this.kind === 'canoe' ? 0 : this.kind === 'windsurf' ? 0.1 : 0.16;
      _q.setFromEuler(_e.set(Math.sin(t * 1.3 + i) * 0.03, yaw, k + Math.sin(t * 0.9 + i * 2) * 0.06));
      b.px = x; b.pz = z;
      this.im.setMatrixAt(i, _m.compose(_p.set(x, 0.05 + Math.sin(t * 1.2 + i) * 0.12, z), _q, _s.setScalar(1.25)));
    });
    this.im.instanceMatrix.needsUpdate = true;
  }
}

export function buildBeaches(scene, villages) {
  const rnd = mulberry32(1515), beaches = [], crowds = [], k = kit(), palmList = [], surf = [];
  // --- recherche des plages : sable presque plat au bord de l'eau, loin des pistes, des ports et des falaises
  const want = BIG ? 16 : 7, span = HALF * 1.7, bad = [...runways, launchSite, ...(city.active ? [cityPort, fishPort] : [])];
  for (let n = 0; n < 200000 && beaches.length < want; n++) {
    const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span, h = heightAt(x, z);
    if (h < 1.2 || h > 2.6 || normalAt(x, z, _n).y < 0.97 || flatInfo(x, z).w > 0 || occupied(x, z)) continue;
    if (bad.some((r) => Math.hypot(r.x - x, r.z - z) < (r === launchSite ? 900 : 520)) || beaches.some((b) => Math.hypot(b.x - x, b.z - z) < (BIG ? 1300 : 900))) continue;
    let dx = heightAt(x + 12, z) - heightAt(x - 12, z), dz = heightAt(x, z + 12) - heightAt(x, z - 12); const l = Math.hypot(dx, dz); if (l < 0.5) continue;
    dx /= -l; dz /= -l; // vers la mer
    if (heightAt(x + dx * 60, z + dz * 60) > -2 || heightAt(x + dx * 320, z + dz * 320) > -12 || heightAt(x - dx * 40, z - dz * 40) > 16) continue;
    if (country.rail && country.rail.pts.some((r) => Math.abs(r.x - x) < 170 && Math.abs(r.z - z) < 170)) continue;
    let sand = 0; // assez de sable sur 200 m de rivage
    for (let a = -100; a <= 100; a += 10) for (let o = -35; o <= 10; o += 5) { const h = heightAt(x - dz * a + dx * o, z + dx * a + dz * o); if (h > 0.7 && h < 4.2) sand++; }
    if (sand < 95) continue;
    beaches.push({ x, z, dx, dz, yaw: Math.atan2(-dx, -dz) });
  }
  const sails = { dinghy: [], windsurf: [], canoe: [] };
  for (const b of beaches) {
    const list = [], tx = -b.dz, tz = b.dx, pts = [];
    // points de sable de part et d'autre, sur 200 m de rivage
    for (let i = 0; i < 260; i++) {
      const a = (rnd() - 0.5) * 220, o = (rnd() - 0.6) * 50, x = b.x + tx * a + b.dx * o, z = b.z + tz * a + b.dz * o, h = heightAt(x, z);
      if (h < 0.7 || h > 4.2 || occupied(x, z) || pts.some((p) => Math.hypot(p.x - x, p.z - z) < 5)) continue;
      pts.push({ x, z, h });
    }
    pts.forEach((p, i) => {
      const c = COLORS[Math.floor(rnd() * COLORS.length)], y = p.h;
      if (i < 24) { // parasol, serviettes, baigneurs
        k.C(0.05, 0.05, 2.4, 0xf4f4ee, p.x, y + 1.2, p.z, 4);
        for (let q = 0; q < 6; q++) k.parts.push({ geo: new THREE.ConeGeometry(1.7, 0.8, 1, 1, true, q * 1.0472, 1.0472), color: q % 2 ? c : 0xfbfbf8, matrix: xform(p.x, y + 2.5, p.z) });
        for (let q = 0; q < 1 + (i % 2); q++) { const x = p.x + 1.7 * Math.cos(q * 2.6 + i), z = p.z + 1.7 * Math.sin(q * 2.6 + i), ry = rnd() * 6; k.B(0.9, 0.08, 2, COLORS[(i + q * 3) % COLORS.length], x, heightAt(x, z) + 0.08, z, ry); if (rnd() < 0.75) list.push({ x, z, yaw: ry, lie: true }); }
      } else if (i < 40) list.push(rnd() < 0.6 ? { loop: [0, 1, 2, 3].map((q) => ({ x: p.x + tx * Math.sin(q * 1.57) * 14, z: p.z + tz * Math.sin(q * 1.57) * 14 })) } : { x: p.x, z: p.z, yaw: rnd() * 6 });
      else if (i < 46) palmList.push([p.x - b.dx * 16, p.z - b.dz * 16, 0.8 + rnd() * 0.5]);
      else if (i < 50) { k.B(0.6, 2.4, 0.12, c, p.x, y + 1.2, p.z, rnd() * 3); k.parts.push({ geo: new THREE.ConeGeometry(0.3, 0.6, 4), color: c, matrix: xform(p.x, y + 2.7, p.z, 0.78, 1, 1, 0.3) }); }
      else if (i === 50) { // poste de secours
        for (const [u, v] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) k.B(0.2, 3, 0.2, 0xf4f4ee, p.x + u, y + 1.5, p.z + v); k.B(2.6, 0.2, 2.6, 0xf4f4ee, p.x, y + 3, p.z); k.B(2, 1.8, 0.2, 0xd8312b, p.x - b.dx, y + 4, p.z - b.dz, b.yaw); k.C(0.06, 0.06, 4, 0xd9dcdf, p.x + 1.2, y + 5, p.z, 4); k.B(1.2, 0.8, 0.05, 0x2fae7a, p.x + 1.8, y + 6.6, p.z);
      } else if (i === 51) { const x = p.x - b.dx * 10, z = p.z - b.dz * 10, yy = heightAt(x, z); k.B(6, 3, 4, 0xfbfbf8, x, yy + 1.5, z, b.yaw); for (let q = -2; q <= 2; q++) k.B(1.2, 0.25, 5.4, q % 2 ? 0xfbfbf8 : 0x2f7fdc, x + q * 1.2 * Math.cos(b.yaw), yy + 3.2, z - q * 1.2 * Math.sin(b.yaw), b.yaw, 0.12); }
    });
    for (let i = 0; i < 10; i++) { // baigneurs dans l'eau
      const a = (rnd() - 0.5) * 160; for (let o = 0; o < 70; o += 4) { const x = b.x + tx * a + b.dx * o, z = b.z + tz * a + b.dz * o, h = heightAt(x, z); if (h < -0.8) { list.push({ x, z, yaw: rnd() * 6, up: -1.15 - h * 0 }); break; } }
    }
    if (list.length) crowds.push(new People(scene, list, (x, z) => Math.max(heightAt(x, z), 0), 100 + crowds.length));
    // vagues et surfeurs
    for (let i = 0; i < 3; i++) surf.push({ b, tx, tz, off: (i - 1) * 46 + (rnd() - 0.5) * 12, T: 15 + rnd() * 4, ph: rnd() * 15, dir: rnd() < 0.5 ? 1 : -1 });
    // voiles au large
    for (let i = 0; i < 5; i++) {
      const o = 190 + rnd() * 240, a = (rnd() - 0.5) * 320, x = b.x + b.dx * o + tx * a, z = b.z + b.dz * o + tz * a, R = 45 + rnd() * 50;
      if ([0, 1, 2, 3, 4, 5, 6, 7].some((q) => heightAt(x + Math.cos(q * 0.785) * R * 1.25, z + Math.sin(q * 0.785) * R * 1.25) > -3)) continue;
      sails[i % 2 ? 'windsurf' : 'dinghy'].push({ x, z, rx: R, rz: R * (0.5 + rnd() * 0.5), v: (rnd() < 0.5 ? -1 : 1) * (2 + rnd() * 1.5), ph: rnd() * 6 });
    }
  }
  // --- le lac : dériveurs, planches à voile et canoës, plus un ponton de club nautique
  if (BIG) {
    for (const [kind, N, R] of [['dinghy', 8, 0.34], ['windsurf', 8, 0.4], ['canoe', 4, 0.42]]) {
      for (let t = 0, n = 0; n < N && t < 400; t++) {
        const a = rnd() * 6.283, f = Math.sqrt(rnd()) * 0.52, x = LAKE.x + Math.cos(a) * LAKE.rx * f, z = LAKE.z + Math.sin(a) * LAKE.rz * f, r = kind === 'canoe' ? 40 : 60 + rnd() * 90;
        if ([0, 1, 2, 3, 4, 5, 6, 7].some((q) => heightAt(x + Math.cos(q * 0.785) * r * 1.25, z + Math.sin(q * 0.785) * r * 1.25) > -2)) continue;
        sails[kind].push({ x, z, rx: r, rz: r * (0.5 + rnd() * 0.5), v: (rnd() < 0.5 ? -1 : 1) * (kind === 'canoe' ? 1.2 : 2.2 + rnd() * 1.6), ph: rnd() * 6 }); n++;
      }
    }
    // club nautique sur la rive la plus douce
    let best = null;
    for (let a = 0; a < 6.28; a += 0.05) {
      let r = 300; while (r < 1600 && heightAt(LAKE.x + Math.cos(a) * r, LAKE.z + Math.sin(a) * r) < 1.5) r += 5;
      const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r, up = heightAt(x + Math.cos(a) * 40, z + Math.sin(a) * 40);
      if (!occupied(x, z) && heightAt(x - Math.cos(a) * 70, z - Math.sin(a) * 70) < -2 && (!best || up < best.up)) best = { a, x, z, up };
    }
    if (best) {
      const { a, x, z } = best, ux = Math.cos(a), uz = Math.sin(a), ry = Math.PI / 2 - a, gx = x + ux * 14, gz = z + uz * 14, y = heightAt(gx, gz);
      k.B(14, 5, 8, 0xfbf7ef, gx, y + 2, gz, ry); k.B(15.4, 0.5, 9.4, 0x2f7fdc, gx, y + 4.8, gz, ry); k.B(14.2, 1.6, 8.2, 0x3a5a70, gx, y + 2.8, gz, ry);
      k.B(3, 0.4, 60, 0x9a7650, x - ux * 28, 1, z - uz * 28, ry); for (let o = 6; o < 58; o += 9) for (const s of [-1.4, 1.4]) k.C(0.2, 0.25, 7, 0x6b4e33, x - ux * o - uz * s, -1.2, z - uz * o + ux * s, 5);
      const list = [];
      for (let i = 0; i < 8; i++) { const o = 4 + rnd() * 8, s = 10 + i * 2.4, X = x + ux * o - uz * s, Z = z + uz * o + ux * s, c = COLORS[i % 8]; k.B(0.9, 0.5, 4.4, c, X, heightAt(X, Z) + 0.4, Z, ry); if (i < 3) list.push({ x: X + 2, z: Z, yaw: i }); }
      list.push({ loop: [{ x: x + ux * 6, z: z + uz * 6 }, { x: x - ux * 54, z: z - uz * 54 }, { x: x - ux * 54 + 0.8, z: z - uz * 54 }, { x: x + ux * 6 + 0.8, z: z + uz * 6 }] });
      crowds.push(new People(scene, list, (X, Z) => Math.max(heightAt(X, Z), 1.2), 77));
      [-5, 5].forEach((s, i) => sails.dinghy.push({ x: x - ux * 46 - uz * s, z: z - uz * 46 + ux * s, rx: 0.4, rz: 0.4, v: 0.02, ph: i }));
    }
  }
  if (k.parts.length) scene.add(k.mesh());
  if (palmList.length) palms(scene, palmList);
  const fleets = Object.entries(sails).filter(([, l]) => l.length).map(([kind, l]) => new Sails(scene, kind, l));

  // vague : un rouleau blanc et bleu qui avance vers le rivage, avec son surfeur
  const wg = new THREE.BufferGeometry(), v = [], N = 10;
  const prof = [[-5, 0], [-1.5, 0.9], [0, 1.5], [1.1, 1.3], [1.5, 0]]; // z vers l'arrière (large) négatif -> déferle vers +z
  const cols = [], wc = [0x4f9fd8, 0x6fb8e6, 0xeaf6fb, 0xffffff];
  for (let i = 0; i < N; i++) for (let j = 0; j < prof.length - 1; j++) {
    const P = (q, o) => { const u = q / N, f = Math.sin(u * Math.PI); return [(u - 0.5) * 40, prof[o][1] * f, prof[o][0] * (0.4 + 0.6 * f)]; };
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    v.push(...a, ...c, ...b, ...a, ...d, ...c); _c.setHex(wc[j]); for (let q = 0; q < 6; q++) cols.push(_c.r, _c.g, _c.b);
  }
  wg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3)); wg.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); wg.computeVertexNormals();
  const waves = new THREE.InstancedMesh(wg, lam({ side: THREE.DoubleSide }), Math.max(1, surf.length));
  const sg = mergeColored([{ geo: new THREE.BoxGeometry(0.6, 0.12, 2.3), color: 0xffffff, matrix: xform(0, 0.06, 0) }, { geo: new THREE.BoxGeometry(0.4, 0.7, 0.34), color: 0x2b2e33, matrix: xform(0, 0.5, 0.1, 0, 1, 1, 1, 0.3) }, { geo: new THREE.BoxGeometry(0.42, 0.7, 0.32), color: 0x2b2e33, matrix: xform(0, 1.05, -0.05, 0, 1, 1, 1, -0.3) }, { geo: new THREE.BoxGeometry(0.28, 0.3, 0.28), color: 0xc98f70, matrix: xform(0, 1.55, -0.12) }, { geo: new THREE.BoxGeometry(1.9, 0.14, 0.14), color: 0xc98f70, matrix: xform(0, 1.25, -0.1, 0.5) }]);
  const riders = new THREE.InstancedMesh(sg, lam(), Math.max(1, surf.length));
  surf.forEach((s, i) => riders.setColorAt(i, _c.setHex(COLORS[i % COLORS.length])));
  for (const m of [waves, riders]) { m.frustumCulled = false; m.count = surf.length; scene.add(m); }

  // --- promeneurs : autour des maisons des villages et sur les chemins
  for (const vl of villages) {
    const list = [];
    (vl.houses || []).forEach((h, i) => {
      if (i % 2) return;
      const c = Math.cos(h.ry), s = Math.sin(h.ry), a = h.w / 2 + 3, b = h.d / 2 + 3;
      list.push({ loop: [[-a, -b], [a, -b], [a, b], [-a, b]].map(([u, w]) => ({ x: h.x + u * c + w * s, z: h.z - u * s + w * c })) });
    });
    if (list.length) crowds.push(new People(scene, list, heightAt, 300 + crowds.length));
  }
  for (const path of country.roads.filter((r) => !r.paved).slice(0, 6)) { // randonneurs
    const list = [];
    for (let i = 0; i < 4; i++) {
      const a = Math.floor(rnd() * Math.max(1, path.length - 30)), seg = [];
      for (let q = a; q < Math.min(path.length, a + 24); q += 2) seg.push({ x: path[q].x + 2.5, z: path[q].z });
      if (seg.length > 3) list.push({ loop: [...seg, ...seg.slice(1, -1).reverse()] });
    }
    if (list.length) crowds.push(new People(scene, list, (x, z) => heightAt(x, z) + 0.2, 400 + crowds.length));
  }

  return {
    beaches, fleets, crowds,
    update(dt, t, cam) {
      for (const c of crowds) c.update(dt, t, cam);
      for (const f of fleets) f.update(t);
      surf.forEach((s, i) => {
        const { b } = s; let o = 0;
        const u = ((t + s.ph) % s.T) / s.T, f = Math.min(1, u * 5) * Math.min(1, (1 - u) * 6);
        o = 115 - u * 85;
        const x = b.x + b.dx * o + s.tx * s.off, z = b.z + b.dz * o + s.tz * s.off;
        _q.setFromEuler(_e.set(0, b.yaw, 0));
        waves.setMatrixAt(i, _m.compose(_p.set(x, -0.1, z), _q, _s.set(1, Math.max(0.01, f), 1)));
        const side = s.dir * (u - 0.4) * 16, up = f * 1.0;
        _q.setFromEuler(_e.set(0.1, b.yaw + Math.PI + s.dir * 0.8, s.dir * 0.25));
        riders.setMatrixAt(i, _m.compose(_p.set(x + s.tx * side - b.dx * 0.6, up, z + s.tz * side - b.dz * 0.6), _q, _s.setScalar(1.1)));
      });
      waves.instanceMatrix.needsUpdate = riders.instanceMatrix.needsUpdate = true;
    },
  };
}
