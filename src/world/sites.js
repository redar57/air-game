import * as THREE from 'three';
import { heightAt, normalAt, flatInfo, BIG } from './terrain.js';
import { occupied } from './country.js';
import { helipads, helipadMesh, lightsPoints, runwayAt } from './airfields.js';
import { addBox, hitObstacle } from './colliders.js';
import { mergeColored, xform } from '../util.js';

// Lieux utiles aux missions : l'hôpital (et son hélisurface) au bord d'un village, et une recherche
// d'emplacements dégagés (zones de saut, aires de dépose de fret…).

export const hospital = { x: 0, z: 0, y: 0, name: 'Hôpital', active: false };
const _n = new THREE.Vector3();

/** Vrai si un carré de demi-côté `half` autour de (x, z) est plat, à terre, libre de piste, de chemin et de maison. */
export function clearSpot(x, z, half, villages = [], trees = null, opts = {}) {
  const { minH = 4, maxH = 420, flat = 0.965, allowFlat = false, tol = half * 0.12 } = opts;
  const h0 = heightAt(x, z);
  if (allowFlat && (runwayAt(x, z) || hitObstacle(x, h0 + 2, z))) return false;
  for (const [a, b] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [1, 0], [0, -1], [-1, 0]]) {
    const px = x + a * half, pz = z + b * half, h = heightAt(px, pz);
    if (h < minH || h > maxH || Math.abs(h - h0) > tol) return false;
    if (normalAt(px, pz, _n).y < flat || (!allowFlat && flatInfo(px, pz).w > 0)) return false;
    if (allowFlat && hitObstacle(px, h + 2, pz)) return false;
    if (BIG && occupied(px, pz)) return false;
  }
  for (const v of villages) for (const hs of v.houses || []) if (Math.hypot(hs.x - x, hs.z - z) < half + 14) return false;
  if (trees) for (const t of trees) if (Math.abs(t.x - x) < half + 4 && Math.abs(t.z - z) < half + 4) return false;
  return true;
}

/** Hôpital : bâtiment blanc à croix rouge et hélisurface, au bord du village le plus central. */
export function buildHospital(scene, villages, trees) {
  if (!villages.length) return;
  const v = BIG ? villages.find((w) => w.name === 'Village du Lac') || villages[0] : villages[0];
  let spot = null;
  for (let d = v.r * 0.6; d < v.r + 500 && !spot; d += 25) {
    for (let a = 0; a < 6.283; a += 0.3) {
      const x = v.x + Math.cos(a) * d, z = v.z + Math.sin(a) * d;
      if (clearSpot(x, z, 32, villages, trees)) { spot = { x, z, a }; break; }
    }
  }
  if (!spot) return;
  const y = heightAt(spot.x, spot.z);
  Object.assign(hospital, { x: spot.x, z: spot.z, y, active: true, name: `Hôpital (${v.name})` });
  // le bâtiment, à côté de l'hélisurface (vers le village)
  const ry = -spot.a, c = Math.cos(spot.a), s = Math.sin(spot.a);
  const bx = spot.x - c * 22, bz = spot.z - s * 22, by = Math.min(y, heightAt(bx, bz)) - 0.5;
  const W = 0xf6f6f2, R = 0xd8312b, G = 0x5a8fb0;
  const parts = [
    { geo: new THREE.BoxGeometry(12, 10, 30), color: W, matrix: xform(0, 5, 0) },
    { geo: new THREE.BoxGeometry(12.2, 1.6, 30.2), color: G, matrix: xform(0, 3.2, 0) },
    { geo: new THREE.BoxGeometry(12.2, 1.6, 30.2), color: G, matrix: xform(0, 6.8, 0) },
    { geo: new THREE.BoxGeometry(12.6, 0.6, 30.6), color: 0xc9cdd2, matrix: xform(0, 10.3, 0) },
    // croix rouges : sur le toit et sur la façade
    { geo: new THREE.BoxGeometry(2, 0.1, 7), color: R, matrix: xform(0, 10.65, 0) },
    { geo: new THREE.BoxGeometry(7, 0.1, 2), color: R, matrix: xform(0, 10.65, 0) },
    { geo: new THREE.BoxGeometry(0.2, 3.2, 1), color: R, matrix: xform(6.1, 8.5, 0) },
    { geo: new THREE.BoxGeometry(0.2, 1, 3.2), color: R, matrix: xform(6.1, 8.5, 0) },
    { geo: new THREE.BoxGeometry(4, 3, 6), color: W, matrix: xform(7, 1.5, 0) },   // entrée
    { geo: new THREE.BoxGeometry(4.4, 0.4, 6.4), color: R, matrix: xform(7, 3.1, 0) },
  ];
  const mesh = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.position.set(bx, by, bz); mesh.rotation.y = ry + Math.PI;
  scene.add(mesh);
  addBox(bx, bz, ry + Math.PI, 6, 15, by, by + 11);
  const pad = helipadMesh(spot.x, y, spot.z, 12);
  scene.add(pad);
  const lp = [];
  for (let k = -1; k <= 1; k += 2) lp.push(k * 6.4, 8.5, k * 10);
  const lights = lightsPoints(lp, 0xff6050, 3);
  lights.position.copy(mesh.position); lights.rotation.y = mesh.rotation.y;
  scene.add(lights);
  helipads.push({ x: spot.x, z: spot.z, y, r: 12, name: hospital.name, hospital: true });
}

/** Cherche au hasard un endroit dégagé (demi-côté `half`) ; options : loin de (fx, fz) d'au moins minD, au plus maxD. */
export function randomClearSpot(rnd, span, half, villages, trees, { from = null, minD = 0, maxD = Infinity, tries = 400, ...opts } = {}) {
  for (let k = 0; k < tries; k++) {
    const x = (rnd() - 0.5) * span, z = (rnd() - 0.5) * span;
    if (from) { const d = Math.hypot(x - from.x, z - from.z); if (d < minD || d > maxD) continue; }
    if (clearSpot(x, z, half, villages, trees, opts)) return { x, z, y: heightAt(x, z) };
  }
  return null;
}
