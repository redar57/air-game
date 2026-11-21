import * as THREE from 'three';
import { makeNoise2D, fbm, ridged } from './noise.js';
import { clamp, lerp, smoothstep, toLocal } from '../util.js';

// Taille du monde : petite carte (l'île d'origine) ou grande carte (une autre île, bien plus grande).
// setBig() doit être appelé avant toute construction (le choix change au menu, avec rechargement).
export let BIG = false, SIZE = 11000, SEG = 352, CELL = SIZE / SEG, HALF = SIZE / 2;
export const ISLAND_R = 4400;
/** Chaîne de montagnes : centre, orientation, demi-longueur et demi-largeur, hauteur des crêtes. */
export const MTN = { x: 800, z: -900, ang: 0.45, len: 2600, wid: 1250, amp: 1080 };
export const VOLCANO = { x: -2500, z: 1000, rimR: 300, baseR: 1350, h: 760, depth: 230 };
const ISLETS = [
  { x: 4300, z: -3700, r: 380, a: 150 },
  { x: -4700, z: -3000, r: 300, a: 125 },
  { x: 3500, z: 4300, r: 260, a: 110 },
  { x: -1200, z: -4900, r: 240, a: 105 },
];
/** Grande île : réunion de lobes elliptiques, avec une grande baie creusée au sud-ouest. */
const LOBES = [
  { x: -5000, z: -1800, rx: 3400, rz: 3000 },
  { x: 0, z: 0, rx: 4800, rz: 4000 },
  { x: 5200, z: 1300, rx: 3400, rz: 3000 },
  { x: 1500, z: -4200, rx: 3000, rz: 2000 },
  { x: -1300, z: 3700, rx: 3000, rz: 2100 },
];
const BAY = { x: -4500, z: 2500, rx: 1900, rz: 1500 };
let mca = Math.cos(MTN.ang), msa = Math.sin(MTN.ang);

export function setBig(big) {
  BIG = !!big;
  SIZE = BIG ? 22000 : 11000; SEG = BIG ? 600 : 352; CELL = SIZE / SEG; HALF = SIZE / 2;
  if (!BIG) return;
  Object.assign(MTN, { x: 1900, z: -2700, ang: -0.32, len: 3900, wid: 1500, amp: 1300 });
  Object.assign(VOLCANO, { x: -6300, z: -2900, rimR: 340, baseR: 1600, h: 900, depth: 260 });
  ISLETS.splice(0, ISLETS.length,
    { x: -9000, z: 900, r: 420, a: 140 }, { x: 9300, z: -1600, r: 360, a: 125 },
    { x: -800, z: -5900, r: 380, a: 130 }, { x: 9400, z: 3700, r: 300, a: 105 }, { x: 4200, z: 5100, r: 320, a: 115 });
  mca = Math.cos(MTN.ang); msa = Math.sin(MTN.ang);
}

const nA = makeNoise2D(1337), nB = makeNoise2D(9001), nC = makeNoise2D(271);

/** Distance au fond du canyon (qui serpente le long de la chaîne) et abscisse le long de celui-ci. */
export function canyonDist(x, z) {
  const dx = x - MTN.x, dz = z - MTN.z;
  const u = dx * mca + dz * msa, v = -dx * msa + dz * mca;
  const f = 250 * Math.sin(u / 430) + 110 * Math.sin(u / 170 + 1.3);
  const fp = (250 / 430) * Math.cos(u / 430) + (110 / 170) * Math.cos(u / 170 + 1.3);
  return Math.abs(v - f) / Math.sqrt(1 + fp * fp);
}

function bigMask(x, z) {
  const wx = x + 650 * nB(x * 0.0003, z * 0.0003), wz = z + 650 * nB(x * 0.0003 + 40, z * 0.0003 + 17);
  let e = 0; // union « douce » des lobes : ils se fondent sans pincement entre eux
  for (const l of LOBES) e += Math.exp(-Math.hypot((wx - l.x) / l.rx, (wz - l.z) / l.rz) / 0.12);
  let c = -0.12 * Math.log(e + 1e-9);
  c += 0.14 * fbm(nA, x * 0.0004 + 5, z * 0.0004 - 3, 3);
  const bay = Math.hypot((wx - BAY.x) / BAY.rx, (wz - BAY.z) / BAY.rz);
  return (1 - smoothstep(0.6, 1.02, c)) * smoothstep(0.7, 1.1, bay);
}

function islandMask(x, z) {
  const wx = x + 420 * nB(x * 0.00045, z * 0.00045);
  const wz = z + 420 * nB(x * 0.00045 + 40, z * 0.00045 + 17);
  const r = Math.hypot(wx, wz * 1.1) / ISLAND_R;
  const c = r + 0.16 * fbm(nA, x * 0.00042 + 5, z * 0.00042 - 3, 3);
  return 1 - smoothstep(0.6, 1.02, c);
}

/** Relief « naturel », avant aplanissement des terrains d'aviation. */
export function rawBase(x, z) {
  const m = BIG ? bigMask(x, z) : islandMask(x, z), amp = BIG ? 110 : 95;
  const hills = fbm(nA, x * 0.0012, z * 0.0012, 4) * 0.5 + 0.5;
  let h = lerp(-60, 16, Math.pow(m, 0.75)) + m * hills * amp;
  h += m * fbm(nC, x * 0.004, z * 0.004, 2) * 7;

  // montagnes
  const dx = x - MTN.x, dz = z - MTN.z;
  const u = dx * mca + dz * msa, v = -dx * msa + dz * mca;
  const mw = Math.exp(-((u / MTN.len) ** 2 + (v / MTN.wid) ** 2) * 1.9);
  if (mw > 0.003) {
    const rg = ridged(nB, x * 0.0005 + 3, z * 0.0005 + 8, 4);
    h += m * m * mw * (190 + Math.pow(rg, 1.3) * MTN.amp);
  }

  // volcan et son cratère
  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (dv < VOLCANO.baseR) {
    const rimH = VOLCANO.h * Math.pow(1 - VOLCANO.rimR / VOLCANO.baseR, 1.35);
    let hv;
    if (dv >= VOLCANO.rimR) hv = VOLCANO.h * Math.pow(1 - dv / VOLCANO.baseR, 1.35);
    else hv = rimH - VOLCANO.depth * (1 - (dv / VOLCANO.rimR) ** 2) ** 1.4;
    h += hv * (1 + 0.1 * nC(x * 0.003, z * 0.003) * smoothstep(0, 600, dv));
    if (h < 6 && hv > 30) h = lerp(h, 6, smoothstep(30, 90, hv));
  }

  // îlots
  for (const it of ISLETS) {
    const d2 = ((x - it.x) ** 2 + (z - it.z) ** 2) / (it.r * it.r);
    if (d2 < 6) h += it.a * Math.exp(-d2 * 1.6) * (1 + 0.25 * nC(x * 0.006, z * 0.006));
  }

  // canyon
  const cd = canyonDist(x, z);
  if (cd < 300) {
    const floor = 34 + 14 * nC(u * 0.0015, 7.7);
    if (h > floor) h = floor + (h - floor) * smoothstep(85, 290, cd);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Zones aplanies (pistes) + grille de hauteurs utilisée pour le rendu ET les collisions
// ---------------------------------------------------------------------------
let zones = [];
let H = null;
const _l = { x: 0, z: 0 };

/** Poids d'aplanissement (0..1) et altitude cible de la zone la plus influente. */
export function flatInfo(x, z) {
  let w = 0, alt = 0;
  for (const zn of zones) {
    toLocal(zn, x, z, _l);
    const dz = Math.max(0, Math.abs(_l.z) - zn.halfLen), dx = Math.max(0, Math.abs(_l.x) - zn.halfWid);
    const d = Math.hypot(dx, dz);
    if (d < zn.margin) {
      const k = 1 - smoothstep(0, zn.margin, d);
      if (k > w) { w = k; alt = zn.alt; }
    }
  }
  return { w, alt };
}

function finalHeight(x, z) {
  let h = rawBase(x, z);
  const f = flatInfo(x, z);
  if (f.w > 0) h = lerp(h, f.alt, f.w);
  return h;
}

/** Hauteur du sol (interpolation identique au maillage affiché). */
export function heightAt(x, z) {
  const gx = (x + HALF) / CELL, gz = (z + HALF) / CELL;
  if (gx < 0 || gz < 0 || gx >= SEG || gz >= SEG) return -60;
  const i = Math.floor(gx), j = Math.floor(gz);
  const fx = gx - i, fz = gz - j;
  const k = i + j * (SEG + 1);
  const a = H[k], b = H[k + 1], c = H[k + SEG + 1], d = H[k + SEG + 2];
  if (fx + fz <= 1) return a + (b - a) * fx + (c - a) * fz;
  return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}

export function normalAt(x, z, out) {
  const e = CELL * 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

// ---------------------------------------------------------------------------
// Couleurs
// ---------------------------------------------------------------------------
const hex = (h) => new THREE.Color(h);
const COL = {
  deep: hex(0x1d6fae), shallow: hex(0x8fe3d2), sand: hex(0xf0e2ae),
  grassA: hex(0x93d063), grassB: hex(0x5fae52), alpine: hex(0xa7ab6c),
  rockA: hex(0xa39b8f), rockB: hex(0x8b847a), snow: hex(0xf6f9fc),
  basalt: hex(0x5a504b), ember: hex(0x8a3d24), field: hex(0x84c75f), gravel: hex(0xcbbd98),
};

function colorAt(x, z, h, ny, out) {
  const jit = nC(x * 0.021, z * 0.021) * 0.5 + 0.5;
  const big = fbm(nB, x * 0.0016 + 9, z * 0.0016 - 4, 3);
  if (h < 0) {
    out.copy(COL.shallow).lerp(COL.deep, smoothstep(0, -20, h));
    return;
  }
  out.copy(COL.grassA).lerp(COL.grassB, smoothstep(-0.3, 0.35, big));
  out.lerp(COL.alpine, smoothstep(230, 430, h));
  out.lerp(COL.sand, smoothstep(7.5, 3, h));
  const rockT = Math.max(smoothstep(0.8, 0.62, ny), smoothstep(430, 560, h + big * 60));
  out.lerp(jit > 0.5 ? COL.rockA : COL.rockB, rockT * smoothstep(1.5, 6, h));
  out.lerp(COL.snow, smoothstep(560, 650, h + big * 70) * smoothstep(0.2, 0.5, ny));

  const cd = canyonDist(x, z);
  if (cd < 110 && ny > 0.85 && h < 70) out.lerp(COL.gravel, smoothstep(110, 60, cd));

  const dv = Math.hypot(x - VOLCANO.x, z - VOLCANO.z);
  if (dv < 1300) {
    out.lerp(COL.basalt, smoothstep(1300, 650, dv) * smoothstep(30, 150, h));
    if (dv < VOLCANO.rimR) out.lerp(COL.ember, smoothstep(VOLCANO.rimR * 0.9, 60, dv) * 0.8);
  }
  const f = flatInfo(x, z);
  if (f.w > 0.4) out.lerp(COL.field, smoothstep(0.4, 0.9, f.w));
  out.multiplyScalar(0.92 + 0.16 * jit);
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
export let maxHeight = 0;

export function buildTerrain(flatZones) {
  zones = flatZones;
  const n = SEG + 1;
  H = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = -HALF + j * CELL;
    for (let i = 0; i < n; i++) {
      const h = finalHeight(-HALF + i * CELL, z);
      H[i + j * n] = h;
      if (h > maxHeight) maxHeight = h;
    }
  }

  const pos = new Float32Array(n * n * 3), col = new Float32Array(n * n * 3);
  const c = new THREE.Color();
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const k = i + j * n, x = -HALF + i * CELL, z = -HALF + j * CELL, h = H[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const hl = H[Math.max(i - 1, 0) + j * n], hr = H[Math.min(i + 1, SEG) + j * n];
      const hu = H[i + Math.max(j - 1, 0) * n], hd = H[i + Math.min(j + 1, SEG) * n];
      const nx = hl - hr, nz = hu - hd, ny = 2 * CELL;
      colorAt(x, z, h, ny / Math.hypot(nx, ny, nz), c);
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
    }
  }
  const idx = new Uint32Array(SEG * SEG * 6);
  let t = 0;
  for (let j = 0; j < SEG; j++) {
    for (let i = 0; i < SEG; i++) {
      const a = i + j * n, b = a + 1, cc = a + n, d = cc + 1;
      idx[t++] = a; idx[t++] = cc; idx[t++] = b;
      idx[t++] = b; idx[t++] = cc; idx[t++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

/** Cherche le rivage le long d'un rayon partant du centre ; renvoie le point à `offset` m du rivage (négatif = dans les terres). */
export function coastPoint(angle, offset = 0, fn = heightAt) {
  const dx = Math.cos(angle), dz = Math.sin(angle);
  let r = 1200;
  while (r < Math.max(6200, HALF * 0.95) && fn(dx * r, dz * r) > 0.5) r += 20;
  r += offset;
  return { x: dx * r, z: dz * r };
}

export { clamp };
