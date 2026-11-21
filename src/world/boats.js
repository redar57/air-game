import * as THREE from 'three';
import { mulberry32, mergeColored, xform } from '../util.js';
import { HALF, BIG } from './terrain.js';

// Bateaux : voiliers, chalutiers et vedettes qui croisent autour des îles. Chacun avance droit devant,
// sonde l'eau devant sa proue et vire dès qu'il approche d'un haut-fond, d'une côte ou du bord du monde.
// Repère bateau : -Z vers l'avant (rotation.y = cap).

const KINDS = {
  //        vitesse (m/s), longueur (pour le sillage)
  sail: { speed: [3, 5], len: 10 },
  trawler: { speed: [3.5, 5.5], len: 15 },
  speed: { speed: [10, 15], len: 8 },
};

function hullParts(parts, w, h, len, color, deck = 0xc9b48a) {
  parts.push({ geo: new THREE.BoxGeometry(w, h, len * 0.78), color, matrix: xform(0, h / 2 - 0.4, len * 0.08) });
  // proue en pointe
  parts.push({ geo: new THREE.CylinderGeometry(0.01, w * 0.7071, len * 0.26, 4, 1).rotateX(-Math.PI / 2).rotateZ(Math.PI / 4), color, matrix: xform(0, h / 2 - 0.4, -len * 0.39, 0, 1, h / w, 1) });
  parts.push({ geo: new THREE.BoxGeometry(w * 0.9, 0.12, len * 0.74), color: deck, matrix: xform(0, h - 0.34, len * 0.08) });
}

function buildModel(kind) {
  const parts = [];
  if (kind === 'sail') {
    hullParts(parts, 2.8, 1.4, 10, 0xf4f4f0);
    parts.push({ geo: new THREE.CylinderGeometry(0.1, 0.12, 13, 5), color: 0xdddddd, matrix: xform(0, 7.5, -0.8) });
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.6, -0.6, 0, 13.6, -0.7, 0, 1.6, 4.2, 0, 1.6, -1.0, 0, 11, -1.0, 0, 1.6, -5.2], 3));
    sail.computeVertexNormals();
    parts.push({ geo: sail, color: 0xfffbea, matrix: xform(0.05) });
  } else if (kind === 'trawler') {
    hullParts(parts, 4.2, 2.2, 15, 0x2f5f9e, 0x9a8f80);
    parts.push({ geo: new THREE.BoxGeometry(3, 2.4, 4), color: 0xf2efe6, matrix: xform(0, 3, -1.5) });
    parts.push({ geo: new THREE.BoxGeometry(3.1, 0.25, 4.2), color: 0xc0392b, matrix: xform(0, 4.3, -1.5) });
    parts.push({ geo: new THREE.CylinderGeometry(0.12, 0.14, 7, 5), color: 0x555555, matrix: xform(0, 5.5, 3) });
    parts.push({ geo: new THREE.BoxGeometry(5, 0.15, 0.15), color: 0x555555, matrix: xform(0, 7, 3) });
  } else {
    hullParts(parts, 2.4, 1.1, 8, 0xd8452e, 0xe8e2d0);
    parts.push({ geo: new THREE.BoxGeometry(1.9, 0.9, 1.6), color: 0x2b3440, matrix: xform(0, 1.3, -0.6) });
  }
  return mergeColored(parts);
}

function wakeGeometry() {
  // triangle à plat qui s'élargit vers l'arrière (z positif), long de 1 ; mis à l'échelle selon la vitesse
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, -0.5, 0, 1, 0.5, 0, 1], 3));
  g.computeVertexNormals();
  return g;
}

export class Boats {
  constructor(scene, heightAt, avoid = []) {
    this.heightAt = heightAt;
    this.avoid = avoid; // [{x, z, r}] : zones interdites (porte-avions)
    const rnd = (this.rnd = mulberry32(7171));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
    const wakeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.28, depthWrite: false });
    const geos = { sail: buildModel('sail'), trawler: buildModel('trawler'), speed: buildModel('speed') };
    const wakeGeo = wakeGeometry();
    this.boats = [];
    const want = BIG ? 16 : 8, lim = HALF * 0.82;
    for (let n = 0; n < 4000 && this.boats.length < want; n++) {
      const x = (rnd() - 0.5) * 2 * lim, z = (rnd() - 0.5) * 2 * lim, h = heightAt(x, z);
      // en eau assez profonde, mais surtout pas trop loin des côtes (h > -55 : la mer s'approfondit au large)
      if (h > -12 || (rnd() < 0.7 && h < -55) || !this.clear(x, z, 0) || this.boats.some((b) => Math.hypot(b.x - x, b.z - z) < 500)) continue;
      const r = rnd(), kind = r < 0.5 ? 'sail' : r < 0.8 ? 'trawler' : 'speed', k = KINDS[kind];
      const mesh = new THREE.Mesh(geos[kind], mat);
      mesh.castShadow = true;
      mesh.rotation.order = 'YXZ';
      const wake = new THREE.Mesh(wakeGeo, wakeMat);
      wake.renderOrder = 1;
      scene.add(mesh, wake);
      this.boats.push({
        kind, mesh, wake, x, z, len: k.len, hdg: rnd() * Math.PI * 2, turn: 0,
        speed: k.speed[0] + rnd() * (k.speed[1] - k.speed[0]), probeT: rnd(), phase: rnd() * 6.3,
      });
    }
  }

  /** Vrai si le point (x, z) est en eau libre, assez loin des côtes, du bord du monde et des zones à éviter. */
  clear(x, z, margin = 0) {
    if (Math.abs(x) > HALF * 0.86 || Math.abs(z) > HALF * 0.86) return false;
    if (this.heightAt(x, z) > -6) return false;
    for (const a of this.avoid) if (Math.hypot(x - a.x, z - a.z) < a.r + margin) return false;
    return true;
  }

  update(dt, time) {
    for (const b of this.boats) {
      b.probeT -= dt;
      if (b.probeT <= 0) {
        b.probeT = 0.5;
        const ahead = Math.max(120, b.speed * 22);
        const ok = (h) => this.clear(b.x - Math.sin(h) * ahead, b.z - Math.cos(h) * ahead) && this.clear(b.x - Math.sin(h) * ahead * 0.5, b.z - Math.cos(h) * ahead * 0.5);
        if (!ok(b.hdg)) {
          // cherche le cap libre le plus proche, alternativement à gauche et à droite
          b.turn = 0;
          for (let k = 1; k <= 6 && !b.turn; k++) {
            for (const s of [1, -1]) if (!b.turn && ok(b.hdg + s * k * 0.5)) b.turn = s * k * 0.5;
          }
          if (!b.turn) b.turn = Math.PI; // cul-de-sac : demi-tour
        } else if (Math.abs(b.turn) < 0.01 && this.rnd() < 0.02) {
          b.turn = (this.rnd() - 0.5) * 1.2; // petit changement de cap au hasard
        }
      }
      const rate = (b.kind === 'speed' ? 0.35 : 0.16) * dt, dh = Math.max(-rate, Math.min(rate, b.turn));
      b.hdg += dh; b.turn -= dh;
      // si le bateau s'est malgré tout échoué, il s'arrête et tourne sur place
      const stuck = this.heightAt(b.x, b.z) > -2;
      const v = stuck ? 0 : b.speed;
      b.x -= Math.sin(b.hdg) * v * dt; b.z -= Math.cos(b.hdg) * v * dt;
      if (stuck) b.turn = Math.PI;

      const t = time + b.phase, m = b.mesh;
      m.position.set(b.x, 0.25 * Math.sin(t * 1.3), b.z);
      m.rotation.set(0.03 * Math.sin(t * 0.9) - (b.kind === 'speed' ? 0.06 : 0), b.hdg, 0.05 * Math.sin(t * 1.1) - dh / dt * (b.kind === 'sail' ? 0.4 : 0.15));
      const wl = b.len * (1.5 + v * 0.3);
      b.wake.position.set(b.x + Math.sin(b.hdg) * b.len * 0.45, 0.15, b.z + Math.cos(b.hdg) * b.len * 0.45);
      b.wake.rotation.y = b.hdg;
      b.wake.scale.set(b.len * 0.3 + v * 0.6, 1, wl);
      b.wake.visible = v > 0;
    }
  }
}
