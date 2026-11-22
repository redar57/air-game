import * as THREE from 'three';
import { heightAt, BIG } from './world/terrain.js';
import { runways, lightsPoints, milBase, fuelStation } from './world/airfields.js';
import { addMoving, hitObstacle } from './world/colliders.js';
import { mergeColored, xform, toWorld, toLocal, clamp, smoothstep } from './util.js';

// Ravitailleur (appareil inventé : triréacteur à empennage en T) : il fait le tour de la carte sans arrêt, se pose de
// temps en temps à la base, roule, repart. Derrière lui traîne un tuyau terminé par un panier : le Jet de chasse vient
// s'y brancher (perche au-dessus du nez), suit l'avion en douceur et fait le plein.

const CRUISE = 104, VROT = 72, VLAND = 66, TAXI = 9, LAPS = 2, WAIT = 70, STEP = 10;
const G = 9.81, LEN = 36, SPAN = 36, STAND = 3.6, HOSE = [0, -5.6, 41]; // panier en croisière (repère avion)
const PORT = [0, -1.9, 13.2], PROBE = [0, 1.1, -7.6];
const FUEL_T = 20; // secondes pour un plein complet
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _l = { x: 0, z: 0 }, _w = { x: 0, z: 0 }, _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

function bodyMesh() {
  const parts = [], W = 0xdfe4e8, B = 0x3f5a78, O = 0xf2a22c, K = 0x23272d, N = 0x9aa3ab;
  const T = (rf, rb, zf, zb, c, x = 0, y = 0, sy = 1) => parts.push({ geo: new THREE.CylinderGeometry(rf, rb, zb - zf, 12).rotateX(-Math.PI / 2), color: c, matrix: xform(x, y, (zf + zb) / 2, 0, 1, sy, 1) });
  const BX = (w, h, d, c, x, y, z, ry = 0, rx = 0, rz = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry, 1, 1, 1, rx, rz) });
  const wing = (span, cr, ct, th, sweep, dih, x, y, z, c, s) => { const g = new THREE.BoxGeometry(span, th, cr).translate(span / 2, 0, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getX(i) / span; p.setXYZ(i, s * (x + p.getX(i)), y + p.getY(i) * (1 - 0.5 * t) + dih * t, z + (p.getZ(i) / cr) * (cr + (ct - cr) * t) + sweep * t); } parts.push({ geo: g, color: c }); };
  T(0.4, 1.5, -18, -16, W, 0, -0.2); T(1.5, 2.1, -16, -13, W); T(2.1, 2.1, -13, 7, W); T(2.1, 0.8, 7, 17, W, 0, 0.7);
  BX(2.6, 0.7, 0.9, 0x27455c, 0, 0.9, -15.3); T(2.13, 2.13, -13, 7, B, 0, -0.75, 0.62); BX(4.3, 0.25, 22, O, 0, 0.2, -3);
  for (const s of [-1, 1]) {
    wing(16, 6.4, 2, 0.7, 5.4, 0.9, 1.8, -0.8, -1.5, W, s); wing(1.8, 1.8, 0.8, 0.2, 1, 1.2, 17.8, 0.1, 3.9, O, s);
    BX(0.3, 0.9, 2.6, W, s * 6.4, -0.9, -1.8); T(1.15, 1.2, -5, -2, B, s * 6.4, -1.7); T(1.2, 0.85, -2, 0.6, B, s * 6.4, -1.7); T(0.95, 0.95, -5.1, -5, K, s * 6.4, -1.7); T(0.6, 0.3, 0.6, 1.5, K, s * 6.4, -1.7);
    T(0.2, 0.42, 0.2, 1.4, O, s * 12.5, -0.9); T(0.42, 0.25, 1.4, 4, N, s * 12.5, -0.9); // nacelles de ravitaillement d'aile
    wing(6, 3.2, 1.6, 0.26, 1.8, 0.2, 0.1, 9.6, 17.4, B, s);
  }
  { const g = new THREE.BoxGeometry(0.5, 8.2, 5.2).translate(0, 4.1, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 8.2; p.setXYZ(i, p.getX(i), 1.5 + p.getY(i), 13.8 + p.getZ(i) * (1 - 0.36 * t) + 3.4 * t); } parts.push({ geo: g, color: B }); }
  T(1.0, 1.1, 10.5, 12, B, 0, 3); T(1.1, 0.75, 12, 18, B, 0, 2.8); T(0.85, 0.85, 10.4, 10.5, K, 0, 3); T(0.55, 0.3, 18, 18.8, K, 0, 2.7);
  BX(0.9, 0.6, 3, N, 0, -1.7, 12); BX(1.3, 0.5, 1.6, K, 0, -2.2, 6.5); for (const s of [-1, 1]) BX(0.3, 0.14, 5, s > 0 ? 0x2fae5a : 0xf2c230, s * 1, -2.15, 1); // repères lumineux sous le ventre
  const m = new THREE.Mesh(mergeColored(parts), lam()); m.castShadow = true;
  const gp = [];
  for (const s of [-1, 1]) for (const z of [0.4, 1.8]) { gp.push({ geo: new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(s * 2.4, -3.05, z) }, { geo: new THREE.BoxGeometry(0.2, 2, 0.2), color: 0xbfc4c9, matrix: xform(s * 2.2, -2.1, z) }); }
  for (const s of [-1, 1]) gp.push({ geo: new THREE.CylinderGeometry(0.42, 0.42, 0.25, 10).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(s * 0.25, -3.15, -13.5) }); gp.push({ geo: new THREE.BoxGeometry(0.2, 1.6, 0.2), color: 0xbfc4c9, matrix: xform(0, -2.4, -13.5) });
  const gear = new THREE.Mesh(mergeColored(gp), lam());
  return { m, gear };
}

export class Tanker {
  constructor(scene) {
    this.rw = runways.find((r) => r.id === (BIG ? 'militaire' : 'aeroport'));
    this.root = new THREE.Group();
    const { m, gear } = bodyMesh();
    this.gear = gear; this.root.add(m, gear);
    this.root.add(lightsPoints([-17.8, 0.2, 4], 0xff3020, 7), lightsPoints([17.8, 0.2, 4], 0x30ff60, 7), lightsPoints([0, -0.2, 17.6], 0xffffff, 6), lightsPoints([-1, -2.4, 1, 1, -2.4, 1, 0, -2.4, 4], 0xffe2a0, 4));
    scene.add(this.root);
    // tuyau et panier
    this.hose = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ color: 0x1b1c1e, side: THREE.DoubleSide }));
    this.hosePos = new Float32Array(13 * 4 * 3); const idx = [];
    for (let i = 0; i < 12; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b = i * 4 + ((k + 1) % 4); idx.push(a, b, a + 4, b, b + 4, a + 4); }
    this.hose.geometry.setAttribute('position', new THREE.BufferAttribute(this.hosePos, 3)); this.hose.geometry.setIndex(idx); this.hose.frustumCulled = false;
    const bp = [{ geo: new THREE.CylinderGeometry(0.95, 0.3, 1.1, 12, 1, true).rotateX(Math.PI / 2), color: 0xf4f4ee, matrix: xform(0, 0, 0.5) }, { geo: new THREE.TorusGeometry(0.95, 0.1, 5, 14), color: 0xf2a22c, matrix: xform(0, 0, 1.05) }, { geo: new THREE.CylinderGeometry(0.28, 0.28, 0.6, 8).rotateX(Math.PI / 2), color: 0x2b2e33, matrix: xform(0, 0, -0.2) }];
    this.basket = new THREE.Mesh(mergeColored(bp), lam({ side: THREE.DoubleSide }));
    this.basket.add(lightsPoints([0.9, 0, 1, -0.9, 0, 1, 0, 0.9, 1, 0, -0.9, 1], 0x60ffb0, 2));
    scene.add(this.hose, this.basket);
    this.drogue = new THREE.Vector3();
    this.cols = [addMoving(2.2, LEN / 2, 0, 1), addMoving(SPAN / 2, 2.6, 0, 1)];
    this.vel = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.bank = 0; this.pitch = 0; this.yaw = 0;
    this.out = 1; this.linked = false; this.xfer = 0; this.refuels = 0; this.near = false; this.cool = 0; this.info = null; this.t = 0;
    this.plan();
    this.s = this.sIn + this.lap * 0.22; this.v = CRUISE; this.wait = 0; this.lapN = 0;
    this.place(0);
  }

  /** Emplacement de stationnement dégagé au bord du seuil de piste. */
  park() {
    const rw = this.rw;
    for (const lz of [rw.length / 2 - 70, rw.length / 2 - 130, rw.length / 2 - 190]) for (const s of [-1, 1]) for (const o of [30, 45, 60, 80]) {
      const lx = s * (rw.width / 2 + o);
      let ok = true;
      for (let a = -22; a <= 22 && ok; a += 4) for (let b = -24; b <= 24 && ok; b += 4) { toWorld(rw, lx + a, lz + b, _w); if (hitObstacle(_w.x, rw.alt + 2, _w.z) || hitObstacle(_w.x, rw.alt + 8, _w.z) || Math.abs(heightAt(_w.x, _w.z) - rw.alt) > 0.6) ok = false; }
      toWorld(rw, lx, lz, _w);
      for (const c of [milBase.board, fuelStation]) if (Math.hypot(c.x - _w.x, c.z - _w.z) < 60) ok = false;
      if (ok) return { lx, lz };
    }
    return { lx: rw.width / 2 + 60, lz: rw.length / 2 - 70 };
  }

  /** Trajet complet : parking, décollage, tours de la carte, approche, atterrissage, retour au parking. */
  plan() {
    const rw = this.rw, L = rw.length / 2, fx = -Math.sin(rw.yaw), fz = -Math.cos(rw.yaw), y0 = rw.alt + 0.12 + STAND;
    const at = (lx, lz, y = y0) => { toWorld(rw, lx, lz, _w); return new THREE.Vector3(_w.x, y, _w.z); };
    const C = BIG ? { x: 0, z: -200, rx: 11000, rz: 8500, alt: 900 } : { x: 0, z: 0, rx: 5300, rz: 4700, alt: 620 };
    const th0 = Math.atan2((rw.z - C.z) / C.rz, (rw.x - C.x) / C.rx), sg = -C.rx * Math.sin(th0) * fx + C.rz * Math.cos(th0) * fz > 0 ? 1 : -1;
    const ell = (th) => { const x = C.x + Math.cos(th) * C.rx, z = C.z + Math.sin(th) * C.rz; return new THREE.Vector3(x, Math.max(C.alt, this.clear(x, z)), z); };
    const pk = this.park(), k = BIG ? 1 : 0.62, a0 = th0 + sg * 0.62, N = 64;
    const taxi1 = [at(pk.lx, pk.lz), at(pk.lx * 0.75, pk.lz + 4), at(pk.lx * 0.3, pk.lz + 22), at(0, L - 34), at(0, L - 70)];
    const out = [at(0, L - 160), at(0, 0), at(0, -L + 240, y0 + 2), at(0, -L - 300 * k, y0 + 60), at(0, -L - 1500 * k, y0 + 190), at(0, -L - 2900 * k, y0 + 330)];
    const loop = []; for (let i = 0; i < N * LAPS; i++) loop.push(ell(a0 + (sg * i * 2 * Math.PI) / N));
    // on quitte la boucle assez tôt pour s'aligner loin derrière la piste
    const cut = Math.round(((1.3) / (2 * Math.PI)) * N); loop.splice(loop.length - cut, cut);
    const inn = [at(0, L + 5600 * k, y0 + 430), at(0, L + 3800 * k, y0 + 270), at(0, L + 2200 * k, y0 + 150), at(0, L + 900 * k, y0 + 58), at(0, L + 120, y0 + 9), at(0, L - 90, y0), at(0, 0), at(0, -L + 160)];
    const back = [at(pk.lx * 0.12, -L + 105), at(pk.lx * 0.5, -L + 110), at(pk.lx * 0.85, -L + 170), at(pk.lx, -L + 300), at(pk.lx, 0), at(pk.lx, pk.lz - 120), at(pk.lx, pk.lz)];
    const seq = [taxi1, out, loop, inn, back], all = seq.flat(), curve = new THREE.CatmullRomCurve3(all, false, 'centripetal');
    // échantillonnage régulier, en repérant l'abscisse de quelques points-clés
    const n = all.length - 1, sub = 24, raw = [], mark = []; let acc = 0, prev = null;
    for (let i = 0; i <= n * sub; i++) { const p = curve.getPoint(i / (n * sub)); if (prev) acc += p.distanceTo(prev); raw.push([acc, p]); if (i % sub === 0) mark.push(acc); prev = p; }
    this.len = acc; this.pts = []; let j = 0;
    for (let s = 0; s <= acc; s += STEP) { while (j < raw.length - 2 && raw[j + 1][0] < s) j++; const [a, A] = raw[j], [b, B] = raw[j + 1]; this.pts.push(A.clone().lerp(B, clamp((s - a) / (b - a || 1), 0, 1))); }
    // relief : marge au-dessus du sol sur tout le trajet en vol
    const o0 = taxi1.length, o1 = o0 + out.length, o2 = o1 + loop.length, o3 = o2 + inn.length;
    this.sRoll = mark[o0 - 1]; this.sIn = mark[o1 + 2]; this.sOut = mark[o2 - 1]; this.sTouch = mark[o3 - 3]; this.sStop = mark[o3 - 1]; this.sLift = mark[o0 + 2];
    this.lap = mark[o1 + N + 4] - mark[o1 + 4];
    const w = (s) => smoothstep(this.sLift + 700, this.sLift + 3200 * k, s) * (1 - smoothstep(this.sTouch - 5200 * k, this.sTouch - 2600 * k, s));
    let sm = this.pts.map((p, i) => p.y + w(i * STEP) * Math.max(0, this.clear(p.x, p.z) - p.y));
    const climb = 0.13 * STEP, n0 = Math.ceil((this.sLift + 700) / STEP), n1 = Math.floor((this.sTouch - 2600 * k) / STEP);
    for (let i = n1; i > n0; i--) sm[i - 1] = Math.max(sm[i - 1], sm[i] - climb); // monte assez tôt, descend assez tard
    for (let i = n0; i < n1; i++) sm[i + 1] = Math.max(sm[i + 1], sm[i] - climb);
    for (let it = 0; it < 4; it++) { const o = sm.slice(); for (let i = n0 + 25; i < n1 - 25; i++) { let t = 0; for (let q = -25; q <= 25; q += 5) t += o[i + q]; sm[i] = t / 11; } }
    // pentes tenables au départ de la piste et à l'arrivée
    sm = sm.map((y, i) => { const d = Math.min(i * STEP - this.sLift, this.sTouch - i * STEP); return d > 0 ? Math.min(y, y0 + 4 + 0.15 * d) : this.pts[i].y; });
    for (let it = 0; it < 4; it++) { const o = sm.slice(); for (let i = Math.ceil((this.sLift + 350) / STEP); i < (this.sTouch - 400) / STEP; i++) sm[i] = (o[i - 8] + o[i - 4] + o[i] + o[i + 4] + o[i + 8]) / 5; }
    this.pts.forEach((p, i) => { p.y = sm[i]; });
    // contraintes de vitesse [abscisse, vitesse]
    this.limits = [[this.sTouch, VLAND], [this.sStop, TAXI], [this.len, 0]];
  }
  clear(x, z) { let h = 0; for (const [a, b] of [[0, 0], [250, 0], [-250, 0], [0, 250], [0, -250]]) h = Math.max(h, heightAt(x + a, z + b)); return h + 180; }
  at(s, out) { const u = clamp(s / STEP, 0, this.pts.length - 1.001), i = Math.floor(u); return out.copy(this.pts[i]).lerp(this.pts[i + 1], u - i); }
  get flying() { return this.s > this.sLift + 600 && this.s < this.sTouch - 1500; }
  get cruising() { return this.s > this.sIn && this.s < this.sOut - 400; }

  busy(plane) { // le joueur est sur la piste ou tout près, bas
    if (!plane || plane.crashed || plane.agl > 120) return false;
    toLocal(this.rw, plane.pos.x, plane.pos.z, _l);
    return Math.abs(_l.x) < this.rw.width / 2 + 14 && Math.abs(_l.z) < this.rw.length / 2 + 250;
  }

  place(dt) {
    this.at(this.s, this.pos);
    const air = smoothstep(this.sLift - 60, this.sLift + 260, this.s) * (1 - smoothstep(this.sTouch - 120, this.sTouch + 30, this.s));
    const L = 14 + 40 * air;
    this.at(this.s - L, _v); this.at(this.s + L, _d);
    _p.subVectors(_d, _v); const h = Math.hypot(_p.x, _p.z) || 1;
    const yaw = Math.atan2(-_p.x, -_p.z), pitch = Math.atan2(_p.y, h) + 0.045 * air * (this.s > this.sTouch - 700 || this.s < this.sLift + 400 ? 1.6 : 1);
    let dy = yaw - this.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const rate = dt > 0 ? dy / dt : 0, wantBank = clamp(Math.atan((this.v * rate) / G), -0.5, 0.5) * air;
    const f = dt > 0 ? 1 - Math.exp(-dt * 0.8) : 1;
    this.yaw = yaw; this.bank += (wantBank - this.bank) * f; this.pitch += (pitch - this.pitch) * (dt > 0 ? 1 - Math.exp(-dt * 2) : 1);
    this.root.position.copy(this.pos); this.root.quaternion.setFromEuler(_e.set(this.pitch, yaw, this.bank));
    this.vel.set(_p.x, _p.y, _p.z).normalize().multiplyScalar(this.v);
    const agl = this.pos.y - Math.max(0, heightAt(this.pos.x, this.pos.z));
    this.gear.visible = agl < 170; this.gear.scale.y = clamp((190 - agl) / 80, 0.05, 1);
    this.cols.forEach((c, i) => { c.x = this.pos.x; c.z = this.pos.z; c.yaw = yaw; c.y0 = this.pos.y - (i ? 1.6 : 3); c.y1 = this.pos.y + (i ? 1.2 : 3); });
  }

  update(dt, plane) {
    if (dt <= 0) return;
    this.t += dt;
    if (this.wait > 0) { this.wait -= dt; this.v = 0; if (this.wait <= 0 && this.busy(plane)) this.wait = 5; }
    else {
      let target = CRUISE, acc = 2.4;
      if (this.s < this.sRoll) { target = TAXI; if (this.s > this.sRoll - 40 && this.busy(plane)) target = 0; }
      for (const [s, v] of this.limits) { if (v === 0 && this.s < this.sStop - 60) continue; const d = s - this.s; if (d >= 0) target = Math.min(target, Math.sqrt(v * v + 2 * (v === 0 ? 0.6 : v === TAXI ? 3.2 : 0.55) * d) + (v === 0 ? 0.2 : 0)); }
      if (this.s > this.sStop) target = Math.min(target, 13);
      this.v += clamp(target - this.v, -3.6 * dt, acc * dt);
      this.s += this.v * dt;
      // piste occupée : on refait un tour
      if (this.s >= this.sOut && this.s - this.v * dt < this.sOut && this.busy(plane)) this.s -= this.lap;
      if (this.s >= this.len - 1) { this.s = 0; this.wait = WAIT; this.v = 0; }
    }
    this.place(dt);
    this.assist(dt, plane);
    this.drawHose(dt);
  }

  /** Branchement du Jet : approche aidée, transfert, débranchement. */
  assist(dt, plane) {
    this.near = false; this.info = null; this.cool -= dt;
    if (!plane || !plane.spec.afterburner || plane.onGround || plane.crashed || !this.flying) { this.unlink(); return; }
    _d.set(...HOSE); _d.x += Math.sin(this.t * 0.7) * 0.35; _d.y += Math.sin(this.t * 1.1) * 0.3;
    _d.applyQuaternion(this.root.quaternion).add(this.pos); // panier libre
    _p.set(...PROBE).applyQuaternion(plane.quat).add(plane.pos);
    const r = _v.subVectors(_d, _p), d = r.length();
    if (plane.pos.distanceTo(this.pos) > 1600) { this.unlink(); return; }
    this.near = true;
    const rel = plane.speed - this.v, along = -(r.x * Math.sin(this.yaw) + r.z * Math.cos(this.yaw)), side = r.x * Math.cos(this.yaw) - r.z * Math.sin(this.yaw);
    this.info = { d, rel, along, side, up: r.y };
    const c = plane.ctrl, aligned = plane.fwd.x * -Math.sin(this.yaw) + plane.fwd.z * -Math.cos(this.yaw) > 0.85;
    if (this.linked) {
      // suit le ravitailleur en douceur ; on se débranche aux freins, ou en tirant franchement sur le manche
      const k = 1 - Math.exp(-2.2 * dt);
      plane.vel.lerp(_p.copy(this.vel).addScaledVector(r, 0.9), k);
      plane.pos.addScaledVector(r, 1 - Math.exp(-1.4 * dt));
      plane.quat.slerp(_q.setFromEuler(_e.set(this.pitch - 0.02, this.yaw, this.bank)), 1 - Math.exp(-1.8 * dt));
      plane.axes(); plane.speed = plane.vel.length();
      plane.throttle += (0.45 - plane.throttle) * (1 - Math.exp(-dt * 0.5));
      this.force = Math.abs(c.pitch) > 0.85 || Math.abs(c.roll) > 0.85 ? (this.force || 0) + dt : 0;
      if (plane.fuelOn) plane.fuel = Math.min(1, plane.fuel + dt / FUEL_T);
      this.xfer = Math.min(1, this.xfer + dt / FUEL_T);
      const full = plane.fuelOn ? plane.fuel >= 0.999 && this.xfer > 0.1 : this.xfer >= 1;
      if (full) { this.refuels++; plane.fuelWarned = false; this.event = 'full'; this.unlink(8); } else if (plane.braking || this.force > 0.5 || d > 14) { this.event = 'off'; this.unlink(4); }
      return;
    }
    // coup de pouce : tout près derrière, la vitesse s'accorde et le panier attire la perche
    if (aligned && this.cool <= 0 && along > -8 && along < 90 && Math.abs(side) < 30 && Math.abs(r.y) < 22) {
      const k = smoothstep(90, 12, d);
      plane.vel.addScaledVector(_p.copy(this.vel).sub(plane.vel), (1 - Math.exp(-0.55 * k * dt)));
      const n = Math.max(d, 1); plane.vel.addScaledVector(r, (2.6 * k * dt) / n * Math.min(1, d / 4)); plane.pos.addScaledVector(r, (0.9 * k * dt) / n);
      if (d < 5.5 && Math.abs(rel) < 14) { this.linked = true; this.force = 0; this.event = 'on'; if (plane.fuelOn) this.xfer = plane.fuel; else this.xfer = 0; }
    }
  }
  unlink(cool = 0) { if (this.linked) { this.linked = false; this.cool = cool; } }

  drawHose(dt) {
    this.out += ((this.flying ? 1 : 0) - this.out) * (1 - Math.exp(-dt * 0.5));
    const show = this.out > 0.02; this.hose.visible = this.basket.visible = show;
    if (!show) return;
    const a = _p.set(...PORT).applyQuaternion(this.root.quaternion).add(this.pos).clone();
    _d.set(HOSE[0] * this.out, PORT[1] + (HOSE[1] - PORT[1]) * this.out, PORT[2] + (HOSE[2] - PORT[2]) * this.out);
    _d.x += Math.sin(this.t * 0.7) * 0.35 * this.out; _d.y += Math.sin(this.t * 1.1) * 0.3 * this.out;
    const end = _d.applyQuaternion(this.root.quaternion).add(this.pos);
    this.drogue.copy(end);
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, sag = -1.6 * Math.sin(t * Math.PI) * this.out;
      const x = a.x + (end.x - a.x) * t, y = a.y + (end.y - a.y) * t + sag, z = a.z + (end.z - a.z) * t;
      for (let k = 0; k < 4; k++) { const o = (i * 4 + k) * 3; this.hosePos[o] = x + [0.11, 0, -0.11, 0][k]; this.hosePos[o + 1] = y + [0, 0.11, 0, -0.11][k]; this.hosePos[o + 2] = z; }
    }
    this.hose.geometry.attributes.position.needsUpdate = true;
    this.basket.position.copy(end); this.basket.quaternion.copy(this.root.quaternion);
  }

  /** Panneau affiché près du ravitailleur. */
  hud(plane) {
    const i = this.info; if (!i) return null;
    const dir = [Math.abs(i.up) > 2 ? (i.up > 0 ? 'monte' : 'descends') : '', Math.abs(i.side) > 2 ? (i.side > 0 ? 'à droite' : 'à gauche') : ''].filter(Boolean).join(', ') || 'dans l\'axe';
    return {
      title: 'Ravitaillement en vol', big: this.linked ? `${Math.round(this.xfer * 100)} %` : i.d > 999 ? `${(i.d / 1000).toFixed(1).replace('.', ',')}` : `${Math.round(i.d)}`, unit: this.linked ? 'transfert' : i.d > 999 ? 'km du panier' : 'm du panier',
      lines: this.linked ? ['branché : laisse-toi guider', 'Espace pour te débrancher'] : [`ravitailleur : ${Math.round(this.v * 3.6)} km/h · toi : ${i.rel >= 0 ? '+' : ''}${Math.round(i.rel * 3.6)}`, i.along < -8 ? 'passe derrière lui' : i.d < 400 ? dir : 'approche-toi par derrière, sous la queue'],
      bar: this.linked ? this.xfer : clamp(1 - i.d / 400, 0, 1),
    };
  }
}
