import { toLocal } from '../util.js';

/**
 * Obstacles simples contre lesquels l'avion peut s'écraser (bâtiments, rochers, ballons…), rangés dans une grille
 * pour ne tester que les voisins. Les obstacles qui bougent (addMoving) sont testés à part.
 */
const CELL = 256, grid = new Map(), moving = [];
const _l = { x: 0, z: 0 };
const key = (i, j) => i * 4096 + j;

function add(c) {
  for (let i = Math.floor((c.x - c.r) / CELL); i <= Math.floor((c.x + c.r) / CELL); i++) {
    for (let j = Math.floor((c.z - c.r) / CELL); j <= Math.floor((c.z + c.r) / CELL); j++) {
      const k = key(i, j);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(c);
    }
  }
  return c;
}
export function addBox(x, z, yaw, hx, hz, y0, y1) {
  return add({ t: 0, x, z, yaw, hx, hz, y0, y1, r: Math.hypot(hx, hz), off: false });
}
/** Renvoie l'obstacle (.off = true le désactive). */
export function addCylinder(x, z, r, y0, y1) {
  return add({ t: 1, x, z, r, y0, y1, off: false });
}
/** Renvoie l'obstacle : mettre .off = true le désactive (montgolfière abattue). */
export function addSphere(x, y, z, r) {
  return add({ t: 2, x, y, z, r, y0: y - r, y1: y + r, off: false });
}
/** fn(px, py, pz) -> bool ; (x, z, r) sert de pré-filtre. */
export function addCustom(x, z, r, y0, y1, fn) {
  return add({ t: 3, x, z, r, y0, y1, fn, off: false });
}
/** Boîte mobile : on peut changer x, z, yaw, y0, y1 à tout moment. */
export function addMoving(hx, hz, y0, y1) {
  const c = { t: 0, x: 0, z: 0, yaw: 0, hx, hz, y0, y1, r: Math.hypot(hx, hz), off: false };
  moving.push(c);
  return c;
}

function test(list, px, py, pz) {
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c.off || py < c.y0 || py > c.y1) continue;
    const dx = px - c.x, dz = pz - c.z;
    if (dx * dx + dz * dz > c.r * c.r) continue;
    if (c.t === 1) return true;
    if (c.t === 0) {
      toLocal(c, px, pz, _l);
      if (Math.abs(_l.x) <= c.hx && Math.abs(_l.z) <= c.hz) return true;
    } else if (c.t === 2) {
      const dy = py - c.y;
      if (dx * dx + dy * dy + dz * dz <= c.r * c.r) return true;
    } else if (c.fn(px, py, pz)) return true;
  }
  return false;
}
export function hitObstacle(px, py, pz) {
  const list = grid.get(key(Math.floor(px / CELL), Math.floor(pz / CELL)));
  return (list !== undefined && test(list, px, py, pz)) || test(moving, px, py, pz);
}
