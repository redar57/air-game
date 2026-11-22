import * as THREE from 'three';
import { mergeColored, xform, clamp, mulberry32 } from './util.js';
import { randomClearSpot } from './world/sites.js';

// Largage de matériel (Bipoutre) : quatre charges à bord (jeep, caisses, canon…), larguées une à une par l'arrière (X).
// La charge tombe, son parachute s'ouvre, puis elle descend droit avec le vent : une croix au sol, devant l'avion,
// montre en permanence où elle tomberait. On recharge à l'arrêt sur une piste ou sur l'aire de la base militaire.

const CAP = 4, MIN_AGL = 120, MAX_SPEED = 100, NEED = 2, WIND = 1.2, SINK = 8;
const KINDS = ['jeep', 'caisses', 'canon', 'caisses'];
const NAMES = { jeep: 'jeep', caisses: 'caisses', canon: 'canon' };
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _p = new THREE.Vector3(), _v = new THREE.Vector3();

function loadMesh(kind) {
  const parts = [], K = 0x1b1c1e, O = 0x6b7048, D = 0x4d5434;
  const B = (w, h, d, c, x, y, z, ry = 0, rx = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry, 1, 1, 1, rx) });
  if (kind === 'jeep') {
    B(1.7, 0.6, 3.6, O, 0, 0.85, 0); B(1.5, 0.3, 1.2, O, 0, 1.25, -1.1); B(1.5, 0.7, 0.08, 0x3a5a70, 0, 1.6, -0.5, 0, -0.2); B(1.4, 0.4, 0.3, D, 0, 1.3, 0.7); B(1.5, 0.9, 0.4, D, 0, 1.3, 1.6); B(0.7, 0.7, 0.2, K, 0, 1.1, 1.9);
    for (const x of [-0.85, 0.85]) for (const z of [-1.2, 1.2]) parts.push({ geo: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 9).rotateZ(Math.PI / 2), color: K, matrix: xform(x, 0.42, z) });
  } else if (kind === 'canon') {
    B(0.3, 0.3, 3.4, D, 0, 1.2, -0.8, 0, 0.12); B(1.9, 1.1, 0.12, O, 0, 1.2, 0.2); B(0.2, 0.2, 2.6, D, 0.4, 0.5, 1.4, 0.2); B(0.2, 0.2, 2.6, D, -0.4, 0.5, 1.4, -0.2);
    for (const x of [-0.95, 0.95]) parts.push({ geo: new THREE.CylinderGeometry(0.6, 0.6, 0.25, 10).rotateZ(Math.PI / 2), color: K, matrix: xform(x, 0.6, 0.3) });
  } else {
    B(2.4, 0.25, 2.4, 0x9a7650, 0, 0.13, 0);
    for (const [x, y, z, c] of [[-0.6, 0.8, -0.6, 0x8a6a42], [0.6, 0.8, -0.6, 0x7a5c38], [-0.6, 0.8, 0.6, 0x7a5c38], [0.6, 0.8, 0.6, 0x8a6a42], [0, 1.85, 0, 0x8a6a42]]) { B(1.1, 1.05, 1.1, c, x, y, z); B(1.14, 0.12, 1.14, D, x, y + 0.2, z); }
    B(0.5, 0.5, 0.06, 0xf4f4ee, 0, 1.9, 0.57); B(0.4, 0.12, 0.07, 0xd8312b, 0, 1.9, 0.58); B(0.12, 0.4, 0.07, 0xd8312b, 0, 1.9, 0.58);
  }
  const g = new THREE.Group(), body = new THREE.Mesh(mergeColored(parts), lam());
  body.castShadow = true; g.add(body);
  // trois coupoles et leurs suspentes
  const cp = [];
  for (let k = 0; k < 3; k++) {
    const a = k * 2.094, x = Math.cos(a) * 2.7, z = Math.sin(a) * 2.7;
    for (let q = 0; q < 8; q++) cp.push({ geo: new THREE.SphereGeometry(2.6, 1, 3, q * 0.7854, 0.7854, 0, 1.35), color: q % 2 ? 0xe8e2cf : 0x8a8f63, matrix: xform(x, 8.2, z, 0, 1, 0.75, 1) });
    for (let q = 0; q < 4; q++) { const u = x + Math.cos(q * 1.571) * 2.4, w = z + Math.sin(q * 1.571) * 2.4, L = Math.hypot(u, 6.9, w); const m = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(u, 6.9, w).normalize())); m.setPosition(u / 2, 1.8 + 3.4, w / 2); cp.push({ geo: new THREE.CylinderGeometry(0.02, 0.02, L, 3), color: 0x333333, matrix: m }); }
  }
  const chute = new THREE.Mesh(mergeColored(cp), lam({ side: THREE.DoubleSide }));
  chute.castShadow = true; chute.scale.setScalar(0.01); g.add(chute);
  return { g, chute };
}

/** Un pas de chute : ouverture au bout d'une seconde, puis descente freinée, portée par le vent d'ouest. */
function fall(o, dt) {
  o.t += dt;
  const open = clamp((o.t - 0.9) / 1.1, 0, 1), k = 0.25 + open * 1.5;
  o.v.y -= 9.81 * dt;
  o.v.y += (Math.max(o.v.y, -SINK) - o.v.y) * (1 - Math.exp(-dt * 4 * open));
  const f = 1 - Math.exp(-dt * k * 0.55);
  o.v.x += (WIND * open - o.v.x) * f; o.v.z += -o.v.z * f;
  o.p.addScaledVector(o.v, dt);
  return open;
}

class Airdrop {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'airdrop'; this.title = 'Largage de matériel';
    this.aboard = [...KINDS]; this.loadAcc = 0; this.loading = false; this.prevFire = false; this.cool = 0;
    this.delivered = 0; this.bulls = 0; this.hits = 0; this.loads = [];
    this.rnd = mulberry32((Math.random() * 1e9) | 0);
    const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false, side: THREE.DoubleSide });
    this.marker = new THREE.Group();
    for (const [r0, r1, c] of [[97, 100, 0xffffff], [28, 31, 0xffd34d], [0, 5, 0xffd34d]]) this.marker.add(new THREE.Mesh(new THREE.RingGeometry(r0, r1, 56).rotateX(-Math.PI / 2), mat(c, 0.85)));
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.marker.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 500, 10, 1, true).translate(0, 250, 0), this.beamMat));
    // point de chute prévu
    this.aim = new THREE.Group();
    const am = new THREE.MeshBasicMaterial({ color: 0x35e0ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
    this.aim.add(new THREE.Mesh(new THREE.RingGeometry(8, 10, 32).rotateX(-Math.PI / 2), am), new THREE.Mesh(new THREE.PlaneGeometry(26, 1.6).rotateX(-Math.PI / 2), am), new THREE.Mesh(new THREE.PlaneGeometry(1.6, 26).rotateX(-Math.PI / 2), am));
    this.aim.renderOrder = 5;
    ctx.scene.add(this.marker, this.aim);
    this.ghost = { p: new THREE.Vector3(), v: new THREE.Vector3(), t: 0 };
    this.zone = null; this.miss = null;
    this.pick();
  }
  pick() {
    const { span, villages, trees, board } = this.ctx;
    let z = null;
    for (let n = 0; n < 25; n++) { // un pré dégagé, sans relief autour (on doit pouvoir l'approcher bas)
      z = randomClearSpot(this.rnd, span * 0.85, 35, villages, trees, { from: board, minD: 1500, maxD: span * 0.5, tries: 2000, maxH: 300, flat: 0.94 }) || z;
      let top = 0;
      if (z) for (let a = 0; a < 12; a++) for (const r of [500, 1000, 1500]) top = Math.max(top, this.ctx.heightAt(z.x + Math.cos(a * 0.524) * r, z.z + Math.sin(a * 0.524) * r));
      if (z && top < z.y + 110) break;
    }
    this.zone = z; this.hits = 0; this.marker.visible = !!z;
    if (z) this.marker.position.set(z.x, z.y + 0.6, z.z);
  }
  get pins() {
    const out = [];
    if (this.zone) out.push({ x: this.zone.x, z: this.zone.z, color: '#ffd34d', icon: '✚' });
    if (!this.aboard.length && this.ctx.board) out.push({ x: this.ctx.board.x, z: this.ctx.board.z, color: '#3fae4a', icon: '+' });
    return out;
  }
  exit(plane, out) { return out.copy(plane.pos).addScaledVector(plane.fwd, -plane.spec.len * 0.32).addScaledVector(plane.up, -1.2); }
  drop(plane) {
    const kind = this.aboard.shift(), { g, chute } = loadMesh(kind);
    const o = { kind, g, chute, p: g.position, v: plane.vel.clone().multiplyScalar(0.94), t: 0, landed: 0, zone: this.zone };
    this.exit(plane, g.position); g.rotation.y = Math.atan2(-plane.fwd.x, -plane.fwd.z);
    this.ctx.scene.add(g); this.loads.push(o);
    this.ctx.sound.click(true); this.ctx.ui.toast(`Largué : ${NAMES[kind]}`, 1200);
  }
  predict(plane) {
    const o = this.ghost, { heightAt } = this.ctx;
    this.exit(plane, o.p); o.v.copy(plane.vel).multiplyScalar(0.94); o.t = 0;
    for (let i = 0; i < 240; i++) { fall(o, o.t < 4 ? 0.1 : 0.5); if (o.p.y <= Math.max(0, heightAt(o.p.x, o.p.z))) break; }
    return o.p;
  }
  update(dt, plane, input) {
    const { ui, sound, heightAt, canBoard } = this.ctx;
    this.cool -= dt;
    this.loading = plane.onGround && plane.groundSpeed < 1 && this.aboard.length < CAP && canBoard(plane.pos.x, plane.pos.z);
    if (this.loading) {
      if (this.loadAcc === 0) ui.toast('Chargement…', 1500);
      if ((this.loadAcc += dt) > 1.4) { this.loadAcc = 0.001; this.aboard.push(KINDS[this.aboard.length]); sound.click(false); if (this.aboard.length === CAP) { ui.toast('Soute pleine : quatre charges. En route pour la cible jaune !', 2600); sound.chime(1); } }
    } else this.loadAcc = 0;
    const agl = plane.agl + plane.standH, fire = input.fireHeld();
    if (fire && !this.prevFire && this.cool <= 0) {
      if (plane.onGround) ui.toast('Décolle d\'abord : on largue en vol', 1800);
      else if (!this.aboard.length) ui.toast("Soute vide : recharge à l'arrêt sur une piste", 2200);
      else if (agl < MIN_AGL) ui.toast(`Trop bas : monte au-dessus de ${MIN_AGL} m`, 1800);
      else if (plane.speed > MAX_SPEED) ui.toast(`Trop vite : ralentis sous ${Math.round(MAX_SPEED * 3.6)} km/h`, 1800);
      else { this.drop(plane); this.cool = 0.7; }
    }
    this.prevFire = fire;
    // point de chute
    const ready = !plane.onGround && this.aboard.length > 0 && agl > MIN_AGL * 0.6 && agl < 900;
    this.aim.visible = ready; this.miss = null;
    if (ready) {
      const p = this.predict(plane); this.aim.position.set(p.x, Math.max(0, heightAt(p.x, p.z)) + 1.5, p.z);
      this.aim.scale.setScalar(clamp(agl / 250, 0.8, 2.2));
      if (this.zone) { // écart le long de la route : positif = la charge tomberait trop court
        const dx = this.zone.x - p.x, dz = this.zone.z - p.z, h = Math.hypot(plane.vel.x, plane.vel.z) || 1;
        this.miss = { d: Math.hypot(dx, dz), ahead: (dx * plane.vel.x + dz * plane.vel.z) / h };
      }
    }
    for (const o of this.loads) {
      if (o.landed) {
        o.landed += dt;
        o.chute.scale.y = Math.max(0.04, o.chute.scale.y - dt * 0.8); o.chute.position.x += o.landed < 2 ? dt * 2 : 0;
        if (o.landed > 6) o.chute.visible = false;
        if (o.kind === 'jeep' && o.drive && o.landed > 5) { // la jeep rejoint la cible
          const dx = o.drive.x - o.p.x, dz = o.drive.z - o.p.z, d = Math.hypot(dx, dz);
          if (d > 8) { o.p.x += (dx / d) * 6 * dt; o.p.z += (dz / d) * 6 * dt; o.p.y = heightAt(o.p.x, o.p.z); let dy = Math.atan2(-dx, -dz) - o.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); o.g.rotation.y += clamp(dy, -2 * dt, 2 * dt); }
        }
        continue;
      }
      const open = fall(o, dt), gy = Math.max(0, heightAt(o.p.x, o.p.z));
      o.chute.scale.setScalar(Math.max(0.01, open)); o.g.rotation.z = Math.sin(o.t * 1.6) * 0.08 * open; o.g.rotation.x = Math.cos(o.t * 1.3) * 0.06 * open;
      if (o.p.y <= gy) { o.p.y = gy; o.g.rotation.z = o.g.rotation.x = 0; o.landed = 0.001; this.land(o); }
    }
    this.loads = this.loads.filter((o) => { if (o.landed > 150) { this.ctx.scene.remove(o.g); return false; } return true; });
    if (this.zone) this.beamMat.opacity = 0.32 * clamp((Math.hypot(plane.pos.x - this.zone.x, plane.pos.z - this.zone.z) - 200) / 1500, 0.15, 1);
    return null;
  }
  land(o) {
    const { ui, sound, heightAt } = this.ctx, z = o.zone, name = NAMES[o.kind][0].toUpperCase() + NAMES[o.kind].slice(1);
    if (heightAt(o.p.x, o.p.z) < 0) { o.g.visible = false; ui.toast(`${name} : à l'eau !`, 2000); return; }
    if (!z) return;
    const d = Math.hypot(o.p.x - z.x, o.p.z - z.z);
    if (d < 100) {
      this.delivered++; if (d < 30) this.bulls++;
      o.drive = { x: z.x + (this.rnd() - 0.5) * 12, z: z.z + (this.rnd() - 0.5) * 12 };
      sound.chime(d < 30 ? 3 : 2);
      const done = z === this.zone && ++this.hits >= NEED;
      ui.toast(d < 30 ? `${name} : en plein dans la cible (${Math.round(d)} m) !` : `${name} : dans la zone (${Math.round(d)} m)`, 2200);
      if (done) { this.pick(); setTimeout(() => ui.toast('Livraison terminée. Nouvelle cible jaune (N : carte)', 2400), 2400); }
    } else ui.toast(`${name} : hors zone, à ${Math.round(d)} m`, 2000);
  }
  hud() {
    const p = this.ctx.plane(), z = this.zone, d = z ? Math.hypot(p.pos.x - z.x, p.pos.z - z.z) : 0, m = this.miss;
    return {
      title: this.title, big: `${this.delivered}`, unit: 'livrées',
      lines: [this.loading ? 'chargement…' : this.aboard.length ? `à bord : ${this.aboard.map((k) => NAMES[k]).join(', ')}` : "soute vide : recharge à l'arrêt sur une piste",
        z ? `cible : ${(d / 1000).toFixed(1).replace('.', ',')} km · ${this.hits}/${NEED} livrées ici` : '',
        m && d < 2500 ? (m.d < 30 ? 'X : LARGUE !' : m.ahead > 0 ? `chute prévue ${Math.round(m.d)} m avant la cible` : `chute prévue ${Math.round(m.d)} m après la cible`) : `X : larguer (au-dessus de ${MIN_AGL} m)`],
      bar: this.aboard.length / CAP,
    };
  }
  dispose() { this.ctx.scene.remove(this.marker, this.aim); for (const o of this.loads) this.ctx.scene.remove(o.g); }
}
export function createAirdrop(ctx) { return new Airdrop(ctx); }
