import * as THREE from 'three';
import { mergeColored, xform, clamp, mulberry32 } from './util.js';
import { helipads } from './world/airfields.js';
import { clearSpot } from './world/sites.js';

// Missions d'hélicoptère au câble :
//  - Secours (hélicoptère de secours) : treuiller des naufragés et des randonneurs, puis les déposer à l'hôpital ;
//  - Élingue (Bi-rotor) : accrocher une charge sous la machine, la transporter et la poser en douceur.
// Le câble est un pendule : la charge se balance, traîne derrière en vol rapide et tire sur l'hélicoptère.

const G = 9.81, SUB = 1 / 120;
const _a = new THREE.Vector3(), _d = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3();
const lam = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });

/** Colonne lumineuse au-dessus d'un objectif (s'estompe quand on approche). */
function beam(color, h = 260) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, h, 10, 1, true).translate(0, h / 2, 0), mat);
  m.userData.noShadow = true;
  return m;
}
function fadeBeam(m, plane) {
  const d = Math.hypot(plane.pos.x - m.position.x, plane.pos.z - m.position.z);
  m.material.opacity = 0.32 * clamp((d - 120) / 900, 0.12, 1);
}
/** Cercle posé au sol (zone de dépose). */
function ring(color, r) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  g.add(new THREE.Mesh(new THREE.RingGeometry(r - 1.6, r, 48).rotateX(-Math.PI / 2), mat));
  g.add(new THREE.Mesh(new THREE.RingGeometry(1.5, 3, 24).rotateX(-Math.PI / 2), mat));
  return g;
}

// --------------------------------------------------------------------------- câble
export class Rope {
  constructor(scene, color = 0x22262b) {
    this.scene = scene;
    this.end = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.len = 2; this.slack = true;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color }));
    this.line.frustumCulled = false;
    this.hook = new THREE.Mesh(mergeColored([
      { geo: new THREE.CylinderGeometry(0.18, 0.18, 0.5, 6), color: 0xf2c230, matrix: xform(0, 0.1, 0) },
      { geo: new THREE.TorusGeometry(0.22, 0.06, 4, 8, Math.PI * 1.5), color: 0x5a5f66, matrix: xform(0, -0.3, 0) },
    ]), lam());
    scene.add(this.line, this.hook);
    this.anchor = new THREE.Vector3();
    this.hold = false;
  }
  reset(anchor) { this.end.copy(anchor); this.end.y -= this.len; this.vel.set(0, 0, 0); }
  /** Point d'accroche sous l'appareil (repère local -> monde). */
  anchorOf(plane, local) { return this.anchor.copy(local).applyQuaternion(plane.quat).add(plane.pos); }
  /**
   * Fait avancer le pendule. floor(x, z) : hauteur du sol (ou de l'eau) sous le bout du câble.
   * Renvoie l'accélération que la charge (rapport de masse k) imprime à l'appareil.
   */
  step(dt, plane, local, floor, k = 0.02, out = _a) {
    const A = this.anchorOf(plane, local);
    if (this.end.distanceTo(A) > this.len + 60) this.reset(A); // réapparition : on ramène le câble
    out.set(0, 0, 0);
    for (let t = 0; t < dt - 1e-6; t += SUB) {
      const h = Math.min(SUB, dt - t), e = this.end, v = this.vel;
      v.y -= G * h;
      const drag = 1 - Math.min(1, h * (0.25 + v.length() * 0.012));
      v.multiplyScalar(drag);
      e.addScaledVector(v, h);
      // câble tendu : le bout reste sur la sphère, la vitesse qui l'en éloignerait est annulée
      _d.subVectors(e, A); const d = _d.length();
      if (d > this.len) {
        _d.multiplyScalar(1 / d);
        e.copy(A).addScaledVector(_d, this.len);
        _r.copy(v).sub(plane.vel);
        const out_ = _r.dot(_d);
        if (out_ > 0) v.addScaledVector(_d, -out_);
      }
      const gy = floor(e.x, e.z);
      this.grounded = e.y <= gy + 0.02;
      if (this.grounded) {
        e.y = gy; if (v.y < 0) v.y = 0;
        v.x *= 1 - Math.min(1, h * 6); v.z *= 1 - Math.min(1, h * 6);
      }
    }
    // l'appareil porte la charge quand le câble est tendu et qu'elle ne repose pas au sol
    _d.subVectors(this.end, A); const dl = _d.length();
    this.slack = dl < this.len - 0.3;
    if (!this.slack && !this.grounded && dl > 0.1) {
      _d.multiplyScalar(1 / dl);
      out.copy(_d).multiplyScalar(G * k / Math.max(0.45, -_d.y));
      out.y = Math.min(out.y, 0);
    }
    const p = this.line.geometry.attributes.position;
    p.setXYZ(0, A.x, A.y, A.z); p.setXYZ(1, this.end.x, this.end.y, this.end.z); p.needsUpdate = true;
    this.hook.position.copy(this.end);
    return out;
  }
  set visible(v) { this.line.visible = v; this.hook.visible = v; }
  dispose() { this.scene.remove(this.line, this.hook); }
}

// --------------------------------------------------------------------------- secours au treuil
const CAP = 3;
const WINCH = new THREE.Vector3(2.05, 0.95, -0.6); // bout du bras de treuil (côté droit de l'hélicoptère de secours)

function personGeo(jacket, legs) {
  return mergeColored([
    { geo: new THREE.BoxGeometry(0.5, 0.75, 0.32), color: jacket, matrix: xform(0, 1.15, 0) },
    { geo: new THREE.BoxGeometry(0.42, 0.8, 0.28), color: legs, matrix: xform(0, 0.4, 0) },
    { geo: new THREE.BoxGeometry(0.3, 0.32, 0.3), color: 0xe0b48f, matrix: xform(0, 1.72, 0) },
  ]);
}
function victimMesh(kind) {
  const g = new THREE.Group();
  const person = new THREE.Group();
  person.add(new THREE.Mesh(personGeo(kind === 'sea' ? 0xf27a1f : 0x2f7fdc, 0x2b3440), lam()));
  const arm = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(0.14, 0.7, 0.14), color: kind === 'sea' ? 0xf27a1f : 0x2f7fdc, matrix: xform(0, 0.35, 0) }]), lam());
  arm.position.set(0.32, 1.45, 0); person.add(arm);
  g.add(person);
  if (kind === 'sea') { // canot de survie orange
    g.add(new THREE.Mesh(mergeColored([
      { geo: new THREE.TorusGeometry(1.25, 0.38, 6, 12).rotateX(Math.PI / 2), color: 0xf27a1f, matrix: xform(0, 0.15, 0) },
      { geo: new THREE.CircleGeometry(1.2, 12).rotateX(-Math.PI / 2), color: 0xd9632a, matrix: xform(0, 0.05, 0) },
    ]), lam()));
    person.position.y = -0.35;
  } else { // sac à dos rouge et petite tente
    person.add(new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(0.42, 0.55, 0.25), color: 0xd8312b, matrix: xform(0, 1.15, 0.28) }]), lam()));
    g.add(new THREE.Mesh(mergeColored([{ geo: new THREE.ConeGeometry(1.4, 1.5, 4), color: 0xf2c230, matrix: xform(2.6, 0.75, 0.8, Math.PI / 4, 1, 1, 1.5) }]), lam()));
  }
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return { g, person, arm };
}

class Rescue {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'secours'; this.title = 'Secours';
    this.rope = new Rope(ctx.scene, 0x2b2e33); this.rope.len = 1.2;
    this.victims = []; this.hooked = null; this.aboard = 0; this.rescued = 0; this.unloadT = 0;
    this.rnd = mulberry32((Math.random() * 1e9) | 0);
    this.pads = helipads.filter((p) => p.hospital || p.base);
    this.padBeams = this.pads.map((p) => { const b = beam(0x5fe07a, 200); b.position.set(p.x, p.y, p.z); ctx.scene.add(b); return b; });
    this.warnHigh = 0;
    for (let k = 0; k < 3; k++) this.spawn();
  }
  /** Un naufragé en mer (pas trop loin d'une côte) ou un randonneur coincé en montagne. */
  spawn() {
    const { heightAt, normalAt, span } = this.ctx, rnd = this.rnd, n = new THREE.Vector3();
    const home = this.pads.find((p) => p.hospital) || this.pads[0] || { x: 0, z: 0 }, maxD = span * 0.42;
    const kind = rnd() < 0.5 ? 'sea' : 'hill';
    for (let k = 0; k < 3000; k++) {
      const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span;
      if (Math.hypot(x - home.x, z - home.z) > maxD || Math.hypot(x - home.x, z - home.z) < 600) continue;
      if (this.victims.some((v) => Math.hypot(v.x - x, v.z - z) < 800)) continue;
      const h = heightAt(x, z);
      if (kind === 'sea') {
        if (h > -6) continue;
        let coast = false;
        for (let a = 0; a < 6.28 && !coast; a += 0.8) coast = heightAt(x + Math.cos(a) * 1400, z + Math.sin(a) * 1400) > 0;
        if (!coast) continue;
        this.add(kind, x, z, 0.2); return;
      }
      if (h < 140 || h > 1000 || normalAt(x, z, n).y < 0.8) continue;
      this.add(kind, x, z, h - 0.05); return;
    }
  }
  add(kind, x, z, y) {
    const { g, person, arm } = victimMesh(kind), b = beam(0xff8a3d);
    g.position.set(x, y, z); g.rotation.y = this.rnd() * 6.28;
    b.position.set(x, y, z);
    this.ctx.scene.add(g, b);
    this.victims.push({ kind, x, z, y, g, person, arm, beam: b, t: this.rnd() * 6, name: kind === 'sea' ? 'naufragé' : 'randonneur' });
  }
  remove(v) {
    this.ctx.scene.remove(v.g, v.beam);
    this.victims = this.victims.filter((w) => w !== v);
  }
  get nearest() {
    const p = this.ctx.plane().pos;
    let best = null, bd = Infinity;
    for (const v of this.victims) { if (v === this.hooked) continue; const d = Math.hypot(v.x - p.x, v.z - p.z); if (d < bd) { bd = d; best = v; } }
    return best ? { v: best, d: bd } : null;
  }
  update(dt, plane, input) {
    const { ui, sound, heightAt } = this.ctx;
    // treuil : X maintenue = on descend le câble, relâchée = il remonte
    const down = input.fireHeld() && !plane.onGround;
    if (down && this.aboard >= CAP && !this.hooked) { if (this.warnFull <= 0) ui.toast('Cabine pleine : dépose les blessés à l\'hôpital (croix verte sur la carte)', 2600); this.warnFull = 4; }
    this.warnFull = (this.warnFull || 0) - dt;
    // câble mou (crochet posé au sol ou sur l'eau) : il ne se déroule pas davantage, et remonte aussitôt
    const reach = this.rope.end.distanceTo(this.rope.anchor);
    if (this.rope.slack) this.rope.len = Math.min(this.rope.len, reach + (down ? 2 : 0.3));
    if (down && (this.aboard < CAP || this.hooked)) this.rope.len = Math.min(70, this.rope.len + 4.5 * dt);
    else this.rope.len = Math.max(1.2, this.rope.len - (this.hooked ? 2.6 : 3.5) * dt);
    if (down && plane.agl > 75 && (this.warnHigh -= dt) <= 0) { this.warnHigh = 5; ui.toast('Trop haut : le câble mesure 70 m, descends en stationnaire', 2200); }
    const floor = (x, z) => { const h = heightAt(x, z); return h < 0 ? -0.6 : h; };
    plane.extAcc.copy(this.rope.step(dt, plane, WINCH, floor, this.hooked ? 0.08 : 0.01));
    if (plane.onGround) plane.extAcc.set(0, 0, 0);

    // accrochage : le crochet passe tout près de la personne
    const e = this.rope.end;
    if (!this.hooked && this.rope.len > 3) {
      for (const v of this.victims) {
        if (Math.hypot(e.x - v.x, e.z - v.z) < 3.2 && Math.abs(e.y - (v.y + 1.6)) < 3) {
          this.hooked = v; v.beam.visible = false;
          ui.toast(`${v.kind === 'sea' ? 'Naufragé' : 'Randonneur'} accroché ! Relâche X pour le remonter`, 2400); sound.chime(1);
          break;
        }
      }
    }
    if (this.hooked) {
      const v = this.hooked;
      v.g.position.set(e.x, e.y - 1.9, e.z);
      v.person.rotation.x = Math.sin(performance.now() * 0.003) * 0.1;
      if (v.kind === 'sea') v.g.children[1].visible = false; // le canot reste à l'eau
      if (this.rope.len <= 1.5) {
        this.remove(v); this.hooked = null; this.aboard++;
        ui.toast(this.aboard >= CAP ? 'À bord ! Cabine pleine : direction l\'hôpital' : `À bord ! (${this.aboard}/${CAP}) · dépose à l'hôpital, croix verte sur la carte`, 2600);
        sound.chime(2);
        setTimeout(() => { if (this.victims) this.spawn(); }, 4000);
      }
    }
    // dépose : posé sur l'hélisurface de l'hôpital (ou celle de la base militaire)
    const pad = this.pads.find((p) => Math.hypot(plane.pos.x - p.x, plane.pos.z - p.z) < p.r + 8);
    if (plane.onGround && pad && this.aboard > 0) {
      this.unloadT += dt;
      if (this.unloadT > 1.2) {
        this.unloadT = 0; this.aboard--; this.rescued++;
        sound.chime(this.aboard ? 1 : 3);
        ui.toast(this.aboard ? `Blessé confié aux secours (${this.rescued} sauvés)` : `🚑 Tous les blessés sont à l'abri ! ${this.rescued} personnes sauvées`, 2600);
      }
    } else this.unloadT = 0;
    // personnes qui font signe, canots qui dansent sur la houle
    for (const v of this.victims) {
      if (v === this.hooked) continue;
      v.t += dt;
      v.arm.rotation.z = Math.PI + Math.sin(v.t * 7) * 0.6;
      if (v.kind === 'sea') { v.g.position.y = v.y + Math.sin(v.t * 1.3) * 0.25; v.g.rotation.z = Math.sin(v.t * 0.9) * 0.08; }
      fadeBeam(v.beam, plane);
    }
    this.padBeams.forEach((b) => { b.visible = this.aboard > 0; fadeBeam(b, plane); });
    return null;
  }
  get pins() {
    const out = this.victims.filter((v) => v !== this.hooked).map((v) => ({ x: v.x, z: v.z, color: '#ff8a3d', icon: v.kind === 'sea' ? '🛟' : '⛰' }));
    for (const p of this.pads) if (p.hospital || this.aboard) out.push({ x: p.x, z: p.z, color: '#5fe07a', icon: '✚' });
    return out;
  }
  hud() {
    const n = this.nearest, len = Math.round(this.rope.len);
    return {
      title: this.title, big: `${this.rescued}`, unit: 'sauvés',
      lines: [`🧍 à bord : ${this.aboard}/${CAP}${this.unloadT > 0 ? ' · débarquement…' : ''}`,
        this.hooked ? `treuillage… câble ${len} m` : len > 2 ? `câble : ${len} m` : 'X maintenue : descendre le treuil',
        n ? `${n.v.name} le plus proche : ${(n.d / 1000).toFixed(1).replace('.', ',')} km` : ''],
      bar: this.aboard / CAP,
    };
  }
  onCrash() { if (this.hooked) { this.remove(this.hooked); this.hooked = null; this.spawn(); } this.aboard = 0; this.rope.len = 1.2; }
  dispose() {
    this.rope.dispose();
    for (const v of this.victims) this.ctx.scene.remove(v.g, v.beam);
    for (const b of this.padBeams) this.ctx.scene.remove(b);
    this.ctx.plane().extAcc.set(0, 0, 0);
    this.victims = null;
  }
}
export function createRescue(ctx) { return new Rescue(ctx); }

// --------------------------------------------------------------------------- élingue
const HOOK = new THREE.Vector3(0, -1.7, 0.2); // crochet sous le ventre du Bi-rotor
const SLING = 16;                             // longueur de l'élingue (m)

const LOADS = [
  { name: 'Conteneur', k: 0.26, h: 2.6, build: (P) => { P(new THREE.BoxGeometry(2.4, 2.6, 6.1), [0xc8402f, 0x2f5fa8, 0x2f8a5a, 0xf08a2c][Math.floor(Math.random() * 4)], 0, 1.3, 0); } },
  { name: 'Caisse de vivres', k: 0.12, h: 2.2, build: (P) => { P(new THREE.BoxGeometry(2.4, 2.2, 2.4), 0xb98a52, 0, 1.1, 0); P(new THREE.BoxGeometry(2.5, 0.25, 2.5), 0x7a5634, 0, 1.6, 0); } },
  { name: 'Citerne d\'eau', k: 0.2, h: 2.4, build: (P) => { P(new THREE.CylinderGeometry(1.15, 1.15, 5, 12).rotateX(Math.PI / 2), 0xe9ecef, 0, 1.25, 0); P(new THREE.BoxGeometry(2, 0.3, 4.6), 0x5a5f66, 0, 0.15, 0); } },
  { name: 'Jeep', k: 0.18, h: 1.9, build: (P) => { P(new THREE.BoxGeometry(1.8, 0.9, 3.8), 0x5f6b45, 0, 0.9, 0); P(new THREE.BoxGeometry(1.7, 0.7, 1.6), 0x46502f, 0, 1.6, 0.4); for (const [x, z] of [[-0.9, -1.2], [0.9, -1.2], [-0.9, 1.2], [0.9, 1.2]]) P(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10).rotateZ(Math.PI / 2), 0x1b1c1e, x, 0.42, z); } },
  { name: 'Poutres de charpente', k: 0.15, h: 1.2, build: (P) => { for (let i = 0; i < 3; i++) P(new THREE.BoxGeometry(0.5, 0.4, 9), 0xa8743f, (i - 1) * 0.55, 0.2 + (i % 2) * 0.4, 0); } },
];

function loadMesh(kind) {
  const parts = [];
  kind.build((geo, color, x, y, z) => parts.push({ geo, color, matrix: xform(x, y, z) }));
  const apex = kind.h + 2.6;
  // élingues : quatre sangles jusqu'à l'anneau au-dessus de la charge
  for (const [x, z] of [[-0.9, -1.4], [0.9, -1.4], [-0.9, 1.4], [0.9, 1.4]]) {
    const a = new THREE.Vector3(x, kind.h, z), b = new THREE.Vector3(0, apex, 0), len = a.distanceTo(b);
    const m = new THREE.Matrix4().lookAt(a, b, new THREE.Vector3(0, 1, 0)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
    m.setPosition((x) / 2, (kind.h + apex) / 2, z / 2);
    parts.push({ geo: new THREE.CylinderGeometry(0.04, 0.04, len, 3), color: 0xf2c230, matrix: m });
  }
  parts.push({ geo: new THREE.TorusGeometry(0.3, 0.07, 4, 8), color: 0x5a5f66, matrix: xform(0, apex, 0) });
  const mesh = new THREE.Mesh(mergeColored(parts), lam());
  mesh.castShadow = true;
  return { mesh, apex };
}

class Sling {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'elingue'; this.title = 'Élingue';
    this.rope = new Rope(ctx.scene, 0x2b2e33); this.rope.len = SLING;
    this.delivered = 0; this.prevFire = false; this.hooked = false; this.load = null; this.job = null;
    this.sites = this.findSites();
    this.zone = ring(0x5fe07a, 20); this.zoneBeam = beam(0x5fe07a); this.loadBeam = beam(0x5fb8ff);
    ctx.scene.add(this.zone, this.zoneBeam, this.loadBeam);
    this.newJob(true);
  }
  /** Aires de chargement et de dépose : près des pistes, des villages, et quelques chantiers en montagne. */
  findSites() {
    const { heightAt, villages, runways, trees, span } = this.ctx, out = [], rnd = mulberry32(99);
    const near = (name, x, z, rmin = 0, rmax = 400, opts) => {
      for (let d = rmin; d <= rmax; d += 20) for (let a = 0; a < 6.283; a += 0.35) {
        const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
        if (clearSpot(px, pz, 14, villages, trees, opts)) { out.push({ name, x: px, z: pz, y: heightAt(px, pz) }); return; }
      }
    };
    for (const rw of runways) near(rw.name, rw.x, rw.z, rw.width / 2 + 60, rw.width / 2 + 420, { allowFlat: true, minH: 3 });
    if (this.ctx.seaBase && this.ctx.seaBase.active) near('Base nautique', this.ctx.seaBase.zone.x, this.ctx.seaBase.zone.z, 30, 200, { allowFlat: true, minH: 3 });
    for (const v of villages) near(v.name, v.x, v.z, v.r * 0.8, v.r + 400);
    for (let k = 0, n = 0; k < 20000 && n < 2; k++) {
      const x = (rnd() - 0.5) * span * 0.8, z = (rnd() - 0.5) * span * 0.8;
      if (heightAt(x, z) < 220) continue;
      if (clearSpot(x, z, 12, villages, trees, { minH: 200, maxH: 1200, flat: 0.9, tol: 4 })) { out.push({ name: n ? 'Refuge de montagne' : 'Chantier du relais radio', x, z, y: heightAt(x, z) }); n++; }
    }
    return out;
  }
  newJob(first = false) {
    const p = this.ctx.plane().pos, sites = this.sites;
    if (sites.length < 2) return;
    // départ : l'aire la plus proche la première fois, sinon là où l'on vient de livrer
    let from = this.job ? this.job.to : sites.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
    if (first) from = sites.reduce((a, b) => (Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b));
    const far = sites.filter((s) => s !== from && Math.hypot(s.x - from.x, s.z - from.z) > 1200);
    const list = far.length ? far : sites.filter((s) => s !== from);
    const to = list[Math.floor(Math.random() * list.length)];
    const kind = LOADS[Math.floor(Math.random() * LOADS.length)];
    this.job = { from, to, kind };
    this.spawnLoad();
    this.zone.position.set(to.x, to.y + 0.4, to.z); this.zoneBeam.position.set(to.x, to.y, to.z);
  }
  spawnLoad() {
    const { from, kind } = this.job;
    if (this.load) this.ctx.scene.remove(this.load.mesh);
    const { mesh, apex } = loadMesh(kind);
    const yaw = Math.random() * 6.28;
    mesh.position.set(from.x + 6, this.ctx.heightAt(from.x + 6, from.z), from.z); mesh.rotation.y = yaw;
    this.ctx.scene.add(mesh);
    this.load = { mesh, apex, kind, vel: new THREE.Vector3(), state: 'ground', yaw };
    this.hooked = false;
  }
  update(dt, plane, input) {
    const { ui, sound, heightAt } = this.ctx, L = this.load, job = this.job;
    const floor = (x, z) => Math.max(heightAt(x, z), -0.5);
    // le crochet seul ou la charge accrochée, au bout de l'élingue
    const k = this.hooked ? L.kind.k : 0.01;
    plane.extAcc.copy(this.rope.step(dt, plane, HOOK, this.hooked ? (x, z) => floor(x, z) + L.apex : floor, k));
    if (plane.onGround) plane.extAcc.set(0, 0, 0);
    const fire = input.fireHeld(), press = fire && !this.prevFire;
    this.prevFire = fire;
    if (!L) return null;
    const e = this.rope.end, top = _p.copy(L.mesh.position); top.y += L.apex;
    if (press) {
      if (this.hooked) {
        this.hooked = false;
        L.vel.copy(this.rope.vel);
        L.state = this.rope.grounded ? 'ground' : 'falling';
        if (L.state === 'ground') this.setDown(L);
        else { ui.toast('Charge larguée en l\'air !', 1600); }
        sound.click(false);
      } else if (e.distanceTo(top) < 4.5 && L.state === 'ground') {
        this.hooked = true; L.state = 'hooked';
        this.rope.end.copy(top); this.rope.vel.set(0, 0, 0);
        ui.toast(`${L.kind.name} accroché : monte doucement, puis pose-le dans le cercle vert de ${job.to.name}`, 3000); sound.chime(1);
      } else ui.toast('Mets le crochet au-dessus de la charge (anneau jaune), à moins de 4 m, puis X', 2400);
    }
    if (this.hooked) {
      L.mesh.position.set(e.x, e.y - L.apex, e.z);
      // la charge se balance : elle penche dans le sens du câble
      _d.subVectors(this.rope.anchor, e).normalize();
      L.mesh.rotation.set(clamp(-_d.z, -0.5, 0.5) * 0.4, L.yaw, clamp(_d.x, -0.5, 0.5) * 0.4);
    } else if (L.state === 'falling') {
      L.vel.y -= G * dt; L.mesh.position.addScaledVector(L.vel, dt);
      const gy = heightAt(L.mesh.position.x, L.mesh.position.z);
      if (L.mesh.position.y <= Math.max(gy, -1)) {
        if (gy < 0) { ui.toast(`${L.kind.name} tombé à l'eau… on en prépare un autre`, 2600); sound.failure(); }
        else if (-L.vel.y > 7) { ui.toast(`${L.kind.name} écrasé au sol ! On en prépare un autre`, 2600); sound.boom && sound.boom(); }
        else { L.mesh.position.y = gy; L.state = 'ground'; this.setDown(L); return null; }
        L.state = 'lost';
        setTimeout(() => { if (this.job === job) this.spawnLoad(); }, 2500);
      }
    } else if (L.state === 'ground' && !this.hooked) {
      // le crochet seul pend : on ne bouge pas la charge
    }
    if (this.hooked && L.state === 'hooked' && !this.rope.grounded) L.mesh.visible = true;
    fadeBeam(this.zoneBeam, plane); fadeBeam(this.loadBeam, plane);
    this.loadBeam.visible = !this.hooked && L.state === 'ground';
    this.loadBeam.position.copy(L.mesh.position);
    return null;
  }
  /** Charge posée au sol : livrée si c'est dans le cercle de destination. */
  setDown(L) {
    const { ui, sound } = this.ctx, to = this.job.to, p = L.mesh.position;
    p.y = this.ctx.heightAt(p.x, p.z); L.mesh.rotation.set(0, L.yaw, 0);
    const d = Math.hypot(p.x - to.x, p.z - to.z);
    if (d < 20) {
      this.delivered++;
      ui.toast(`📦 ${L.kind.name} livré à ${to.name}${d < 5 ? ' : pile au centre !' : ''}`, 2800); sound.chime(3);
      const old = L.mesh;
      setTimeout(() => this.ctx.scene.remove(old), 12000);
      this.load = null;
      this.newJob();
      if (this.job) setTimeout(() => ui.toast(`Nouvelle charge : ${this.job.kind.name}, à ${this.job.from.name}`, 2600), 3000);
    } else ui.toast(`Charge posée à ${Math.round(d)} m du cercle : raccroche-la (X) et rapproche-toi`, 2400);
  }
  get pins() {
    const out = [];
    if (this.job) out.push({ x: this.job.to.x, z: this.job.to.z, color: '#5fe07a', icon: '⬇' });
    if (this.load && !this.hooked) out.push({ x: this.load.mesh.position.x, z: this.load.mesh.position.z, color: '#5fb8ff', icon: '📦' });
    return out;
  }
  hud() {
    const p = this.ctx.plane().pos, j = this.job, L = this.load;
    const tgt = L && (this.hooked || L.state !== 'ground') ? j && j.to : L ? { x: L.mesh.position.x, z: L.mesh.position.z } : null;
    const d = tgt ? Math.hypot(p.x - tgt.x, p.z - tgt.z) : 0;
    return {
      title: this.title, big: `${this.delivered}`, unit: 'livrés',
      lines: [j ? `${j.kind.name} : ${j.from.name} → ${j.to.name}` : 'pas de charge',
        this.hooked ? `accroché · cercle vert à ${(d / 1000).toFixed(1).replace('.', ',')} km · X : décrocher` : `charge à ${(d / 1000).toFixed(1).replace('.', ',')} km · X près de l'anneau : accrocher`],
    };
  }
  onCrash() { this.hooked = false; if (this.job) this.spawnLoad(); }
  dispose() {
    this.rope.dispose();
    this.ctx.scene.remove(this.zone, this.zoneBeam, this.loadBeam);
    if (this.load) this.ctx.scene.remove(this.load.mesh);
    this.ctx.plane().extAcc.set(0, 0, 0);
  }
}
export function createSling(ctx) { return new Sling(ctx); }
