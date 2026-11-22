import * as THREE from 'three';
import { mulberry32, mergeColored, xform, smoothstep, lerp } from '../util.js';
import { HALF, BIG } from './terrain.js';

// Bateaux : bateaux de pêche, voiliers, chalutiers et vedettes qui croisent autour des îles. Chacun avance droit devant,
// sonde l'eau devant sa proue et vire dès qu'il approche d'un haut-fond, d'une côte ou du bord du monde.
// Repère bateau : -Z vers l'avant (rotation.y = cap).

const KINDS = {
  //        vitesse (m/s), longueur (pour le sillage), part de la flotte
  fisher: { speed: [3, 5], len: 13, share: 0.4 },
  sail: { speed: [3, 5], len: 10, share: 0.3 },
  trawler: { speed: [3, 4.5], len: 18, share: 0.15 },
  speed: { speed: [10, 15], len: 8, share: 0.15 },
};
/** Bateaux de pêche : coque et liston (et pont) ; la première livrée reprend le bateau jaune à liston rouge. */
const FISHER_COLORS = [
  [0xf0b62f, 0xe8553e, 0xf6cf63], [0x3f7fc4, 0xf4f4f0, 0xdfe6ea], [0x3d9a6a, 0xf08a2c, 0xe9dcb8], [0xf4f2ea, 0x2f5f9e, 0xd9cdb0],
];

/**
 * Coque arrondie : une boîte subdivisée qu'on effile vers la proue (-Z), qu'on arrondit vers la quille
 * et dont le bord se relève à l'avant (tonture). Le liston et le pont suivent la même forme.
 */
function hull(parts, { len, w, h, sheer, color, rim, deck }) {
  const yb = -0.8, yt = h - 0.8;
  const shape = (geo, narrow = true) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const t = Math.min(1, Math.max(0, (z + len / 2) / len)), up = smoothstep(yb, yt, y);
      if (narrow) {
        let wf = Math.pow(smoothstep(0, 0.42, t), 0.6) * lerp(1, 0.86, smoothstep(0.8, 1, t));
        wf *= lerp(0.35, 1, smoothstep(yb, yb + h * 0.75, y)); // fond arrondi
        x *= Math.max(wf, 0.03);
      }
      z += (1 - up) * len * 0.14 * (1 - t) ** 3; // étrave inclinée : le bas de la proue recule
      y += sheer * (1 - t) ** 2 * up;
      p.setXYZ(i, x, y, z);
    }
    return geo;
  };
  parts.push({ geo: shape(new THREE.BoxGeometry(w, h, len, 2, 4, 16).translate(0, (yb + yt) / 2, 0)), color });
  parts.push({ geo: shape(new THREE.BoxGeometry(w * 0.97, 0.1, len * 0.985, 2, 1, 16).translate(0, yt + 0.03, 0.05)), color: deck });
  parts.push({ geo: shape(new THREE.BoxGeometry(w * 1.1, 0.4, len * 1.015, 2, 1, 16).translate(0, yt + 0.05, 0)), color: rim });
  // étrave : un listel de la couleur du liston sur l'arête de la proue
  parts.push({ geo: shape(new THREE.BoxGeometry(0.36, h + 0.4, 0.5, 1, 4, 1).translate(0, (yb + yt) / 2 + 0.2, -len / 2 - 0.05), false), color: rim });
  return yt;
}

export function buildModel(kind, variant = 0) {
  const parts = [];
  const B = (w, h, d, color, x, y, z, ry = 0, rx = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color, matrix: xform(x, y, z, ry, 1, 1, 1, rx) });
  const C = (r, h, color, x, y, z, seg = 8) => parts.push({ geo: new THREE.CylinderGeometry(r, r, h, seg), color, matrix: xform(x, y, z) });
  if (kind === 'fisher') {
    const [hc, rc, dc] = FISHER_COLORS[variant];
    const yt = hull(parts, { len: 13, w: 4.4, h: 2.4, sheer: 1.2, color: hc, rim: rc, deck: dc });
    // timonerie gris-bleu, fenêtres blanches, liseré rouge et toit blanc
    const wz = -0.9, wy = yt + 0.15;
    parts.push({ geo: new THREE.CylinderGeometry(1.55, 1.75, 2.3, 6).rotateY(Math.PI / 6), color: 0x4f6273, matrix: xform(0, wy + 1.15, wz, 0, 1, 1, 1.25) });
    for (const s of [-1, 1]) for (const dz of [-0.9, 0.7]) {
      B(0.12, 1.25, 1.0, 0xf4f4f0, s * 1.62, wy + 1.25, wz + dz);
      B(0.14, 0.95, 0.72, 0xa9b1b8, s * 1.62, wy + 1.25, wz + dz);
    }
    for (const dx of [-0.6, 0.6]) {
      B(0.95, 1.2, 0.12, 0xf4f4f0, dx, wy + 1.25, wz - 2.02);
      B(0.7, 0.92, 0.14, 0xa9b1b8, dx, wy + 1.25, wz - 2.02);
    }
    parts.push({ geo: new THREE.CylinderGeometry(1.9, 1.9, 0.32, 6).rotateY(Math.PI / 6), color: rc, matrix: xform(0, wy + 2.42, wz, 0, 1, 1, 1.25) });
    parts.push({ geo: new THREE.CylinderGeometry(1.45, 1.75, 0.6, 6).rotateY(Math.PI / 6), color: 0xf4f4f0, matrix: xform(0, wy + 2.88, wz, 0, 1, 1, 1.25) });
    // mât rouge à bagues blanches, antenne
    const mz = 1.6;
    C(0.17, 6.2, rc, 0, wy + 3.1, mz);
    for (const y of [4.6, 5.0, 5.6]) C(0.22, 0.16, 0xf4f4f0, 0, wy + y, mz);
    C(0.05, 3.2, 0x3a4048, 0, wy + 7.8, mz, 5);
    // garde-corps à l'arrière
    const rail = 0xc8ccd0, z0 = 2.4, z1 = 5.9, rx = 1.85;
    for (const s of [-1, 1]) {
      for (let z = z0; z <= z1 + 0.01; z += 0.875) C(0.05, 0.95, rail, s * rx, yt + 0.6, z, 4);
      B(0.1, 0.1, z1 - z0, rail, s * rx, yt + 1.08, (z0 + z1) / 2);
    }
    for (let x = -rx; x <= rx + 0.01; x += rx / 2) C(0.05, 0.95, rail, x, yt + 0.6, z1, 4);
    B(rx * 2, 0.1, 0.1, rail, 0, yt + 1.08, z1);
  } else if (kind === 'sail') {
    const yt = hull(parts, { len: 10, w: 3, h: 1.5, sheer: 0.5, color: 0xf6f6f2, rim: 0x24406b, deck: 0xc9a06a });
    B(1.8, 0.7, 3, 0xf6f6f2, 0, yt + 0.35, 0.8);
    C(0.1, 13, 0xdddddd, 0, yt + 6.5, -0.8, 5);
    const sail = new THREE.BufferGeometry();
    sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 1.6, -0.6, 0, 13.6, -0.7, 0, 1.6, 4.2, 0, 1.6, -1.0, 0, 11, -1.0, 0, 1.6, -5.0], 3));
    parts.push({ geo: sail, color: 0xfffbea, matrix: xform(0.05) });
  } else if (kind === 'trawler') {
    const yt = hull(parts, { len: 18, w: 5, h: 3, sheer: 1, color: 0x2f5f9e, rim: 0xd8402f, deck: 0x9a8f80 });
    B(3.4, 2.6, 4.5, 0xf2efe6, 0, yt + 1.3, -3);
    B(3.5, 0.6, 1.2, 0x2b3440, 0, yt + 2.1, -5.3);
    B(3.7, 0.3, 4.8, 0xd8402f, 0, yt + 2.75, -3);
    C(0.14, 7, 0x555555, 0, yt + 3.5, 0, 6);
    for (const s of [-1, 1]) B(0.25, 4.5, 0.25, 0x555555, s * 2, yt + 2.2, 7.4);  // portique arrière
    B(4.3, 0.25, 0.25, 0x555555, 0, yt + 4.4, 7.4);
    B(2.2, 1, 2.2, 0x3d8a5a, 0, yt + 0.5, 3.5);                                    // filets
  } else {
    const yt = hull(parts, { len: 8, w: 2.6, h: 1.6, sheer: 0.6, color: 0xd8452e, rim: 0xf4f4f0, deck: 0xe8e2d0 });
    B(2.0, 0.7, 0.12, 0x2b3440, 0, yt + 0.45, -0.9, 0, -0.5);
    B(1.8, 0.5, 1.6, 0xf4f4f0, 0, yt + 0.25, 0.6);
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
    const geos = { fisher: FISHER_COLORS.map((_, i) => buildModel('fisher', i)), sail: [buildModel('sail')], trawler: [buildModel('trawler')], speed: [buildModel('speed')] };
    const wakeGeo = wakeGeometry();
    this.boats = [];
    const want = BIG ? 30 : 14, lim = HALF * 0.82;
    for (let n = 0; n < 4000 && this.boats.length < want; n++) {
      const x = (rnd() - 0.5) * 2 * lim, z = (rnd() - 0.5) * 2 * lim, h = heightAt(x, z);
      // en eau assez profonde, mais surtout pas trop loin des côtes (h > -55 : la mer s'approfondit au large)
      if (h > -12 || (rnd() < 0.7 && h < -55) || !this.clear(x, z, 0) || this.boats.some((b) => Math.hypot(b.x - x, b.z - z) < 400)) continue;
      let r = rnd(), kind = 'fisher';
      for (const [name, kd] of Object.entries(KINDS)) { if (r < kd.share) { kind = name; break; } r -= kd.share; }
      const k = KINDS[kind], list = geos[kind];
      const mesh = new THREE.Mesh(list[Math.floor(rnd() * list.length)], mat);
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
