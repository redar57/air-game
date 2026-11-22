import * as THREE from 'three';
import { heightAt, VOLCANO } from './terrain.js';
import { Puffs } from './puffs.js';
import { smoothstep } from '../util.js';

// Volcan actif : un mince panache permanent et, de temps en temps (sans annonce), une éruption : colonne de cendres,
// bombes de lave, et coulées qui descendent les flancs puis refroidissent.

const QUIET = [780, 1020], ERUPT = 95, COOL = 260; // repos (s), durée d'une éruption, refroidissement des coulées
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();
const G = 9.81;

/** Ligne de plus grande pente depuis le bord du cratère (avec un peu d'inertie), jusqu'à la mer ou à un creux. */
function flowPath(a) {
  let x = VOLCANO.x + Math.cos(a) * VOLCANO.rimR * 0.98, z = VOLCANO.z + Math.sin(a) * VOLCANO.rimR * 0.98, dx = Math.cos(a), dz = Math.sin(a);
  const pts = [{ x: VOLCANO.x + dx * VOLCANO.rimR * 0.72, z: VOLCANO.z + dz * VOLCANO.rimR * 0.72 }];
  for (let i = 0; i < 260; i++) {
    pts.push({ x, z });
    const gx = heightAt(x - 12, z) - heightAt(x + 12, z), gz = heightAt(x, z - 12) - heightAt(x, z + 12), l = Math.hypot(gx, gz);
    if (heightAt(x, z) < 1 || (l < 1.2 && i > 60)) break;
    const r = Math.hypot(x - VOLCANO.x, z - VOLCANO.z) || 1;
    dx = dx * 0.72 + ((gx / (l || 1)) * 0.8 + ((x - VOLCANO.x) / r) * 0.35) * 0.28; dz = dz * 0.72 + ((gz / (l || 1)) * 0.8 + ((z - VOLCANO.z) / r) * 0.35) * 0.28;
    const n = Math.hypot(dx, dz) || 1; dx /= n; dz /= n;
    x += dx * 9; z += dz * 9;
  }
  return pts;
}

export class Volcano {
  constructor(scene) {
    this.y = heightAt(VOLCANO.x, VOLCANO.z);
    this.rim = heightAt(VOLCANO.x + VOLCANO.rimR, VOLCANO.z);
    this.ash = new Puffs(scene, 260, { opacity: 0.82 });
    this.steam = new Puffs(scene, 60, { opacity: 0.6 });
    this.fire = new Puffs(scene, 140, { opacity: 1, emissive: 0xff5a10 });
    this.t = QUIET[0] * 0.35; this.on = false; this.emitT = 0; this.k = 0; this.n = 0;
    // bombes de lave
    this.bombs = Array.from({ length: 46 }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0 }));
    this.bm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xff6a1c }), this.bombs.length);
    this.bm.frustumCulled = false; this.bm.visible = false; scene.add(this.bm);
    // coulées
    let low = 0; // brèche : le point le plus bas du bord
    for (let a = 0, h = 1e9; a < 6.28; a += 0.05) { const y = heightAt(VOLCANO.x + Math.cos(a) * VOLCANO.rimR, VOLCANO.z + Math.sin(a) * VOLCANO.rimR); if (y < h) { h = y; low = a; } }
    this.flows = [low, ...[0.5, 1.9, 3.2, 4.4, 5.5].filter((a) => Math.cos(a - low) < 0.8)].map((a) => this.ribbon(scene, flowPath(a), a)).filter((f) => f.n > 30);
  }
  ribbon(scene, pts, seed) {
    const pos = [], col = [], W = 5, n = pts.length - 1;
    const row = (i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n, i + 1)], p = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z) || 1, w = 19 + 9 * Math.sin(i * 0.16 + seed * 3) + 12 * smoothstep(0.4, 1, i / n);
      return Array.from({ length: W }, (_, j) => { const u = (j / (W - 1)) * 2 - 1, x = p.x - ((b.z - a.z) / l) * u * w, z = p.z + ((b.x - a.x) / l) * u * w; return [x, Math.max(0.2, heightAt(x, z)) + 1.9 * (1 - u * u) + (Math.abs(u) === 1 ? -0.6 : 0.5), z, u]; });
    };
    let A = row(0);
    for (let i = 0; i < n; i++) {
      const B = row(i + 1);
      for (let j = 0; j < W - 1; j++) for (const v of [A[j], A[j + 1], B[j], A[j + 1], B[j + 1], B[j]]) {
        pos.push(v[0], v[1], v[2]);
        const h = Math.sin(i * 1.7 + j * 2.3 + seed * 9) * 0.5 + 0.5, e = Math.abs(v[3]);
        _c.setRGB(1, 0.62 - e * 0.4 - h * 0.16, 0.16 - e * 0.1).multiplyScalar(e === 1 ? 0.45 : 1 - h * 0.22); col.push(_c.r, _c.g, _c.b);
      }
      A = B;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true }));
    mesh.visible = false; scene.add(mesh);
    return { mesh, n, per: (W - 1) * 6, pts, head: 0, heat: 0, age: 1e9, active: false, speed: 1 };
  }
  /** Lance une éruption (utilisé aussi pour les essais). */
  erupt() {
    this.on = true; this.t = ERUPT; this.n++;
    const start = this.n % this.flows.length;
    this.flows.forEach((f, i) => { if (i === 0 || (i - start + this.flows.length) % this.flows.length < 2) Object.assign(f, { active: true, head: 0, age: 0, speed: 2.1 + (i % 3) * 0.6 }); });
  }
  /** Grondement entendu de la caméra (0..1). */
  loudness(cam) { return (0.9 * this.k) / (1 + (Math.hypot(cam.x - VOLCANO.x, cam.y - this.rim, cam.z - VOLCANO.z) / 1400) ** 1.5); }

  update(dt, cam) {
    if (dt <= 0) return;
    if ((this.t -= dt) <= 0) { if (this.on) { this.on = false; this.t = QUIET[0] + Math.random() * (QUIET[1] - QUIET[0]); } else this.erupt(); }
    this.k += ((this.on ? 1 : 0) - this.k) * (1 - Math.exp(-dt * 0.7));
    const R = () => Math.random() - 0.5, X = VOLCANO.x, Z = VOLCANO.z;
    // panache : le vent l'emporte vers l'est
    if ((this.emitT -= dt) <= 0) {
      if (this.on) {
        this.emitT = 0.22;
        const g = 0.14 + Math.random() * 0.16; _c.setRGB(g, g * 0.95, g * 0.92);
        this.ash.emit(X + R() * 90, this.y + 60, Z + R() * 90, 14 + R() * 22, 78 + Math.random() * 34, R() * 24, 34, 150 + Math.random() * 90, 34, _c.getHex());
      } else {
        this.emitT = 1.9;
        this.ash.emit(X + R() * 60, this.y + 30, Z + R() * 60, 9 + R() * 4, 36 + Math.random() * 8, R() * 4, 16, 95 + Math.random() * 35, 46, Math.random() < 0.5 ? 0x9a9a98 : 0xb9b8b4);
      }
    }
    if (this.on) {
      for (let i = 0; i < 3; i++) if (Math.random() < dt * 26) this.fire.emit(X + R() * 70, this.y + 8, Z + R() * 70, R() * 44, 55 + Math.random() * 70, R() * 44, 5, 2, 2.6, Math.random() < 0.5 ? 0xff8a2a : 0xffc04a);
      const b = this.bombs.find((o) => !o.r);
      if (b && Math.random() < dt * 7) { const a = Math.random() * 6.283, h = 25 + Math.random() * 62; b.r = 2.5 + Math.random() * 5; b.p.set(X, this.y + 20, Z); b.v.set(Math.cos(a) * h, 85 + Math.random() * 45, Math.sin(a) * h); }
    }
    let any = false;
    this.bombs.forEach((b, i) => {
      if (b.r) {
        any = true; b.v.y -= G * dt; b.p.addScaledVector(b.v, dt);
        if (Math.random() < dt * 9) this.steam.emit(b.p.x, b.p.y, b.p.z, 2, 2, 0, b.r * 0.7, b.r * 2, 4, 0x4a4644);
        if (b.v.y < 0 && b.p.y < heightAt(b.p.x, b.p.z)) { for (let q = 0; q < 3; q++) this.steam.emit(b.p.x, b.p.y, b.p.z, R() * 16, 8, R() * 16, 4, 14, 5, 0x6b6661); b.r = 0; }
      }
      this.bm.setMatrixAt(i, _m.compose(b.p, _q.set(Math.sin(i + b.p.y * 0.05), Math.cos(i), 0.3, 1).normalize(), _s.setScalar(b.r || 1e-4)));
    });
    this.bm.visible = any; if (any) this.bm.instanceMatrix.needsUpdate = true;
    for (const f of this.flows) {
      if (!f.active) continue;
      f.age += dt;
      if (this.on) { f.head = Math.min(f.n, f.head + f.speed * dt); f.heat = Math.min(1, f.heat + dt * 0.5); }
      else f.heat = Math.max(0, f.heat - dt / COOL);
      f.mesh.visible = f.head > 1;
      f.mesh.geometry.setDrawRange(0, Math.floor(f.head) * f.per);
      const h = f.heat, pulse = 1 + 0.06 * Math.sin(f.age * 2);
      f.mesh.material.color.setRGB((0.1 + 0.9 * h) * pulse, 0.1 + 0.9 * h * h, 0.1 + 0.9 * h * h * h);
      f.mesh.material.opacity = smoothstep(0, 0.12, h);
      if (h <= 0) { f.active = false; f.mesh.visible = false; }
      const p = f.pts[Math.min(f.n, Math.floor(f.head))]; // fumerolles à la tête ; vapeur si elle touche l'eau
      if (this.on && Math.random() < dt * 2.5) { const y = heightAt(p.x, p.z), sea = y < 3; this.steam.emit(p.x + R() * 14, Math.max(0, y) + 2, p.z + R() * 14, 2 + R() * 3, sea ? 9 : 4, R() * 3, 3, sea ? 24 : 11, 9, sea ? 0xf4f4f2 : 0x8a8682); }
    }
    this.ash.update(dt, 0.07); this.steam.update(dt, 0.25); this.fire.update(dt, 0.25);
  }
}
