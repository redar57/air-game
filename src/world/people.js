import * as THREE from 'three';
import { mergeColored, xform, mulberry32 } from '../util.js';

// Personnages low-poly en instances : promeneurs qui suivent une boucle, ou personnes immobiles (plage, quais…).

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const SHIRTS = [0xd8312b, 0x2f5fa8, 0xf2c230, 0x2f8a5a, 0xf4f4ee, 0x8e5cc9, 0xf08a2c, 0x2ec4b6, 0x3a3f45, 0xe0457b];
let geo = null;
/** Silhouette : le haut (blanc) prend la couleur de l'instance. */
function personGeo() {
  return geo || (geo = mergeColored([
    { geo: new THREE.BoxGeometry(0.5, 0.7, 0.3), color: 0xffffff, matrix: xform(0, 1.15, 0) },
    { geo: new THREE.BoxGeometry(0.42, 0.8, 0.26), color: 0x4a5058, matrix: xform(0, 0.4, 0) },
    { geo: new THREE.BoxGeometry(0.3, 0.32, 0.3), color: 0xd9a583, matrix: xform(0, 1.68, 0) },
    { geo: new THREE.BoxGeometry(0.32, 0.12, 0.32), color: 0x4a3626, matrix: xform(0, 1.88, 0) },
  ]));
}

/** Distance au-delà de laquelle on ne dessine ni n'anime les personnages. */
const NEAR = 1600;

export class People {
  /** list : [{ loop: [{x, z}…] } qui marche, ou { x, z, yaw, lie } immobile] ; y(x, z) donne le sol. */
  constructor(scene, list, y, seed = 1) {
    const rnd = mulberry32(seed);
    this.y = y;
    this.mesh = new THREE.InstancedMesh(personGeo(), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), Math.max(1, list.length));
    this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    let cx = 0, cz = 0;
    this.list = list.map((o, i) => {
      this.mesh.setColorAt(i, _c.setHex(SHIRTS[Math.floor(rnd() * SHIRTS.length)]));
      const w = { ...o, s: 0, sp: 1 + rnd() * 0.7, ph: rnd() * 6, scale: 0.9 + rnd() * 0.2 };
      if (o.loop) {
        w.len = [0];
        o.loop.forEach((a, k) => { const b = o.loop[(k + 1) % o.loop.length]; w.len.push(w.len[k] + Math.hypot(b.x - a.x, b.z - a.z)); });
        w.s = rnd() * w.len[o.loop.length]; w.x = o.loop[0].x; w.z = o.loop[0].z; w.dir = rnd() < 0.5 ? 1 : -1;
      }
      cx += w.x; cz += w.z;
      return w;
    });
    this.x = cx / Math.max(1, list.length); this.z = cz / Math.max(1, list.length);
    this.r = this.list.reduce((m, w) => Math.max(m, Math.hypot(w.x - this.x, w.z - this.z)), 0);
    scene.add(this.mesh);
    this.first = true;
  }
  update(dt, t, cam) {
    const show = !cam || Math.hypot(cam.x - this.x, cam.z - this.z) < NEAR + this.r;
    this.mesh.visible = show;
    if (!show && !this.first) return;
    this.first = false;
    this.list.forEach((w, i) => {
      let bob = 0;
      if (w.loop) {
        const n = w.loop.length, L = w.len[n];
        w.s = (w.s + w.dir * w.sp * dt + L) % L;
        let k = 0; while (k < n - 1 && w.len[k + 1] < w.s) k++;
        const a = w.loop[k], b = w.loop[(k + 1) % n], f = (w.s - w.len[k]) / (w.len[k + 1] - w.len[k] || 1);
        w.x = a.x + (b.x - a.x) * f; w.z = a.z + (b.z - a.z) * f;
        w.yaw = Math.atan2((a.x - b.x) * w.dir, (a.z - b.z) * w.dir);
        bob = Math.abs(Math.sin(t * 5 + w.ph)) * 0.07;
      }
      _q.setFromAxisAngle(UP, w.yaw || 0);
      if (w.lie) _q.multiply(_l);
      _m.compose(_p.set(w.x, this.y(w.x, w.z) + bob + (w.lie ? 0.35 : 0) + (w.up || 0), w.z), _q, _s.setScalar(w.scale));
      this.mesh.setMatrixAt(i, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
const _l = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
