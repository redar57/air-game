import { toLocal, toWorld } from '../util.js';

// Ponts où l'on peut se poser : porte-avions, plateformes des navires d'escorte, plateforme pétrolière, rampe de vol
// libre. Un pont peut bouger : l'appareil posé dessus est emporté avec lui.

/** { x, z, yaw, y, hw, hl, kind: 'carrier' | 'deck', name, fuel?, vx, vz } ; repère local : -Z vers l'avant. */
export const decks = [];
const _l = { x: 0, z: 0 }, _w = { x: 0, z: 0 };

export function addDeck(o) {
  Object.assign(o, { vx: 0, vz: 0 });
  decks.push(o);
  return o;
}
/** Pont situé sous le point (x, y, z), ou null. */
export function deckAt(x, y, z) {
  for (const d of decks) {
    if (y < d.y - 2.5 || Math.abs(x - d.x) > 160 || Math.abs(z - d.z) > 160) continue;
    toLocal(d, x, z, _l);
    if (Math.abs(_l.x) <= d.hw && Math.abs(_l.z) <= d.hl) return d;
  }
  return null;
}
/** Déplace un pont et note sa vitesse. */
export function moveDeck(d, x, z, yaw, dt) {
  if (dt > 0) { d.vx = (x - d.x) / dt; d.vz = (z - d.z) / dt; }
  d.x = x; d.z = z; d.yaw = yaw;
}
/** Pompe à carburant d'un pont sous (x, z). */
export function deckPump(x, z) {
  for (const d of decks) {
    if (!d.fuel || Math.abs(x - d.x) > 160 || Math.abs(z - d.z) > 160) continue;
    toLocal(d, x, z, _l);
    if (Math.abs(_l.x - d.fuel.lx) <= d.fuel.half && Math.abs(_l.z - d.fuel.lz) <= d.fuel.half) return true;
  }
  return false;
}
/** Exécute `move` (qui déplace les ponts) en emportant l'appareil posé sur l'un d'eux. */
export function ride(plane, move) {
  const d = plane.onGround && plane.deck;
  if (!d) { move(); return; }
  toLocal(d, plane.pos.x, plane.pos.z, _l);
  const lx = _l.x, lz = _l.z, yaw = d.yaw;
  move();
  toWorld(d, lx, lz, _w);
  plane.pos.x = _w.x; plane.pos.z = _w.z;
  plane.turnWith(d.yaw - yaw);
}
