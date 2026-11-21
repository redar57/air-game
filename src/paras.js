import * as THREE from 'three';
import { mergeColored, xform, clamp, mulberry32 } from './util.js';
import { randomClearSpot } from './world/sites.js';

// Parachutistes (C-17) : on embarque une section à l'arrêt sur l'aire verte de la base militaire
// (sur la petite carte : sur une piste), puis on les largue (X) au-dessus de la zone de saut.
// Chaque parachutiste tombe quelques secondes, ouvre sa voile puis se dirige vers la croix ; il ne
// peut rattraper qu'une partie de l'écart (finesse ~2), il faut donc larguer au bon endroit, assez haut.

const CAP = 12, STICK = 4, MIN_AGL = 250, MAX_SPEED = 95;
const _v = new THREE.Vector3(), _p = new THREE.Vector3();
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const CANOPY = [0x5f6b45, 0x7a7f4a, 0xc9b98a, 0x46502f];

function paraMesh(color) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(mergeColored([
    { geo: new THREE.BoxGeometry(0.5, 0.75, 0.32), color: 0x5f6b45, matrix: xform(0, 1.15, 0) },
    { geo: new THREE.BoxGeometry(0.42, 0.8, 0.28), color: 0x46502f, matrix: xform(0, 0.4, 0) },
    { geo: new THREE.BoxGeometry(0.3, 0.3, 0.3), color: 0xe0b48f, matrix: xform(0, 1.7, 0) },
    { geo: new THREE.BoxGeometry(0.36, 0.18, 0.36), color: 0x3a4030, matrix: xform(0, 1.88, 0) },
    { geo: new THREE.BoxGeometry(0.45, 0.5, 0.22), color: 0x3a4030, matrix: xform(0, 1.2, 0.27) },
  ]), lam());
  g.add(body);
  // voile rectangulaire (aile de caissons) et suspentes
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.16, x = Math.sin(a) * 4.2, y = Math.cos(a) * 4.2 - 4.2;
    parts.push({ geo: new THREE.BoxGeometry(0.95, 0.35, 2.4), color: i % 2 ? color : 0xe8e2cf, matrix: xform(x, y, 0, 0, 1, 1, 1, 0, -a) });
  }
  for (const [x, z] of [[-2.6, -1], [2.6, -1], [-2.6, 1], [2.6, 1]]) {
    const a = new THREE.Vector3(x, -0.6, z), b = new THREE.Vector3(0, -4.6, 0), len = a.distanceTo(b);
    const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    m.setPosition((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push({ geo: new THREE.CylinderGeometry(0.02, 0.02, len, 3), color: 0x333333, matrix: m });
  }
  const chute = new THREE.Mesh(mergeColored(parts), lam({ side: THREE.DoubleSide }));
  const holder = new THREE.Group();
  holder.position.y = 6.4;
  holder.add(chute);
  holder.scale.setScalar(0.01);
  g.add(holder);
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, holder };
}

class Paras {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'paras'; this.title = 'Parachutistes';
    this.aboard = CAP; this.loadAcc = 0; this.loading = false; this.prevFire = false;
    this.jumping = 0; this.jumpT = 0; this.stick = null;
    this.landed = 0; this.onTarget = 0; this.paras = [];
    this.rnd = mulberry32((Math.random() * 1e9) | 0);
    // zone de saut : grand cercle blanc, croix orange au centre, colonne lumineuse
    this.marker = new THREE.Group();
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
    const orange = new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide });
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(97, 100, 64).rotateX(-Math.PI / 2), white));
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(23, 25, 40).rotateX(-Math.PI / 2), white));
    this.marker.add(new THREE.Mesh(new THREE.PlaneGeometry(36, 5).rotateX(-Math.PI / 2), orange));
    this.marker.add(new THREE.Mesh(new THREE.PlaneGeometry(5, 36).rotateX(-Math.PI / 2), orange));
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xff7a1f, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.marker.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 500, 10, 1, true).translate(0, 250, 0), this.beamMat));
    ctx.scene.add(this.marker);
    this.zone = null;
    this.pick();
  }
  /** Nouvelle zone de saut : un pré dégagé, à bonne distance de l'aire d'embarquement. */
  pick() {
    const { span, villages, trees, board } = this.ctx;
    const z = randomClearSpot(this.rnd, span * 0.85, 40, villages, trees, { from: board, minD: 1800, maxD: span * 0.55, tries: 3000, maxH: 500, flat: 0.95 })
      || randomClearSpot(this.rnd, span * 0.85, 25, villages, null, { tries: 3000, flat: 0.93 });
    if (!z) { this.marker.visible = false; return; }
    this.zone = z;
    this.marker.position.set(z.x, z.y + 0.5, z.z);
    this.marker.visible = true;
  }
  get pins() {
    const out = [];
    if (this.zone) out.push({ x: this.zone.x, z: this.zone.z, color: '#ff7a1f', icon: '✚' });
    if (this.aboard < CAP && this.ctx.board) out.push({ x: this.ctx.board.x, z: this.ctx.board.z, color: '#3fae4a', icon: '🪖' });
    return out;
  }
  jump(plane) {
    const { g, holder } = paraMesh(CANOPY[Math.floor(this.rnd() * CANOPY.length)]);
    // sortie par la rampe arrière
    _p.copy(plane.pos).addScaledVector(plane.fwd, -plane.spec.len * 0.45).addScaledVector(plane.up, -1.5);
    g.position.copy(_p);
    g.rotation.y = Math.atan2(-plane.fwd.x, -plane.fwd.z);
    this.ctx.scene.add(g);
    this.paras.push({ g, holder, vel: plane.vel.clone().multiplyScalar(0.85), t: 0, open: 0, landed: 0, stick: this.stick, zone: this.zone });
    this.aboard--;
    this.ctx.sound.click(true);
  }
  update(dt, plane, input) {
    const { ui, sound, heightAt, canBoard } = this.ctx;
    // embarquement : à l'arrêt sur l'aire verte
    this.loading = plane.onGround && plane.groundSpeed < 1 && canBoard(plane.pos.x, plane.pos.z) && this.aboard < CAP;
    if (this.loading) {
      if (this.loadAcc === 0) ui.toast('Embarquement de la section…', 1500);
      this.loadAcc += dt;
      if (this.loadAcc > 0.7) {
        this.loadAcc = 0.001; this.aboard++; sound.click(false);
        if (this.aboard === CAP) { ui.toast(`Section embarquée : ${CAP} parachutistes. En route pour la croix orange !`, 2600); sound.chime(1); }
      }
    } else this.loadAcc = 0;
    // largage : X lâche un groupe de 4, l'un après l'autre
    const fire = input.fireHeld();
    if (fire && !this.prevFire && !this.jumping) {
      const agl = plane.agl + plane.standH;
      if (plane.onGround) ui.toast('Décolle d\'abord : on saute en vol, au-dessus de la croix orange', 1800);
      else if (!this.aboard) ui.toast(this.ctx.boardHint, 2400);
      else if (agl < MIN_AGL) ui.toast(`Trop bas pour sauter : monte au-dessus de ${MIN_AGL} m`, 2000);
      else if (plane.speed > MAX_SPEED) ui.toast(`Trop vite pour sauter : ralentis sous ${Math.round(MAX_SPEED * 3.6)} km/h`, 2000);
      else { this.jumping = Math.min(STICK, this.aboard); this.jumpT = 0; this.stick = { n: this.jumping, done: 0, hits: 0, zone: this.zone }; ui.toast('Go ! Go ! Go !', 1200); sound.chime(1); }
    }
    this.prevFire = fire;
    if (this.jumping) {
      this.jumpT -= dt;
      if (this.jumpT <= 0) { this.jump(plane); this.jumping--; this.jumpT = 0.45; }
    }
    // parachutistes en l'air
    for (const pa of this.paras) {
      const p = pa.g.position;
      if (pa.landed) {
        pa.landed += dt;
        pa.holder.scale.y = Math.max(0.05, pa.holder.scale.y - dt * 0.7);
        pa.holder.rotation.x = Math.min(1.4, pa.holder.rotation.x + dt * 0.8);
        continue;
      }
      pa.t += dt;
      const gy = Math.max(heightAt(p.x, p.z), 0), agl = p.y - gy;
      // ouverture au bout de 3 s de chute (plus tôt si le sol approche)
      if (!pa.open && (pa.t > 3 || agl < 220)) pa.open = 0.001;
      if (pa.open) pa.open = Math.min(1, pa.open + dt / 1.2);
      pa.holder.scale.setScalar(Math.max(0.01, pa.open));
      if (!pa.open) {
        pa.vel.y -= 9.8 * dt;
        pa.vel.multiplyScalar(1 - Math.min(1, dt * (0.05 + pa.vel.length() * 0.004))); // vitesse limite ~50 m/s
      } else {
        // sous voile : il descend à 6,5 m/s et se dirige vers la croix (vent léger d'ouest)
        const z = pa.zone || this.zone, k = Math.min(1, dt * 1.6 * pa.open);
        let tx = 1.2, tz = 0;
        if (z) {
          const dx = z.x - p.x, dz = z.z - p.z, d = Math.hypot(dx, dz) || 1, sp = Math.min(10, d * 0.25);
          tx += (dx / d) * sp; tz += (dz / d) * sp;
          let dy = Math.atan2(-dx, -dz) - pa.g.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          pa.g.rotation.y += clamp(dy, -dt, dt);
        }
        pa.vel.x += (tx - pa.vel.x) * k; pa.vel.z += (tz - pa.vel.z) * k;
        pa.vel.y += (-6.5 - pa.vel.y) * Math.min(1, dt * 2.5 * pa.open);
        pa.g.rotation.z = Math.sin(pa.t * 1.4) * 0.06;
      }
      p.addScaledVector(pa.vel, dt);
      if (p.y <= gy) { p.y = gy; pa.landed = 0.001; pa.g.rotation.z = 0; this.land(pa); }
    }
    this.paras = this.paras.filter((pa) => {
      if (pa.landed > 30) { this.ctx.scene.remove(pa.g); return false; }
      return true;
    });
    if (this.zone) {
      const d = Math.hypot(plane.pos.x - this.zone.x, plane.pos.z - this.zone.z);
      this.beamMat.opacity = 0.32 * clamp((d - 200) / 1500, 0.15, 1);
    }
    return null;
  }
  land(pa) {
    const { ui, sound, heightAt } = this.ctx, p = pa.g.position, z = pa.zone, st = pa.stick;
    this.landed++;
    let msg;
    if (heightAt(p.x, p.z) < 0) msg = 'Un parachutiste à l\'eau ! (repêché par un bateau)';
    else if (z) {
      const d = Math.hypot(p.x - z.x, p.z - z.z);
      if (d < 25) { this.onTarget++; if (st) st.hits++; msg = `🎯 Posé sur la croix (${Math.round(d)} m)`; }
      else if (d < 100) msg = `Posé dans la zone (${Math.round(d)} m)`;
      else msg = `Posé hors zone, à ${Math.round(d)} m de la croix`;
    }
    if (st) {
      st.done++;
      if (st.done === st.n) {
        msg = st.hits === st.n ? `🎯 Groupe parfait : ${st.n} sur ${st.n} sur la croix !` : `Groupe au sol : ${st.hits} sur ${st.n} sur la croix`;
        sound.chime(st.hits ? 3 : 2);
        if (st.zone === this.zone) { this.pick(); setTimeout(() => ui.toast('Nouvelle zone de saut : la croix orange (N : carte)', 2400), 2600); }
      }
    }
    if (msg) ui.toast(msg, 2200);
  }
  hud() {
    const p = this.ctx.plane(), z = this.zone, d = z ? Math.hypot(p.pos.x - z.x, p.pos.z - z.z) : 0;
    return {
      title: this.title, big: `${this.onTarget}`, unit: 'sur la croix',
      lines: [`🪂 à bord : ${this.aboard}/${CAP}${this.loading ? ' · embarquement…' : ''}`,
        z ? `zone de saut : ${(d / 1000).toFixed(1).replace('.', ',')} km` : '',
        this.aboard ? `X : faire sauter ${Math.min(STICK, this.aboard)} hommes (au-dessus de ${MIN_AGL} m, moins de ${Math.round(MAX_SPEED * 3.6)} km/h)` : this.ctx.boardHint],
      bar: this.aboard / CAP,
    };
  }
  dispose() {
    this.ctx.scene.remove(this.marker);
    for (const pa of this.paras) this.ctx.scene.remove(pa.g);
  }
}
export function createParas(ctx) { return new Paras(ctx); }
