import * as THREE from 'three';
import { mulberry32, mergeColored, xform } from '../util.js';

// Thermiques : colonnes d'air chaud qui montent au-dessus de l'île (surtout utiles au planeur).
// Chacune est surmontée d'un gros cumulus bien rond, pour qu'on la repère de loin.

export const thermals = [];

export function defineThermals(heightAt, span = 10000, count = 14) {
  thermals.length = 0;
  const rnd = mulberry32(7741);
  for (let n = 0; n < 600 * (count / 14) && thermals.length < count; n++) {
    const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span, h = heightAt(x, z);
    if (h < 15 || h > 650) continue;
    if (thermals.some((t) => Math.hypot(t.x - x, t.z - z) < 1100)) continue;
    thermals.push({ x, z, r: 230 + rnd() * 90, w: 3 + rnd() * 2.5, base: h, top: Math.max(h + 950, 1350 + rnd() * 400) });
  }
  return thermals;
}

/** Vitesse verticale de l'air (m/s) au point donné : ça monte au cœur, ça descend un peu autour. */
export function updraft(x, y, z) {
  let w = 0;
  for (const t of thermals) {
    const dx = x - t.x, dz = z - t.z, d2 = dx * dx + dz * dz, r2 = t.r * t.r;
    if (d2 > r2 * 2.6 || y > t.top || y < t.base) continue;
    const fade = Math.min(1, (t.top - y) / 200);
    w += d2 < r2 ? t.w * (1 - d2 / r2) * fade : -0.4 * fade; // anneau de « dégueulante » autour
  }
  return w;
}

export function buildThermalClouds(scene) {
  const rnd = mulberry32(99), parts = [];
  for (const t of thermals) {
    const s = t.r * 0.55;
    for (let k = 0; k < 6; k++) {
      const a = rnd() * 6.28, d = rnd() * s * 0.9;
      parts.push({ geo: new THREE.IcosahedronGeometry(s * (0.55 + rnd() * 0.45), 1), color: 0xffffff,
        matrix: xform(t.x + Math.cos(a) * d, t.top + 60 + rnd() * s * 0.4, t.z + Math.sin(a) * d, rnd() * 6, 1, 0.62, 1) });
    }
    parts.push({ geo: new THREE.CylinderGeometry(s * 1.1, s * 1.15, s * 0.25, 9), color: 0xe9eef3, matrix: xform(t.x, t.top + 40, t.z) });
  }
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: true, opacity: 0.94 }));
  scene.add(mesh);
  return mesh;
}
