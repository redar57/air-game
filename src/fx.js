import * as THREE from 'three';
import { damp } from './util.js';

const MAX = 420, TRAIL = 46;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color(), _p = new THREE.Vector3();

/** Explosion / gerbe d'eau en particules low-poly, et traînées de bout d'aile. */
export class Effects {
  constructor(scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshBasicMaterial(), MAX);
    this.mesh.frustumCulled = false;
    this.parts = [];
    for (let i = 0; i < MAX; i++) {
      this.parts.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), size: 1, grow: 0, grav: 0 });
      this.mesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, _c.set(0xffffff));
    }
    scene.add(this.mesh);
    this.cursor = 0;

    this.trails = [0, 1].map(() => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      line.frustumCulled = false;
      scene.add(line);
      return line;
    });
    this.trailAlpha = 0;
  }

  emit(pos, vel, life, size, color, grow, grav) {
    const i = this.cursor = (this.cursor + 1) % MAX, p = this.parts[i];
    p.pos.copy(pos); p.vel.copy(vel); p.life = p.max = life; p.size = size; p.grow = grow; p.grav = grav;
    this.mesh.setColorAt(i, _c.set(color));
    this.mesh.instanceColor.needsUpdate = true;
  }

  /** scale : taille de l'avion (1 = petit avion). */
  explode(pos, water, scale = 1) {
    const r = () => Math.random() - 0.5, v = new THREE.Vector3();
    if (water) {
      for (let i = 0; i < 48; i++) {
        v.set(r() * 16, 14 + Math.random() * 26, r() * 16).multiplyScalar(Math.sqrt(scale));
        this.emit(pos, v, 1.1 + Math.random() * 0.9, (1 + Math.random() * 1.8) * scale, i % 3 ? 0xffffff : 0xa9dcf5, 0, 26);
      }
      return;
    }
    for (let i = 0; i < 30; i++) {
      v.set(r() * 34, Math.random() * 26, r() * 34);
      this.emit(pos, v, 0.5 + Math.random() * 0.7, (2.2 + Math.random() * 3) * scale, i % 2 ? 0xff8a1f : 0xffd34d, -1.5, 4);
    }
    for (let i = 0; i < 20; i++) {
      v.set(r() * 10, 5 + Math.random() * 9, r() * 10);
      this.emit(pos, v, 1.6 + Math.random() * 1.4, (2.5 + Math.random() * 2.5) * scale, i % 2 ? 0x3a3a3a : 0x565656, 2.2, -1);
    }
    for (let i = 0; i < 16; i++) {
      v.set(r() * 70, 12 + Math.random() * 30, r() * 70);
      this.emit(pos, v, 1.4 + Math.random(), (0.5 + Math.random() * 0.7) * scale, 0x2a2c30, 0, 24);
    }
  }

  /** Traînées : tips = positions locales des bouts d'aile ; on = conditions réunies (vitesse, G). */
  updateTrails(dt, plane, tips, on) {
    this.trailAlpha = damp(this.trailAlpha, on ? 0.5 : 0, on ? 6 : 2.5, dt);
    this.trails.forEach((line, k) => {
      const a = line.geometry.attributes.position.array;
      _p.set(tips[k][0], tips[k][1], tips[k][2]).applyQuaternion(plane.quat).add(plane.pos);
      if (this.trailAlpha < 0.02) {
        for (let i = 0; i < TRAIL; i++) { a[i * 3] = _p.x; a[i * 3 + 1] = _p.y; a[i * 3 + 2] = _p.z; }
      } else {
        a.copyWithin(3, 0, (TRAIL - 1) * 3);
        a[0] = _p.x; a[1] = _p.y; a[2] = _p.z;
      }
      line.geometry.attributes.position.needsUpdate = true;
      line.material.opacity = this.trailAlpha;
      line.visible = this.trailAlpha >= 0.02;
    });
  }

  update(dt) {
    let dirty = false;
    for (let i = 0; i < MAX; i++) {
      const p = this.parts[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      p.vel.y -= p.grav * dt;
      p.vel.multiplyScalar(1 - Math.min(1, 1.2 * dt));
      p.pos.addScaledVector(p.vel, dt);
      p.size = Math.max(0, p.size + p.grow * dt);
      const k = p.life <= 0 ? 0 : p.size * Math.min(1, (p.life / p.max) * 2.5);
      _m.compose(p.pos, _q, _s.set(k, k, k));
      this.mesh.setMatrixAt(i, _m);
      dirty = true;
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
}
