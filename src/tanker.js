import * as THREE from 'three';
import { heightAt, BIG } from './world/terrain.js';
import { runways, lightsPoints, milBase, fuelStation } from './world/airfields.js';
import { addMoving } from './world/colliders.js';
import { mergeColored, xform, toWorld, toLocal, clamp, smoothstep } from './util.js';

// Ravitailleur façon KC-135 Stratotanker : il fait le tour de la carte sans arrêt, se pose de temps en temps à la base,
// roule jusqu'à la pompe, fait le plein et repart. Sous sa queue pend une perche rigide : le Jet de chasse vient se
// placer dessous, la perche s'allonge jusqu'à son dos, il suit l'avion en douceur et fait le plein.

const CRUISE = 104, VROT = 72, VLAND = 66, TAXI = 9, LAPS = 2, WAIT = 70, STEP = 10;
const G = 9.81, LEN = 40, SPAN = 40;
export const STAND = 3.9;
// perche : pivot sous la queue, angle et longueur au repos (déployée), réceptacle sur le dos du Jet (repères avion)
const PORT = [0, -1.5, 13.2], ANG = 0.52, REACH = 14, RECEPT = [0, 0.95, -1.2];
const TIP = [0, PORT[1] - Math.sin(ANG) * REACH, PORT[2] + Math.cos(ANG) * REACH];
const FUEL_T = 20; // secondes pour un plein complet
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _l = { x: 0, z: 0 }, _w = { x: 0, z: 0 }, _v = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');

/** Coque, train et perche du ravitailleur (aussi pour l'appareil garé à la base). */
export function bodyMesh() {
  const parts = [], W = 0xb4bac0, B = 0x9098a0, D = 0x5f666d, K = 0x23272d;
  const T = (rf, rb, zf, zb, c, x = 0, y = 0, seg = 12) => parts.push({ geo: new THREE.CylinderGeometry(rf, rb, zb - zf, seg).rotateX(-Math.PI / 2), color: c, matrix: xform(x, y, (zf + zb) / 2) });
  const BX = (w, h, d, c, x, y, z, ry = 0, rx = 0, rz = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry, 1, 1, 1, rx, rz) });
  const wing = (span, cr, ct, th, sweep, dih, x, y, z, c, s) => { const g = new THREE.BoxGeometry(span, th, cr).translate(span / 2, 0, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getX(i) / span; p.setXYZ(i, s * (x + p.getX(i)), y + p.getY(i) * (1 - 0.5 * t) + dih * t, z + (p.getZ(i) / cr) * (cr + (ct - cr) * t) + sweep * t); } parts.push({ geo: g, color: c }); };
  // fuselage étroit, nez arrondi, queue effilée
  T(0.35, 1.0, -20, -19.1, D, 0, -0.35); T(1.0, 1.6, -19.1, -17.4, W, 0, -0.2); T(1.6, 1.85, -17.4, -15, W, 0, -0.05); T(1.85, 1.85, -15, 8, W); T(1.85, 1.2, 8, 14.5, W, 0, 0.4); T(1.2, 0.35, 14.5, 20, W, 0, 0.85);
  T(1.87, 1.87, -15, 8, B, 0, -0.06); BX(3.2, 0.5, 23, W, 0, 1.55, -3.5);
  BX(2.3, 0.55, 0.8, 0x27455c, 0, 0.85, -17.7); BX(2.9, 0.42, 0.5, 0x27455c, 0, 0.85, -17.1);
  for (const s of [-1, 1]) {
    wing(18.4, 7.6, 2.3, 0.75, 8.8, 1.5, 1.6, -0.95, -2.6, B, s);
    for (const t of [0.34, 0.66]) { // quatre nacelles courtes et rondes
      const x = s * (1.6 + 18.4 * t), y = -0.95 + 1.5 * t - 1.35, zc = -2.6 + 8.8 * t - 2.9 * (1 - t) - 1.2;
      BX(0.3, 0.9, 3, D, x, y + 0.9, zc + 1.1); T(1.0, 1.08, zc - 2.2, zc - 1.2, B, x, y); T(1.08, 0.78, zc - 1.2, zc + 1.2, B, x, y); T(0.86, 0.86, zc - 2.3, zc - 2.2, K, x, y); T(0.52, 0.28, zc + 1.2, zc + 2.1, K, x, y);
    }
    wing(6.8, 3.8, 1.7, 0.32, 3, 0.7, 0.7, 0.9, 15.6, B, s);
  }
  { const g = new THREE.BoxGeometry(0.5, 7.6, 5.4).translate(0, 3.8, 0), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const t = p.getY(i) / 7.6; p.setXYZ(i, p.getX(i), 1.6 + p.getY(i), 15 + p.getZ(i) * (1 - 0.55 * t) + 3.2 * t); } parts.push({ geo: g, color: B }); }
  BX(0.53, 0.7, 2.6, 0x2f4f86, 0, 8, 18); BX(0.2, 0.2, 2.2, D, 0, 8.9, 16.9); // bande et antenne de dérive
  BX(1.7, 0.9, 4.4, D, 0, -1.5, 10.6); BX(1.2, 0.5, 0.2, 0x27455c, 0, -1.55, 12.9); // poste de l'opérateur de perche
  for (const s of [-1, 1]) for (let k = 0; k < 5; k++) BX(0.3, 0.14, 0.9, s < 0 ? [0x2fae5a, 0x2fae5a, 0xf2c230, 0xd8312b, 0xd8312b][k] : [0xd8312b, 0xf2c230, 0x2fae5a, 0xf2c230, 0xd8312b][k], s * 0.8, -1.95, -6 + k * 1.5); // barres de guidage
  const m = new THREE.Mesh(mergeColored(parts), lam()); m.castShadow = true;
  const gp = [];
  for (const s of [-1, 1]) { for (const z of [-0.2, 1.2]) for (const x of [2.5, 3.3]) gp.push({ geo: new THREE.CylinderGeometry(0.55, 0.55, 0.4, 10).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(s * x, -3.35, z) }); gp.push({ geo: new THREE.BoxGeometry(0.28, 2.2, 0.28), color: 0xbfc4c9, matrix: xform(s * 2.9, -2.2, 0.5) }); }
  for (const s of [-1, 1]) gp.push({ geo: new THREE.CylinderGeometry(0.45, 0.45, 0.26, 10).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(s * 0.3, -3.45, -14.5) }); gp.push({ geo: new THREE.BoxGeometry(0.22, 2, 0.22), color: 0xbfc4c9, matrix: xform(0, -2.4, -14.5) });
  const gear = new THREE.Mesh(mergeColored(gp), lam());
  // perche (le long de +Z, pivot à l'origine) : fût, ailerons en V et tube coulissant
  const bm = new THREE.Mesh(mergeColored([
    { geo: new THREE.CylinderGeometry(0.36, 0.42, 9, 10).rotateX(Math.PI / 2), color: B, matrix: xform(0, 0, 4.5) }, { geo: new THREE.CylinderGeometry(0.44, 0.44, 0.5, 10).rotateX(Math.PI / 2), color: 0xf2c230, matrix: xform(0, 0, 8.6) },
    ...[-1, 1].map((s) => ({ geo: new THREE.BoxGeometry(2.6, 0.12, 1.2).translate(s * 1.4, 0, 0), color: D, matrix: xform(0, 0, 6.6, 0, 1, 1, 1, 0, s * 0.7) })),
  ]), lam());
  const tube = new THREE.Mesh(mergeColored([{ geo: new THREE.CylinderGeometry(0.2, 0.2, 9, 8).rotateX(Math.PI / 2), color: 0xd9dcdf, matrix: xform(0, 0, -4.5) }, { geo: new THREE.CylinderGeometry(0.3, 0.2, 0.7, 8).rotateX(Math.PI / 2), color: 0xd8312b, matrix: xform(0, 0, -0.35) }]), lam());
  tube.add(lightsPoints([0, 0, 0], 0x60ffb0, 3));
  const boom = new THREE.Group(); boom.position.set(...PORT); boom.rotation.order = 'YXZ'; boom.add(bm, tube); bm.castShadow = true;
  return { m, gear, boom, tube };
}

export class Tanker {
  constructor(scene) {
    this.rw = runways.find((r) => r.id === (BIG ? 'militaire' : 'aeroport'));
    this.root = new THREE.Group();
    const { m, gear, boom, tube } = bodyMesh();
    this.gear = gear; this.boom = boom; this.tube = tube; this.root.add(m, gear, boom);
    this.root.add(lightsPoints([-19.8, 0.6, 6.6], 0xff3020, 7), lightsPoints([19.8, 0.6, 6.6], 0x30ff60, 7), lightsPoints([0, 0.9, 20.2], 0xffffff, 6), lightsPoints([-0.8, -2.1, -3, 0.8, -2.1, -3, 0, -2.1, 8], 0xffe2a0, 4));
    scene.add(this.root);
    this.tip = new THREE.Vector3();
    this.cols = [addMoving(2.2, LEN / 2, 0, 1), addMoving(SPAN / 2, 2.6, 0, 1)];
    this.vel = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.bank = 0; this.pitch = 0; this.yaw = 0;
    this.out = 1; this.linked = false; this.xfer = 0; this.refuels = 0; this.near = false; this.cool = 0; this.info = null; this.t = 0;
    this.plan();
    this.s = this.sIn + this.lap * 0.22; this.v = CRUISE; this.wait = 0; this.lapN = 0;
    this.place(0);
  }

  /** Trajet complet : parking, décollage, tours de la carte, approche, atterrissage, retour au parking. */
  plan() {
    const rw = this.rw, L = rw.length / 2, fx = -Math.sin(rw.yaw), fz = -Math.cos(rw.yaw), y0 = rw.alt + 0.12 + STAND;
    const at = (lx, lz, y = y0) => { toWorld(rw, lx, lz, _w); return new THREE.Vector3(_w.x, y, _w.z); };
    const C = BIG ? { x: 0, z: -200, rx: 11000, rz: 8500, alt: 900 } : { x: 0, z: 0, rx: 5300, rz: 4700, alt: 620 };
    const th0 = Math.atan2((rw.z - C.z) / C.rz, (rw.x - C.x) / C.rx), sg = -C.rx * Math.sin(th0) * fx + C.rz * Math.cos(th0) * fz > 0 ? 1 : -1;
    const ell = (th) => { const x = C.x + Math.cos(th) * C.rx, z = C.z + Math.sin(th) * C.rz; return new THREE.Vector3(x, Math.max(C.alt, this.clear(x, z)), z); };
    const k = BIG ? 1 : 0.62, a0 = th0 + sg * 0.62, N = 64;
    // au sol : toujours sur le goudron, la pompe est l'arrêt (points en repère de la piste)
    const path = (list) => list.map(([x, z]) => at(x, z));
    const [PX, PZ] = BIG ? [milBase.fuel.lx, milBase.fuel.lz] : [fuelStation.lx, fuelStation.lz], X = rw.width / 2 + (BIG ? 24 : 27);
    this.pump = at(PX, PZ).clone();
    const taxi1 = path(BIG
      ? [[PX, PZ], [PX - 1, PZ - 24], [PX - 9, PZ - 46], [PX - 22, PZ - 46], [X, PZ - 22], [X, PZ + 20], [X, 0], [X, 300], [X, 440], [X, 476], [X - 7, 506], [X - 25, 520], [5, 508], [0, 482]]
      : [[PX, PZ], [PX, PZ + 40], [PX - 3, PZ + 90], [PX - 12, L - 125], [X, L - 80], [X - 10, L - 48], [22, L - 34], [5, L - 48], [0, L - 76]]);
    const out = [at(0, L - 160), at(0, 0), at(0, -L + 240, y0 + 2), at(0, -L - 300 * k, y0 + 60), at(0, -L - 1500 * k, y0 + 190), at(0, -L - 2900 * k, y0 + 330)];
    const loop = []; for (let i = 0; i < N * LAPS; i++) loop.push(ell(a0 + (sg * i * 2 * Math.PI) / N));
    // on quitte la boucle assez tôt pour s'aligner loin derrière la piste
    const cut = Math.round(((1.3) / (2 * Math.PI)) * N); loop.splice(loop.length - cut, cut);
    const inn = [at(0, L + 5600 * k, y0 + 430), at(0, L + 3800 * k, y0 + 270), at(0, L + 2200 * k, y0 + 150), at(0, L + 900 * k, y0 + 58), at(0, L + 120, y0 + 9), at(0, L - 90, y0), at(0, 80), at(0, BIG ? -225 : -10)];
    const back = path(BIG
      ? [[0, -262], [8, -287], [27, -299], [50, -301], [69, -311], [PX, PZ]]
      : [[0, -36], [8, -58], [27, -68], [X - 6, -56], [X, -26], [X, 120], [X, 330], [X + 6, 385], [PX - 3, 435], [PX, PZ]]);
    const seq = [taxi1, out, loop, inn, back], all = seq.flat(), curve = new THREE.CatmullRomCurve3(all, false, 'centripetal');
    // échantillonnage régulier, en repérant l'abscisse de quelques points-clés
    const n = all.length - 1, sub = 24, raw = [], mark = []; let acc = 0, prev = null;
    for (let i = 0; i <= n * sub; i++) { const p = curve.getPoint(i / (n * sub)); if (prev) acc += p.distanceTo(prev); raw.push([acc, p]); if (i % sub === 0) mark.push(acc); prev = p; }
    this.len = acc; this.pts = []; let j = 0;
    for (let s = 0; s <= acc; s += STEP) { while (j < raw.length - 2 && raw[j + 1][0] < s) j++; const [a, A] = raw[j], [b, B] = raw[j + 1]; this.pts.push(A.clone().lerp(B, clamp((s - a) / (b - a || 1), 0, 1))); }
    // relief : marge au-dessus du sol sur tout le trajet en vol
    const o0 = taxi1.length, o1 = o0 + out.length, o2 = o1 + loop.length, o3 = o2 + inn.length;
    this.sRoll = mark[o0 - 1]; this.sIn = mark[o1 + 2]; this.sOut = mark[o2 - 1]; this.sTouch = mark[o3 - 3]; this.sStop = mark[o3 - 1]; this.sLift = mark[o0 + 2]; this.sHold = mark[o0 - 4];
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
    if (this.wait > 0) { // à la pompe ; il libère la place si le joueur arrive
      this.wait -= dt; this.v = 0;
      if (plane && plane.onGround && !plane.crashed && this.wait > 2 && plane.pos.distanceTo(this.pump) < 160) this.wait = 2;
    }
    else {
      let target = CRUISE, acc = 2.4;
      const ground = this.s < this.sRoll || this.s > this.sStop;
      if (this.s < this.sLift) acc = 3.2;
      if (ground) {
        // sur le goudron : ralentit dans les virages, attend avant la piste si elle est prise, s'arrête derrière le joueur
        this.at(this.s + 6, _v).sub(this.at(this.s - 6, _d)); this.at(this.s + 34, _p).sub(this.at(this.s + 22, _d));
        target = Math.abs(Math.atan2(_v.x * _p.z - _v.z * _p.x, _v.x * _p.x + _v.z * _p.z)) > 0.25 ? 6 : 13; acc = 1.2;
        if (this.s < this.sRoll && Math.abs(this.s - this.sHold) < 10 && this.busy(plane)) target = 0;
        if (plane && plane.onGround && !plane.crashed) { _p.subVectors(plane.pos, this.pos); if (_p.length() < 62 && _p.x * _v.x + _p.z * _v.z > 0.3 * _p.length() * _v.length()) target = 0; }
      }
      for (const [s, v] of this.limits) { if (v === 0 && this.s < this.sStop - 60) continue; const d = s - this.s; if (d >= 0) target = Math.min(target, Math.sqrt(v * v + 2 * (v === 0 ? 0.6 : v === TAXI ? 3.2 : 0.55) * d) + (v === 0 ? 0.2 : 0)); }
      this.v += clamp(target - this.v, -3.6 * dt, acc * dt);
      this.s += this.v * dt;
      // piste occupée : on refait un tour
      if (this.s >= this.sOut && this.s - this.v * dt < this.sOut && this.busy(plane)) this.s -= this.lap;
      if (this.s >= this.len - 1) { this.s = 0; this.wait = WAIT; this.v = 0; }
    }
    this.place(dt);
    this.assist(dt, plane);
    this.drawBoom(dt, plane);
  }

  /** Branchement du Jet : approche aidée, transfert, débranchement. */
  assist(dt, plane) {
    this.near = false; this.info = null; this.cool -= dt;
    if (!plane || !plane.spec.afterburner || plane.onGround || plane.crashed || !this.flying) { this.unlink(); return; }
    _d.set(...TIP); _d.x += Math.sin(this.t * 0.7) * 0.25; _d.y += Math.sin(this.t * 1.1) * 0.2;
    _d.applyQuaternion(this.root.quaternion).add(this.pos); // bout de la perche
    _p.set(...RECEPT).applyQuaternion(plane.quat).add(plane.pos);
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
    // coup de pouce : tout près derrière, la vitesse s'accorde et le Jet glisse vers le bout de la perche
    if (aligned && this.cool <= 0 && along > -8 && along < 90 && Math.abs(side) < 30 && Math.abs(r.y) < 22) {
      const k = smoothstep(90, 12, d);
      plane.vel.addScaledVector(_p.copy(this.vel).sub(plane.vel), (1 - Math.exp(-0.55 * k * dt)));
      const n = Math.max(d, 1); plane.vel.addScaledVector(r, (2.6 * k * dt) / n * Math.min(1, d / 4)); plane.pos.addScaledVector(r, (0.9 * k * dt) / n);
      if (d < 5.5 && Math.abs(rel) < 14) { this.linked = true; this.force = 0; this.event = 'on'; if (plane.fuelOn) this.xfer = plane.fuel; else this.xfer = 0; }
    }
  }
  unlink(cool = 0) { if (this.linked) { this.linked = false; this.cool = cool; } }

  /** Perche : repliée au sol, déployée en vol ; branchée, elle suit le réceptacle du Jet. */
  drawBoom(dt, plane) {
    this.out += ((this.flying ? 1 : 0) - this.out) * (1 - Math.exp(-dt * 0.5));
    let a = -0.06 + (ANG + 0.06) * this.out + Math.sin(this.t * 1.1) * 0.012 * this.out, b = Math.sin(this.t * 0.7) * 0.016 * this.out, len = 9.6 + (REACH - 9.6) * this.out;
    if (this.linked && plane) {
      _p.set(...RECEPT).applyQuaternion(plane.quat).add(plane.pos).sub(this.pos).applyQuaternion(_q.copy(this.root.quaternion).invert());
      _p.x -= PORT[0]; _p.y -= PORT[1]; _p.z -= PORT[2];
      a = Math.atan2(-_p.y, Math.hypot(_p.x, _p.z)); b = Math.atan2(_p.x, _p.z); len = clamp(_p.length(), 9.6, 18);
    }
    const f = 1 - Math.exp(-dt * (this.linked ? 8 : 3));
    this.ba = (this.ba ?? a) + (a - (this.ba ?? a)) * f; this.bb = (this.bb ?? b) + (b - (this.bb ?? b)) * f; this.bl = (this.bl ?? len) + (len - (this.bl ?? len)) * f;
    this.boom.rotation.set(this.ba, this.bb, 0); this.tube.position.z = this.bl;
  }

  /** Panneau affiché près du ravitailleur. */
  hud(plane) {
    const i = this.info; if (!i) return null;
    const dir = [Math.abs(i.up) > 2 ? (i.up > 0 ? 'monte' : 'descends') : '', Math.abs(i.side) > 2 ? (i.side > 0 ? 'à droite' : 'à gauche') : ''].filter(Boolean).join(', ') || 'dans l\'axe';
    return {
      title: 'Ravitaillement en vol', big: this.linked ? `${Math.round(this.xfer * 100)} %` : i.d > 999 ? `${(i.d / 1000).toFixed(1).replace('.', ',')}` : `${Math.round(i.d)}`, unit: this.linked ? 'transfert' : i.d > 999 ? 'km de la perche' : 'm de la perche',
      lines: this.linked ? ['branché : laisse-toi guider', 'Espace pour te débrancher'] : [`ravitailleur : ${Math.round(this.v * 3.6)} km/h · toi : ${i.rel >= 0 ? '+' : ''}${Math.round(i.rel * 3.6)}`, i.along < -8 ? 'passe derrière lui' : i.d < 400 ? dir : 'place-toi derrière, sous la queue'],
      bar: this.linked ? this.xfer : clamp(1 - i.d / 400, 0, 1),
    };
  }
}
