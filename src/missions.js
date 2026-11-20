import * as THREE from 'three';
import { Effects } from './fx.js';
import { mulberry32, clamp } from './util.js';
import { HALF } from './world/terrain.js';

// Bombardier d'eau (hélicoptère rouge) : écopage, largage, et feux de forêt si l'option est activée.
// update(dt, plane, input), hud() -> panneau, fires (pour la carte), dispose().

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const _v = new THREE.Vector3(), _p = new THREE.Vector3();

// --------------------------------------------------------------------------- feux de forêt
class Fires {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'feux';
    this.withFires = !!ctx.fires; this.title = this.withFires ? 'Feux de forêt' : "Bombardier d'eau";
    this.t = 0; this.water = 0; this.scooping = false; this.dropping = false; this.full = false;
    this.fx = new Effects(ctx.scene, { max: 360 });                          // flammes, eau
    this.smoke = new Effects(ctx.scene, { max: 220, opacity: 0.5, drag: 0.35 }); // fumée translucide
    this.fires = [];
    this.count = this.withFires ? 4 : 0;
    this.wave = 0; this.waveT = 0; this.nextT = 0;
    this.spawn();
  }
  spawn() {
    const { heightAt, normalAt, runways } = this.ctx, rnd = mulberry32((Math.random() * 1e9) | 0), n = new THREE.Vector3();
    this.fires = [];
    for (let k = 0; k < 2000 && this.fires.length < this.count; k++) {
      const x = (rnd() - 0.5) * HALF * 1.64, z = (rnd() - 0.5) * HALF * 1.64, h = heightAt(x, z);
      if (h < 20 || h > 380 || normalAt(x, z, n).y < 0.85) continue;
      if (runways.some((r) => Math.hypot(r.x - x, r.z - z) < 1200)) continue;
      if (this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < 900)) continue;
      this.fires.push({ x, z, y: h, power: 0.8 + rnd() * 0.3, out: false, smoke: 0 });
    }
    this.wave++; this.waveT = 0;
  }
  update(dt, plane, input) {
    this.t += dt; this.waveT += dt;
    const s = plane.spec, sound = this.ctx.sound;
    // écopage : hélico en stationnaire au ras de l'eau, hydravion qui glisse sur l'eau
    const overWater = plane.surface === 'water';
    // hélico : stationnaire au ras de l'eau ; écopeur : coque qui rase l'eau en gardant de la vitesse
    const scoopOk = s.heli ? !plane.onGround && overWater && plane.agl < 8 && plane.speed < 20
      : overWater && plane.speed > 15 && (plane.onGround || plane.agl < 1.5) && !plane.gearDown;
    this.scooping = scoopOk && this.water < 1;
    if (this.scooping) {
      this.water = Math.min(1, this.water + dt / (s.heli ? 4 : 5));
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
      const big = !s.heli, amt = Math.min(this.water, dt * (big ? 0.33 : 0.25)), rad = big ? 95 : 70;
      this.water -= amt;
      for (let k = 0; k < (big ? 6 : 3); k++) {
        _v.copy(plane.vel).multiplyScalar(0.85).add(_p.set((Math.random() - 0.5) * 3, -3 - Math.random() * 3, (Math.random() - 0.5) * 3));
        this.fx.emit(_p.copy(plane.pos).addScaledVector(plane.up, -1.5).addScaledVector(plane.fwd, big ? (Math.random() - 0.5) * 4 : 0), _v, 2.2, (big ? 2 : 1.4) + Math.random(), Math.random() < 0.5 ? 0xdff2ff : 0xffffff, big ? 1.8 : 1.2, 9.8);
      }
      // point d'impact : chute libre depuis la hauteur actuelle
      const g = 9.8, vy = plane.vel.y, h = Math.max(1, plane.agl + plane.standH);
      const tf = (vy + Math.sqrt(vy * vy + 2 * g * h)) / g;
      const ix = plane.pos.x + plane.vel.x * 0.85 * tf, iz = plane.pos.z + plane.vel.z * 0.85 * tf;
      for (const f of this.fires) {
        if (f.out) continue;
        const d = Math.hypot(f.x - ix, f.z - iz);
        if (d < rad) {
          f.power -= amt * 1.7 * (1 - d / rad);
          if (f.power <= 0) {
            f.out = true; f.smoke = 8;
            const left = this.fires.filter((x) => !x.out).length;
            this.ctx.ui.toast(left ? `Feu éteint ! Encore ${left}` : `Tous les feux sont éteints en ${fmt(this.waveT)} ! D'autres se déclareront bientôt…`, 3000);
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
    // vol libre : une fois tous les feux éteints, une nouvelle série se déclare un peu plus tard
    if (this.withFires && this.fires.every((f) => f.out && f.smoke <= 0)) {
      this.nextT += dt;
      if (this.nextT > 20) { this.nextT = 0; this.spawn(); this.ctx.ui.toast('Nouveaux départs de feu ! (N : carte)', 2600); sound.chime(1); }
    }
    return null;
  }
  hud() {
    const left = this.fires.filter((f) => !f.out), tank = Math.round(this.water * 100);
    const tankLine = `💧 ${tank} %${this.scooping ? ' · écopage…' : this.dropping ? ' · largage !' : ''}`;
    if (!this.withFires) {
      const how = this.ctx.plane().spec.heli ? "écope en stationnaire au ras de l'eau" : "rase l'eau, roues rentrées, pour écoper";
      return { title: this.title, big: `${tank} %`, unit: 'réservoir', lines: [this.scooping ? 'écopage…' : this.dropping ? 'largage !' : tank ? 'X : larguer' : how], bar: this.water };
    }
    let near = Infinity;
    // (distance au feu le plus proche, utile quand on ne le voit pas encore)
    const p = this.ctx.plane();
    for (const f of left) near = Math.min(near, Math.hypot(f.x - p.pos.x, f.z - p.pos.z));
    return {
      title: this.title, big: `${this.fires.length - left.length}/${this.fires.length}`, unit: 'éteints',
      lines: [left.length ? `⏱ ${fmt(this.waveT)}` : 'prochains feux bientôt…', tankLine,
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

/** Appareils qui emportent un réservoir d'eau : l'hélicoptère rouge et l'écopeur. */
export const canScoop = (spec) => spec.id === 'helico' || spec.id === 'canadair';
export function createWaterBomber(ctx) { return new Fires(ctx); }
export { clamp };
