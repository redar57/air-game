import { heightAt, canyonDist, VOLCANO, MTN } from '../world/terrain.js';
import { arch } from '../world/scenery.js';
import { toLocal } from '../util.js';

const TAU = Math.PI * 2;
const _l = { x: 0, z: 0 };
const msa = Math.sin(MTN.ang), mca = Math.cos(MTN.ang);

/** Repère les figures et les passages remarquables ; update() renvoie un texte à afficher, ou null. */
export class Tricks {
  constructor() {
    this.rimY = null;
    this.reset();
  }

  reset() {
    this.loop = 0; this.loopMinUp = 1; this.loopIdle = 0;
    this.roll = 0; this.rollIdle = 0; this.rollCombo = 0; this.rollComboT = 0;
    this.inv = 0; this.invDone = false;
    this.knife = 0; this.knifeDone = false;
    this.low = 0; this.lowCd = 0;
    this.archZ = null;
    this.craterCd = 0;
    this.canyon = 0; this.canyonCd = 0;
  }

  update(dt, p) {
    if (this.rimY === null) this.rimY = heightAt(VOLCANO.x + VOLCANO.rimR, VOLCANO.z);
    let msg = null;
    this.lowCd -= dt; this.craterCd -= dt; this.canyonCd -= dt; this.rollComboT -= dt;
    if (p.onGround) { this.loop = 0; this.roll = 0; this.low = 0; this.inv = 0; this.knife = 0; this.canyon = 0; return null; }

    // looping : un tour complet en tangage en passant sur le dos
    if (Math.abs(p.pitchRate) > 0.2 && Math.abs(p.rollRate) < 1) {
      if (Math.sign(p.pitchRate) !== Math.sign(this.loop) && this.loop !== 0) { this.loop = 0; this.loopMinUp = 1; }
      this.loop += p.pitchRate * dt;
      this.loopIdle = 0;
      this.loopMinUp = Math.min(this.loopMinUp, p.up.y);
      if (Math.abs(this.loop) >= TAU * 0.96) {
        if (this.loopMinUp < -0.5) msg = this.loop > 0 ? 'Looping !' : 'Looping inversé !';
        this.loop = 0; this.loopMinUp = 1;
      }
    } else if ((this.loopIdle += dt) > 1.2) { this.loop = 0; this.loopMinUp = 1; }

    // tonneau : un tour complet en roulis
    if (Math.abs(p.rollRate) > 0.5) {
      if (Math.sign(p.rollRate) !== Math.sign(this.roll) && this.roll !== 0) this.roll = 0;
      this.roll += p.rollRate * dt;
      this.rollIdle = 0;
      if (Math.abs(this.roll) >= TAU * 0.96) {
        this.roll = 0;
        this.rollCombo = this.rollComboT > 0 ? this.rollCombo + 1 : 1;
        this.rollComboT = 2.2;
        msg = this.rollCombo > 1 ? `Tonneau ×${this.rollCombo} !` : 'Tonneau !';
      }
    } else if ((this.rollIdle += dt) > 0.8) this.roll = 0;

    // vol dos / vol sur la tranche
    if (p.up.y < -0.75) {
      if ((this.inv += dt) > 3 && !this.invDone) { this.invDone = true; msg = 'Vol dos !'; }
    } else if (p.up.y > 0.3) { this.inv = 0; this.invDone = false; }
    if (Math.abs(p.right.y) > 0.92) {
      if ((this.knife += dt) > 3 && !this.knifeDone) { this.knifeDone = true; msg = 'Vol sur la tranche !'; }
    } else if (Math.abs(p.right.y) < 0.5) { this.knife = 0; this.knifeDone = false; }

    // rase-mottes
    if (p.agl < 14 && p.speed > p.spec.stall * 1.3 && p.surface !== 'runway' && p.surface !== 'carrier' && p.airTime > 6) {
      if ((this.low += dt) > 3 && this.lowCd <= 0) {
        this.lowCd = 14; this.low = 0;
        msg = p.surface === 'water' ? 'Rase-vagues !' : 'Rase-mottes !';
      }
    } else this.low = 0;

    // sous l'arche
    toLocal(arch, p.pos.x, p.pos.z, _l);
    if (this.archZ !== null && Math.sign(_l.z) !== Math.sign(this.archZ) && Math.abs(_l.z) < 60
      && Math.hypot(_l.x, p.pos.y - arch.y) < arch.R - arch.tube * 0.8) msg = "Sous l'arche !";
    this.archZ = _l.z;

    // dans le cratère du volcan
    if (this.craterCd <= 0 && p.pos.y < this.rimY - 25 && Math.hypot(p.pos.x - VOLCANO.x, p.pos.z - VOLCANO.z) < VOLCANO.rimR * 0.8) {
      this.craterCd = 25; msg = 'Dans le cratère !';
    }

    // au fond du canyon (des parois plus hautes que l'avion des deux côtés)
    if (this.canyonCd <= 0 && canyonDist(p.pos.x, p.pos.z) < 150
      && heightAt(p.pos.x - msa * 330, p.pos.z + mca * 330) > p.pos.y + 50
      && heightAt(p.pos.x + msa * 330, p.pos.z - mca * 330) > p.pos.y + 50) {
      if ((this.canyon += dt) > 4) { this.canyonCd = 25; this.canyon = 0; msg = 'Pilote de canyon !'; }
    } else this.canyon = 0;

    return msg;
  }
}
