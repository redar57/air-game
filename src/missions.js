import * as THREE from 'three';
import { Effects } from './fx.js';
import { mulberry32, clamp } from './util.js';

// Modes de jeu : voltige notée, chasse aux montgolfières, feux de forêt.
// Chaque mission expose : update(dt, plane, input) -> résultat final ou null, hud() -> panneau,
// et éventuellement onTrick(texte) / onPop(montgolfière) / fires (pour la carte).

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const _v = new THREE.Vector3(), _p = new THREE.Vector3();

// --------------------------------------------------------------------------- voltige
const PTS = [
  [/Looping inversé/, 180], [/Looping/, 120], [/Tonneau ×(\d+)/, (m) => 50 * +m[1]], [/Tonneau/, 50],
  [/Vol dos/, 100], [/tranche/, 110], [/Rase/, 80], [/arche/, 300], [/cratère/, 250], [/canyon/, 250],
];

class Aerobatics {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'voltige'; this.title = 'Voltige notée';
    this.time = 180; this.score = 0; this.mult = 1; this.lastT = -99; this.t = 0;
  }
  onTrick(msg) {
    let pts = 0;
    for (const [re, v] of PTS) { const m = msg.match(re); if (m) { pts = typeof v === 'function' ? v(m) : v; break; } }
    if (!pts) return msg;
    this.mult = this.t - this.lastT < 6 ? Math.min(4, this.mult + 0.5) : 1;
    this.lastT = this.t;
    const got = Math.round(pts * this.mult);
    this.score += got;
    this.ctx.sound.chime(1);
    return `${msg}  +${got}${this.mult > 1 ? ` ×${this.mult}` : ''}`;
  }
  onCrash() { this.mult = 1; this.score = Math.max(0, this.score - 150); }
  update(dt) {
    this.t += dt; this.time -= dt;
    if (this.t - this.lastT > 6) this.mult = 1;
    if (this.time <= 0) return this.finish();
    return null;
  }
  finish() {
    const r = this.ctx.save.record('voltige', this.score);
    return { title: 'Voltige terminée', big: `${this.score} points`, line: r.isNew ? 'Nouveau record !' : `Record : ${r.best} points`, isNew: r.isNew };
  }
  hud() {
    return { title: this.title, big: `${this.score}`, unit: 'points', lines: [`⏱ ${fmt(Math.max(0, this.time))}`, this.mult > 1 ? `combo ×${this.mult}` : 'enchaîne les figures !'] };
  }
  dispose() {}
}

// --------------------------------------------------------------------------- chasse
class Hunt {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'chasse'; this.title = 'Chasse';
    this.time = 180; this.score = 0;
    ctx.scenery.respawn = 8;
  }
  onPop() { this.score++; }
  update(dt) {
    this.time -= dt;
    if (this.time <= 0) {
      const r = this.ctx.save.record('chasse', this.score);
      return { title: 'Chasse terminée', big: `${this.score} montgolfière${this.score > 1 ? 's' : ''}`, line: r.isNew ? 'Nouveau record !' : `Record : ${r.best}`, isNew: r.isNew };
    }
    return null;
  }
  hud() {
    const near = this.ctx.scenery.balloons.filter((b) => b.alive).length;
    return { title: this.title, big: `${this.score}`, unit: 'abattues', lines: [`⏱ ${fmt(Math.max(0, this.time))}`, `${near} en l'air`] };
  }
  dispose() { this.ctx.scenery.respawn = 40; }
}

// --------------------------------------------------------------------------- feux de forêt
class Fires {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'feux'; this.title = 'Feux de forêt';
    this.t = 0; this.water = 0; this.scooping = false; this.dropping = false; this.full = false;
    this.fx = new Effects(ctx.scene, { max: 360 });                          // flammes, eau
    this.smoke = new Effects(ctx.scene, { max: 220, opacity: 0.5, drag: 0.35 }); // fumée translucide
    this.fires = [];
    this.count = 4;
    this.spawn();
  }
  spawn() {
    const { heightAt, normalAt, runways } = this.ctx, rnd = mulberry32((Math.random() * 1e9) | 0), n = new THREE.Vector3();
    this.fires = [];
    for (let k = 0; k < 2000 && this.fires.length < this.count; k++) {
      const x = (rnd() - 0.5) * 9000, z = (rnd() - 0.5) * 9000, h = heightAt(x, z);
      if (h < 20 || h > 380 || normalAt(x, z, n).y < 0.85) continue;
      if (runways.some((r) => Math.hypot(r.x - x, r.z - z) < 1200)) continue;
      if (this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < 900)) continue;
      this.fires.push({ x, z, y: h, power: 0.8 + rnd() * 0.3, out: false, smoke: 0 });
    }
  }
  update(dt, plane, input) {
    this.t += dt;
    const s = plane.spec, sound = this.ctx.sound;
    // écopage : hélico en stationnaire au ras de l'eau, hydravion qui glisse sur l'eau
    const overWater = plane.surface === 'water';
    const heliScoop = s.heli && !plane.onGround && overWater && plane.agl < 8 && plane.speed < 20;
    const seaScoop = s.amphibian && overWater && plane.speed > 8 && (plane.onGround || plane.agl < 2);
    this.scooping = (heliScoop || seaScoop) && this.water < 1;
    if (this.scooping) {
      this.water = Math.min(1, this.water + dt / (s.heli ? 4 : 3.5));
      if (Math.random() < 0.5) {
        _v.set((Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6);
        this.fx.emit(_p.set(plane.pos.x, plane.pos.y - plane.agl - plane.standH + 0.5, plane.pos.z), _v, 0.9, 1.2, 0xe8f6ff, 1.5, 9);
      }
      if (this.water >= 1 && !this.full) { this.full = true; this.ctx.ui.toast('Réservoir plein : direction les flammes !', 1800); sound.chime(1); }
    }
    if (this.water < 1) this.full = false;
    // largage (X maintenue)
    this.dropping = input.fireHeld() && this.water > 0 && !plane.onGround;
    if (this.dropping) {
      const amt = Math.min(this.water, dt * 0.6);
      this.water -= amt;
      for (let k = 0; k < 3; k++) {
        _v.copy(plane.vel).multiplyScalar(0.85).add(_p.set((Math.random() - 0.5) * 3, -3 - Math.random() * 3, (Math.random() - 0.5) * 3));
        this.fx.emit(_p.copy(plane.pos).addScaledVector(plane.up, -1.5), _v, 2.2, 1.4 + Math.random(), Math.random() < 0.5 ? 0xdff2ff : 0xffffff, 1.2, 9.8);
      }
      // point d'impact : chute libre depuis la hauteur actuelle
      const g = 9.8, vy = plane.vel.y, h = Math.max(1, plane.agl + plane.standH);
      const tf = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
      const ix = plane.pos.x + plane.vel.x * 0.85 * tf, iz = plane.pos.z + plane.vel.z * 0.85 * tf;
      for (const f of this.fires) {
        if (f.out) continue;
        const d = Math.hypot(f.x - ix, f.z - iz);
        if (d < 70) {
          f.power -= amt * 1.7 * (1 - d / 70);
          if (f.power <= 0) {
            f.out = true; f.smoke = 8;
            const left = this.fires.filter((x) => !x.out).length;
            this.ctx.ui.toast(left ? `Feu éteint ! Encore ${left}` : 'Tous les feux sont éteints !', 1800);
            sound.chime(2);
          }
        }
      }
    }
    // les feux grossissent doucement, crépitent et fument
    for (const f of this.fires) {
      if (!f.out) f.power = Math.min(1.5, f.power + dt * 0.008);
      const p = f.out ? 0 : f.power;
      if (p > 0) {
        for (let k = 0; k < 1; k++) {
          const a = Math.random() * 6.28, r = Math.random() * 30 * p;
          _v.set((Math.random() - 0.5) * 3, 6 + Math.random() * 8 * p, (Math.random() - 0.5) * 3);
          this.fx.emit(_p.set(f.x + Math.cos(a) * r, f.y + 1, f.z + Math.sin(a) * r), _v, 0.7 + Math.random() * 0.5, (4 + Math.random() * 4) * p, Math.random() < 0.5 ? 0xff7a1f : 0xffc23a, -2, -2);
        }
      }
      if (f.out) f.smoke -= dt;
      f.smokeT = (f.smokeT || 0) - dt;
      if ((p > 0 || f.smoke > 0) && f.smokeT <= 0) {
        f.smokeT = 0.22;
        // colonne de fumée qui monte et s'élargit, poussée par le vent
        _v.set(2 + Math.random() * 2, 9 + Math.random() * 5, (Math.random() - 0.5) * 3);
        this.smoke.emit(_p.set(f.x + (Math.random() - 0.5) * 25, f.y + 6, f.z + (Math.random() - 0.5) * 25), _v, 9, 5 + 5 * Math.max(p, 0.4),
          f.out ? 0xe6eaee : Math.random() < 0.5 ? 0x4e4e4e : 0x6e6e6e, 3.2, -1.2);
      }
    }
    this.fx.update(dt); this.smoke.update(dt);
    sound.fireAmbience(this.fires, plane.pos, this.scooping, this.dropping);
    if (this.fires.every((f) => f.out)) {
      const r = this.ctx.save.record(`feux:${this.count}`, Math.round(this.t), true);
      return { title: 'Feux éteints !', big: fmt(this.t), line: r.isNew ? 'Nouveau record !' : `Record : ${fmt(r.best)}`, isNew: r.isNew };
    }
    return null;
  }
  hud() {
    const left = this.fires.filter((f) => !f.out), tank = Math.round(this.water * 100);
    let near = Infinity;
    // (distance au feu le plus proche, utile quand on ne le voit pas encore)
    const p = this.ctx.plane();
    for (const f of left) near = Math.min(near, Math.hypot(f.x - p.pos.x, f.z - p.pos.z));
    return {
      title: this.title, big: `${this.fires.length - left.length}/${this.fires.length}`, unit: 'éteints',
      lines: [`⏱ ${fmt(this.t)}`, `💧 ${tank} %${this.scooping ? ' · écopage…' : this.dropping ? ' · largage !' : ''}`,
        left.length ? `feu le plus proche : ${(near / 1000).toFixed(1).replace('.', ',')} km` : ''],
      bar: this.water,
    };
  }
  dispose() {
    for (const e of [this.fx, this.smoke]) {
      this.ctx.scene.remove(e.mesh);
      for (const t of e.trails) this.ctx.scene.remove(t);
    }
    this.ctx.sound.fireAmbience([], null, false, false);
  }
}

export function createMission(id, ctx) {
  if (id === 'voltige') return new Aerobatics(ctx);
  if (id === 'chasse') return new Hunt(ctx);
  if (id === 'feux') return new Fires(ctx);
  return null;
}
export { clamp };
