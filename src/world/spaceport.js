import * as THREE from 'three';
import { launchSite, helipads, helipadMesh, lightsPoints, spinners } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { mergeColored, xform, toWorld, clamp, smoothstep, mulberry32 } from '../util.js';
import { Puffs } from './puffs.js';
import { usFlag, usFlagTexture } from './flag.js';

// Site de lancement, sur un îlot : une fusée sort du hall d'assemblage, roule jusqu'au pas de tir, fait le plein,
// décolle (compte à rebours, fumée, grondement, propulseurs largués), puis une autre prend la suite.
// Repère local du site : hall vers +Z, pas de tir vers -Z. Les propulseurs d'appoint sont de part et d'autre (X).

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const PAD_Z = -95, PAD_H = 6, HALL_Z = 110;
/** Durée de chaque étape (s). */
const T = { rollout: 45, ready: 1030, count: 10, ignite: 3, flight: 75, back: 35 };

/** Lanceur : corps blanc à bandes orange, deux propulseurs, coiffe ; base des tuyères à y = 0, environ 58 m. */
function rocketMesh() {
  const W = 0xf4f4f0, O = 0xe8762c, K = 0x24282d, GR = 0x8d959d;
  const body = [], C = (list, rt, rb, h, c, x, y, z = 0, seg = 14) => list.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, matrix: xform(x, y, z) });
  for (const [a, b] of [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) C(body, 0.45, 0.85, 2, K, a, 1, b, 10);
  C(body, 2.6, 2.6, 1.6, GR, 0, 2.6); C(body, 2.6, 2.6, 34, W, 0, 20.4); C(body, 2.64, 2.64, 2.2, K, 0, 38); C(body, 2.64, 2.64, 1.2, O, 0, 12); C(body, 2.64, 2.64, 1.2, O, 0, 30);
  C(body, 2.6, 2.6, 8, W, 0, 43); C(body, 3.1, 2.6, 1.6, GR, 0, 47.6); C(body, 3.1, 3.1, 4.4, W, 0, 50.6); C(body, 3.14, 3.14, 0.7, O, 0, 49); C(body, 1.3, 3.1, 4, W, 0, 54.8); C(body, 0.1, 1.3, 2.2, O, 0, 57.9);
  for (let k = 0; k < 4; k++) body.push({ geo: new THREE.BoxGeometry(0.3, 5, 2.6), color: O, matrix: xform(Math.sin(k * Math.PI / 2 + Math.PI / 4) * 3.4, 4.6, Math.cos(k * Math.PI / 2 + Math.PI / 4) * 3.4, k * Math.PI / 2 + Math.PI / 4) });
  for (let y = 6; y < 36; y += 1.6) body.push({ geo: new THREE.BoxGeometry(0.35, 1.5, 0.35), color: GR, matrix: xform(0, y, 2.65) }); // goulotte
  const g = new THREE.Group(), core = new THREE.Mesh(mergeColored(body), lam());
  core.castShadow = true; g.add(core);
  const decal = new THREE.Mesh(new THREE.CylinderGeometry(2.66, 2.66, 2.7, 8, 1, true, -0.95, 1.9), new THREE.MeshLambertMaterial({ map: usFlagTexture() }));
  decal.position.y = 24; decal.rotation.y = Math.PI; g.add(decal);
  const bp = [];
  C(bp, 0.7, 1.15, 2, K, 0, 1, 0, 10); C(bp, 1.5, 1.5, 24, W, 0, 14); C(bp, 1.54, 1.54, 1.4, O, 0, 5); C(bp, 1.54, 1.54, 1.4, K, 0, 22); C(bp, 0.1, 1.5, 4.4, O, 0, 28.2);
  const boosters = [-1, 1].map((s) => { const m = new THREE.Mesh(mergeColored(bp), lam()); m.position.x = s * 4.3; m.castShadow = true; g.add(m); return m; });
  const glow = (color, r, h, opacity) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 12, 1, true).rotateX(Math.PI).translate(0, -h / 2, 0),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    m.visible = false; return m;
  };
  const flames = [];
  for (const [x, p, k] of [[0, g, 1], [0, boosters[0], 0.75], [0, boosters[1], 0.75]]) for (const [c, r, h, o] of [[0xff8a2a, 2.4, 26, 0.75], [0xfff2c0, 1.3, 14, 0.95]]) { const f = glow(c, r * k, h * k, o); f.position.set(x, 1, 0); p.add(f); flames.push(f); }
  return { g, boosters, flames };
}

export function buildLaunchSite(scene) {
  const S = launchSite, parts = [], _w = {}, y0 = S.alt, rnd = mulberry32(77);
  const G = new THREE.Group();
  G.position.set(S.x, y0, S.z); G.rotation.y = S.yaw;
  scene.add(G);
  const B = (w, h, d, c, x, y, z, ry = 0, rx = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry, 1, 1, 1, rx) });
  const C = (rt, rb, h, c, x, y, z, seg = 10) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, matrix: xform(x, y, z) });
  const collide = (x, z, hw, hd, h) => { toWorld(S, x, z, _w); addBox(_w.x, _w.z, S.yaw, hw, hd, y0 - 2, y0 + h); };
  const post = (x, z, r, h) => { toWorld(S, x, z, _w); addCylinder(_w.x, _w.z, r, y0, y0 + h); };
  const red = [], white = [];
  const CO = 0xa7aaac, DK = 0x2b2f34, ST = 0x8a9199, W = 0xeceeec, RD = 0xc8402f;

  // --- piste du transporteur : deux bandes de gravier, rampe, puis pas de tir en béton et tranchée à flammes
  for (const s of [-1, 1]) B(9, 0.3, 152, 0xb9ad92, s * 7, 0.1, 18);
  B(6, 0.2, 152, 0x7f9a55, 0, 0.08, 18);
  B(24, 1.2, 32.6, CO, 0, PAD_H / 2 - 0.6, -46, 0, Math.atan2(PAD_H, 32));
  B(24, PAD_H, 6, CO, 0, PAD_H / 2, -63);
  parts.push({ geo: new THREE.CylinderGeometry(36, 42, PAD_H, 8), color: CO, matrix: xform(0, PAD_H / 2, PAD_Z, Math.PI / 8) });
  for (const s of [-1, 1]) { B(34, 0.3, 9, DK, s * 24, PAD_H + 0.05, PAD_Z); B(16, 5.4, 9, 0x3a3f45, s * 37, 3, PAD_Z); }
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; B(13, 0.1, 1, 0xe8c33a, Math.sin(a) * 31, PAD_H + 0.1, PAD_Z + Math.cos(a) * 31, a); }
  collide(0, PAD_Z, 33, 33, PAD_H - 0.2);

  // --- tour de service : treillis rouge, plateaux, bras d'accès, grue
  const tx = -15, tz = PAD_Z, TH = 74;
  for (const [a, b] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) B(0.8, TH, 0.8, RD, tx + a, PAD_H + TH / 2, tz + b);
  for (let y = 4; y <= TH; y += 7) {
    B(7.6, 0.35, 7.6, 0x7a2f26, tx, PAD_H + y, tz);
    for (const s of [-3.4, 3.4]) for (const q of [-1, 1]) {
      parts.push({ geo: new THREE.BoxGeometry(0.3, 9.6, 0.3), color: RD, matrix: xform(tx + s, PAD_H + y - 3.5, tz, 0, 1, 1, 1, q * 0.77) });
      parts.push({ geo: new THREE.BoxGeometry(0.3, 9.6, 0.3), color: RD, matrix: xform(tx, PAD_H + y - 3.5, tz + s, 0, 1, 1, 1, 0, q * 0.77) });
    }
  }
  B(2, TH, 2, 0x5a3a35, tx, PAD_H + TH / 2, tz);
  B(22, 1.2, 1.4, 0xe8c33a, tx + 4, PAD_H + TH + 4, tz); B(1.4, 4, 1.4, 0xe8c33a, tx, PAD_H + TH + 2, tz); B(2.4, 1.6, 2, ST, tx - 6, PAD_H + TH + 3, tz); B(0.1, 9, 0.1, DK, tx + 12, PAD_H + TH - 0.6, tz);
  C(0.1, 0.15, 8, ST, tx, PAD_H + TH + 8, tz, 5); red.push(tx, PAD_H + TH + 12, tz);
  collide(tx, tz, 4, 4, PAD_H + TH + 6);
  const arms = [14, 34, 49].map((y, k) => { // bras qui s'écartent avant le départ
    const p = new THREE.Group(); p.position.set(tx + 3.4, PAD_H + y, tz + 3);
    const m = new THREE.Mesh(mergeColored([
      { geo: new THREE.BoxGeometry(8.4, 2, 1.6), color: k === 2 ? W : RD, matrix: xform(4.2, 0, 0) }, { geo: new THREE.BoxGeometry(1.6, 2.6, 2.2), color: DK, matrix: xform(8, 0, 0) },
    ]), lam());
    m.position.z = -3; p.add(m); G.add(p); return p;
  });

  // --- quatre paratonnerres
  for (const [a, b] of [[-46, -46], [46, -46], [-46, 46], [46, 46]]) {
    for (let k = 0; k < 6; k++) C(1.5 - k * 0.22, 1.7 - k * 0.22, 15, k % 2 ? RD : W, a, 7.5 + k * 15, PAD_Z + b, 6);
    C(0.08, 0.15, 10, ST, a, 95, PAD_Z + b, 5); red.push(a, 100, PAD_Z + b); post(a, PAD_Z + b, 1.5, 99);
  }
  // --- réservoirs d'ergols, conduites, château d'eau du déluge
  for (const [x, z, r, c] of [[70, -62, 8, W], [78, -100, 9.5, W], [-74, -78, 7, 0xd9dcdf]]) {
    parts.push({ geo: new THREE.IcosahedronGeometry(r, 2), color: c, matrix: xform(x, r + 4, z) });
    for (let k = 0; k < 6; k++) C(0.35, 0.35, r + 4, ST, x + Math.sin(k * 1.047) * r * 0.85, (r + 4) / 2, z + Math.cos(k * 1.047) * r * 0.85, 6);
    parts.push({ geo: new THREE.TorusGeometry(r * 1.01, 0.3, 5, 24).rotateX(Math.PI / 2), color: 0x2f6fb5, matrix: xform(x, r + 4, z) });
    const L = Math.hypot(x, z - PAD_Z) - 34, a = Math.atan2(-x, PAD_Z - z);
    for (const o of [-0.7, 0.7]) parts.push({ geo: new THREE.CylinderGeometry(0.3, 0.3, L, 6).rotateX(Math.PI / 2), color: o > 0 ? 0xd9dcdf : 0x2f6fb5, matrix: xform(x + Math.sin(a) * L / 2, 1.2, z + Math.cos(a) * L / 2, a).multiply(xform(o, 0, 0)) });
    collide(x, z, r * 0.8, r * 0.8, r * 2 + 4);
  }
  for (let k = 0; k < 3; k++) { parts.push({ geo: new THREE.CylinderGeometry(2.2, 2.2, 14, 12).rotateX(Math.PI / 2), color: W, matrix: xform(60 + k * 6, 3, -30) }); collide(60 + k * 6, -30, 2.2, 7, 5.4); }
  for (const [a, b] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) B(0.7, 26, 0.7, ST, -62 + a, 13, -122 + b);
  C(6.5, 6.5, 9, 0x9fc4dd, -62, 30, -122, 14); C(0.5, 6.9, 3, W, -62, 36, -122, 14); C(0.8, 0.8, 26, ST, -62, 13, -122, 8); red.push(-62, 38, -122); collide(-62, -122, 6, 6, 37);

  // --- hall d'assemblage (assez haut pour la fusée debout), annexe, drapeau peint
  const HW = 50, HH = 80, HD = 50;
  B(HW, HH, HD, W, 0, HH / 2, HALL_Z + 8); B(HW + 1, 3, HD + 1, 0x39424c, 0, HH, HALL_Z + 8);
  for (const s of [-1, 1]) { B(3, HH, 0.8, 0x39424c, s * 23.5, HH / 2, HALL_Z - 17.2); for (let k = 0; k < 8; k++) B(0.8, 3, 40, 0xd3d7da, s * 25.1, 8 + k * 9, HALL_Z + 8); }
  B(26, 72, 0.6, 0x1c2126, 0, 36, HALL_Z - 17.2); // porte ouverte
  for (const s of [-1, 1]) B(1.6, 72, 1.4, 0xe8c33a, s * 13.6, 36, HALL_Z - 17.4);
  B(30, 12, 34, 0xd3d7da, 40, 6, HALL_Z + 14); B(30.3, 2, 34.3, 0x3b6e9c, 40, 8, HALL_Z + 14);
  collide(0, HALL_Z + 8, HW / 2, HD / 2, HH); collide(40, HALL_Z + 14, 15, 17, 12);
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(34, 17.9), new THREE.MeshLambertMaterial({ map: usFlagTexture() }));
    f.position.set(s * (HW / 2 + 0.6), 56, HALL_Z + 8); f.rotation.y = s * Math.PI / 2; G.add(f);
  }
  red.push(-24, HH + 2, HALL_Z - 16, 24, HH + 2, HALL_Z - 16, -24, HH + 2, HALL_Z + 32, 24, HH + 2, HALL_Z + 32);

  // --- centre de contrôle : vitrage tourné vers le pas de tir, paraboles, mât et drapeau, parking
  B(34, 10, 18, W, -80, 5, 62); B(34.4, 3, 1, 0x29495f, -80, 7, 52.8); B(36, 1, 20, 0x39424c, -80, 10.4, 62); B(14, 4, 10, W, -80, 13, 64); B(14.2, 1.6, 0.6, 0x29495f, -80, 13.4, 58.9);
  collide(-80, 62, 17, 9, 15);
  for (const [x, z, r] of [[-104, 90, 6.5], [-84, 96, 4.5]]) {
    C(1, 1.6, 6, CO, x, 3, z, 8);
    const d = new THREE.Mesh(mergeColored([
      { geo: new THREE.SphereGeometry(r, 14, 6, 0, 6.2832, 0, 0.9), color: W, matrix: xform(0, r * 0.2, r * 0.35, 0, 1, 1, 1, 2.2).multiply(xform(0, -r, 0)) },
      { geo: new THREE.BoxGeometry(1.4, 2.4, 1.4), color: ST, matrix: xform(0, 0, 0) },
    ]), lam({ side: THREE.DoubleSide }));
    d.position.set(x, 7, z); G.add(d); spinners.push({ obj: d, rate: 0.12 }); collide(x, z, r * 0.8, r * 0.8, 8 + r);
  }
  C(0.14, 0.25, 22, 0xe3e6e8, -56, 11, 50, 8); const fl = usFlag(4.6); fl.position.set(-56, 17, 50); G.add(fl);
  B(34, 0.1, 22, 0x55585d, -80, 0.1, 30);
  const CAR = [0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0xf2c230];
  for (let k = 0; k < 10; k++) { const x = -93 + (k % 5) * 6, z = 24 + Math.floor(k / 5) * 12; B(1.8, 0.8, 4.2, CAR[(k * 3) % 5], x, 0.7, z); B(1.6, 0.6, 2.2, 0x2c4558, x, 1.4, z); }
  B(8, 0.12, 90, 0x55585d, -50, 0.1, 60); B(50, 0.12, 8, 0x55585d, -25, 0.1, 18);
  // gros projecteurs autour du pas de tir, clôture
  for (const [x, z] of [[-40, -38], [40, -38], [58, -130], [-30, -150], [30, 20]]) { C(0.25, 0.4, 18, ST, x, 9, z, 6); B(5, 3, 0.8, 0x3a3f45, x, 18.5, z, Math.atan2(-x, PAD_Z - z)); for (const s of [-1.4, 0, 1.4]) white.push(x + s, 18.5, z); post(x, z, 0.6, 20); }
  const fx = 118, fz = 168;
  for (let x = -fx; x <= fx; x += 11.8) for (const s of [-1, 1]) B(0.2, 2.6, 0.2, ST, x, 1.3, s * fz);
  for (let z = -fz; z <= fz; z += 12) for (const s of [-1, 1]) B(0.2, 2.6, 0.2, ST, s * fx, 1.3, z);
  for (const y of [1, 1.8, 2.5]) for (const s of [-1, 1]) { B(fx * 2, 0.08, 0.08, 0xa8adb2, 0, y, s * fz); B(0.08, 0.08, fz * 2, 0xa8adb2, s * fx, y, 0); }

  const mesh = new THREE.Mesh(mergeColored(parts), lam());
  mesh.castShadow = mesh.receiveShadow = true;
  G.add(mesh, lightsPoints(red, 0xff3020, 6), lightsPoints(white, 0xfff2cc, 8));
  for (const p of helipads) if (p.launch) scene.add(helipadMesh(p.x, p.y, p.z, p.r));

  // --- transporteur à chenilles (reste sur place pendant le tir) et fusée
  const tp = [];
  const tb = (w, h, d, c, x, y, z) => tp.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z) });
  tb(21, 1.8, 17, ST, 0, 2.9, 0); tb(21.4, 0.5, 17.4, 0xe8c33a, 0, 3.6, 0);
  for (const s of [-1, 1]) for (const z of [-6, 6]) { tb(6, 2, 5.4, DK, s * 7, 1, z); tb(6.2, 0.5, 4, ST, s * 7, 1, z); }
  for (const s of [-1, 1]) { tb(1.4, 2, 2.4, RD, s * 3.4, 4.6, 3.6); tb(1.4, 2, 2.4, RD, s * 3.4, 4.6, -3.6); }
  const crawler = new THREE.Mesh(mergeColored(tp), lam()); crawler.castShadow = true; G.add(crawler);
  const R = rocketMesh(); G.add(R.g);
  toWorld(S, 0, PAD_Z, _w);
  const col = addCylinder(_w.x, _w.z, 6, y0, y0 + 72); // la fusée sur son pas de tir
  const smoke = new Puffs(scene, 620, { emissive: 0x555555 });
  const order = ['rollout', 'ready', 'count', 'ignite', 'flight', 'back'];

  const api = {
    x: S.x, z: S.z, phase: 'ready', t: 600, rocket: R.g, smoke,
    /** Passe directement à une étape (essais). */
    go(phase) { this.phase = phase; this.t = 0; this.enter(); },
    enter() {
      if (this.phase !== 'flight' && this.phase !== 'back') { R.g.visible = true; R.g.rotation.set(0, 0, 0); R.boosters.forEach((b, k) => { b.visible = true; b.position.set(k ? 4.3 : -4.3, 0, 0); b.rotation.set(0, 0, 0); }); }
      if (this.phase === 'flight') { this.v = 0; this.alt = 0; this.out = 0; this.tilt = 0; this.emit = 0; }
    },
    /** Force du grondement (0..1) entendu depuis la caméra. */
    loudness(cam) {
      if (this.phase !== 'ignite' && this.phase !== 'flight') return 0;
      R.g.getWorldPosition(_p);
      return (1.3 * (this.phase === 'ignite' ? smoothstep(0, 1, this.t) : 1 - smoothstep(60, T.flight, this.t))) / (1 + (_p.distanceTo(cam) / 900) ** 1.3);
    },
    update(dt, cam) {
      this.t += dt;
      if (this.t >= T[this.phase]) {
        this.t = 0; this.phase = order[(order.indexOf(this.phase) + 1) % order.length];
        this.enter();
      }
      const ph = this.phase, t = this.t, near = Math.hypot(cam.x - S.x, cam.z - S.z) < 15000;
      // position du transporteur : du hall (0) au pas de tir (1), en montant la rampe
      const along = ph === 'rollout' ? smoothstep(0, T.rollout, t) : ph === 'back' ? 1 - smoothstep(4, T.back, t) : 1;
      const z = HALL_Z + (PAD_Z - HALL_Z) * along, up = PAD_H * clamp((-30 - z) / 32, 0, 1);
      crawler.position.set(0, up + 0.2, z);
      // bras de service : s'écartent pendant le compte à rebours
      const open = ph === 'ready' ? 0 : ph === 'count' ? smoothstep(3, 9, t) : 1;
      arms.forEach((a) => { a.rotation.y = open * 1.5; });
      col.off = along < 1 || ph === 'flight';
      if (ph !== 'flight') {
        R.g.position.set(0, up + 5.4, z);
        if (ph === 'back') R.g.visible = false;
      }
      const lit = (ph === 'ignite' && t > 0.4) || ph === 'flight';
      for (const f of R.flames) { f.visible = lit; if (lit) f.scale.set(1, (ph === 'ignite' ? 0.5 : 1) * (0.85 + Math.random() * 0.3), 1); }
      if (ph === 'flight') this.fly(dt, near);
      else this.emit = (this.emit || 0) - dt;
      R.g.getWorldPosition(_p);
      if (near && this.emit <= 0) {
        if (ph === 'ready' || ph === 'count') { // dégazage le long du corps
          this.emit = 0.25; const h = 14 + rnd() * 26, s = rnd() < 0.5 ? -1 : 1;
          smoke.emit(_p.x + s * 2.6, _p.y + h, _p.z + (rnd() - 0.5) * 3, s * 2.5 + 1, -1.2, rnd() - 0.5, 0.5, 2.2, 3, 0xffffff);
        } else if (ph === 'ignite') this.ground(0.04, 3);
      }
      smoke.update(dt, 0.5);
    },
    /** Nuages de vapeur chassés des deux côtés par la tranchée à flammes. */
    ground(every, n) {
      this.emit = every;
      toWorld(S, 0, PAD_Z, _w);
      const c = Math.cos(S.yaw), s = Math.sin(S.yaw);
      for (let k = 0; k < n; k++) {
        const d = rnd() < 0.5 ? -1 : 1, v = 22 + rnd() * 26, a = (rnd() - 0.5) * 18;
        smoke.emit(_w.x + c * d * 30, y0 + 4, _w.z - s * d * 30, c * d * v + s * a, 2 + rnd() * 5, -s * d * v + c * a, 3, 11 + rnd() * 8, 7 + rnd() * 5, rnd() < 0.3 ? 0xd9d5cc : 0xf2f1ee);
      }
    },
    fly(dt, near) {
      const t = this.t;
      this.v += Math.min(26, 5 + t * 0.55) * dt;
      this.tilt = 0.75 * smoothstep(7, 60, t);
      this.alt += this.v * Math.cos(this.tilt) * dt; this.out += this.v * Math.sin(this.tilt) * dt;
      // vers le large : la fusée s'incline du côté du pas de tir
      R.g.position.set(0, PAD_H + 5.4 + this.alt, PAD_Z - this.out);
      R.g.rotation.set(-this.tilt, 0, 0);
      R.g.visible = t < T.flight - 1;
      if (t > 26) { // propulseurs largués : ils s'écartent et retombent en tournant
        const u = t - 26;
        R.boosters.forEach((b, k) => { const s = k ? 1 : -1; b.position.set(s * (4.3 + u * 7), -u * u * 6, 0); b.rotation.z = -s * u * 0.5; b.rotation.x = u * 0.3; b.visible = u < 14; });
        R.flames.forEach((f, k) => { if (k > 1) f.visible = false; });
      }
      this.emit -= dt;
      if (!near || this.emit > 0) return;
      if (t < 5) this.ground(0.05, 2);
      R.g.getWorldPosition(_p);
      this.emit = t < 5 ? 0.05 : 0.07;
      if (t < 34) {
        _d.set(0, -1, 0).applyQuaternion(R.g.quaternion).transformDirection(G.matrixWorld);
        // une bouffée tous les 10 m environ, pour un panache continu même à grande vitesse
        const n = Math.min(6, 1 + Math.floor((this.v * 0.08) / 9));
        for (let k = 0; k < n; k++) {
          const b = 14 + (k / n) * this.v * 0.08;
          smoke.emit(_p.x + _d.x * b + rnd() * 2 - 1, _p.y + _d.y * b, _p.z + _d.z * b + rnd() * 2 - 1, _d.x * 12, _d.y * 12, _d.z * 12, 2 + Math.min(4, t * 0.3), 12 + rnd() * 5 + t * 0.4, 12 + rnd() * 4, k % 2 ? 0xf4f3f0 : 0xe6e3dd);
        }
      }
    },
  };
  const _p = new THREE.Vector3(), _d = new THREE.Vector3();
  api.emit = 0;
  api.enter();
  return api;
}
