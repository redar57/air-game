import * as THREE from 'three';
import { city } from './places.js';
import { lightsPoints } from './airfields.js';
import { addBox, addCylinder } from './colliders.js';
import { mergeColored, xform, mulberry32 } from '../util.js';
import { People } from './people.js';
import { prism } from './ports.js';

// La Grande Ville : rues en damier, gratte-ciel au centre, immeubles puis maisons autour, parc, cathédrale, stade et
// fête foraine (grande roue, montagnes russes, manège). Repère local : origine au centre, sol à y = 0.

const PITCH = 95, NX = 9, NZ = 10, STREET = 15, BLOCK = PITCH - STREET;
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);

/** Façade : 8 × 8 fenêtres (le mur blanc prend la couleur de l'immeuble) ; et les fenêtres éclairées la nuit. */
function facade() {
  const mk = () => { const cv = document.createElement('canvas'); cv.width = cv.height = 256; return [cv, cv.getContext('2d')]; };
  const [a, g] = mk(), [b, e] = mk(), rnd = mulberry32(8);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 256, 256);
  e.fillStyle = '#000'; e.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
    const x = i * 32 + 6, y = j * 32 + 8;
    g.fillStyle = ['#39566e', '#45657f', '#2f4a60'][Math.floor(rnd() * 3)]; g.fillRect(x, y, 20, 18);
    g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(x, y, 8, 18);
    g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(i * 32, j * 32 + 29, 32, 2);
    if (rnd() < 0.42) { e.fillStyle = ['#ffd890', '#ffe9b8', '#ffc870', '#dfeaff'][Math.floor(rnd() * 4)]; e.fillRect(x, y, 20, 18); }
  }
  return [a, b].map((cv) => { const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; });
}
function streetTexture() {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64;
  const g = cv.getContext('2d');
  g.fillStyle = '#4f5257'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#e9e7df'; g.fillRect(31, 8, 2, 30); g.fillRect(1, 0, 1, 64); g.fillRect(62, 0, 1, 64);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function buildCity(scene) {
  if (!city.active) return null;
  const G = new THREE.Group(), rnd = mulberry32(2718), Y = city.alt;
  G.position.set(city.x, Y, city.z);
  scene.add(G);
  const X = (i) => -((NX * PITCH) / 2) + i * PITCH, Z = (j) => -((NZ * PITCH) / 2) + j * PITCH; // axes des rues
  const parts = [], red = [], lamps = [], trees = [];
  const B = (w, h, d, c, x, y, z, ry = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color: c, matrix: xform(x, y, z, ry) });
  const C = (rt, rb, h, c, x, y, z, seg = 10) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color: c, matrix: xform(x, y, z) });
  const collide = (x, z, hw, hd, h) => addBox(city.x + x, city.z + z, 0, hw, hd, Y - 2, Y + h);

  // --- rues
  const tex = streetTexture();
  const road = (x, z, w, l, ry) => {
    const t = tex.clone(); t.repeat.set(1, l / 16); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l).rotateX(-Math.PI / 2).rotateY(ry), new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -3 - ry, polygonOffsetUnits: -6 }));
    m.position.set(x, 0.14 + ry * 0.02, z); m.receiveShadow = true; G.add(m);
  };
  // grandes parcelles [case, case, largeur, profondeur] : les rues s'arrêtent à leur bord
  const LOTS = [[7, 0, 2, 2], [0, 7, 2, 3], [4, 6, 2, 2]];
  const inLot = (i, j, alongZ) => LOTS.some(([a, b, w, d]) => (alongZ ? i > a && i < a + w && j >= b && j < b + d : i >= a && i < a + w && j > b && j < b + d));
  const runs = (n, skip, fn) => { for (let k = 0; k < n; k++) { if (skip(k)) continue; const k0 = k; while (k < n && !skip(k)) k++; fn(k0, k); } };
  for (let i = 0; i <= NX; i++) runs(NZ, (j) => inLot(i, j, true), (a, b) => road(X(i), (Z(a) + Z(b)) / 2, STREET - 3, (b - a) * PITCH + STREET - 3, 0));
  for (let j = 0; j <= NZ; j++) runs(NX, (i) => inLot(i, j, false), (a, b) => road((X(a) + X(b)) / 2, Z(j), STREET - 3, (b - a) * PITCH + STREET - 3, Math.PI / 2));

  // --- immeubles texturés
  const pos = [], uv = [], nor = [], col = [];
  const face = (v, n, w, h, c, flat) => {
    const U = flat ? 0.002 : Math.max(1, Math.round(w / 3.6)) / 8, V = flat ? 0.002 : Math.max(1, Math.round(h / 3.4)) / 8;
    const q = [[0, 0], [U, 0], [U, V], [0, 0], [U, V], [0, V]], idx = [0, 1, 2, 0, 2, 3];
    idx.forEach((k, i) => { pos.push(...v[k]); nor.push(...n); uv.push(...q[i]); col.push(c.r, c.g, c.b); });
  };
  const block = (x, z, w, d, y0, h, color, roof = 0x8f9499) => {
    const c = _c.setHex(color).clone(), r = new THREE.Color(roof), x0 = x - w / 2, x1 = x + w / 2, z0 = z - d / 2, z1 = z + d / 2, y1 = y0 + h;
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], w, h, c);
    face([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], w, h, c);
    face([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], d, h, c);
    face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], d, h, c);
    face([[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], 0, 0, r, true);
  };
  const GLASSY = [0x9fc4dd, 0xb8cfe0, 0x8fb0c8, 0xc9d6df, 0x7fa0b8], STONE = [0xe9dfc8, 0xd9c4a0, 0xf0e6d6, 0xc9b59a, 0xe0d0c0, 0xd8b8a0], BRICK = [0xb9705a, 0xc08468, 0xa86450];
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const tower = (x, z, w, d, h) => {
    const c = pick(GLASSY), k = rnd();
    block(x, z, w, d, 0.3, h, c);
    if (k < 0.45) { block(x, z, w * 0.72, d * 0.72, h + 0.3, h * 0.22, c); h *= 1.22; B(w * 0.5, 2, d * 0.5, 0x7d858c, x, h + 1.2, z); C(0.2, 0.4, 16, 0xd9dcdf, x, h + 9, z, 5); red.push(x, h + 17.5, z); }
    else if (k < 0.7) { parts.push({ geo: new THREE.ConeGeometry(w * 0.7, w * 0.8, 4), color: 0x5f7f98, matrix: xform(x, h + w * 0.4 + 0.3, z, Math.PI / 4) }); red.push(x, h + w * 0.8 + 1, z); }
    else { B(w + 0.8, 1.2, d + 0.8, 0x6b737a, x, h + 0.8, z); B(w * 0.3, 3, d * 0.3, 0x8d959d, x + w * 0.15, h + 2, z); C(1.6, 1.6, 2.6, 0x9aa0a6, x - w * 0.25, h + 1.8, z + d * 0.2, 8); red.push(x, h + 4, z); }
    collide(x, z, w / 2, d / 2, h + 3);
  };
  const mid = (x, z, w, d, h) => {
    block(x, z, w, d, 0.3, h, pick(rnd() < 0.3 ? BRICK : STONE), pick([0x8f9499, 0xa8705a, 0x7d858c]));
    B(w + 0.6, 0.7, d + 0.6, 0xf4f0e6, x, h + 0.3, z);
    if (rnd() < 0.6) { B(2.4, 1.6, 2, 0x9aa0a6, x + (rnd() - 0.5) * w * 0.5, h + 1.2, z + (rnd() - 0.5) * d * 0.5); }
    collide(x, z, w / 2, d / 2, h + 1);
  };
  const ROOFS = [0xc8553a, 0xb9472f, 0xd3704a, 0x4f6f8f];
  const house = (x, z, ry) => {
    const w = 9 + rnd() * 3, d = 8 + rnd() * 3, h = 5 + rnd() * 2;
    B(w, h, d, pick([0xf6efe2, 0xfbf7ef, 0xf0d9b8, 0xe9e2d4]), x, h / 2 + 0.2, z, ry);
    parts.push({ geo: new THREE.ConeGeometry(1, 1, 4), color: pick(ROOFS), matrix: xform(x, h + 2, z, ry + Math.PI / 4, w * 0.78, 3.8, d * 0.78) });
    collide(x, z, w / 2, d / 2, h + 3);
  };
  const pad = (i, j, color, w = 1, d = 1) => B(BLOCK + (w - 1) * PITCH, 0.3, BLOCK + (d - 1) * PITCH, color, X(i) + (PITCH * w) / 2, 0.15, Z(j) + (PITCH * d) / 2);

  // --- quartiers (cases réservées : stade, fête foraine, parc, cathédrale)
  const taken = new Set(), reserve = (i, j, w, d) => { for (let a = 0; a < w; a++) for (let b = 0; b < d; b++) taken.add(`${i + a},${j + b}`); };
  for (const l of LOTS) reserve(...l);
  reserve(3, 3, 1, 1);
  const cx = (i, w = 1) => X(i) + (PITCH * w) / 2, cz = (j, d = 1) => Z(j) + (PITCH * d) / 2;
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    if (taken.has(`${i},${j}`)) continue;
    const x = cx(i), z = cz(j), r = Math.hypot((x - 20) / 1, (z + 40) / 1.1) / 100;
    if (r < 2.1) {
      pad(i, j, 0xc4c2bc);
      const h = 130 - r * 34;
      if (rnd() < 0.35) tower(x, z, 40, 36, h * (0.8 + rnd() * 0.45));
      else for (const [a, b] of [[-20, -20], [20, -20], [-20, 20], [20, 20]]) if (rnd() < 0.88) { const w = 22 + rnd() * 8; tower(x + a, z + b, w, 22 + rnd() * 8, h * (0.45 + rnd() * 0.55)); }
    } else if (r < 3.9) {
      pad(i, j, 0xc9c6be);
      for (const [a, b] of [[-26, -26], [0, -26], [26, -26], [-26, 26], [0, 26], [26, 26], [-26, 0], [26, 0]]) if (rnd() < 0.9) mid(x + a, z + b, 20 + rnd() * 4, 20 + rnd() * 4, 13 + rnd() * 18 - r * 2);
      for (let k = 0; k < 3; k++) trees.push([x + (rnd() - 0.5) * 18, z + (rnd() - 0.5) * 18, 0.7 + rnd() * 0.3]);
    } else {
      pad(i, j, 0x8fc06a);
      for (const a of [-27, -9, 9, 27]) for (const b of [-26, 26]) if (rnd() < 0.85) house(x + a + (rnd() - 0.5) * 3, z + b, rnd() < 0.5 ? 0 : Math.PI / 2);
      for (let k = 0; k < 7; k++) trees.push([x + (rnd() - 0.5) * 70, z + (rnd() - 0.5) * 30, 0.7 + rnd() * 0.5]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const [day, lit] = facade();
  const wall = new THREE.MeshLambertMaterial({ map: day, vertexColors: true, emissive: 0xffffff, emissiveMap: lit, emissiveIntensity: 0 });
  const bm = new THREE.Mesh(g, wall); bm.castShadow = bm.receiveShadow = true; G.add(bm);

  // --- cathédrale sur sa place
  {
    const x = cx(3), z = cz(3); pad(3, 3, 0xd9d2c0);
    const S = 0xe6dcc4, R = 0x5f7f98;
    B(16, 18, 46, S, x, 9, z + 4); B(30, 16, 12, S, x, 8, z - 2);
    for (const [w, d, rx, ry] of [[12, 46, z + 4, 0], [12, 30, z - 2, Math.PI / 2]]) parts.push({ geo: prism(d, w + (ry ? 0 : 4), 8), color: R, matrix: xform(x, ry ? 16 : 18, rx, Math.PI / 2 - ry) });
    for (const s of [-1, 1]) { B(7, 34, 7, S, x + s * 7.5, 17, z + 26); parts.push({ geo: new THREE.ConeGeometry(5, 16, 4), color: R, matrix: xform(x + s * 7.5, 42, z + 26, Math.PI / 4) }); }
    parts.push({ geo: new THREE.ConeGeometry(2.4, 22, 6), color: R, matrix: xform(x, 36, z - 2) });
    C(3.4, 3.4, 0.4, 0x8e2a3a, x, 12, z + 29.8, 12);
    collide(x, z + 4, 8, 23, 24); collide(x, z - 2, 15, 6, 22); collide(x, z + 26, 11.5, 3.5, 48);
  }
  // --- parc : pelouse, étang, allées, kiosque
  {
    const x = cx(4, 2), z = cz(6, 2); pad(4, 6, 0x79b858, 2, 2);
    C(34, 34, 0.3, 0x4f9fd0, x + 20, 0.2, z - 10, 20); C(36, 36, 0.28, 0xd9cfa8, x + 20, 0.18, z - 10, 20);
    for (const ry of [Math.PI / 4, -Math.PI / 4]) B(5, 0.34, 220, 0xd9cfa8, x, 0.16, z, ry);
    C(5, 5.4, 0.8, 0xe8e4d8, x - 30, 0.6, z + 30, 8); parts.push({ geo: new THREE.ConeGeometry(6, 3, 8), color: 0x2f8a5a, matrix: xform(x - 30, 6.4, z + 30) });
    for (let k = 0; k < 8; k++) C(0.18, 0.18, 4, 0xf4f4ee, x - 30 + Math.cos(k * 0.785) * 4.6, 3, z + 30 + Math.sin(k * 0.785) * 4.6, 5);
    for (let k = 0; k < 70; k++) { const a = (rnd() - 0.5) * 160, b = (rnd() - 0.5) * 160; if (Math.hypot(a - 20, b + 10) > 42 && Math.hypot(a + 30, b - 30) > 10) trees.push([x + a, z + b, 0.8 + rnd() * 0.7]); }
  }
  // --- stade
  {
    const x = cx(7, 2), z = cz(0, 2); pad(7, 0, 0xb8b6b0, 2, 2);
    const prof = [[46, 0], [46, 2], [62, 14], [66, 14], [66, 20], [60, 21.5], [61, 20], [65, 19], [65, 0]].map(([a, b]) => new THREE.Vector2(a, b));
    parts.push({ geo: new THREE.LatheGeometry(prof, 28), color: 0xdfe3e6, matrix: xform(x, 0.3, z, 0, 1, 1, 1.22) });
    for (let k = 0; k < 4; k++) parts.push({ geo: new THREE.LatheGeometry([[48 + k * 3.6, 3.6 + k * 2.6], [50.6 + k * 3.6, 5.6 + k * 2.6]].map(([a, b]) => new THREE.Vector2(a, b)), 28), color: k % 2 ? 0xd8312b : 0x2f5fa8, matrix: xform(x, 0.4, z, 0, 1, 1, 1.22) });
    B(62, 0.2, 94, 0x5cae3a, x, 0.42, z); for (let k = -4; k <= 4; k += 2) B(62, 0.22, 9.4, 0x4f9e33, x, 0.43, z + k * 9.4);
    const L = (w, d, a, b) => B(w, 0.06, d, 0xf4f4ee, x + a, 0.6, z + b);
    L(60, 0.5, 0, 0); for (const s of [-1, 1]) { L(60, 0.5, 0, s * 45); L(0.5, 90, s * 30, 0); L(32, 0.5, 0, s * 30); for (const u of [-16, 16]) L(0.5, 15, u, s * 37.5); B(7.4, 0.2, 0.2, 0xf4f4ee, x, 2.9, z + s * 45.2); for (const u of [-3.7, 3.7]) B(0.2, 2.6, 0.2, 0xf4f4ee, x + u, 1.6, z + s * 45.2); }
    parts.push({ geo: new THREE.TorusGeometry(9, 0.25, 4, 24).rotateX(Math.PI / 2), color: 0xf4f4ee, matrix: xform(x, 0.55, z) });
    for (const [a, b] of [[-66, -72], [66, -72], [-66, 72], [66, 72]]) { C(0.6, 1, 36, 0x8d959d, x + a, 18, z + b, 6); B(9, 5, 1, 0x3a3f45, x + a, 37, z + b, Math.atan2(-a, -b)); lamps.push(x + a, 37, z + b, x + a * 0.97, 38.5, z + b * 0.97); addCylinder(city.x + x + a, city.z + z + b, 1.4, Y, Y + 40); }
    for (let k = 0; k < 28; k++) { const a = (k / 28) * 6.283; addBox(city.x + x + Math.cos(a) * 60, city.z + z + Math.sin(a) * 60 * 1.22, -a, 6, 8, Y, Y + 21); }
  }
  // --- fête foraine
  const fair = [], spin = [];
  {
    const x = cx(0, 2), z = cz(7, 3); pad(0, 7, 0xcbb994, 2, 3);
    // grande roue
    const wheel = new THREE.Group(), wp = [], R = 27, CAB = [0xd8312b, 0xf2c230, 0x2f5fa8, 0x2f8a5a, 0x8e5cc9, 0xf08a2c];
    for (const zz of [-1.6, 1.6]) { wp.push({ geo: new THREE.TorusGeometry(R, 0.35, 5, 36), color: 0xf4f4ee, matrix: xform(0, 0, zz) }); for (let k = 0; k < 12; k++) wp.push({ geo: new THREE.BoxGeometry(0.3, R * 2, 0.3), color: 0xd9dcdf, matrix: xform(0, 0, zz, 0, 1, 1, 1, 0, (k * Math.PI) / 12) }); }
    wp.push({ geo: new THREE.CylinderGeometry(2, 2, 5, 12).rotateX(Math.PI / 2), color: 0xd8312b, matrix: xform(0, 0, 0) });
    wheel.add(new THREE.Mesh(mergeColored(wp), lam()));
    const cabs = [], bulbs = [];
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * 6.283, m = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(2.6, 2.2, 2.6), color: CAB[k % 6], matrix: xform(0, -2, 0) }, { geo: new THREE.BoxGeometry(2.64, 0.8, 2.2), color: 0x2c4558, matrix: xform(0, -1.6, 0) }, { geo: new THREE.ConeGeometry(2, 0.9, 4), color: 0xf4f4ee, matrix: xform(0, -0.5, 0, Math.PI / 4) }]), lam());
      m.position.set(Math.cos(a) * R, Math.sin(a) * R, 0); wheel.add(m); cabs.push(m); bulbs.push(Math.cos(a) * R, Math.sin(a) * R, 2.2, Math.cos(a + 0.17) * R, Math.sin(a + 0.17) * R, 2.2);
    }
    wheel.add(lightsPoints(bulbs, 0xffd34d, 2.6));
    wheel.position.set(x + 20, 32, z + 78); G.add(wheel);
    spin.push((t) => { wheel.rotation.z = t * 0.12; for (const c of cabs) c.rotation.z = -wheel.rotation.z; });
    for (const s of [-1, 1]) for (const zz of [-4, 4]) parts.push({ geo: new THREE.BoxGeometry(1, 35, 1), color: 0xd9dcdf, matrix: xform(x + 20 + s * 7, 16.2, z + 78 + zz, 0, 1, 1, 1, 0, s * 0.42) });
    addBox(city.x + x + 20, city.z + z + 78, 0, 29, 4, Y, Y + 60);
    // montagnes russes : boucle fermée, rails, poteaux, wagonnets
    const pts = [[-70, 4, -110], [-70, 24, -60], [-66, 30, -30], [-52, 6, -4], [-30, 18, 10], [-8, 5, -8], [10, 22, -30], [30, 8, -10], [56, 16, -24], [64, 4, -60], [52, 14, -96], [30, 3, -112], [8, 12, -84], [-14, 4, -66], [-34, 14, -96], [-50, 3, -116]].map(([a, b, c]) => new THREE.Vector3(x + a, b, z + c));
    const curve = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    for (const o of [-0.7, 0.7]) parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(curve.getSpacedPoints(120).slice(0, 120).map((p, k) => { const t = curve.getTangentAt(k / 120), l = Math.hypot(t.x, t.z) || 1; return new THREE.Vector3(p.x - (t.z / l) * o, p.y, p.z + (t.x / l) * o); }), true), 240, 0.2, 5, true), color: 0xd8312b });
    for (let k = 0; k < 70; k++) { const p = curve.getPointAt(k / 70); C(0.25, 0.3, p.y, 0xf4f4ee, p.x, p.y / 2, p.z, 5); if (k % 4 === 0) lamps.push(p.x, p.y + 0.4, p.z); }
    const carts = [];
    for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(1.7, 1, 2.6), color: k ? 0xf2c230 : 0x2f5fa8, matrix: xform(0, 0.8, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.7, 0.4), color: 0xd8312b, matrix: xform(-0.4, 1.5, 0) }, { geo: new THREE.BoxGeometry(0.5, 0.7, 0.4), color: 0x2f8a5a, matrix: xform(0.4, 1.5, 0) }]), lam()); G.add(m); carts.push(m); }
    const Lc = curve.getLength(), state = { s: 0, v: 8 };
    spin.push((t, dt) => {
      const u0 = (state.s / Lc) % 1, tg = curve.getTangentAt(u0);
      state.v = Math.max(6, Math.min(26, state.v + (-9 * tg.y - 0.02 * (state.v - 9)) * dt)); state.s += state.v * dt;
      carts.forEach((m, k) => { const u = (((state.s - k * 3.1) / Lc) % 1 + 1) % 1, p = curve.getPointAt(u), q = curve.getTangentAt(u); m.position.copy(p); m.lookAt(_p.copy(p).sub(q).add(G.position)); });
    });
    addBox(city.x + x, city.z + z - 55, 0, 76, 66, Y, Y + 14);
    // manège, chapiteaux, tour de chute, stands
    const car = new THREE.Group(), cp = [{ geo: new THREE.ConeGeometry(10, 4, 14), color: 0xd8312b, matrix: xform(0, 8, 0) }, { geo: new THREE.CylinderGeometry(9.4, 9.4, 0.6, 14), color: 0xf2c230, matrix: xform(0, 1, 0) }, { geo: new THREE.CylinderGeometry(1, 1, 7, 8), color: 0xf4f4ee, matrix: xform(0, 4, 0) }, { geo: new THREE.CylinderGeometry(10, 10, 1, 14, 1, true), color: 0xf4f4ee, matrix: xform(0, 5.8, 0) }];
    for (let k = 0; k < 10; k++) { const a = k * 0.628; cp.push({ geo: new THREE.BoxGeometry(0.6, 1.1, 1.8), color: [0xf4f4ee, 0x8a5a33, 0x2b2e33][k % 3], matrix: xform(Math.cos(a) * 7, 2.4, Math.sin(a) * 7, -a) }, { geo: new THREE.CylinderGeometry(0.1, 0.1, 6, 5), color: 0xd9a92b, matrix: xform(Math.cos(a) * 7, 4, Math.sin(a) * 7) }); }
    car.add(new THREE.Mesh(mergeColored(cp), lam())); car.position.set(x - 45, 0, z + 60); G.add(car); spin.push((t) => { car.rotation.y = t * 0.6; });
    addCylinder(city.x + x - 45, city.z + z + 60, 10, Y, Y + 10);
    for (const [a, b, r, c] of [[-50, 108, 16, 0xd8312b], [62, 30, 10, 0x2f5fa8], [66, 120, 9, 0x2f8a5a], [-70, 20, 9, 0xf08a2c]]) { for (let k = 0; k < 12; k++) parts.push({ geo: new THREE.ConeGeometry(r, r * 0.8, 1, 1, true, (k / 12) * 6.283, 6.283 / 12), color: k % 2 ? c : 0xf4f4ee, matrix: xform(x + a, r * 0.4 + 5, z + b) }, { geo: new THREE.CylinderGeometry(r * 0.96, r * 0.96, 5, 1, 1, true, (k / 12) * 6.283, 6.283 / 12), color: k % 2 ? 0xf4f4ee : c, matrix: xform(x + a, 2.5, z + b) }); addCylinder(city.x + x + a, city.z + z + b, r, Y, Y + 5 + r * 0.6); }
    C(1.2, 1.6, 46, 0x2f5fa8, x + 68, 23, z + 70, 8); red.push(x + 68, 47, z + 70); addCylinder(city.x + x + 68, city.z + z + 70, 4, Y, Y + 47);
    const drop = new THREE.Mesh(mergeColored([{ geo: new THREE.TorusGeometry(3.2, 0.8, 5, 12).rotateX(Math.PI / 2), color: 0xf2c230, matrix: xform() }]), lam()); G.add(drop);
    spin.push((t) => { const u = (t % 16) / 16; drop.position.set(x + 68, u < 0.6 ? 3 + 38 * u / 0.6 : u < 0.72 ? 41 : u < 0.82 ? 41 - 38 * ((u - 0.72) / 0.1) ** 2 : 3, z + 70); });
    for (let k = 0; k < 12; k++) { const a = x - 74 + (k % 6) * 13, b = z + 22 + Math.floor(k / 6) * 12, c = pick([0xd8312b, 0x2f5fa8, 0xf2c230, 0x2f8a5a]); B(5, 2.6, 4, 0xf4ead6, a, 1.5, b); B(5.6, 0.4, 5.2, c, a, 3.1, b); lamps.push(a, 3.4, b); }
    fair.push(x, z);
  }
  // --- lampadaires aux carrefours et arbres d'alignement
  for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) { if (LOTS.some(([a, b, w, d]) => i > a && i < a + w && j > b && j < b + d)) continue; const x = X(i) + 9, z = Z(j) + 9; C(0.1, 0.14, 7, 0x3a3f45, x, 3.5, z, 5); B(0.9, 0.25, 0.5, 0x2b2e33, x, 7, z); lamps.push(x, 6.8, z); }
  const mesh = new THREE.Mesh(mergeColored(parts), lam({ side: THREE.DoubleSide }));
  mesh.castShadow = mesh.receiveShadow = true;
  G.add(mesh, lightsPoints(red, 0xff3020, 6), lightsPoints(lamps, 0xffe2a0, 4.5));
  const tg = mergeColored([{ geo: new THREE.CylinderGeometry(0.35, 0.5, 3, 5, 1, true), color: 0x7a5a3c, matrix: xform(0, 1.5, 0) }, { geo: new THREE.IcosahedronGeometry(2.9, 0), color: 0x6fb850, matrix: xform(0, 5.2, 0, 0, 1, 0.9, 1) }]);
  const tm = new THREE.InstancedMesh(tg, lam(), trees.length);
  trees.forEach(([x, z, s], i) => tm.setMatrixAt(i, _m.compose(_p.set(x, 0.1, z), _q.setFromAxisAngle(UP, i), _s.setScalar(s))));
  tm.castShadow = true; tm.frustumCulled = false; G.add(tm);

  // --- circulation : chaque voiture tourne autour d'un pâté de maisons ; promeneurs sur les trottoirs
  const carGeo = mergeColored([{ geo: new THREE.BoxGeometry(1.8, 0.7, 4.3), color: 0xffffff, matrix: xform(0, 0.75, 0) }, { geo: new THREE.BoxGeometry(1.6, 0.6, 2.2), color: 0x3a5a70, matrix: xform(0, 1.4, 0.2) }, { geo: new THREE.BoxGeometry(1.9, 0.5, 0.7), color: 0x1b1c1e, matrix: xform(0, 0.35, -1.4) }, { geo: new THREE.BoxGeometry(1.9, 0.5, 0.7), color: 0x1b1c1e, matrix: xform(0, 0.35, 1.4) }]);
  const N = 70, cars = new THREE.InstancedMesh(carGeo, lam(), N), loops = [];
  for (let k = 0; k < N; k++) {
    let i0, j0, i1, j1, ok = false;
    while (!ok) { // un tour de pâté de maisons dont les quatre rues existent
      i0 = Math.floor(rnd() * NX); j0 = Math.floor(rnd() * NZ); i1 = Math.min(NX, i0 + 1 + Math.floor(rnd() * 4)); j1 = Math.min(NZ, j0 + 1 + Math.floor(rnd() * 4)); ok = true;
      for (let j = j0; j < j1; j++) ok = ok && !inLot(i0, j, true) && !inLot(i1, j, true);
      for (let i = i0; i < i1; i++) ok = ok && !inLot(i, j0, false) && !inLot(i, j1, false);
    }
    const x0 = X(i0) + 2.8, x1 = X(i1) - 2.8, z0 = Z(j0) + 2.8, z1 = Z(j1) - 2.8; // sens horaire, donc à droite
    loops.push({ x0, x1, z0, z1, s: rnd() * 2 * (x1 - x0 + z1 - z0), v: 8 + rnd() * 5 });
    cars.setColorAt(k, _c.setHex(pick([0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0x9aa3ab, 0xf2c230, 0x2f8a5a])));
  }
  cars.frustumCulled = false; cars.castShadow = true; G.add(cars);
  const walkers = [];
  for (let k = 0; k < 170; k++) {
    const i = Math.floor(rnd() * NX), j = Math.floor(rnd() * NZ), x = city.x + cx(i), z = city.z + cz(j), h = BLOCK / 2 - 2 - rnd() * 2;
    walkers.push({ loop: [{ x: x - h, z: z - h }, { x: x + h, z: z - h }, { x: x + h, z: z + h }, { x: x - h, z: z + h }] });
  }
  for (let k = 0; k < 40; k++) { const x = city.x + fair[0] + (rnd() - 0.5) * 130, z = city.z + fair[1] + 10 + rnd() * 110, r = 6 + rnd() * 10; walkers.push({ loop: [0, 1, 2, 3].map((q) => ({ x: x + Math.cos(q * 1.57) * r, z: z + Math.sin(q * 1.57) * r })) }); }
  const people = new People(scene, walkers, () => Y + 0.3, 5);

  return {
    update(dt, t, night, cam) {
      wall.emissiveIntensity = Math.min(1, night * 1.4);
      const d = cam ? Math.hypot(cam.x - city.x, cam.z - city.z) : 0;
      people.update(dt, t, cam);
      if (d > 5000) return;
      for (const f of spin) f(t, dt);
      loops.forEach((o, k) => {
        const w = o.x1 - o.x0, h = o.z1 - o.z0, P = 2 * (w + h);
        // ralentit aux carrefours
        o.s = (o.s + o.v * dt) % P;
        let s = o.s, x, z, yaw;
        if (s < w) { x = o.x0 + s; z = o.z0; yaw = -Math.PI / 2; }
        else if ((s -= w) < h) { x = o.x1; z = o.z0 + s; yaw = Math.PI; }
        else if ((s -= h) < w) { x = o.x1 - s; z = o.z1; yaw = Math.PI / 2; }
        else { x = o.x0; z = o.z1 - (s - w); yaw = 0; }
        cars.setMatrixAt(k, _m.compose(_p.set(x, 0.2, z), _q.setFromAxisAngle(UP, yaw), _s.setScalar(1)));
      });
      cars.instanceMatrix.needsUpdate = true;
    },
  };
}
