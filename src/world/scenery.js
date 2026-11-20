import * as THREE from 'three';
import { heightAt, normalAt, flatInfo, coastPoint, VOLCANO } from './terrain.js';
import { makeNoise2D, fbm } from './noise.js';
import { mulberry32, mergeColored, xform, toLocal, smoothstep } from '../util.js';
import { addCylinder, addSphere, addCustom } from './colliders.js';

/** Arche rocheuse en mer (utilisée aussi par la détection des figures). */
export const arch = { x: 0, z: 0, yaw: 0, R: 95, tube: 24, y: -14 };

const _n = new THREE.Vector3();
const _l = { x: 0, z: 0 };

/** Déforme une géométrie pour lui donner un aspect de roche (les sommets confondus restent soudés). */
function roughen(geo, amount) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 10) / 10, y = Math.round(p.getY(i) * 10) / 10, z = Math.round(p.getZ(i) * 10) / 10;
    const h = (k) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k) * 43758.5453; return (s - Math.floor(s)) - 0.5; };
    p.setXYZ(i, x + h(1) * amount, y + h(2) * amount, z + h(3) * amount);
  }
  return geo;
}

function buildTrees(scene) {
  const rnd = mulberry32(2024), nF = makeNoise2D(555);
  const conifer = mergeColored([
    { geo: new THREE.CylinderGeometry(0.35, 0.5, 2.6, 5, 1, true), color: 0x7a5a3c, matrix: xform(0, 1.3, 0) },
    { geo: new THREE.ConeGeometry(2.7, 5.2, 6, 1, true), color: 0x3c8a48, matrix: xform(0, 5, 0) },
    { geo: new THREE.ConeGeometry(1.95, 4.4, 6, 1, true), color: 0x4a9c52, matrix: xform(0, 8.2, 0, 0.5) },
  ]);
  const round = mergeColored([
    { geo: new THREE.CylinderGeometry(0.35, 0.5, 3, 5, 1, true), color: 0x7a5a3c, matrix: xform(0, 1.5, 0) },
    { geo: new THREE.IcosahedronGeometry(2.9, 0), color: 0x6fb850, matrix: xform(0, 5.2, 0, 0, 1, 0.9, 1) },
  ]);
  const a = [], b = [];
  for (let n = 0; n < 90000 && a.length + b.length < 8200; n++) {
    const x = (rnd() - 0.5) * 9800, z = (rnd() - 0.5) * 9800;
    const h = heightAt(x, z);
    if (h < 5 || h > 480) continue;
    if (normalAt(x, z, _n).y < 0.83) continue;
    if (flatInfo(x, z).w > 0.02) continue;
    if (Math.hypot(x - VOLCANO.x, z - VOLCANO.z) < 850) continue;
    const f = fbm(nF, x * 0.0015, z * 0.0015, 3);
    if (rnd() > smoothstep(-0.28, 0.3, f) * 0.92 + 0.035) continue;
    const s = 1 + rnd() * 1.1;
    (h > 150 + f * 90 || rnd() < 0.28 ? a : b).push({ x, y: h - 0.3, z, s, r: rnd() * 6 });
  }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
  for (const [geo, items] of [[conifer, a], [round, b]]) {
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    items.forEach((t, i) => {
      q.setFromEuler(e.set(0, t.r, 0));
      m4.compose(new THREE.Vector3(t.x, t.y, t.z), q, new THREE.Vector3(t.s, t.s * (0.9 + (t.r % 1) * 0.3), t.s));
      im.setMatrixAt(i, m4);
      const v = 0.8 + ((t.r * 7.3) % 1) * 0.35;
      im.setColorAt(i, col.setRGB(v, v, v * 0.95));
    });
    im.frustumCulled = false;
    scene.add(im);
  }
  return a.length + b.length;
}

function buildVillage(scene) {
  const rnd = mulberry32(77), parts = [];
  const c = coastPoint(0.75, -430);
  const walls = [0xf6efe2, 0xfbf7ef, 0xf0d9b8, 0xe9e2d4], roofs = [0xc8553a, 0xb9472f, 0xd3704a, 0x4f6f8f];
  const placed = [];
  const house = (x, z, w, h, d, ry, wall, roof) => {
    const y = heightAt(x, z) - 0.6;
    parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: wall, matrix: xform(x, y + h / 2, z, ry) });
    parts.push({ geo: new THREE.ConeGeometry(1, 1, 4), color: roof, matrix: xform(x, y + h + 1.9, z, ry + Math.PI / 4, w * 0.78, 3.8, d * 0.78) });
  };
  for (let n = 0; n < 900 && placed.length < 38; n++) {
    const ang = rnd() * 6.283, rad = Math.sqrt(rnd()) * 300;
    const x = c.x + Math.cos(ang) * rad, z = c.z + Math.sin(ang) * rad;
    if (heightAt(x, z) < 4 || normalAt(x, z, _n).y < 0.94 || flatInfo(x, z).w > 0) continue;
    if (placed.some((p) => Math.hypot(p.x - x, p.z - z) < 24)) continue;
    placed.push({ x, z });
    if (placed.length === 1) {
      // l'église
      house(x, z, 9, 9, 17, 0.3, 0xfbf7ef, 0x4f6f8f);
      const y = heightAt(x, z);
      parts.push({ geo: new THREE.BoxGeometry(5.5, 19, 5.5), color: 0xfbf7ef, matrix: xform(x + 2.8, y + 9.5, z - 9, 0.3) });
      parts.push({ geo: new THREE.ConeGeometry(4.4, 9, 4), color: 0x4f6f8f, matrix: xform(x + 2.8, y + 23.5, z - 9, 0.3 + Math.PI / 4) });
    } else {
      house(x, z, 8 + rnd() * 5, 4.5 + rnd() * 2.5, 7 + rnd() * 4, rnd() * 3.14, walls[Math.floor(rnd() * 4)], roofs[Math.floor(rnd() * 4)]);
    }
  }
  if (!parts.length) return;
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  scene.add(mesh);
}

function buildLighthouse(scene) {
  const c = coastPoint(-Math.PI / 2 + 0.25, -55);
  const y = Math.max(heightAt(c.x, c.z), 1);
  const parts = [
    { geo: new THREE.CylinderGeometry(5, 6.5, 7, 8), color: 0x9a948a, matrix: xform(0, 3.5, 0) },
    { geo: new THREE.CylinderGeometry(2.7, 3.9, 27, 8), color: 0xf7f5ef, matrix: xform(0, 20.5, 0) },
    { geo: new THREE.CylinderGeometry(3.25, 3.55, 6, 8), color: 0xc8402f, matrix: xform(0, 17, 0) },
    { geo: new THREE.CylinderGeometry(3.9, 3.9, 0.8, 8), color: 0x3a3f45, matrix: xform(0, 34.2, 0) },
    { geo: new THREE.ConeGeometry(3.4, 3.4, 8), color: 0xc8402f, matrix: xform(0, 40, 0) },
  ];
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.position.set(c.x, y, c.z);
  const lamp = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 3.8, 8), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
  lamp.position.y = 36.4;
  mesh.add(lamp);
  scene.add(mesh);
  addCylinder(c.x, c.z, 5.5, y - 2, y + 42);
  return lamp;
}

function buildRocks(scene) {
  const A = 3.52;
  const rock = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const parts = [];

  // arche : un demi-tore dont les deux pieds plongent dans la mer
  const c = coastPoint(A, 330);
  arch.x = c.x; arch.z = c.z; arch.yaw = -A;
  const torus = roughen(new THREE.TorusGeometry(arch.R, arch.tube, 6, 14, Math.PI * 1.12), 9);
  parts.push({ geo: torus, color: 0x9a8f7f, matrix: xform(arch.x, arch.y, arch.z, arch.yaw, 1, 1, 1, 0, -Math.PI * 0.06) });
  addCustom(arch.x, arch.z, arch.R + arch.tube + 5, arch.y, arch.R + arch.tube + 10, (px, py, pz) => {
    toLocal(arch, px, pz, _l);
    return Math.hypot(Math.hypot(_l.x, py - arch.y) - arch.R, _l.z) < arch.tube * 0.86;
  });

  // pitons rocheux
  const stacks = [[A - 0.085, 230, 26, 125], [A + 0.1, 420, 20, 95], [A + 0.16, 180, 30, 70], [A - 0.15, 520, 17, 110], [A + 0.05, 720, 14, 60]];
  for (const [ang, off, r, h] of stacks) {
    const s = coastPoint(ang, off);
    parts.push({ geo: roughen(new THREE.CylinderGeometry(r * 0.55, r * 1.15, h + 20, 6, 3), r * 0.3), color: 0x8f8678, matrix: xform(s.x, h / 2 - 10, s.z, ang * 9) });
    parts.push({ geo: new THREE.CylinderGeometry(r * 0.5, r * 0.56, 3, 6), color: 0x6fae52, matrix: xform(s.x, h + 0.5, s.z, ang * 9) });
    addCylinder(s.x, s.z, r * 0.95, -20, h + 3);
  }
  scene.add(new THREE.Mesh(mergeColored(parts), rock));
}

function buildBalloons(scene) {
  const spots = [[1700, 330, 1300], [-800, 400, 2300], [2700, 300, -2700], [-3400, 420, -500], [300, 560, -2900]];
  const palettes = [[0xe84c3d, 0xfff1d6], [0x2f7fdc, 0xffd34d], [0x8e5cc9, 0xfff1d6], [0x2fae7a, 0xfff1d6], [0xf08a2c, 0x2f4a7a]];
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const out = [];
  spots.forEach(([x, y, z], i) => {
    const parts = [];
    for (let k = 0; k < 8; k++) {
      parts.push({ geo: new THREE.SphereGeometry(12, 1, 6, (k * Math.PI) / 4, Math.PI / 4), color: palettes[i][k % 2], matrix: xform(0, 0, 0, 0, 1, 1.18, 1) });
    }
    parts.push({ geo: new THREE.CylinderGeometry(4.6, 1.9, 6, 8, 1, true), color: palettes[i][0], matrix: xform(0, -14.5, 0) });
    parts.push({ geo: new THREE.BoxGeometry(2.6, 2.2, 2.6), color: 0x8a5a33, matrix: xform(0, -21, 0) });
    const mesh = new THREE.Mesh(mergeColored(parts), mat);
    const by = Math.max(y, heightAt(x, z) + 170);
    mesh.position.set(x, by, z);
    scene.add(mesh);
    addSphere(x, by - 2, z, 14);
    out.push({ mesh, by, ph: i * 1.7 });
  });
  return out;
}

export function buildScenery(scene) {
  const trees = buildTrees(scene);
  buildVillage(scene);
  const lamp = buildLighthouse(scene);
  buildRocks(scene);
  const balloons = buildBalloons(scene);

  // lac de lave au fond du cratère
  const lavaY = heightAt(VOLCANO.x, VOLCANO.z) + 3;
  const lava = new THREE.Mesh(new THREE.CircleGeometry(95, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff7a1f }));
  lava.position.set(VOLCANO.x, lavaY, VOLCANO.z);
  scene.add(lava);
  const glow = new THREE.PointLight(0xff6a20, 0, 900, 1.2);
  glow.position.set(VOLCANO.x, lavaY + 60, VOLCANO.z);
  scene.add(glow);

  return {
    trees,
    update(t, night) {
      for (const b of balloons) b.mesh.position.y = b.by + Math.sin(t * 0.35 + b.ph) * 3;
      lamp.material.color.setHex(night > 0.2 && Math.sin(t * 2.2) > 0.2 ? 0xffffff : 0xfff0a0);
      lava.material.color.setRGB(1, 0.42 + 0.1 * Math.sin(t * 1.7), 0.1);
      glow.intensity = 1600 * (0.3 + night) * (0.85 + 0.15 * Math.sin(t * 1.7));
    },
  };
}
