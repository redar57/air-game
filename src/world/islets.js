import * as THREE from 'three';
import { heightAt, normalAt } from './terrain.js';
import { islets } from './places.js';
import { helipadMesh, lightsPoints } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { kit, prism } from './ports.js';
import { buildModel } from './boats.js';
import { People } from './people.js';
import { Puffs } from './puffs.js';
import { mulberry32, smoothstep, mergeColored, xform } from '../util.js';

// Îlots aménagés : phare habité, station météo, village de pêcheurs (grande carte) et île au trésor.

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _n = new THREE.Vector3();

/** Faisceau tournant d'un phare : deux cônes opposés, visibles seulement à la tombée du jour. */
export function lighthouseBeam() {
  const beam = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  for (const s of [1, -1]) {
    const geo = new THREE.ConeGeometry(34, 560, 16, 6, true).translate(0, -280, 0), pp = geo.attributes.position, col = [];
    for (let i = 0; i < pp.count; i++) { const k = Math.pow(1 + pp.getY(i) / 560, 1.6); col.push(k, k, k); } // s'éteint vers le bout
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const cone = new THREE.Mesh(geo, mat);
    cone.rotation.z = s * Math.PI / 2 - s * 0.03; // légèrement plongeant
    beam.add(cone);
  }
  beam.userData.update = (t, night) => {
    beam.rotation.y = t * 0.9;
    mat.opacity = 0.22 * smoothstep(0.15, 0.7, night);
    beam.visible = mat.opacity > 0.005;
  };
  return beam;
}
/** Petite maison : murs, toit à deux pans, porte, fenêtres (façade vers +Z). */
export function cottage(k, x, y, z, ry, w, d, h, wall, roof) {
  const c = Math.cos(ry), s = Math.sin(ry), at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
  k.B(w, h + 2, d, wall, x, y + h / 2 - 1, z, ry);
  k.parts.push({ geo: prism(w + 1, d + 1.4, d * 0.45), color: roof, matrix: xform(x, y + h, z, ry) });
  const put = (a, b, W, H, yy, col) => { const [u, v] = at(a, b); k.B(W, H, 0.2, col, u, y + yy, v, ry); };
  put(0, d / 2 + 0.05, 1.3, 2.3, 1.15, 0x6b4e33);
  for (const a of [-w * 0.3, w * 0.3]) { put(a, d / 2 + 0.05, 1.3, 1.2, 2, 0x3a5a70); put(a, -d / 2 - 0.05, 1.3, 1.2, 2, 0x3a5a70); }
  const [cx, cz] = at(w * 0.28, 0); k.B(1, 2.4, 1, 0x9a6a50, cx, y + h + d * 0.45, cz, ry);
  addBox(x, z, ry, w / 2, d / 2, y - 2, y + h + d * 0.4);
}
let palm = null;
/** Palmiers en instances : [x, z, échelle]. */
export function palms(scene, list) {
  palm = palm || mergeColored([
    ...[0, 1, 2, 3].map((i) => ({ geo: new THREE.CylinderGeometry(0.22 - i * 0.02, 0.28 - i * 0.02, 2, 5), color: 0x9a7650, matrix: xform(0.1 + i * i * 0.1, 1 + i * 1.9, 0, 0, 1, 1, 1, 0, -0.1 - i * 0.06) })),
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ geo: new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.15, 1.6, 0.7, -0.55, 3.4, -0.9, 0, 0, 0, 0.15, 3.4, -0.9, 0, 1.6, 0.7, 0.55, 0, 0, -0.15, 3.4, -0.9, 0, 0, 0, 0.15], 3)), color: i % 2 ? 0x4f9a3f : 0x62ad48, matrix: xform(1.2, 7.8, 0, i * 0.9) })),
    { geo: new THREE.IcosahedronGeometry(0.45, 0), color: 0x6b4a2a, matrix: xform(1.2, 7.5, 0) },
  ]);
  const im = new THREE.InstancedMesh(palm, lam({ side: THREE.DoubleSide }), Math.max(1, list.length)), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  im.count = list.length;
  list.forEach(([x, z, s], i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(x, heightAt(x, z) - 0.2, z), q.setFromAxisAngle(up, i * 2.4), new THREE.Vector3(s, s, s))));
  im.frustumCulled = false; im.castShadow = true; scene.add(im);
}

export function buildIslets(scene) {
  const rnd = mulberry32(6262), ticks = [], smoke = new Puffs(scene, 40, { opacity: 0.5 });
  const add = (k, lights = [], col = 0xffe2a0, size = 5) => { scene.add(k.mesh()); if (lights.length) scene.add(lightsPoints(lights, col, size)); };
  const folk = (list, y = heightAt) => { const p = new People(scene, list, y, 11 + ticks.length); ticks.push((t, night, dt, cam) => p.update(dt, t, cam)); };
  const ring = (x, z, rx, rz = rx) => ({ loop: [0, 1, 2, 3, 4, 5].map((i) => ({ x: x + Math.cos(i * 1.047) * rx, z: z + Math.sin(i * 1.047) * rz })) });
  const fence = (k, pts, y, c = 0xf4f4ee) => pts.forEach(([x, z], i) => { const [u, v] = pts[(i + 1) % pts.length]; k.B(0.2, 1.2, 0.2, c, x, y + 0.6, z); k.B(0.1, 0.12, Math.hypot(u - x, v - z), c, (x + u) / 2, y + 0.95, (z + v) / 2, Math.atan2(u - x, v - z)); });
  /** Rivage depuis le centre de l'îlot dans la direction a : premier point sous h mètres. */
  const shore = (p, a, h) => { let r = 20; while (r < p.r * 2 && heightAt(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r) > h) r += 4; return { x: p.x + Math.cos(a) * r, z: p.z + Math.sin(a) * r, a, r }; };

  for (const p of islets) {
    if (p.kind === 'phare') {
      const k = kit(), y = p.zone.alt, x = p.x, z = p.z, L = [];
      k.C(5.4, 7, 8, 0x9a948a, x, y + 3, z, 10); k.C(3, 4.6, 36, 0xf7f5ef, x, y + 25, z, 10);
      for (const [h, r] of [[14, 4.3], [24, 3.8], [34, 3.35]]) k.C(r - 0.1, r + 0.14, 4.4, 0xc8402f, x, y + h, z, 10);
      k.C(4.6, 4.6, 0.8, 0x3a3f45, x, y + 43.4, z, 10); k.C(0.1, 3.8, 4, 0xc8402f, x, y + 51, z, 10);
      for (let a = 0; a < 10; a++) k.C(0.08, 0.08, 1.3, 0x3a3f45, x + Math.cos(a * 0.628) * 4.4, y + 44.4, z + Math.sin(a * 0.628) * 4.4, 4);
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 5, 10), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
      lamp.position.set(x, y + 46.4, z); scene.add(lamp);
      const beam = lighthouseBeam(); beam.position.copy(lamp.position); scene.add(beam);
      ticks.push((t, night) => { beam.userData.update(t + 2, night); lamp.material.color.setHex(night > 0.2 ? 0xffffff : 0xfff0a0); });
      addCylinder(x, z, 5.5, y - 4, y + 53);
      cottage(k, x + 15, y, z + 6, 0.4, 11, 8, 4.4, 0xfbf7ef, 0xb9472f); cottage(k, x + 13, y, z - 11, 0.1, 6, 5, 3, 0xe9e2d4, 0x6b4e33);
      fence(k, [[x + 5, z + 22], [x + 24, z + 22], [x + 24, z - 18], [x - 18, z - 18], [x - 18, z + 22], [x - 4, z + 22]], y);
      for (let i = 0; i < 10; i++) k.B(1.2, 0.5, 7, [0x5cae3a, 0x8a5a33][i % 2], x - 14 + i * 1.3, y + 0.15, z - 11);
      k.C(0.14, 0.18, 9, 0xd9dcdf, x - 13, y + 4.5, z + 16, 5); k.B(2.6, 1.6, 0.06, 0x2f6fb8, x - 11.6, y + 8, z + 16); // pavillon
      k.B(3, 1.2, 0.8, 0xf4f4ee, x + 9, y + 2.2, z + 17); k.B(3, 0.1, 0.6, 0x8a5a33, x + 9, y + 0.8, z + 19);
      const s = shore(p, 0.6, 0.4); // débarcadère et canot
      k.B(3, 0.4, 26, 0x9a7650, s.x + Math.cos(0.6) * 6, 1.4, s.z + Math.sin(0.6) * 6, Math.PI / 2 - 0.6);
      L.push(x + 15, y + 2.4, z + 11, x + 12, y + 2.4, z + 11); add(k, L);
      folk([ring(x - 2, z + 10, 9), { x: x + 16, z: z + 14, yaw: 1 }]);
      const dinghy = new THREE.Mesh(buildModel('speed'), lam({ side: THREE.DoubleSide })); dinghy.position.set(s.x + Math.cos(0.6) * 22 + 3, 0, s.z + Math.sin(0.6) * 22 - 4); scene.add(dinghy);
      ticks.push((t) => { dinghy.position.y = Math.sin(t * 1.2) * 0.15; dinghy.rotation.z = Math.sin(t) * 0.05; });
    } else if (p.kind === 'meteo') {
      const k = kit(), y = p.zone.alt, x = p.x, z = p.z, W = 0xf4f4ee, red = [];
      k.B(26, 6, 12, 0xdfe6ea, x - 10, y + 3, z); k.B(27, 0.6, 13, 0x2f6fb8, x - 10, y + 6.2, z); k.B(10, 5, 8, 0xdfe6ea, x + 8, y + 2.5, z + 4); k.B(8, 4, 8, W, x - 14, y + 8.4, z); k.B(8.2, 1.6, 8.2, 0x3a5a70, x - 14, y + 9, z);
      for (let a = -20; a <= 0; a += 4) k.B(2, 1.6, 12.2, 0x3a5a70, x + a, y + 3.2, z);
      addBox(x - 10, z, 0, 13, 6, y - 2, y + 10);
      for (const [a, b, r, h] of [[26, -24, 7, 8], [-36, 20, 5, 5]]) { k.C(r * 0.6, r * 0.75, h, 0x9aa3ab, x + a, y + h / 2, z + b, 10); k.parts.push({ geo: new THREE.IcosahedronGeometry(r, 2), color: W, matrix: xform(x + a, y + h + r * 0.7, z + b) }); addCylinder(x + a, z + b, r, y - 2, y + h + r * 1.7); red.push(x + a, y + h + r * 1.75, z + b); }
      // mât d'anémomètres, abri Stevenson, pluviomètres, antenne haubanée
      k.C(0.2, 0.4, 24, 0xd8402f, x + 34, y + 12, z + 22, 6); for (let h = 3; h < 24; h += 6) k.C(0.42, 0.42, 3, W, x + 34, y + h, z + 22, 6); red.push(x + 34, y + 24.6, z + 22);
      for (let i = 0; i < 4; i++) { const u = x + 14 + i * 5, v = z + 26; k.B(1.4, 1.2, 1.4, W, u, y + 1.7, v); for (const [c, d] of [[-0.5, -0.5], [0.5, 0.5], [-0.5, 0.5], [0.5, -0.5]]) k.B(0.1, 1.2, 0.1, W, u + c, y + 0.6, v + d); }
      const spin = (geoParts, X, Y, Z, fn) => { const m = new THREE.Mesh(mergeColored(geoParts), lam()); m.position.set(X, Y, Z); scene.add(m); ticks.push((t) => fn(m, t)); return m; };
      spin([0, 1, 2].flatMap((i) => [{ geo: new THREE.BoxGeometry(1.6, 0.1, 0.1), color: 0x2b2e33, matrix: xform(Math.cos(i * 2.094) * 0.8, 0, -Math.sin(i * 2.094) * 0.8, i * 2.094) }, { geo: new THREE.SphereGeometry(0.35, 6, 4), color: 0xd8402f, matrix: xform(Math.cos(i * 2.094) * 1.6, 0, -Math.sin(i * 2.094) * 1.6) }]), x + 34, y + 24.2, z + 22, (m, t) => { m.rotation.y = t * 4; });
      // éolienne
      k.C(0.7, 1.4, 38, W, x - 42, y + 19, z - 26, 10); k.B(2, 2, 5, W, x - 42, y + 38.4, z - 26); addCylinder(x - 42, z - 26, 1.6, y - 2, y + 56); red.push(x - 42, y + 39.8, z - 26);
      spin([{ geo: new THREE.ConeGeometry(0.9, 1.6, 8).rotateX(-Math.PI / 2), color: 0xd8402f, matrix: xform(0, 0, -0.4) }, ...[0, 1, 2].map((i) => ({ geo: new THREE.BoxGeometry(1.1, 16, 0.2).translate(0, 8, 0), color: W, matrix: xform(0, 0, 0, 0, 1, 1, 1, 0, i * 2.094) }))], x - 42, y + 38.4, z - 29, (m, t) => { m.rotation.z = t * 1.4; });
      // parabole orientable, ballon-sonde captif
      spin([{ geo: new THREE.SphereGeometry(4, 10, 4, 0, 6.283, 0, 1).rotateX(Math.PI), color: W, matrix: xform(0, 4, 0, 0, 1, 1, 1, -0.7) }, { geo: new THREE.CylinderGeometry(0.15, 0.15, 3), color: 0x3a3f45, matrix: xform(0, 2, 0.4, 0, 1, 1, 1, 0.7) }], x + 10, y + 3, z - 26, (m, t) => { m.rotation.y = Math.sin(t * 0.07) * 2; });
      k.C(1, 1.4, 3, 0x9aa3ab, x + 10, y + 1.5, z - 26, 8);
      const bal = new THREE.Mesh(mergeColored([{ geo: new THREE.SphereGeometry(2.6, 10, 8), color: 0xfbfbf8, matrix: xform(0, 0, 0, 0, 1, 1.15, 1) }, { geo: new THREE.BoxGeometry(0.6, 0.6, 0.6), color: 0xf08a2c, matrix: xform(0, -8, 0) }, { geo: new THREE.CylinderGeometry(0.04, 0.04, 6), color: 0x2b2e33, matrix: xform(0, -5, 0) }]), lam());
      scene.add(bal); // un ballon-sonde part régulièrement et disparaît en altitude
      ticks.push((t) => { const u = t % 240; bal.position.set(x + u * 1.5, y + 11 + u * 4, z + 34 + Math.sin(u * 0.1) * 8); const g = Math.min(1, 0.2 + u * 0.05); bal.scale.setScalar(u > 230 ? 0.001 : g + u * 0.004); });
      scene.add(helipadMesh(x + 42, y + 0.2, z - 4, 11));
      add(k, red, 0xff3020, 5); scene.add(lightsPoints([x - 20, y + 3.2, z + 6.6, x - 12, y + 3.2, z + 6.6, x - 4, y + 3.2, z + 6.6], 0xffe2a0, 4));
      folk([ring(x + 4, z + 20, 12, 6), { x: x + 16, z: z + 23, yaw: 2 }]);
    } else if (p.kind === 'pecheurs') {
      const Z = p.zone, k = kit(), y = Z.alt, x = Z.x, z = Z.z, L = [], W = [0xfbf7ef, 0xf6e3c8, 0xcfe3ef, 0xf3d3cf, 0xe3efd2], R = [0xb9472f, 0x3f7fc4, 0xc8553a, 0x4f6f8f];
      k.B(170, 0.4, 8, 0xcdbb95, x + 10, y, z); k.B(8, 0.4, 190, 0xcdbb95, x + 40, y + 0.02, z);
      for (const [a, b, ry] of [[-70, -22, 0], [-48, -24, 0], [-24, -22, 0], [0, -24, 0], [-60, 20, Math.PI], [-36, 22, Math.PI], [-8, 20, Math.PI], [20, -50, Math.PI / 2], [22, -78, Math.PI / 2], [20, 48, Math.PI / 2], [22, 76, Math.PI / 2], [62, -44, -Math.PI / 2], [62, -74, -Math.PI / 2], [62, 52, -Math.PI / 2], [64, 82, -Math.PI / 2]]) {
        cottage(k, x + a, y, z + b, ry, 10 + rnd() * 2, 8, 4.6, W[Math.floor(rnd() * 5)], R[Math.floor(rnd() * 4)]); L.push(x + a, y + 2.4, z + b + (ry === 0 ? 4.4 : ry === Math.PI ? -4.4 : 0));
      }
      // chapelle
      k.B(9, 7, 16, 0xfbf7ef, x - 88, y + 3.5, z); k.parts.push({ geo: prism(17, 10, 5), color: 0x3f7fc4, matrix: xform(x - 88, y + 7, z, Math.PI / 2) }); k.B(4.4, 16, 4.4, 0xfbf7ef, x - 88, y + 8, z + 10); k.parts.push({ geo: new THREE.ConeGeometry(3.4, 6, 4), color: 0x3f7fc4, matrix: xform(x - 88, y + 19, z + 10, Math.PI / 4) }); addBox(x - 88, z + 2, 0, 5, 11, y, y + 20);
      // quai du ferry et ponton de pêche (le ferry accoste l'avant à 237 m du centre de l'îlot)
      const qx = p.x + 237; k.B(150, 1, 12, 0xb3a894, qx - 75, 3, z); for (let a = 4; a < 110; a += 12) for (const s of [-5, 5]) k.C(0.5, 0.6, 12, 0x6b4e33, qx - a, -2.5, z + s, 6); k.B(0.6, 6, 0.6, 0xf2c230, qx - 1, 6, z - 6); k.B(0.6, 6, 0.6, 0xf2c230, qx - 1, 6, z + 6); addBox(qx - 75, z, 0, 75, 6, -6, 3.6);
      const pz = z + 70, px = x + 85; k.B(70, 0.5, 4, 0x9a7650, px + 35, 2.4, pz); for (let a = 6; a < 70; a += 9) for (const s of [-2, 2]) k.C(0.3, 0.35, 10, 0x6b4e33, px + a, -2, pz + s, 6);
      [[40, 6, 'fisher', 1], [58, -6, 'fisher', 2], [60, 7, 'fisher', 0]].forEach(([a, b, kind, v]) => { const m = new THREE.Mesh(buildModel(kind, v), lam({ side: THREE.DoubleSide })); m.position.set(px + a, 0, pz + b); m.rotation.y = -Math.PI / 2; m.rotation.order = 'YXZ'; scene.add(m); ticks.push((t) => { m.position.y = Math.sin(t * 1.2 + a) * 0.15; m.rotation.z = Math.sin(t * 0.9 + a) * 0.04; }); });
      for (let i = 0; i < 9; i++) { const u = x + 76 + rnd() * 10, v = z - 60 + i * 13; if (Math.abs(v - z) < 10) continue; k.parts.push({ geo: new THREE.IcosahedronGeometry(1.4, 0), color: i % 2 ? 0x2f8a5a : 0xc46a3a, matrix: xform(u, y + 0.4, v, i, 1.3, 0.5, 1) }); k.B(0.2, 3, 0.2, 0x6b4e33, u, y + 1.5, v + 4); k.B(0.2, 3, 0.2, 0x6b4e33, u, y + 1.5, v + 9); k.B(0.06, 1.6, 5, 0x8fb0a0, u, y + 2, v + 6.5); }
      for (let a = -60; a < 90; a += 25) { k.C(0.12, 0.16, 4.6, 0x3a3f45, x + a, y + 2.3, z + 5.4, 5); L.push(x + a, y + 4.8, z + 5.4); }
      for (let a = 20; a < 150; a += 32) L.push(qx - a, 4.6, z + 5.4);
      add(k, L);
      const on = (X, Zz) => (X > p.x + 145 && Math.abs(Zz - z) < 6.5 ? 3.5 : X > px && Math.abs(Zz - pz) < 2.5 ? 2.65 : heightAt(X, Zz) + 0.2);
      folk([...Array.from({ length: 9 }, () => ring(x - 60 + rnd() * 100, z + (rnd() - 0.5) * 6, 8 + rnd() * 14, 2)), { loop: [{ x: x + 40, z: z - 1 }, { x: qx - 4, z: z - 1 }, { x: qx - 4, z: z + 2 }, { x: x + 40, z: z + 2 }] }, { loop: [{ x: x + 42, z: pz }, { x: px + 66, z: pz }, { x: px + 66, z: pz + 1 }, { x: x + 42, z: pz + 1 }] }, { x: px + 68, z: pz - 1, yaw: -1.6 }, ring(x + 40, z - 60, 2, 26)], on);
    } else { // île au trésor
      const k = kit(), list = [], A = 2.2;
      for (let i = 0; i < 700 && list.length < 80; i++) { const a = rnd() * 6.283, s = shore(p, a, 2 + rnd() * 7), h = heightAt(s.x, s.z); if (h > 1.4 && Math.abs(Math.sin((a - A) / 2)) > 0.1) list.push([s.x, s.z, 0.8 + rnd() * 0.7]); }
      palms(scene, list);
      // épave couchée sur la grève
      const s = shore(p, A, 0), k2 = kit(), D = 0x6b4a2e, D2 = 0x533822;
      for (let i = 0; i < 11; i++) { const z = -15 + i * 3, w = 4.6 * Math.sin(0.35 + (i / 10) * 2.2); for (const sd of [-1, 1]) if (!(sd > 0 && i > 3 && i < 8 && i % 2)) { k2.B(0.4, 5.2, 1, D2, sd * w, 1.6, z, 0, 0, sd * -0.35); k2.B(0.35, 4.6, 3.1, D, sd * (w + 0.1), 1.5, z, 0, 0, sd * -0.35); } }
      k2.B(1.2, 1, 33, D2, 0, -0.8, 0); k2.B(8.4, 0.3, 11, 0x7d5a3a, 0, 3.2, 10); k2.B(7.6, 4, 5, D, 0, 5, 13.5); for (const a of [-2, 0, 2]) k2.B(1.1, 1.4, 0.2, 0xe8c25a, a, 5.4, 16.1);
      k2.C(0.4, 0.55, 12, D2, 0, 8, 2, 7, 0, 0.12); k2.C(0.35, 0.45, 5, D2, 0.4, 4, -7, 7, 0.2); k2.B(8, 0.35, 0.35, D2, -0.8, 11, 2, 0.1); k2.B(6, 4.4, 0.08, 0xcfc4a8, -0.8, 8.6, 2.1, 0.1, 0.05); k2.B(0.5, 0.5, 8, D2, 0, 4.6, -18, 0, 0.35);
      const wreck = k2.mesh(); wreck.position.set(s.x, Math.max(heightAt(s.x, s.z), -0.6), s.z); wreck.rotation.set(0.06, -A + 0.5, 0.36, 'YXZ'); scene.add(wreck); addBox(s.x, s.z, -A + 0.5, 5, 16, -3, 11);
      // croix, coffre, pelle, campement, rocher percé
      const c = shore(p, A + 0.5, 9), gy = heightAt(c.x, c.z);
      normalAt(c.x, c.z, _n); const rx = Math.asin(_n.z), rz = -Math.asin(_n.x);
      for (const ry of [0.78, -0.78]) k.B(1.6, 0.4, 12, 0xd8312b, c.x, gy + 0.25, c.z, ry, rx * 0.7, rz * 0.7);
      const e = shore(p, A + 0.58, 8), ey = heightAt(e.x, e.z) + 0.1;
      k.B(2.6, 1.3, 1.7, 0x7a4a22, e.x, ey + 0.6, e.z); k.B(2.7, 0.25, 1.8, 0xd9a92b, e.x, ey + 1.2, e.z); k.B(2.6, 0.9, 0.4, 0x7a4a22, e.x, ey + 1.9, e.z - 0.9, 0, -0.5); for (let i = 0; i < 16; i++) k.parts.push({ geo: new THREE.IcosahedronGeometry(0.22, 0), color: i % 4 ? 0xffd34d : 0xd8312b, matrix: xform(e.x + (rnd() - 0.5) * 2.2, ey + 1.4 + rnd() * 0.3, e.z + (rnd() - 0.5) * 1.3) });
      const f = shore(p, A + 0.38, 6), fy = heightAt(f.x, f.z);
      for (const [a, b, col] of [[6, 4, 0xd9c79a], [-6, 5, 0xb88a5a]]) { const u = f.x + a, v = f.z + b; k.parts.push({ geo: prism(5, 4.4, 2.8), color: col, matrix: xform(u, heightAt(u, v), v, a) }); }
      for (let i = 0; i < 6; i++) k.B(0.3, 0.3, 1.8, 0x5a3f28, f.x + Math.cos(i) * 0.5, fy + 0.4, f.z + Math.sin(i) * 0.5, i * 1.05, 0.4);
      k.C(0.1, 0.12, 9, 0x6b4e33, f.x - 2, fy + 4.5, f.z - 6, 5); k.B(3, 1.9, 0.08, 0x1b1c1e, f.x - 0.4, fy + 8, f.z - 6); k.B(1.8, 0.3, 0.1, 0xf4f4ee, f.x - 0.4, fy + 8, f.z - 6, 0, 0, 0.5); k.B(1.8, 0.3, 0.1, 0xf4f4ee, f.x - 0.4, fy + 8, f.z - 6, 0, 0, -0.5); // pavillon noir à deux os croisés
      const g = shore(p, A - 0.6, -4); for (let i = 0; i < 9; i++) k.parts.push({ geo: new THREE.DodecahedronGeometry(7 + rnd() * 5, 0), color: 0x857c6e, matrix: xform(g.x + (rnd() - 0.5) * 34, rnd() * 7 - 2, g.z + (rnd() - 0.5) * 34, rnd() * 6) });
      add(k, [f.x, fy + 1, f.z], 0xff9a3a, 9);
      folk([{ x: f.x + 2.5, z: f.z, yaw: 1.5 }, { x: f.x - 2, z: f.z + 1.6, yaw: -1.2 }, ring(c.x, c.z, 9)]);
      let tm = 0; ticks.push((t, night, dt, cam) => { if (!cam || Math.hypot(cam.x - f.x, cam.z - f.z) > 4000 || (tm -= dt) > 0) return; tm = 0.5; smoke.emit(f.x, fy + 1, f.z, 1 + Math.random(), 4, Math.random() - 0.5, 0.5, 4, 7, 0xb8b4ae); });
    }
  }
  return { update(dt, t, night, cam) { for (const f of ticks) f(t, night, dt, cam); smoke.update(dt, 0.15); } };
}
