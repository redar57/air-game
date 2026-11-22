import * as THREE from 'three';
import { heightAt, normalAt, canyonDist, MTN, BIG } from './terrain.js';
import { runways, lightsPoints, spinners } from './airfields.js';
import { keepOut, peaks } from './places.js';
import { addBox, addCylinder, addMoving } from './colliders.js';
import { addDeck } from './decks.js';
import { thermals } from './thermals.js';
import { kit, prism } from './ports.js';
import { People } from './people.js';
import { mergeColored, xform, mulberry32, toWorld, lerp, smoothstep } from '../util.js';

// Montagne : station de ski (pistes, skieurs, chalets, téléphérique) et rampe d'envol du vol libre.
// Les emplacements sont cherchés dans le relief (toujours les mêmes pour une carte donnée).

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _n = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), _w = { x: 0, z: 0 };
const farFrom = (x, z, d) => runways.every((r) => Math.hypot(r.x - x, r.z - z) > d);

export function planMountain() {
  const R = BIG ? 4200 : 2300;
  let best = null, L = 0;
  // du plus exigeant au plus tolérant : [altitude mini du sommet, station entre, et, longueur, contre-pente, pente maxi, sol de la station]
  const tries = [...(BIG ? [] : [[520, 240, 420, 1000, -0.12, 0.75, 0.86]]), [520, 150, 400, 900, -0.25, 1.2, 0.75], [380, 100, 330, 800, -0.3, 1.3, 0.7]];
  for (const [top, lo, hi, len, smin, smax, flat] of tries) {
   if (best) break;
   L = len;
   for (let x = MTN.x - R; x <= MTN.x + R; x += 70) for (let z = MTN.z - R; z <= MTN.z + R; z += 70) {
    const h = heightAt(x, z);
    if (h < top || canyonDist(x, z) < 330) continue;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * 6.2832, dx = Math.cos(a), dz = Math.sin(a), he = heightAt(x + dx * L, z + dz * L);
      if (he < lo || he > hi) continue;
      let cost = 0, prev = h, ok = true;
      for (let d = 50; d <= L; d += 50) {
        const g = heightAt(x + dx * d, z + dz * d), s = (prev - g) / 50, ideal = (h - he) / L;
        if (s < smin || s > smax || canyonDist(x + dx * d, z + dz * d) < 310) { ok = false; break; }
        cost += (s - ideal) ** 2; prev = g;
      }
      if (!ok || normalAt(x + dx * L, z + dz * L, _n).y < flat || !farFrom(x + dx * L, z + dz * L, 700) || !farFrom(x + dx * L * 0.5, z + dz * L * 0.5, 500)) continue;
      cost -= (h - he) / 2500;
      if (!best || cost < best.cost) best = { cost, x, z, dx, dz, L, h, he };
    }
   }
  }
  if (best) {
    const b = best, bx = b.x + b.dx * L, bz = b.z + b.dz * L;
    peaks.ski = { ...b, name: 'Station de ski', bx, bz, tx: b.x, tz: b.z, x: bx, z: bz };
    keepOut.push((x, z) => { const s = (x - b.x) * b.dx + (z - b.z) * b.dz, v = -(x - b.x) * b.dz + (z - b.z) * b.dx; return (s > -40 && s < L + 40 && v > -70 && v < 110) || Math.hypot(x - bx, z - bz) < 150; });
  }
  // rampe de vol libre : forte pente juste devant, vallée dégagée loin dessous
  let r = null;
  for (let x = MTN.x - R; x <= MTN.x + R; x += 50) for (let z = MTN.z - R; z <= MTN.z + R; z += 50) {
    const h = heightAt(x, z);
    if (h < 300 || h > 560 || canyonDist(x, z) < 420 || !farFrom(x, z, 900)) continue;
    if (best) {
      const s = (x - best.x) * best.dx + (z - best.z) * best.dz, v = -(x - best.x) * best.dz + (z - best.z) * best.dx;
      if (Math.abs(v) < 250 && s > -200 && s < L + 300) continue;
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * 6.2832, dx = Math.cos(a), dz = Math.sin(a), g = (d) => h - heightAt(x + dx * d, z + dz * d);
      if (g(25) < 5 || g(60) < 20 || g(150) < 55 || g(-14) > 3 || g(-14) < -9) continue;
      let clear = true;
      for (let d = 200; d <= 1800; d += 100) if (g(d) < 70 + d * 0.03) { clear = false; break; }
      if (!clear) continue;
      // replat derrière la rampe, pour la cabane, les ailes et les pilotes
      let bump = 0;
      for (const [b, v] of [[-12, 0], [-12, 14], [-12, -14], [-24, 0], [-22, 13], [-22, -13]]) bump += Math.abs(h - heightAt(x + dx * b - dz * v, z + dz * b + dx * v));
      const score = -bump * 1.6 + Math.min(g(60), 45) + Math.min(g(400), 190) * 0.4 + Math.min(g(1500), 320) * 0.2;
      if (!r || score > r.score) r = { score, x, z, dx, dz, h };
    }
  }
  if (r) {
    const yaw = Math.atan2(-r.dx, -r.dz), y = Math.max(heightAt(r.x - r.dx * 9, r.z - r.dz * 9), heightAt(r.x, r.z)) + 1;
    peaks.ramp = { name: 'Rampe de vol libre', x: r.x, z: r.z, yaw, y, alt: y, length: 20 };
    addDeck({ x: r.x, z: r.z, yaw, y, hw: 6, hl: 10, kind: 'deck', name: 'Rampe de vol libre' });
    keepOut.push((x, z) => { const s = (x - r.x) * r.dx + (z - r.z) * r.dz, v = Math.abs(-(x - r.x) * r.dz + (z - r.z) * r.dx); return s > -70 && s < 260 && v < 40 + s * 0.25; });
  }
}
/** Une ascendance devant la rampe, pour tenir l'air dès le départ (après defineThermals, avant ses nuages). */
export function rampThermal() {
  const r = peaks.ramp;
  if (!r) return;
  toWorld(r, 120, -420, _w);
  thermals.push({ x: _w.x, z: _w.z, r: 290, w: 3.4, base: heightAt(_w.x, _w.z), top: r.y + 850 });
}

export function buildMountain(scene) {
  const ticks = [], S = peaks.ski;
  if (S) {
    const rnd = mulberry32(1968), { dx, dz, L } = S, lx = -dz, lz = dx; // l : en travers de la pente
    const at = (s, v) => { const x = S.tx + dx * s + lx * v, z = S.tz + dz * s + lz * v; return [x, heightAt(x, z), z]; };
    const top = (x, z) => Math.max(heightAt(x, z), heightAt(x + 5, z), heightAt(x - 5, z), heightAt(x, z + 5), heightAt(x, z - 5));
    const snow = (pos, color, k) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals(); const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -k, polygonOffsetUnits: -2 * k })); m.receiveShadow = true; scene.add(m); };
    { // champ de neige autour de la station, aux bords irréguliers
      const pos = [], A = 72, RR = 18, P = (i, j) => { const a = (i / A) * 6.2832, e = (j / RR) * (185 + 34 * Math.sin(a * 3 + 1) + 22 * Math.sin(a * 7) + 14 * Math.sin(a * 13 + 2)), x = S.bx + Math.cos(a) * e, z = S.bz + Math.sin(a) * e; return [x, top(x, z) + (j === RR ? -0.6 : 0.35), z]; };
      for (let i = 0; i < A; i++) for (let j = 0; j < RR; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1); pos.push(...a, ...c, ...b, ...b, ...c, ...d); }
      snow(pos, 0xd6e0e8, 2);
    }
    // --- pistes : deux rubans de neige qui serpentent
    const runs = [[(s) => 26 * Math.sin(s / 150), 30, 0xdde6ee], [(s) => 62 + 20 * Math.sin(s / 110 + 1) - 62 * smoothstep(L * 0.8, L, s), 20, 0xd3dee8]];
    for (const [f, W, color] of runs) {
      const pos = [], N = Math.round(L / 7), M = 10;
      const P = (i, j) => { const s = (i / N) * L, w = W * (0.8 + 0.25 * Math.sin(s / 70 + W)), e = (j / M) * 2 - 1, q = at(s, f(s) + e * w); return [q[0], top(q[0], q[2]) + 0.6 - 0.9 * e ** 6, q[2]]; };
      for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) { const a = P(i, j), b = P(i + 1, j), c = P(i, j + 1), d = P(i + 1, j + 1); pos.push(...a, ...b, ...c, ...b, ...d, ...c); }
      snow(pos, color, 3);
    }
    // --- skieurs : descendent en virages, repartent du sommet
    const sk = mergeColored([{ geo: new THREE.BoxGeometry(0.5, 0.75, 0.32), color: 0xffffff, matrix: xform(0, 1.0, 0) }, { geo: new THREE.BoxGeometry(0.44, 0.7, 0.3), color: 0x2b3440, matrix: xform(0, 0.4, 0) }, { geo: new THREE.BoxGeometry(0.32, 0.34, 0.32), color: 0xffffff, matrix: xform(0, 1.55, 0) }, { geo: new THREE.BoxGeometry(0.12, 0.06, 1.9), color: 0xd8312b, matrix: xform(-0.16, 0.04, 0) }, { geo: new THREE.BoxGeometry(0.12, 0.06, 1.9), color: 0xd8312b, matrix: xform(0.16, 0.04, 0) }]);
    const N = 34, im = new THREE.InstancedMesh(sk, lam(), N), list = [];
    im.frustumCulled = false; im.castShadow = true; scene.add(im);
    for (let i = 0; i < N; i++) { list.push({ run: rnd() < 0.65 ? 0 : 1, s: rnd() * L, v: 9 + rnd() * 7, ph: rnd() * 6, a: 6 + rnd() * 10 }); im.setColorAt(i, _c.setHex([0xd8312b, 0x2f5fa8, 0xf2c230, 0x2f8a5a, 0x8e5cc9, 0xf08a2c, 0x2ec4b6, 0xe0457b][i % 8])); }
    ticks.push((dt) => {
      list.forEach((o, i) => {
        o.s += o.v * dt; if (o.s > L - 6) o.s = 4;
        const f = runs[o.run][0], lat = (s) => f(s) + o.a * Math.sin(s / 17 + o.ph), p = at(o.s, lat(o.s)), q = at(o.s + 2, lat(o.s + 2));
        _e.set(Math.atan2(q[1] - p[1], Math.hypot(q[0] - p[0], q[2] - p[2])), Math.atan2(p[0] - q[0], p[2] - q[2]), 0.35 * Math.cos(o.s / 17 + o.ph));
        im.setMatrixAt(i, _m.compose(_p.set(p[0], top(p[0], p[2]) + 0.6, p[2]), _q.setFromEuler(_e), _s));
      });
      im.instanceMatrix.needsUpdate = true;
    });
    // --- station : chalets de bois à toits enneigés, hôtels
    const K = kit(), yawDown = Math.atan2(-dx, -dz), lights = [];
    const chalet = (x, z, w, d, h, ry) => {
      let lowest = Infinity, y = -Infinity;
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { const g = heightAt(x + a * w / 2, z + b * d / 2); lowest = Math.min(lowest, g); y = Math.max(y, g); }
      K.parts.push({ geo: new THREE.BoxGeometry(w, y - lowest + 3, d), color: 0xa39b8f, matrix: xform(x, (y + lowest) / 2 - 0.8, z, ry) }, { geo: new THREE.BoxGeometry(w, h, d), color: rnd() < 0.5 ? 0x9a6a3f : 0x83542f, matrix: xform(x, y + 0.7 + h / 2, z, ry) }, { geo: new THREE.BoxGeometry(w + 2, 0.4, 1.6), color: 0x6b4424, matrix: xform(x, y + h * 0.55, z, ry).multiply(xform(0, 0, -d / 2 - 0.6)) });
      K.parts.push({ geo: prism(d + 3, w + 4, h * 0.6), color: 0xf4f8fb, matrix: xform(x, y + 0.7 + h, z, ry + Math.PI / 2) });
      for (const s of [-1, 1]) K.parts.push({ geo: new THREE.BoxGeometry(1.6, 1.4, 0.2), color: 0xf2d28a, matrix: xform(x, y + 0.7 + h * 0.55, z, ry).multiply(xform(s * w * 0.24, 0, -d / 2 - 0.1)) });
      addBox(x, z, ry, w / 2, d / 2, lowest - 2, y + h * 1.5); lights.push(x, y + h * 0.7, z);
    };
    const spots = [];
    for (let n = 0; n < 600 && spots.length < 15; n++) {
      const a = rnd() * 6.283, d = 55 + rnd() * 110, x = S.bx + Math.cos(a) * d, z = S.bz + Math.sin(a) * d, s = (x - S.tx) * dx + (z - S.tz) * dz, v = (x - S.tx) * lx + (z - S.tz) * lz;
      if (normalAt(x, z, _n).y < 0.8 || (s < L && Math.abs(v - 10) < 70) || spots.some((q) => Math.hypot(q[0] - x, q[1] - z) < 27)) continue;
      spots.push([x, z]);
      const big = spots.length < 3;
      chalet(x, z, big ? 24 : 11 + rnd() * 3, big ? 15 : 10 + rnd() * 2, big ? 11 : 5.5, yawDown + (rnd() - 0.5) * 0.6);
    }
    // --- téléphérique : deux gares, pylônes, câbles, deux cabines qui se croisent
    const cv = -48, A = at(L + 8, cv), T = at(-8, cv), gA = A[1] + 9, gT = T[1] + 9, span = L + 16;
    for (const [q, y] of [[A, gA], [T, gT]]) {
      K.parts.push({ geo: new THREE.BoxGeometry(15, 20, 18), color: 0xb9bfc5, matrix: xform(q[0], y - 8, q[2], yawDown) }, { geo: new THREE.BoxGeometry(15.4, 5, 18.4), color: 0x2f4f66, matrix: xform(q[0], y + 0.5, q[2], yawDown) }, { geo: new THREE.BoxGeometry(18, 1.4, 21), color: 0xd8312b, matrix: xform(q[0], y + 4, q[2], yawDown) });
      addBox(q[0], q[2], yawDown, 7.5, 9, y - 20, y + 5); lights.push(q[0], y + 5.4, q[2]);
    }
    const nodes = [[0, gA]];
    for (const f of [0.25, 0.5, 0.75]) {
      const s = L + 8 - span * f, g = at(s, cv), y = Math.max(g[1] + 26, lerp(gA, gT, f) + 4);
      nodes.push([f, y]);
      K.parts.push({ geo: new THREE.CylinderGeometry(0.8, 2.2, y - g[1] + 4, 4), color: 0x8f979d, matrix: xform(g[0], (y + g[1]) / 2 - 1, g[2], yawDown) }, { geo: new THREE.BoxGeometry(11, 0.8, 1.2), color: 0x8f979d, matrix: xform(g[0], y + 0.8, g[2], yawDown) });
      addCylinder(g[0], g[2], 2.2, g[1] - 4, y + 2); lights.push(g[0], y + 2, g[2]);
    }
    nodes.push([1, gT]);
    const cable = (f) => { let k = 0; while (k < nodes.length - 2 && f > nodes[k + 1][0]) k++; const [f0, y0] = nodes[k], [f1, y1] = nodes[k + 1], t = (f - f0) / (f1 - f0); return lerp(y0, y1, t) - 28 * t * (1 - t); };
    const cpos = (f, o) => { const s = L + 8 - span * f, x = S.tx + dx * s + lx * (cv + o), z = S.tz + dz * s + lz * (cv + o); return [x, cable(f), z]; };
    for (const o of [-4, 4]) { const pts = []; for (let i = 0; i <= 80; i++) pts.push(new THREE.Vector3(...cpos(i / 80, o))); K.parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.14, 4), color: 0x2b2e33 }); }
    scene.add(K.mesh(), lightsPoints(lights, 0xffe2a0, 6));
    const cabG = mergeColored([{ geo: new THREE.BoxGeometry(3.4, 2.6, 5), color: 0xd8312b, matrix: xform(0, -5.2, 0) }, { geo: new THREE.BoxGeometry(3.5, 1.2, 4.6), color: 0x2f4f66, matrix: xform(0, -4.8, 0) }, { geo: new THREE.BoxGeometry(3.6, 0.3, 5.2), color: 0xf4f4ee, matrix: xform(0, -3.8, 0) }, { geo: new THREE.BoxGeometry(0.3, 3.8, 0.3), color: 0x8f979d, matrix: xform(0, -1.9, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.6, 2.4), color: 0x3a3f45, matrix: xform(0, 0, 0) }]);
    const cabs = [-4, 4].map((o) => { const m = new THREE.Mesh(cabG, lam()); m.castShadow = true; m.rotation.y = yawDown; scene.add(m); return { m, o, col: addMoving(1.8, 2.6, 0, 1) }; });
    let ct = 0;
    const RIDE = span / 8, STOP = 14;
    ticks.push((dt) => {
      ct = (ct + dt) % (2 * (RIDE + STOP));
      const half = ct % (RIDE + STOP), p = Math.min(1, half / RIDE), e = p * p * (3 - 2 * p), f0 = ct < RIDE + STOP ? e : 1 - e;
      cabs.forEach((c, i) => { const f = 0.012 + 0.976 * (i ? 1 - f0 : f0), q = cpos(f, c.o); c.m.position.set(...q); c.m.rotation.z = 0.04 * Math.sin(ct * 0.9 + i) * Math.min(1, 8 * p * (1 - p)); Object.assign(c.col, { x: q[0], z: q[2], yaw: yawDown, y0: q[1] - 6.6, y1: q[1] + 0.4 }); });
    });
    const people = [];
    for (let i = 0; i < 30; i++) { const a = rnd() * 6.283, d = 12 + rnd() * 40; people.push(i < 14 ? { x: S.bx + Math.cos(a) * d, z: S.bz + Math.sin(a) * d, yaw: rnd() * 6 } : { loop: [0, 1, 2, 3].map((q) => ({ x: S.bx + Math.cos(a) * d + Math.cos(q * 1.57) * 9, z: S.bz + Math.sin(a) * d + Math.sin(q * 1.57) * 9 })) }); }
    const folk = new People(scene, people, (x, z) => top(x, z) + 0.35, 12);
    let tt = 0;
    ticks.push((dt, cam) => { tt += dt; folk.update(dt, tt, cam); });
  }

  // ------------------------------------------------------------------ rampe de vol libre
  const R = peaks.ramp;
  if (R) {
    const K = kit(), G = new THREE.Group(); G.position.set(R.x, R.y, R.z); G.rotation.y = R.yaw; scene.add(G);
    const gnd = (x, z) => { toWorld(R, x, z, _w); return heightAt(_w.x, _w.z) - R.y; };
    for (let z = -9.5; z <= 9.5; z += 1) K.B(12, 0.3, 0.94, Math.floor(z) % 2 ? 0xb08a5a : 0xa07a4c, 0, -0.16, z);
    for (const x of [-5.4, 5.4]) for (const z of [-9, -3, 3, 9]) { const g = gnd(x, z) - 1.5; if (g < -0.6) K.C(0.22, 0.28, -g, 0x6b4a2e, x, g / 2 - 0.2, z, 6); }
    for (const x of [-5.9, 5.9]) { K.B(0.1, 0.1, 12, 0xf4f4ee, x, 1, 4); for (let z = -2; z <= 10; z += 3) K.B(0.12, 1.1, 0.12, 0xf4f4ee, x, 0.5, z); }
    K.B(11, 0.06, 0.8, 0xd8312b, 0, 0.03, -9.4); K.B(0.4, 0.06, 14, 0xf4f4ee, 0, 0.02, 1);
    // cabane, manche à air, ailes posées, bancs
    const cy = gnd(-14, 14);
    K.B(7, 3.4, 5.4, 0x9a6a3f, -14, cy + 1.7, 14); K.parts.push({ geo: prism(8.4, 7, 2.2), color: 0xb9472f, matrix: xform(-14, cy + 3.4, 14) });
    toWorld(R, -14, 14, _w); addBox(_w.x, _w.z, R.yaw, 3.5, 2.7, R.y + cy - 1, R.y + cy + 5.6);
    const my = gnd(11, 6); K.C(0.12, 0.16, 8, 0xd9dcdf, 11, my + 4, 6, 6);
    for (const [x, z, c] of [[12, 16, 0xd8312b], [17, 22, 0x2f5fa8]]) { const y = gnd(x, z) + 0.8; K.parts.push({ geo: new THREE.ConeGeometry(4.6, 2.6, 3).rotateX(-Math.PI / 2).scale(1, 0.06, 1), color: c, matrix: xform(x, y, z, 0.4, 1, 1, 1, 0.12) }); }
    const py = gnd(-12, 24); K.parts.push({ geo: new THREE.BoxGeometry(9, 0.5, 2.6), color: 0xf2c230, matrix: xform(-12, py + 0.4, 24, 0.5) });
    G.add(K.mesh());
    const sock = new THREE.Group(); sock.position.set(11, my + 7.8, 6);
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.42 - k * 0.07, 0.49 - k * 0.07, 0.8, 8, 1, true).rotateZ(Math.PI / 2), new THREE.MeshLambertMaterial({ color: k % 2 ? 0xf4f4ee : 0xf07a1e, side: THREE.DoubleSide })); m.position.x = 0.5 + k * 0.8; sock.add(m); }
    G.add(sock);
    spinners.push({ tick: (t) => { sock.rotation.y = 0.5 * Math.sin(t * 0.3); sock.rotation.z = -0.15 + 0.1 * Math.sin(t * 1.7); } });
    const list = [];
    for (const [x, z] of [[-9, 8], [-10, 12], [8.5, 9], [9.5, 13], [-8, 18], [4, 16]]) { toWorld(R, x, z, _w); list.push({ x: _w.x, z: _w.z, yaw: R.yaw + (x < 0 ? -0.8 : 0.8) }); }
    const folk = new People(scene, list, heightAt, 3);
    let tt = 0;
    ticks.push((dt, cam) => { tt += dt; folk.update(dt, tt, cam); });
  }
  const near = [S, R].filter(Boolean);
  return { update(dt, cam) { if (cam && near.every((o) => Math.hypot(cam.x - o.x, cam.z - o.z) > 4500)) return; for (const f of ticks) f(dt, cam); } };
}
