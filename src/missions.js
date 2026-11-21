import * as THREE from 'three';
import { Effects } from './fx.js';
import { mulberry32, clamp, mergeColored, xform } from './util.js';
import { HALF } from './world/terrain.js';

// Bombardier d'eau (hélicoptère rouge) : écopage, largage, et feux de forêt si l'option est activée.
// update(dt, plane, input), hud() -> panneau, fires (pour la carte), dispose().

const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const _v = new THREE.Vector3(), _p = new THREE.Vector3(), _d = new THREE.Vector3();

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
    // les feux partent là où il y a de quoi brûler : en forêt (au pied d'un arbre pris au hasard,
    // donc surtout là où les arbres sont serrés) et, une fois sur quatre, aux abords d'un village
    const trees = this.ctx.scenery.treeList || [], villages = this.ctx.scenery.villages || [];
    for (let k = 0; k < 3000 && this.fires.length < this.count; k++) {
      let x, z, village = null;
      if (villages.length && rnd() < 0.25) {
        village = villages[Math.floor(rnd() * villages.length)];
        const a = rnd() * 6.283, d = village.r * 0.8 + rnd() * 160;
        x = village.x + Math.cos(a) * d; z = village.z + Math.sin(a) * d;
      } else if (trees.length) {
        const t = trees[Math.floor(rnd() * trees.length)];
        x = t.x; z = t.z;
      } else { x = (rnd() - 0.5) * HALF * 1.64; z = (rnd() - 0.5) * HALF * 1.64; }
      const h = heightAt(x, z);
      if (h < 5 || h > 480 || normalAt(x, z, n).y < 0.8) continue;
      if (runways.some((r) => Math.hypot(r.x - x, r.z - z) < 900)) continue;
      if (this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < 900)) continue;
      this.fires.push({ x, z, y: h, power: 0.8 + rnd() * 0.3, out: false, smoke: 0, village: village && village.name });
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
      : overWater && plane.speed > 15 && (plane.onGround || plane.agl < 1.5);
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
      const how = this.ctx.plane().spec.heli ? "écope en stationnaire au ras de l'eau" : "rase l'eau pour écoper";
      return { title: this.title, big: `${tank} %`, unit: 'réservoir', lines: [this.scooping ? 'écopage…' : this.dropping ? 'largage !' : tank ? 'X : larguer' : how], bar: this.water };
    }
    let near = Infinity, nearF = null;
    // (distance au feu le plus proche, utile quand on ne le voit pas encore)
    const p = this.ctx.plane();
    for (const f of left) { const d = Math.hypot(f.x - p.pos.x, f.z - p.pos.z); if (d < near) { near = d; nearF = f; } }
    return {
      title: this.title, big: `${this.fires.length - left.length}/${this.fires.length}`, unit: 'éteints',
      lines: [left.length ? `⏱ ${fmt(this.waveT)}` : 'prochains feux bientôt…', tankLine,
        left.length ? `feu le plus proche : ${(near / 1000).toFixed(1).replace('.', ',')} km${nearF.village ? ` (près de ${nearF.village})` : ''}` : ''],
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

// --------------------------------------------------------------------------- épandage
/** Épandeur : produit dans la trémie, épandu (X maintenue) en rase-mottes ; les cases de champ survolées verdissent. */
class Sprayer {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'epandage'; this.title = 'Épandage';
    this.product = 1; this.spraying = false; this.loadT = 0; this.highWarned = false; this.emptyWarned = false;
    this.fx = new Effects(ctx.scene, { max: 500, opacity: 0.22, drag: 1.4 });
  }
  update(dt, plane, input) {
    const { fields, atLoad, ui, sound } = this.ctx;
    // rechargement : arrêté sur l'aire verte devant la grange de la Prairie
    if (plane.onGround && plane.groundSpeed < 1 && atLoad(plane.pos.x, plane.pos.z) && this.product < 1) {
      if (this.loadT === 0) ui.toast('Chargement du produit…', 1800);
      this.loadT += dt;
      this.product = Math.min(1, this.product + dt / 5);
      if (this.product >= 1) { ui.toast('Trémie pleine : en route pour les champs !', 2200); sound.chime(1); }
    } else this.loadT = 0;
    if (this.product > 0) this.emptyWarned = false;
    this.spraying = input.fireHeld() && this.product > 0 && !plane.onGround;
    if (input.fireHeld() && this.product <= 0 && !this.emptyWarned) {
      this.emptyWarned = true;
      ui.toast(fields.length ? "Trémie vide : recharge sur l'aire verte de la Prairie" : 'Trémie vide : recharge à la station jaune devant les hangars', 2600);
    }
    if (this.spraying) {
      this.product = Math.max(0, this.product - dt / 45);
      // brume qui sort de la rampe, sur toute l'envergure
      for (let k = 0; k < 5; k++) {
        const t = (Math.random() - 0.5) * 12.4;
        _p.copy(plane.pos).addScaledVector(plane.right, t).addScaledVector(plane.up, -0.7).addScaledVector(plane.fwd, -0.4);
        _v.copy(plane.vel).multiplyScalar(0.55).add(_d.set((Math.random() - 0.5) * 2, -2.5 - Math.random() * 2, (Math.random() - 0.5) * 2));
        this.fx.emit(_p, _v, 1.4 + Math.random() * 0.6, 0.35 + Math.random() * 0.35, Math.random() < 0.5 ? 0xeef5e2 : 0xd9ead0, 0.9, 1.5);
      }
      // le produit ne tombe sur le champ qu'en volant bas
      const agl = plane.agl + plane.standH;
      if (agl < 25) {
        const x = plane.pos.x + plane.vel.x * 0.5, z = plane.pos.z + plane.vel.z * 0.5;
        for (const f of fields) f.spray(x, z, 7.5 + agl * 0.12);
      } else if (!this.highWarned) {
        this.highWarned = true;
        ui.toast('Trop haut : descends sous 25 m pour que le produit tombe sur le champ', 2600);
      }
    }
    this.fx.update(dt);
    return null;
  }
  hud() {
    const { fields } = this.ctx, pct = Math.round(this.product * 100);
    const state = this.loadT > 0 ? 'chargement…' : this.spraying ? 'épandage…' : pct ? 'X : épandre au ras des champs' : 'trémie vide';
    return {
      title: this.title, big: `${pct} %`, unit: 'produit',
      lines: [state, fields.length ? `🌾 champs traités : ${Math.round(this.ctx.treated() * 100)} %` : 'champs à la Prairie (grande carte)'],
      bar: this.product,
    };
  }
  dispose() {
    this.ctx.scene.remove(this.fx.mesh);
    for (const t of this.fx.trails) this.ctx.scene.remove(t);
  }
}
export function createSprayer(ctx) { return new Sprayer(ctx); }

// --------------------------------------------------------------------------- courrier
const BAGS = 6;
const LOW = 25; // en dessous, le parachute n'a pas le temps de s'ouvrir

function parcelMesh() {
  const g = new THREE.Group();
  const sack = new THREE.Mesh(mergeColored([
    { geo: new THREE.BoxGeometry(0.75, 0.95, 0.55), color: 0xc9a46a, matrix: xform(0, 0, 0) },
    { geo: new THREE.BoxGeometry(0.8, 0.12, 0.6), color: 0x6b4a2a, matrix: xform(0, 0.2, 0) },
    { geo: new THREE.BoxGeometry(0.3, 0.25, 0.3), color: 0xc9a46a, matrix: xform(0, 0.58, 0) },
  ]), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  g.add(sack);
  const parts = [];
  for (let k = 0; k < 8; k++) {
    parts.push({ geo: new THREE.SphereGeometry(2.6, 2, 4, (k * Math.PI) / 4, Math.PI / 4, 0, Math.PI / 2), color: k % 2 ? 0xf4f1ea : 0xd8432f, matrix: xform(0, 0, 0, 0, 1, 0.7, 1) });
  }
  for (const [x, z] of [[1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8]]) {
    const len = Math.hypot(x, z, 4.6);
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(0, 0, 0), new THREE.Vector3(x, 4.6, z), new THREE.Vector3(0, 1, 0));
    m.multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)).setPosition(x / 2, -4.6 / 2, z / 2);
    parts.push({ geo: new THREE.CylinderGeometry(0.025, 0.025, len, 3), color: 0x333333, matrix: m });
  }
  const chute = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
  const holder = new THREE.Group();
  chute.position.y = 4.6 + 0.5;
  holder.add(chute);
  holder.scale.setScalar(0.01);
  g.add(holder);
  return { g, holder };
}

/** Postier : sacs chargés à l'arrêt sur une piste, largués (X) au-dessus du village indiqué. */
class Mail {
  constructor(ctx) {
    this.ctx = ctx; this.id = 'courrier'; this.title = 'Courrier';
    this.bags = BAGS; this.loadAcc = 0; this.loading = false; this.prevFire = false;
    this.delivered = 0; this.perfect = 0; this.best = Infinity; this.parcels = [];
    this.villages = ctx.villages.filter((v) => v.houses && v.houses.length);
    this.target = null;
    // repère au-dessus du village à livrer : un cercle au sol et une colonne lumineuse
    this.marker = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide });
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(30, 36, 40).rotateX(-Math.PI / 2), ringMat));
    this.marker.add(new THREE.Mesh(new THREE.RingGeometry(4, 8, 24).rotateX(-Math.PI / 2), ringMat));
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 320, 10, 1, true).translate(0, 160, 0), this.beamMat);
    this.marker.add(beam);
    ctx.scene.add(this.marker);
    this.pick();
  }
  /** Prochain village à livrer (un autre que le précédent quand c'est possible). */
  pick() {
    const others = this.villages.filter((v) => v !== this.target);
    const list = others.length ? others : this.villages;
    this.target = list[Math.floor(Math.random() * list.length)] || null;
    if (!this.target) { this.marker.visible = false; return; }
    const { x, z } = this.target;
    let top = -Infinity;
    for (let a = 0; a < 6.28; a += 0.5) top = Math.max(top, this.ctx.heightAt(x + Math.cos(a) * 33, z + Math.sin(a) * 33));
    this.marker.position.set(x, Math.max(top, this.ctx.heightAt(x, z)) + 0.6, z);
    this.marker.visible = true;
  }
  get mailTarget() { return this.target; }
  drop(plane) {
    const { g, holder } = parcelMesh();
    _p.copy(plane.pos).addScaledVector(plane.up, -1.4);
    g.position.copy(_p);
    this.ctx.scene.add(g);
    this.parcels.push({ g, holder, vel: plane.vel.clone().multiplyScalar(0.95), t: 0, low: plane.agl + plane.standH < LOW, target: this.target, landed: 0 });
    this.bags--;
    this.ctx.sound.click(true);
    if (!this.bags) this.ctx.ui.toast('Dernier sac largué : pose-toi sur une piste pour recharger', 2600);
  }
  land(pc) {
    const { ui, sound, heightAt } = this.ctx, p = pc.g.position, tv = pc.target;
    if (heightAt(p.x, p.z) < 0) { ui.toast("Plouf ! Le sac est tombé à l'eau", 2200); return; }
    const d = tv ? Math.hypot(p.x - tv.x, p.z - tv.z) : Infinity, dm = Math.round(d);
    const bump = pc.low ? ' (largué trop bas : sac cabossé)' : '';
    const other = this.villages.find((v) => v !== tv && Math.hypot(p.x - v.x, p.z - v.z) < v.r);
    if (tv && d < tv.r) {
      this.delivered++;
      this.best = Math.min(this.best, d);
      if (d < 40) { this.perfect++; ui.toast(`🎯 En plein sur la place de ${tv.name} ! (${dm} m)${bump}`, 2800); sound.chime(3); }
      else { ui.toast(`✉ Courrier livré à ${tv.name}, à ${dm} m de la place${bump}`, 2600); sound.chime(2); }
      if (tv === this.target) {
        this.pick();
        if (this.target && this.target !== tv) setTimeout(() => this.ctx.ui.toast(`Prochaine livraison : ${this.target.name} (N : carte)`, 2400), 2700);
      }
    } else if (other) ui.toast(`Mauvais village : ce sac est arrivé à ${other.name}, il était pour ${tv.name}`, 2800);
    else ui.toast(`Raté : le sac est tombé à ${dm} m de la place de ${tv ? tv.name : 'destination'}`, 2400);
  }
  update(dt, plane, input) {
    const { ui, sound, heightAt, canLoad } = this.ctx;
    // chargement : à l'arrêt sur une piste (ou l'esplanade de la base nautique)
    this.loading = plane.onGround && plane.groundSpeed < 1 && canLoad(plane.pos.x, plane.pos.z) && this.bags < BAGS;
    if (this.loading) {
      if (this.loadAcc === 0) ui.toast('Chargement du courrier…', 1500);
      this.loadAcc += dt;
      if (this.loadAcc > 1.2) {
        this.loadAcc = 0.001; this.bags++;
        sound.click(false);
        if (this.bags === BAGS) { ui.toast(`Soute pleine : ${BAGS} sacs pour ${this.target ? this.target.name : 'le village'} !`, 2400); sound.chime(1); }
      }
    } else this.loadAcc = 0;
    // largage : un sac à chaque appui sur X
    const fire = input.fireHeld();
    if (fire && !this.prevFire) {
      if (plane.onGround) ui.toast('Décolle d\'abord : on largue le courrier en vol', 1600);
      else if (this.bags > 0) this.drop(plane);
      else ui.toast('Plus de sac : recharge à l\'arrêt sur une piste', 1800);
    }
    this.prevFire = fire;
    // sacs en l'air : chute libre, puis le parachute s'ouvre et freine
    for (const pc of this.parcels) {
      const p = pc.g.position;
      if (pc.landed) {
        pc.landed += dt;
        pc.holder.scale.y = Math.max(0.05, pc.holder.scale.y - dt * 0.8);  // la voile s'affaisse
        pc.holder.rotation.z = Math.min(1.3, pc.holder.rotation.z + dt * 0.9);
        continue;
      }
      pc.t += dt;
      const open = pc.t < 0.7 ? 0 : Math.min(1, (pc.t - 0.7) / 0.6);
      pc.holder.scale.setScalar(Math.max(0.01, open));
      pc.vel.y -= 9.8 * dt;
      if (open > 0) {
        const k = Math.min(1, dt * 2.2 * open);
        pc.vel.y += (-1 - pc.vel.y) * k; // avec la pesanteur : descente stabilisée vers 5,5 m/s
        pc.vel.x += (1.5 - pc.vel.x) * k * 0.45; // le vent fait un peu dériver
        pc.vel.z += (0 - pc.vel.z) * k * 0.45;
      } else pc.vel.multiplyScalar(1 - Math.min(1, dt * 0.08));
      p.addScaledVector(pc.vel, dt);
      pc.g.rotation.z = Math.sin(pc.t * 1.6) * 0.08 * open;   // léger balancement
      const gy = Math.max(heightAt(p.x, p.z), 0);
      if (p.y <= gy + 0.45) { p.y = gy + 0.45; pc.landed = 0.001; this.land(pc); }
    }
    // on retire les sacs posés depuis longtemps
    this.parcels = this.parcels.filter((pc) => {
      if (pc.landed > 25) { this.ctx.scene.remove(pc.g); return false; }
      return true;
    });
    if (this.target) {
      const d = Math.hypot(plane.pos.x - this.target.x, plane.pos.z - this.target.z);
      this.beamMat.opacity = 0.32 * clamp((d - 150) / 900, 0.15, 1);
    }
    return null;
  }
  hud() {
    const p = this.ctx.plane(), t = this.target;
    const d = t ? Math.hypot(p.pos.x - t.x, p.pos.z - t.z) : 0;
    return {
      title: this.title, big: `${this.delivered}`, unit: 'livrés',
      lines: [`✉ sacs : ${this.bags}/${BAGS}${this.loading ? ' · chargement…' : ''}`,
        t ? `destination : ${t.name} · ${(d / 1000).toFixed(1).replace('.', ',')} km` : '',
        this.bags ? (this.perfect ? `🎯 en plein sur la place : ${this.perfect}` : 'X : larguer un sac au-dessus du cercle jaune') : "à l'arrêt sur une piste pour recharger"],
      bar: this.bags / BAGS,
    };
  }
  dispose() {
    this.ctx.scene.remove(this.marker);
    for (const pc of this.parcels) this.ctx.scene.remove(pc.g);
  }
}
export function createMail(ctx) { return new Mail(ctx); }

/** Appareils qui emportent un réservoir d'eau : l'hélicoptère rouge et l'écopeur. */
export const canScoop = (spec) => spec.id === 'helico' || spec.id === 'canadair';
export function createWaterBomber(ctx) { return new Fires(ctx); }
export { clamp };
