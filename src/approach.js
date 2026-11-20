import { toLocal } from './util.js';

// Aide à l'atterrissage : on cherche la piste (ou le porte-avions) vers laquelle l'avion se dirige
// et on calcule où il se trouve par rapport au plan de descente idéal (comme les feux PAPI).

const _l = { x: 0, z: 0 };
const T = [2.0, 2.65, 3.35, 4.0]; // seuils des 4 feux (degrés au-dessus du sol vus depuis le point visé)

function check(plane, frame, axisX, aimZ, alt, glide, name, best) {
  // repère local de la piste : atterrissage vers -Z, point visé en (axisX, aimZ)
  for (const dir of [1, -1]) {
    if (dir < 0 && frame.oneWay) continue;
    toLocal(frame, plane.pos.x, plane.pos.z, _l);
    const lx = (_l.x - axisX * dir) * dir, lz = _l.z * dir - aimZ;
    const c = Math.cos(frame.yaw), s = Math.sin(frame.yaw);
    const fz = (plane.fwd.x * s + plane.fwd.z * c) * dir;
    if (lz < 60 || lz > 6000 || fz > -0.7 || Math.abs(lx) > 150 + lz * 0.35) continue;
    const h = plane.pos.y - plane.standH - alt;
    const angle = (Math.atan2(h, lz) * 180) / Math.PI;
    if (!best || lz < best.dist) {
      best = { dist: lz, dev: lx, angle, glide, name, white: T.filter((t) => angle - (glide - 3) > t).length };
    }
  }
  return best;
}

/** Renvoie { dist (m), dev (m, + = à droite de l'axe), angle (°), glide, name, white (0..4) } ou null. */
export function approachInfo(plane, runways, carrier, deckAxisX) {
  if (plane.onGround) return null;
  let best = null;
  for (const rw of runways) best = check(plane, rw, 0, rw.length / 2 - rw.length * 0.15, rw.alt, 3, rw.small ? 'ALTIPORT' : 'PISTE', best);
  best = check(plane, { ...carrier, oneWay: true }, deckAxisX, 95, carrier.deckY, 3.5, 'PORTE-AVIONS', best);
  return best;
}
