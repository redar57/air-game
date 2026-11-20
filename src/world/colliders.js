import { toLocal } from '../util.js';

/** Obstacles simples contre lesquels l'avion peut s'écraser (bâtiments, rochers, ballons…). */
const list = [];
const _l = { x: 0, z: 0 };

export function addBox(x, z, yaw, hx, hz, y0, y1) {
  list.push({ t: 0, x, z, yaw, hx, hz, y0, y1, r: Math.hypot(hx, hz) });
}
export function addCylinder(x, z, r, y0, y1) {
  list.push({ t: 1, x, z, r, y0, y1 });
}
export function addSphere(x, y, z, r) {
  list.push({ t: 2, x, y, z, r, y0: y - r, y1: y + r });
}
/** fn(px, py, pz) -> bool ; (x, z, r) sert de pré-filtre. */
export function addCustom(x, z, r, y0, y1, fn) {
  list.push({ t: 3, x, z, r, y0, y1, fn });
}

export function hitObstacle(px, py, pz) {
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (py < c.y0 || py > c.y1) continue;
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
