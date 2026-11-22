import * as THREE from 'three';
import { heightAt, normalAt, BIG } from './terrain.js';
import { lightsPoints, helipadMesh } from './airfields.js';
import { circuit, castle, monastery, rig, windFarm, keepOut } from './places.js';
import { addBox, addCylinder, addCustom } from './colliders.js';
import { addDeck } from './decks.js';
import { country } from './country.js';
import { kit, prism } from './ports.js';
import { People } from './people.js';
import { Puffs } from './puffs.js';
import { mergeColored, xform, mulberry32, toWorld, toLocal, smoothstep } from '../util.js';

// Grands repères : circuit automobile (une course y tourne sans fin), château fort, monastère perché sur un piton,
// éoliennes et plateforme pétrolière (avec sa pompe et son hélisurface).

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _w = { x: 0, z: 0 }, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3();

/** Éoliennes : choisies le long d'une ligne, sur les points les plus hauts (avant les arbres). */
export function planLandmarks() {
  const [a, b, n] = BIG ? [[7700, -3700], [9900, -2500], 8] : [[2300, -2500], [3000, -1300], 5];
  const rail = country.rail ? country.rail.pts : [];
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), x0 = a[0] + (b[0] - a[0]) * t, z0 = a[1] + (b[1] - a[1]) * t;
    let best = null;
    for (let dx = -130; dx <= 130; dx += 26) for (let dz = -260; dz <= 260; dz += 26) {
      const x = x0 + dx, z = z0 + dz, h = heightAt(x, z);
      if (h < 9 || normalAt(x, z, _n).y < 0.9 || rail.some((p) => Math.abs(p.x - x) < 90 && Math.abs(p.z - z) < 90) || windFarm.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 190)) continue;
      if (!best || h > best.h) best = { x, z, h };
    }
    if (best) windFarm.spots.push(best);
  }
  if (windFarm.spots.length) { const m = windFarm.spots[Math.floor(windFarm.spots.length / 2)]; windFarm.x = m.x; windFarm.z = m.z; }
  keepOut.push((x, z) => windFarm.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 24), (x, z) => Math.hypot(monastery.x - x, monastery.z - z) < 95);
}

// --------------------------------------------------------------------------- éoliennes
function buildWind(scene, ticks, lights) {
  const K = kit(), H = 72, R = 38;
  const blade = [];
  for (let k = 0; k < 3; k++) {
    const g = new THREE.BoxGeometry(1, R, 0.5).translate(0, R / 2, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const t = p.getY(i) / R; p.setX(i, (p.getX(i) > 0 ? 2.4 : -1.4) * (1 - 0.8 * t)); p.setZ(i, p.getZ(i) * (1 - 0.75 * t)); }
    blade.push({ geo: g, color: k ? 0xf4f6f7 : 0xf4f6f7, matrix: xform(0, 0, 0, 0, 1, 1, 1, 0, (k * 2 * Math.PI) / 3) }, { geo: new THREE.BoxGeometry(0.5, 5, 0.22).translate(0.1, R - 3, 0), color: 0xd8312b, matrix: xform(0, 0, 0, 0, 1, 1, 1, 0, (k * 2 * Math.PI) / 3) });
  }
  blade.push({ geo: new THREE.SphereGeometry(1.8, 10, 7), color: 0xe2e6e9 });
  const bg = mergeColored(blade);
  windFarm.spots.forEach((s, i) => {
    const y = heightAt(s.x, s.z), yaw = 0.6 + i * 0.05;
    K.C(1.2, 2.4, H, 0xf0f2f3, s.x, y + H / 2 - 1, s.z, 12); K.C(4, 5, 1.2, 0x9aa0a6, s.x, y + 0.3, s.z, 12);
    K.parts.push({ geo: new THREE.BoxGeometry(3.2, 3.2, 9), color: 0xf0f2f3, matrix: xform(s.x, y + H, s.z, yaw) });
    K.B(0.4, 2.4, 1.2, 0x5f7f98, s.x + 2.2, y + 1.6, s.z);
    const b = new THREE.Mesh(bg, lam()); b.castShadow = true; b.rotation.order = 'YXZ';
    b.position.set(s.x - Math.sin(yaw) * 5.4, y + H, s.z - Math.cos(yaw) * 5.4); b.rotation.y = yaw; scene.add(b);
    const o = { a: i * 0.7 }, hub = { x: b.position.x, z: b.position.z, yaw };
    ticks.push((dt) => { o.a += dt * (0.95 + 0.06 * (i % 3)); b.rotation.z = o.a; });
    addCylinder(s.x, s.z, 2.2, y, y + H + 2); lights.push(s.x, y + H + 2.4, s.z);
    // les pales : on ne s'écrase que si on en touche vraiment une
    const l = { x: 0, z: 0 };
    addCustom(hub.x, hub.z, R + 2, y + H - R, y + H + R, (x, yy, z) => {
      toLocal(hub, x, z, l); if (Math.abs(l.z) > 1.4) return false;
      const dy = yy - y - H, r = Math.hypot(l.x, dy); if (r > R) return false; if (r < 2) return true;
      let d = (Math.atan2(dy, l.x) - Math.PI / 2 - o.a) % (2 * Math.PI / 3); if (d < 0) d += 2 * Math.PI / 3; d = Math.min(d, 2 * Math.PI / 3 - d);
      return d * r < 1.8;
    });
  });
  if (K.parts.length) scene.add(K.mesh());
}

// --------------------------------------------------------------------------- château fort
function buildCastle(scene, ticks) {
  const O = castle, K = kit(), ST = 0xb9ad98, SD = 0x9f9482, RF = 0x4f6f8f, WD = 0x6b4a2e, lamps = [];
  const G = new THREE.Group(); G.position.set(O.x, O.alt, O.z); G.rotation.y = O.yaw; scene.add(G);
  const collide = (x, z, hw, hd, h) => { toWorld(O, x, z, _w); addBox(_w.x, _w.z, O.yaw, hw, hd, O.alt - 3, O.alt + h); };
  const cyl = (x, z, r, h) => { toWorld(O, x, z, _w); addCylinder(_w.x, _w.z, r, O.alt - 3, O.alt + h); };
  const cren = (x, z, w, d, y) => { const n = Math.max(1, Math.round(Math.max(w, d) / 2.6)); for (let i = 0; i < n; i++) { const t = (i + 0.5) / n - 0.5; K.B(w > d ? 1.3 : d === w ? 1.3 : Math.min(w, 0.8), 1.3, w > d ? 0.8 : 1.3, SD, x + (w > d ? t * w : 0), y + 0.65, z + (w > d ? 0 : t * d)); } };
  const tower = (x, z, r, h, roof = true) => {
    K.C(r, r * 1.12, h, ST, x, h / 2 - 1, z, 12); K.C(r * 1.16, r * 1.02, 1.6, SD, x, h - 1.2, z, 12);
    for (let k = 0; k < 10; k++) K.B(1.1, 1.3, 0.8, SD, x + Math.cos(k * 0.628) * r * 1.08, h + 0.2, z + Math.sin(k * 0.628) * r * 1.08, -k * 0.628 + Math.PI / 2);
    if (roof) { K.parts.push({ geo: new THREE.ConeGeometry(r * 1.02, r * 2.2, 12), color: RF, matrix: xform(x, h + r * 1.1 - 0.4, z) }); K.C(0.07, 0.07, 3, WD, x, h + r * 2.2 + 1, z, 4); K.B(1.6, 0.9, 0.06, 0xd8312b, x + 0.8, h + r * 2.2 + 2, z); }
    for (let k = 0; k < 3; k++) K.B(0.5, 1.6, r * 2.3, 0x2b2620, x, h * (0.3 + k * 0.22), z, k * 1.3);
    cyl(x, z, r * 1.1, h + (roof ? r * 2 : 1.5));
  };
  const W = 40, D = 46, HW = 10;
  // courtines, chemin de ronde
  for (const s of [-1, 1]) {
    K.B(2.6, HW + 2, D * 2, ST, s * W, HW / 2 - 1, 0); cren(s * (W + 1), 0, 0.8, D * 2 - 8, HW); collide(s * W, 0, 1.4, D, HW + 1); K.B(1.6, 0.4, D * 2 - 6, WD, s * (W - 2), HW - 1.6, 0);
    if (s < 0) { K.B(W * 2, HW + 2, 2.6, ST, 0, HW / 2 - 1, s * D); cren(0, s * (D + 1), W * 2 - 8, 0.8, HW); collide(0, s * D, W, 1.4, HW + 1); }
    else for (const t of [-1, 1]) { K.B(W - 6, HW + 2, 2.6, ST, t * (W / 2 + 3), HW / 2 - 1, D); cren(t * (W / 2 + 3), D + 1, W - 10, 0.8, HW); collide(t * (W / 2 + 3), D, W / 2 - 3, 1.4, HW + 1); }
    for (const t of [-1, 1]) tower(s * W, t * D, 5.4, 17);
    tower(s * W, 0, 4.2, 14, false);
  }
  // châtelet et pont-levis
  for (const t of [-1, 1]) tower(t * 6.4, D, 4, 16);
  K.B(9, 6, 5, ST, 0, 10, D); cren(0, D + 2.2, 9, 0.8, 13); K.B(5, 7.4, 0.3, 0x2b2620, 0, 3.7, D - 2.6); K.B(5.4, 0.5, 13, WD, 0, 0.2, D + 9); K.B(5.2, 0.16, 18, 0xc9b07e, 0, 0.1, D + 23); for (const x of [-2.4, 2.4]) K.parts.push({ geo: new THREE.BoxGeometry(0.14, 12, 0.14), color: 0x2b2620, matrix: xform(x, 5.6, D + 8.5, 0, 1, 1, 1, 0.9) }); collide(0, D, 5, 3, 14);
  // douves
  for (const s of [-1, 1]) { K.B(7, 0.3, D * 2 + 26, 0x4f8fb0, s * (W + 9.5), 0.12, 0); K.B(W * 2 + 12, 0.3, 7, 0x4f8fb0, 0, 0.13, s * (D + 9.5)); }
  // donjon, logis, chapelle, puits
  K.B(20, 30, 20, ST, 0, 14, -18); for (const x of [-1, 1]) for (const z of [-1, 1]) { K.C(2.6, 2.8, 35, ST, x * 10, 17, -18 + z * 10, 8); K.parts.push({ geo: new THREE.ConeGeometry(3.2, 6, 8), color: RF, matrix: xform(x * 10, 37.4, -18 + z * 10) }); }
  for (const s of [-1, 1]) { cren(0, -18 + s * 10.2, 20, 0.8, 29); cren(s * 10.2, -18, 0.8, 20, 29); }
  for (let y = 6; y < 26; y += 6) for (const x of [-5, 0, 5]) { K.B(1.1, 2.4, 20.4, 0x2b2620, x, y, -18); K.B(20.4, 2.4, 1.1, 0x2b2620, 0, y, -18 + x); }
  K.C(0.1, 0.1, 8, WD, 0, 33, -18, 5); collide(0, -18, 12, 12, 36);
  K.B(16, 8, 34, 0xc9bda6, -27, 4, 8); K.parts.push({ geo: prism(36, 19, 7), color: RF, matrix: xform(-27, 8, 8, Math.PI / 2) }); for (let z = -6; z <= 22; z += 5.5) K.B(16.3, 2.2, 1.2, 0x3a4a58, -27, 4.6, z); collide(-27, 8, 8, 17, 14);
  K.B(11, 9, 20, 0xc9bda6, 27, 4.5, 14); K.parts.push({ geo: prism(22, 13, 6), color: 0x8a4a36, matrix: xform(27, 9, 14, Math.PI / 2) }); K.B(4, 15, 4, ST, 27, 7.5, 24); K.parts.push({ geo: new THREE.ConeGeometry(3.4, 7, 4), color: RF, matrix: xform(27, 18.5, 24, Math.PI / 4) }); collide(27, 14, 5.5, 12, 18);
  K.C(1.8, 2, 1.4, SD, 6, 0.7, 16, 10); K.parts.push({ geo: new THREE.ConeGeometry(2.4, 1.6, 4), color: 0x8a4a36, matrix: xform(6, 4.6, 16, Math.PI / 4) }); for (const x of [4.6, 7.4]) K.B(0.2, 3, 0.2, WD, x, 2.6, 16);
  K.B(W * 2 - 4, 0.2, D * 2 - 4, 0xb8a988, 0, 0.08, 0); K.B(6, 0.22, 60, 0xd0c3a2, 0, 0.1, 22);
  for (const [x, z] of [[-14, 30], [14, 30], [-14, 4], [14, 4]]) { K.B(0.2, 3, 0.2, WD, x, 1.5, z); lamps.push(x, 3.2, z); }
  // étals du marché
  for (let k = 0; k < 6; k++) { const x = 13 + (k % 2) * 6, z = -2 + Math.floor(k / 2) * 5 - 6; K.B(3, 1, 2, WD, x, 0.7, z); K.B(3.6, 0.2, 2.8, [0xd8312b, 0xf2c230, 0x2f5fa8][k % 3], x, 2.8, z); }
  G.add(K.mesh(), lightsPoints(lamps, 0xffb04a, 7));
  const bt = document.createElement('canvas'); bt.width = 64; bt.height = 96; const g = bt.getContext('2d'); g.fillStyle = '#b01f2e'; g.fillRect(0, 0, 64, 96); g.fillStyle = '#e8c33a'; g.fillRect(0, 0, 32, 48); g.fillRect(32, 48, 32, 48);
  const bx = new THREE.CanvasTexture(bt); bx.colorSpace = THREE.SRGBColorSpace;
  const bg = new THREE.PlaneGeometry(7, 4.4, 10, 1).translate(3.5, 0, 0), ban = new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ map: bx, side: THREE.DoubleSide })); ban.position.set(0, 34.6, -18); G.add(ban);
  let t = 0;
  ticks.push((dt) => { t += dt; const p = bg.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 1.1 - t * 5) * 0.14 * p.getX(i) / 2); p.needsUpdate = true; });
  const rnd = mulberry32(1337), list = [];
  for (let i = 0; i < 26; i++) { const x = (rnd() - 0.5) * 22, z = rnd() * 34, r = 3 + rnd() * 6; list.push({ loop: [0, 1, 2, 3].map((q) => { toWorld(O, x + Math.cos(q * 1.57) * r, z + Math.sin(q * 1.57) * r, _w); return { x: _w.x, z: _w.z }; }) }); }
  for (const [x, z] of [[-3, D + 5], [3, D + 5], [-W + 2, -20], [W - 2, 20], [0, -D + 2]]) { toWorld(O, x, z, _w); list.push({ x: _w.x, z: _w.z, yaw: O.yaw + Math.PI, up: Math.abs(x) > 10 || z < 0 ? HW - 1.6 : 0 }); }
  const folk = new People(scene, list, () => O.alt + 0.2, 8); let tt = 0;
  return (dt, cam) => { tt += dt; folk.update(dt, tt, cam); };
}

// --------------------------------------------------------------------------- monastère perché
function roughen(geo, amount) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = Math.round(p.getX(i) * 10) / 10, y = Math.round(p.getY(i) * 10) / 10, z = Math.round(p.getZ(i) * 10) / 10;
    const h = (k) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + k) * 43758.5453; return s - Math.floor(s) - 0.5; };
    p.setXYZ(i, x + h(1) * amount, y + h(2) * amount * 0.4, z + h(3) * amount);
  }
  return geo;
}
function buildMonastery(scene, ticks) {
  const O = monastery, K = kit(), RK = 0x9a9084, RD = 0x877d72, WA = 0xe9dfc8, TL = 0xb9553a, WD = 0x6b4a2e, lights = [];
  let base = Infinity; for (let a = 0; a < 6.28; a += 0.5) base = Math.min(base, heightAt(O.x + Math.cos(a) * 45, O.z + Math.sin(a) * 45));
  const H = 118, Y = base + H; // plateau du piton
  O.y = Y;
  const pillar = (x, z, r, h, col, top = true) => {
    const b = heightAt(O.x + x, O.z + z) - 8;
    K.parts.push({ geo: roughen(new THREE.CylinderGeometry(r * 0.86, r * 1.35, h + 8, 11, 7), r * 0.28), color: col, matrix: xform(O.x + x, b + (h + 8) / 2, O.z + z, x) });
    if (top) K.parts.push({ geo: new THREE.CylinderGeometry(r * 0.84, r * 0.9, 3, 11), color: 0x79a858, matrix: xform(O.x + x, b + h + 8, O.z + z, x) });
    addCylinder(O.x + x, O.z + z, r * 1.02, b, b + h + 9.5);
  };
  // le piton du monastère, et ses voisins
  K.parts.push({ geo: roughen(new THREE.CylinderGeometry(34, 46, H + 12, 14, 8), 8), color: RK, matrix: xform(O.x, base - 12 + (H + 12) / 2, O.z) });
  K.parts.push({ geo: new THREE.CylinderGeometry(32, 33.5, 4, 14), color: 0x8aa860, matrix: xform(O.x, Y - 1, O.z) });
  addCylinder(O.x, O.z, 37, base - 12, Y);
  pillar(70, 30, 15, 84, RD); pillar(-62, 48, 19, 62, RK); pillar(-40, -70, 13, 100, RD); pillar(52, -64, 11, 48, RK);
  // monastère : église à coupole, cloître, cellules accrochées au vide, clocher
  const B = (w, h, d, c, x, y, z, ry = 0) => K.B(w, h, d, c, O.x + x, Y + y, O.z + z, ry);
  const roof = (l, w, h, x, y, z, ry) => K.parts.push({ geo: prism(l, w, h), color: TL, matrix: xform(O.x + x, Y + y, O.z + z, ry) });
  B(52, 1.4, 46, 0xc9bda6, 0, 0.8, 0);
  B(14, 11, 20, WA, 0, 6.5, -4); roof(21, 16, 4.6, 0, 12, -4, Math.PI / 2); K.C(4.6, 4.6, 5, WA, O.x, Y + 15.5, O.z - 6, 12); K.parts.push({ geo: new THREE.SphereGeometry(5, 12, 6, 0, 6.2832, 0, Math.PI / 2), color: TL, matrix: xform(O.x, Y + 18, O.z - 6) }); B(0.3, 2.6, 0.3, 0xd9a92b, 0, 24, -6); B(1.4, 0.3, 0.3, 0xd9a92b, 0, 24.4, -6);
  B(5, 21, 5, WA, 10, 11, 8); K.parts.push({ geo: new THREE.ConeGeometry(4.2, 6, 4), color: TL, matrix: xform(O.x + 10, Y + 24.5, O.z + 8, Math.PI / 4) }); for (const s of [-1, 1]) { B(1.8, 3, 5.2, 0x2b2620, 10, 18, 8); B(5.2, 3, 1.8, 0x2b2620, 10, 18, 8); }
  for (const s of [-1, 1]) {
    B(8, 8, 38, WA, s * 22, 5, 0); roof(40, 10, 3.4, s * 22, 9, 0, Math.PI / 2); for (let z = -16; z <= 16; z += 4) B(8.3, 1.4, 0.9, 0x3a4a58, s * 22, 6.4, z);
    B(2.6, 2.4, 30, WD, s * 27, 4, 0); for (let z = -13; z <= 13; z += 4.3) K.parts.push({ geo: new THREE.BoxGeometry(0.3, 4.5, 0.3), color: WD, matrix: xform(O.x + s * 26.6, Y + 1.4, O.z + z, 0, 1, 1, 1, 0, s * 0.6) });
    B(36, 7, 7, WA, 0, 4.5, s * 20); roof(38, 9, 3, 0, 8, s * 20, 0);
  }
  for (let k = 0; k < 6; k++) { K.C(0.3, 0.3, 3.4, 0xd9cfb8, O.x - 13 + k * 1.2, Y + 3, O.z + 13, 6); }
  for (const [x, z] of [[-11, 8], [-13, -10], [13, -12], [-9, 13]]) { K.parts.push({ geo: new THREE.ConeGeometry(1.4, 8, 6), color: 0x2f6b3a, matrix: xform(O.x + x, Y + 5.4, O.z + z) }); }
  K.C(2, 2.2, 1.2, 0xc9bda6, O.x - 11, Y + 2, O.z + 2, 10);
  addBox(O.x, O.z, 0, 27, 24, Y, Y + 13); addCylinder(O.x, O.z - 6, 6, Y, Y + 25); addCylinder(O.x + 10, O.z + 8, 3.6, Y, Y + 27);
  lights.push(O.x + 10, Y + 18, O.z + 8, O.x - 22, Y + 5, O.z + 20.5, O.x + 22, Y + 5, O.z + 20.5, O.x, Y + 8, O.z + 7);
  // escalier taillé en spirale, et le panier qu'on hisse
  for (let k = 0; k < 120; k++) { const a = 0.4 + k * 0.075, h = (k / 120) * (H - 2), r = 46 - 12 * (h / H) + 1; K.B(3.2, 0.8, 1.9, 0xc9bda6, O.x + Math.cos(a) * r, base + h, O.z + Math.sin(a) * r, -a); }
  B(1, 1, 9, WD, 0, 9.2, 27); B(3, 3, 3, WD, 0, 8, 24.5);
  scene.add(K.mesh(), lightsPoints(lights, 0xffc878, 7));
  const basket = new THREE.Mesh(mergeColored([{ geo: new THREE.CylinderGeometry(0.9, 0.7, 1.4, 8), color: 0x9a6a3a, matrix: xform(0, 0.7, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.9, 0.4), color: 0x2b2620, matrix: xform(0, 1.6, 0) }, { geo: new THREE.BoxGeometry(0.3, 0.3, 0.3), color: 0xd9a583, matrix: xform(0, 2.2, 0) }]), lam());
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1, 4).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x4a3a2a })); scene.add(basket, rope);
  const rx = O.x, rz = O.z + 52, g0 = heightAt(rx, rz) + 0.4; B(1, 1, 26, WD, 0, 9.4, 40); let t = 0;
  ticks.push((dt) => { t += dt; const u = (t % 90) / 90, f = u < 0.4 ? u / 0.4 : u < 0.5 ? 1 : u < 0.9 ? 1 - (u - 0.5) / 0.4 : 0, y = g0 + f * (Y + 4 - g0); basket.position.set(rx, y, rz); rope.position.set(rx, y + 1.4, rz); rope.scale.y = Math.max(0.1, Y + 9 - y - 1.4); });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 30), new THREE.MeshLambertMaterial({ color: WD })); beam.position.set(rx, Y + 9.2, O.z + 39); scene.add(beam);
}

// --------------------------------------------------------------------------- circuit
const TRACK = [[-150, 175], [-150, 60], [-150, -70], [-148, -180], [-120, -258], [-52, -284], [18, -262], [38, -205], [4, -150], [-50, -105], [-58, -45], [-12, 5], [60, 2], [112, -48], [156, -40], [168, 25], [140, 92], [84, 118], [60, 165], [96, 214], [92, 268], [30, 284], [-40, 252], [-104, 262], [-142, 232]];
function buildCircuit(scene, ticks) {
  const O = circuit, K = kit(), rnd = mulberry32(1955), lamps = [];
  const G = new THREE.Group(); G.position.set(O.x, O.alt, O.z); G.rotation.y = O.yaw; scene.add(G);
  const collide = (x, z, hw, hd, h, ry = 0) => { toWorld(O, x, z, _w); addBox(_w.x, _w.z, O.yaw + ry, hw, hd, O.alt - 1, O.alt + h); };
  const N = 480, curve = new THREE.CatmullRomCurve3(TRACK.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal');
  curve.arcLengthDivisions = 1200;
  const P = curve.getSpacedPoints(N).slice(0, N), LEN = curve.getLength(), ds = LEN / N, T = P.map((_, i) => { const a = P[(i - 1 + N) % N], b = P[(i + 1) % N], l = Math.hypot(b.x - a.x, b.z - a.z); return { x: (b.x - a.x) / l, z: (b.z - a.z) / l }; });
  const curv = T.map((_, i) => { const a = T[(i - 2 + N) % N], b = T[(i + 2) % N]; return (a.x * b.z - a.z * b.x) / (4 * ds); });
  // --- piste, bas-côtés, vibreurs
  const strip = (o0, o1, y, colorOf) => { const g = []; for (let i = 0; i < N; i++) { const c = colorOf(i); if (c === null) continue; const j = (i + 1) % N, A = P[i], E = P[j], s = T[i], t = T[j], q = (p, d, o) => [p.x - d.z * o, y, p.z + d.x * o], a = q(A, s, o0), b = q(A, s, o1), e = q(E, t, o0), f = q(E, t, o1); const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...e, ...b, ...f, ...e], 3)); K.parts.push({ geo, color: c }); } return g; };
  strip(-9.5, 9.5, 0.1, () => 0xc7b98e); strip(-6.5, 6.5, 0.16, () => 0x3f4247); strip(-6.4, -6, 0.2, () => 0xf4f4ee); strip(6, 6.4, 0.2, () => 0xf4f4ee);
  for (const s of [-1, 1]) strip(s * 6.5, s * 8.3, 0.22, (i) => (Math.abs(curv[i]) > 0.009 ? (i % 2 ? 0xd8312b : 0xf4f4ee) : null));
  // ligne d'arrivée en damier, portique
  for (let i = 0; i < 12; i++) for (let j = 0; j < 3; j++) K.B(1.08, 0.04, 0.9, (i + j) % 2 ? 0xf4f4ee : 0x1b1c1e, -150 - 5.9 + i * 1.08, 0.24, 60 + j * 0.9);
  for (const s of [-1, 1]) K.B(0.7, 9, 0.7, 0x8d959c, -150 + s * 9, 4.5, 55); K.B(19, 2, 1, 0x1f5fa8, -150, 8.6, 55); for (let i = 0; i < 5; i++) K.B(0.8, 0.8, 0.3, 0xd8312b, -154 + i * 2, 8.6, 55.7); collide(-150, 55, 10, 0.6, 9.6);
  // grille de départ
  for (let k = 0; k < 10; k++) K.B(2.4, 0.04, 0.3, 0xf4f4ee, -150 + (k % 2 ? 2.8 : -2.8), 0.23, 70 + k * 7);
  // --- tribunes, stands, tour, panneaux
  const seats = [];
  const stand = (x, z, w, rows, ry) => {
    const c = Math.cos(ry), s = Math.sin(ry), pt = (a, b) => [x + a * c + b * s, z - a * s + b * c];
    for (let r = 0; r < rows; r++) { const [px, pz] = pt(0, r * 1.5); K.B(w, 0.8 + r * 0.75, 1.5, r % 2 ? 0xc3c8cc : 0xb4babf, px, (0.8 + r * 0.75) / 2, pz, ry); for (let a = -w / 2 + 0.7; a < w / 2; a += 1.15) if (rnd() < 0.72) { const [sx, sz] = pt(a, r * 1.5); toWorld(O, sx, sz, _w); seats.push({ x: _w.x, z: _w.z, yaw: O.yaw + ry, up: 0.8 + r * 0.75 }); } }
    const [bx, bz] = pt(0, rows * 1.5 - 0.6); K.B(w + 1, rows * 0.75 + 6, 0.4, 0x8d959c, bx, (rows * 0.75 + 6) / 2, bz, ry); const [rx, rz] = pt(0, rows * 0.7); K.B(w + 2, 0.4, rows * 1.7, 0xd8312b, rx, rows * 0.75 + 6, rz, ry); collide(...pt(0, rows * 0.75), w / 2, rows * 0.8, rows * 0.75 + 6.4, ry);
  };
  stand(-166, 60, 110, 9, -Math.PI / 2); stand(-166, -60, 80, 8, -Math.PI / 2); stand(-58, -298, 60, 6, Math.PI); stand(184, 20, 60, 6, Math.PI / 2); stand(20, 24, 50, 6, 0);
  K.B(10, 5, 110, 0xf2f2ee, -120, 2.5, 60); K.B(10.6, 0.6, 112, 0x1f5fa8, -120, 5.3, 60); for (let z = 10; z < 112; z += 8.5) K.B(0.3, 3.6, 6, [0xd8312b, 0xf2c230, 0x2f5fa8, 0x2f8a5a][Math.round(z / 8.5) % 4], -125.1, 1.9, z + 2); collide(-120, 60, 5.2, 55, 6); K.B(9, 0.1, 130, 0x55585d, -132, 0.14, 60);
  K.B(7, 16, 7, 0xf2f2ee, -116, 8, 130); K.B(9, 3.4, 9, 0x2f4f66, -116, 17.6, 130); K.B(10, 0.6, 10, 0xd8312b, -116, 19.6, 130); collide(-116, 130, 4.5, 4.5, 20);
  for (let i = 0; i < N; i += 9) { const k = curv[i]; if (Math.abs(k) < 0.008) continue; const s = k > 0 ? 1 : -1, p = P[i], d = T[i]; for (let q = 0; q < 3; q++) { const o = s * -(13.5 + q * 0.2); K.parts.push({ geo: new THREE.BoxGeometry(0.9, 1.3, 2.4), color: (i / 9 + q) % 2 ? 0xd8312b : 0xf4f4ee, matrix: xform(p.x - d.z * o + d.x * (q - 1) * 2.5, 0.7, p.z + d.x * o + d.z * (q - 1) * 2.5, Math.atan2(-d.x, -d.z)) }); } }
  for (const [x, z, ry, c] of [[-168, -150, Math.PI / 2, 0xf2c230], [60, -180, 0.6, 0x2f5fa8], [150, -90, 1.2, 0x2f8a5a], [20, 220, 0, 0xd8312b], [120, 160, -0.7, 0xf08a2c]]) { K.B(12, 2.6, 0.4, c, x, 2.2, z, ry); K.B(9, 0.7, 0.5, 0xf4f4ee, x, 2.2, z, ry); }
  for (const [x, z] of [[-175, 130], [-175, -120], [-100, 0], [60, -120], [120, 40], [20, 180], [-30, -220]]) { K.C(0.3, 0.5, 20, 0x8d959c, x, 10, z, 6); K.B(4, 1, 1, 0x3a3f45, x, 20, z); lamps.push(x, 20, z); toWorld(O, x, z, _w); addCylinder(_w.x, _w.z, 0.6, O.alt, O.alt + 21); }
  // étang et arbustes dans l'infield, parc de stationnement
  K.C(26, 26, 0.1, 0x4f9fd0, 70, 0.16, -110, 18); for (let k = 0; k < 40; k++) { const x = (rnd() - 0.5) * 340, z = (rnd() - 0.5) * 580; if (P.some((p) => Math.hypot(p.x - x, p.z - z) < 22) || Math.abs(x + 118) < 22) continue; K.parts.push({ geo: new THREE.IcosahedronGeometry(2 + rnd() * 1.6, 0), color: 0x6fb850, matrix: xform(x, 2, z) }); }
  for (let r = 0; r < 3; r++) for (let i = 0; i < 14; i++) if (rnd() < 0.8) { const x = 40 + i * 4, z = 60 + r * 11 - 30; if (P.some((p) => Math.hypot(p.x - x, p.z - z) < 14)) continue; K.B(1.8, 0.8, 4.2, [0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0x9aa3ab, 0xf2c230][Math.floor(rnd() * 6)], x, 0.8, z); K.B(1.6, 0.6, 2.2, 0x2f4f66, x, 1.45, z + 0.2); }
  const mesh = K.mesh(); mesh.material.polygonOffset = true; mesh.material.polygonOffsetFactor = -2; mesh.material.polygonOffsetUnits = -4;
  G.add(mesh, lightsPoints(lamps, 0xfff4d8, 5));
  const crowd = new People(scene, seats, () => O.alt, 21); let tt = 0;
  // --- course : vitesse limitée par les virages, freinages anticipés
  const V = curv.map((k) => Math.min(66, Math.sqrt(15 / Math.max(0.0006, Math.abs(k)))));
  for (let r = 0; r < 2; r++) for (let i = 2 * N - 1; i >= 0; i--) { const a = i % N, b = (i + 1) % N; V[a] = Math.min(V[a], Math.sqrt(V[b] ** 2 + 2 * 14 * ds)); }
  const car = (c, c2) => mergeColored([{ geo: new THREE.BoxGeometry(1.1, 0.5, 4.6), color: c, matrix: xform(0, 0.5, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.35, 1.6), color: c, matrix: xform(0, 0.4, -2.6) }, { geo: new THREE.BoxGeometry(2, 0.12, 0.6), color: c2, matrix: xform(0, 0.3, -3.2) }, { geo: new THREE.BoxGeometry(1.8, 0.12, 0.5), color: c2, matrix: xform(0, 1.15, 2.3) }, { geo: new THREE.BoxGeometry(0.12, 0.7, 0.4), color: c2, matrix: xform(0.8, 0.85, 2.3) }, { geo: new THREE.BoxGeometry(0.12, 0.7, 0.4), color: c2, matrix: xform(-0.8, 0.85, 2.3) }, { geo: new THREE.SphereGeometry(0.26, 8, 6), color: 0xf4f4ee, matrix: xform(0, 0.95, 0.1) }, ...[[-0.95, -1.7], [0.95, -1.7], [-0.95, 1.6], [0.95, 1.6]].map(([x, z]) => ({ geo: new THREE.CylinderGeometry(0.4, 0.4, 0.5, 10).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(x, 0.4, z) }))]);
  const COL = [[0xd8312b, 0xf4f4ee], [0x2f5fa8, 0xf2c230], [0xf2c230, 0x1b1c1e], [0x2f8a5a, 0xf4f4ee], [0xf4f4ee, 0xd8312b], [0xf08a2c, 0x2f5fa8], [0x8e5cc9, 0xf4f4ee], [0x1b1c1e, 0xd9a92b], [0x2ec4b6, 0x1b1c1e], [0xe0457b, 0xf4f4ee]];
  const cars = COL.map(([a, b], k) => { const m = new THREE.Mesh(car(a, b), lam()); m.castShadow = true; G.add(m); return { m, s: LEN - 40 - k * 9, v: 0, skill: 0.95 + rnd() * 0.08, mood: rnd() * 6, lat: k % 2 ? 2.4 : -2.4, want: 0 }; });
  const st = { t: 0 };
  ticks.push((dt) => {
    st.t += dt;
    for (const c of cars) {
      const i = Math.floor(c.s / ds) % N, lim = V[i] * c.skill * (1 + 0.035 * Math.sin(st.t * 0.21 + c.mood));
      let room = Infinity, ahead = null;
      for (const o of cars) if (o !== c) { const g = ((o.s - c.s) % LEN + LEN) % LEN; if (g < room) { room = g; ahead = o; } }
      // derrière une voiture plus lente : on déboîte, et on attend si la place manque
      const line = Math.max(-3.6, Math.min(3.6, curv[i] * 260));
      c.want = room < 16 ? (ahead.lat > 0 ? -3.4 : 3.4) : line;
      c.lat += Math.max(-4 * dt, Math.min(4 * dt, c.want - c.lat));
      const stuck = room < 7.5 && Math.abs(ahead.lat - c.lat) < 2.4, vmax = stuck ? Math.min(lim, ahead.v * 0.97) : lim;
      c.v += Math.max(-18 * dt, Math.min(9 * dt, vmax - c.v)); c.s = (c.s + c.v * dt) % LEN;
      const u = c.s / ds, a = Math.floor(u) % N, b = (a + 1) % N, f = u - Math.floor(u), tx = T[a].x + (T[b].x - T[a].x) * f, tz = T[a].z + (T[b].z - T[a].z) * f;
      c.m.position.set(P[a].x + (P[b].x - P[a].x) * f - tz * c.lat, 0.2, P[a].z + (P[b].z - P[a].z) * f + tx * c.lat); c.m.rotation.y = Math.atan2(-tx, -tz);
    }
  });
  return (dt, cam) => { tt += dt; crowd.update(dt, tt, cam); };
}

// --------------------------------------------------------------------------- plateforme pétrolière
function buildRig(scene, ticks, lights) {
  const O = rig, K = kit(), YE = 0xf2c230, ST = 0x8d959c, DK = 0x4a5158, WH = 0xeceff1, OR = 0xd96a2b, red = [];
  const G = new THREE.Group(); G.position.set(O.x, 0, O.z); G.rotation.y = O.yaw; scene.add(G);
  const collide = (x, z, hw, hd, y0, y1) => { toWorld(O, x, z, _w); addBox(_w.x, _w.z, O.yaw, hw, hd, y0, y1); };
  const bar = (a, b, r, c) => { const A = new THREE.Vector3(...a), E = new THREE.Vector3(...b), m = new THREE.Matrix4().compose(A.clone().add(E).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(UP, E.clone().sub(A).normalize()), _s.set(1, 1, 1)); K.parts.push({ geo: new THREE.CylinderGeometry(r, r, A.distanceTo(E), 6), color: c, matrix: m.clone() }); };
  // jambes, entretoises, flotteurs
  for (const x of [-26, 26]) for (const z of [-24, 24]) { K.C(3.2, 3.6, 34, YE, x, 8, z, 14); K.C(3.8, 3.8, 2, 0xd8312b, x, 2, z, 14); toWorld(O, x, z, _w); addCylinder(_w.x, _w.z, 4, -10, 24); }
  for (const s of [-1, 1]) { bar([s * 26, 4, -24], [s * 26, 20, 24], 0.9, YE); bar([s * 26, 20, -24], [s * 26, 4, 24], 0.9, YE); bar([-26, 4, s * 24], [26, 20, s * 24], 0.9, YE); bar([-26, 20, s * 24], [26, 4, s * 24], 0.9, YE); }
  bar([0, -8, 0], [0, 24, 0], 1.2, ST);
  // ponts
  K.B(66, 2.4, 60, DK, 0, 25, 0); K.B(70, 0.6, 64, YE, 0, 23.6, 0); K.B(66, 1.2, 60, 0x6b737a, 0, 32.6, 0); collide(0, 0, 33, 30, 22, 33.4);
  for (const x of [-32, 32]) for (let z = -28; z <= 28; z += 8) K.B(0.6, 6.4, 0.6, ST, x, 29.4, z);
  for (const s of [-1, 1]) { K.B(0.12, 0.12, 60, WH, s * 33, 34.4, 0); K.B(66, 0.12, 0.12, WH, 0, 34.4, s * 30); }
  // modules, tuyauteries, réservoirs, conteneurs
  for (let k = 0; k < 5; k++) { K.B(9, 5, 11, [0xb9bfc5, 0x2f6fb5, 0xc8402f, 0xb9bfc5, 0x2f8a5a][k], -24 + k * 11, 29, -20); }
  for (let k = 0; k < 6; k++) K.C(2.4, 2.4, 7, WH, -20 + k * 6, 36.6, 22, 12);
  for (let k = 0; k < 8; k++) bar([-30, 34.4 + (k % 3) * 0.9, -8 + k * 1.3], [14, 34.4 + (k % 3) * 0.9, -8 + k * 1.3], 0.35, [0xc8402f, ST, YE][k % 3]);
  for (let k = 0; k < 6; k++) K.B(2.5, 2.6, 6, [0xc8402f, 0x2f6fb5, YE, 0x2f8a5a, OR, WH][k], -28 + (k % 3) * 3, 34.6 + Math.floor(k / 3) * 2.6, -22);
  // derrick
  const D0 = 33, DH = 46; for (const x of [-1, 1]) for (const z of [-1, 1]) bar([x * 7, D0, z * 7], [x * 1.6, D0 + DH, z * 1.6], 0.45, 0xd8312b);
  for (let k = 0; k < 8; k++) { const t = k / 8, t2 = (k + 1) / 8, r = 7 - 5.4 * t, r2 = 7 - 5.4 * t2, y = D0 + DH * t, y2 = D0 + DH * t2; for (const [a, b] of [[[-1, -1], [1, -1]], [[1, -1], [1, 1]], [[1, 1], [-1, 1]], [[-1, 1], [-1, -1]]]) { bar([a[0] * r, y, a[1] * r], [b[0] * r2, y2, b[1] * r2], 0.2, k % 2 ? WH : 0xd8312b); bar([a[0] * r2, y2, a[1] * r2], [b[0] * r2, y2, b[1] * r2], 0.22, WH); } }
  K.B(5, 3, 5, DK, 0, D0 + DH + 1, 0); red.push(0, D0 + DH + 4, 0); bar([0, 34, 0], [0, D0 + DH, 0], 0.3, ST); collide(0, 0, 6, 6, 33, D0 + DH * 0.45); collide(0, 0, 2.6, 2.6, 33, D0 + DH + 3);
  // quartier d'habitation, passerelle, canots de sauvetage
  K.B(16, 14, 34, WH, 25, 40, 6); for (let y = 35.5; y < 46; y += 3.4) { K.B(16.3, 1.2, 32, 0x2f4f66, 25, y + 0.6, 6); K.B(14, 1.2, 34.3, 0x2f4f66, 25, y + 0.6, 6); } collide(25, 6, 8, 17, 33, 47);
  for (const z of [-4, 6, 16]) { K.parts.push({ geo: new THREE.CylinderGeometry(1.5, 1.5, 6, 10).rotateX(Math.PI / 2), color: OR, matrix: xform(36, 35, z) }); K.B(1.6, 0.4, 7, ST, 35, 37.2, z); }
  // grue
  K.C(1.6, 2, 12, YE, -26, 39, 20, 10); K.B(5, 4, 5, YE, -26, 46, 20); bar([-26, 47, 20], [-50, 64, 34], 0.7, YE); bar([-50, 64, 34], [-50, 36, 34], 0.12, 0x1b1c1e); K.B(1.2, 1.2, 1.2, DK, -50, 35.6, 34); collide(-26, 20, 2.6, 2.6, 33, 49);
  // torchère
  bar([-20, 33, -28], [-46, 58, -62], 0.9, ST); bar([-24, 33, -26], [-46, 58, -62], 0.5, ST); bar([-16, 33, -28], [-46, 58, -62], 0.5, ST); K.C(0.9, 0.7, 3, DK, -46, 59.5, -62, 8);
  // hélisurface au-dessus des logements, et pompe
  const HY = 49.6; K.C(15, 13, 1.2, 0x6b737a, 24, HY - 0.8, 8, 8); for (let k = 0; k < 8; k++) bar([24 + Math.cos(k * 0.785) * 12, 44, 8 + Math.sin(k * 0.785) * 9], [24 + Math.cos(k * 0.785) * 13, HY - 1, 8 + Math.sin(k * 0.785) * 13], 0.25, ST);
  K.B(1.4, 1.8, 1, 0xd8402f, 24, HY + 0.6, 22.4); G.add(helipadMesh(24, HY - 0.1, 8, 12.4));
  toWorld(O, 24, 8, _w); addDeck({ x: _w.x, z: _w.z, yaw: O.yaw, y: HY, hw: 13, hl: 13, kind: 'deck', name: O.name, fuel: { lx: 0, lz: 0, half: 13 } });
  // bateau ravitailleur amarré
  K.B(9, 4, 30, 0x2f5fa8, 44, 1.2, -6); K.B(9, 2.4, 5, 0x2f5fa8, 44, 2, -22); K.B(7.4, 4, 8, WH, 44, 5, -14); K.B(7.6, 1.3, 8.2, 0x2f4f66, 44, 5.8, -14); K.C(0.2, 0.2, 5, WH, 44, 9, -14, 5); for (let k = 0; k < 4; k++) K.B(2.4, 2, 4, [OR, YE, 0xc8402f, WH][k], 42 + (k % 2) * 3.6, 4.2, -2 + Math.floor(k / 2) * 5); collide(44, -6, 4.6, 16, -2, 7);
  G.add(K.mesh(), lightsPoints(red, 0xff3020, 8));
  for (const [x, y, z] of [[-32, 34, -29], [32, 34, -29], [-32, 34, 29], [32, 34, 29], [0, 34, 29], [24, 47, 24], [12, 41, -6]]) { toWorld(O, x, z, _w); lights.push(_w.x, y, _w.z); }
  // flamme de la torchère
  const flame = new THREE.Mesh(new THREE.ConeGeometry(2, 9, 7).translate(0, 4.5, 0), new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: 0.85, depthWrite: false })); flame.position.set(-46, 61, -62); G.add(flame);
  const glow = new THREE.PointLight(0xff8a2a, 300, 160, 1.3); glow.position.set(-46, 66, -62); G.add(glow);
  const smoke = new Puffs(scene, 40, { opacity: 0.35 }); let t = 0;
  toWorld(O, -46, -62, _w); const fx = _w.x, fz = _w.z;
  ticks.push((dt) => { t += dt; flame.scale.set(1 + 0.2 * Math.sin(t * 17), 1 + 0.25 * Math.sin(t * 11) + 0.1 * Math.sin(t * 29), 1 + 0.2 * Math.cos(t * 13)); flame.rotation.z = 0.2 + 0.1 * Math.sin(t * 2.3); glow.intensity = 260 + 80 * Math.sin(t * 13); if (Math.random() < dt * 3) smoke.emit(fx, 71, fz, 2.5, 3, 1, 1.4, 6, 6, 0x3a3a3a); smoke.update(dt); });
}

export function buildLandmarks(scene) {
  const far = [], rigT = [], windT = [], casT = [], monT = [], cirT = [], lights = [], red = [];
  buildWind(scene, windT, red);
  const cas = buildCastle(scene, casT); buildMonastery(scene, monT); const cir = buildCircuit(scene, cirT); buildRig(scene, rigT, lights);
  casT.push(cas); cirT.push(cir);
  scene.add(lightsPoints(lights, 0xfff0c8, 8), lightsPoints(red, 0xff3020, 8));
  far.push([rig, rigT, 5000], [castle, casT, 3500], [monastery, monT, 3500], [circuit, cirT, 3500]);
  if (windFarm.spots.length) far.push([windFarm, windT, 8000]);
  return { update(dt, cam) { for (const [o, list, d] of far) if (!cam || Math.hypot(cam.x - o.x, cam.z - o.z) < d) for (const f of list) f(dt, cam); } };
}
