import * as THREE from 'three';

// Bouffées de fumée : une réserve fixe de boules à facettes, recyclées à tour de rôle.

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _c = new THREE.Color();

export class Puffs {
  constructor(scene, count, { opacity = 0.9, emissive = 0 } = {}) {
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
      new THREE.MeshLambertMaterial({ flatShading: true, transparent: opacity < 1, opacity, emissive, depthWrite: opacity >= 1 }), count);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.list = Array.from({ length: count }, () => ({ t: 1, life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r0: 1, r1: 1 }));
    this.next = 0; this.alive = 0;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, _c.setHex(0xffffff));
    scene.add(this.mesh);
  }
  /** Lâche une bouffée en (x, y, z), de vitesse (vx, vy, vz), qui grossit de r0 à r1 mètres en `life` secondes. */
  emit(x, y, z, vx, vy, vz, r0, r1, life, color = 0xf4f4f2) {
    const i = this.next, o = this.list[i];
    this.next = (i + 1) % this.list.length;
    o.p.set(x, y, z); o.v.set(vx, vy, vz); o.r0 = r0; o.r1 = r1; o.life = life; o.t = 0;
    this.mesh.setColorAt(i, _c.setHex(color)); this.mesh.instanceColor.needsUpdate = true;
    this.alive = 1;
  }
  update(dt, drag = 0.8) {
    if (!this.alive) return;
    this.alive = 0;
    const k = Math.exp(-drag * dt);
    this.list.forEach((o, i) => {
      let r = 0;
      if (o.life > 0) {
        o.t += dt;
        const f = o.t / o.life;
        if (f >= 1) o.life = 0;
        else {
          this.alive++;
          o.v.multiplyScalar(k);
          o.p.addScaledVector(o.v, dt);
          r = (o.r0 + (o.r1 - o.r0) * Math.sqrt(f)) * (f > 0.65 ? (1 - f) / 0.35 : 1); // grossit, puis se dissipe
        }
      }
      this.mesh.setMatrixAt(i, _m.compose(o.p, _q.set(Math.sin(i), Math.cos(i * 2.1), Math.sin(i * 3.3), 1).normalize(), _s.setScalar(Math.max(r, 1e-4))));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.visible = this.alive > 0;
  }
}
