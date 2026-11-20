import * as THREE from 'three';

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
/** Marche aussi « à l'envers » (a > b). */
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Générateur pseudo-aléatoire à graine (même île à chaque lancement). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Coordonnées monde -> repère local d'un objet posé en (x, z) et tourné de `yaw` autour de Y. */
export function toLocal(o, x, z, out) {
  const dx = x - o.x, dz = z - o.z;
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}

/** Repère local -> monde (même convention que ci-dessus). */
export function toWorld(o, lx, lz, out) {
  const c = Math.cos(o.yaw), s = Math.sin(o.yaw);
  out.x = o.x + lx * c + lz * s;
  out.z = o.z - lx * s + lz * c;
  return out;
}

/**
 * Fusionne plusieurs géométries colorées en une seule (position + normale + couleur).
 * parts : [{ geo, color, matrix? }]
 */
export function mergeColored(parts) {
  const pos = [], nor = [], col = [];
  const c = new THREE.Color();
  for (const part of parts) {
    let g = part.geo.index ? part.geo.toNonIndexed() : part.geo.clone();
    if (part.matrix) g.applyMatrix4(part.matrix);
    g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    c.set(part.color);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
/** Matrice de transformation pratique pour mergeColored. */
export function xform(x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _q.setFromEuler(_e.set(rx, ry, rz, 'YXZ'));
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
