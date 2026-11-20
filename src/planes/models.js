import * as THREE from 'three';
import { lerp, clamp } from '../util.js';
import { instrumentTexture } from './instruments.js';

// Repère avion : -Z vers l'avant, +X aile droite, +Y vers le haut. Origine près du centre de gravité.

const mats = new Map();
function M(color, opts) {
  const key = color + (opts ? JSON.stringify(opts) : '');
  if (!mats.has(key)) mats.set(key, new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts }));
  return mats.get(key);
}
const GLASS = 0x27455c, DARK = 0x23272d, METAL = 0xbfc4c9, TYRE = 0x1b1c1e;
const UP = new THREE.Vector3(0, 1, 0);

function box(w, h, d, color, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(color));
  m.position.set(x, y, z);
  return m;
}

/** Tronçon de fuselage le long de Z : rayon rf à l'avant (zf), rb à l'arrière (zb). */
function tube(rf, rb, zf, zb, color, o = {}) {
  const seg = o.seg || 8;
  const g = new THREE.CylinderGeometry(rf, rb, Math.abs(zb - zf), seg, 1, false, Math.PI / seg);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, o.mat || M(color));
  m.position.set(o.x || 0, o.y || 0, (zf + zb) / 2);
  m.scale.set(o.sx || 1, o.sy || 1, 1);
  return m;
}

/** Demi-aile trapézoïdale (de l'emplanture x=0 au saumon x=span). sweep > 0 : flèche vers l'arrière. */
function wingGeo(span, cr, ct, th, sweep = 0, dih = 0, thTip = 0.5, cut = 0) {
  const g = new THREE.BoxGeometry(span, th, cr);
  g.translate(span / 2, 0, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getX(i) / span, c = lerp(cr, ct, t);
    // cut : part de la corde retirée au bord de fuite (remplacée par les gouvernes mobiles)
    p.setZ(i, (p.getZ(i) > 0 ? c / 2 - cut * c : -c / 2) + sweep * t);
    p.setY(i, p.getY(i) * lerp(1, thTip, t) + dih * t);
  }
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------
// Gouvernes mobiles. wp = [span, cr, ct, th, sweep, dih, thTip] (mêmes paramètres que wingGeo).
const _hq = new THREE.Quaternion(), _hv = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0);

/** Point du bord de fuite et de la charnière à la fraction t de l'envergure (repère de la demi-aile droite). */
function tePoint(wp, t, cut) {
  const [span, cr, ct, th, sweep = 0, dih = 0, thTip = 0.5] = wp;
  const c = lerp(cr, ct, t);
  return { x: span * t, y: dih * t, te: c / 2 + sweep * t, hinge: c / 2 + sweep * t - cut * c, th: th * lerp(1, thTip, t) };
}

/**
 * Une gouverne entre les fractions t0 et t1 de l'envergure, articulée sur sa charnière.
 * side = 1 (droite) ou -1 (gauche, symétrique). Renvoie le groupe qui pivote (rotation.x).
 */
function surface(parent, wp, color, ox, oy, oz, t0, t1, cut, side) {
  const a = tePoint(wp, t0, cut), b = tePoint(wp, t1, cut);
  // les deux extrémités, toujours ordonnées vers +X pour que la rotation ait le même sens des deux côtés
  let e = [a, b].map((p) => ({ ...p, x: side * (ox + p.x) }));
  if (side < 0) e = [e[1], e[0]];
  const h0 = new THREE.Vector3(e[0].x, oy + e[0].y, oz + e[0].hinge), h1 = new THREE.Vector3(e[1].x, oy + e[1].y, oz + e[1].hinge);
  const mid = h0.clone().add(h1).multiplyScalar(0.5);
  const pivot = new THREE.Group();
  pivot.position.copy(mid);
  pivot.quaternion.setFromUnitVectors(_X, _hv.subVectors(h1, h0).normalize());
  _hq.copy(pivot.quaternion).invert();
  const geo = new THREE.BoxGeometry(1, 1, 1), pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const end = e[pos.getX(i) > 0 ? 1 : 0], back = pos.getZ(i) > 0, up = pos.getY(i) > 0 ? 1 : -1;
    const z = oz + (back ? end.te : end.hinge), half = end.th * (back ? 0.12 : 0.48);
    _hv.set(end.x, oy + end.y + up * half, z).sub(mid).applyQuaternion(_hq);
    pos.setXYZ(i, _hv.x, _hv.y, _hv.z);
  }
  geo.computeVertexNormals();
  const flap = new THREE.Group();
  flap.add(new THREE.Mesh(geo, M(color)));
  pivot.add(flap);
  parent.add(pivot);
  return flap;
}

/**
 * Aile (paire) avec ses gouvernes. surfs : [{ kind: 'aileron' | 'flap' | 'elevator', t0, t1 }], cut : corde des gouvernes.
 */
function wingS(m, parent, wp, color, x, y, z, surfs, cut = 0.25, sc = color) {
  const [span, cr, ct, th, sweep, dih, thTip] = wp;
  pair(parent, wingGeo(span, cr, ct, th, sweep, dih, thTip, cut), color, x, y, z);
  for (const sf of surfs) {
    for (const side of [1, -1]) {
      m.surfaces.push({ node: surface(parent, wp, sc, x, y, z, sf.t0, sf.t1, cut, side), kind: sf.kind, side });
    }
  }
}

/** Dérive avec sa gouverne de direction. */
function finS(m, parent, wp, color, x, y, z, cant = 0, cut = 0.35, t0 = 0.08, t1 = 0.95) {
  const [span, cr, ct, th, sweep, dih, thTip] = wp;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.z = Math.PI / 2 - cant;
  g.add(new THREE.Mesh(wingGeo(span, cr, ct, th, sweep, dih, thTip, cut), M(color)));
  parent.add(g);
  m.surfaces.push({ node: surface(g, wp, color, 0, 0, 0, t0, t1, cut, 1), kind: 'rudder', side: 1 });
}

function pair(parent, geo, color, x, y, z) {
  const r = new THREE.Mesh(geo, M(color)); r.position.set(x, y, z);
  const l = new THREE.Mesh(geo, M(color)); l.position.set(-x, y, z); l.scale.x = -1;
  parent.add(r, l);
}

function fin(parent, geo, color, x, y, z, cant = 0) {
  const m = new THREE.Mesh(geo, M(color));
  m.position.set(x, y, z);
  m.rotation.z = Math.PI / 2 - cant;
  parent.add(m);
}

function bar(parent, a, b, t, color) {
  const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, va.distanceTo(vb), t), M(color));
  m.position.copy(va).add(vb).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(UP, vb.clone().sub(va).normalize());
  parent.add(m);
}
/** Barre + sa symétrique. */
function bar2(parent, a, b, t, color) {
  bar(parent, a, b, t, color);
  bar(parent, [-a[0], a[1], a[2]], [-b[0], b[1], b[2]], t, color);
}

function wheel(parent, r, w, x, y, z) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 10), M(TYRE));
  m.rotation.z = Math.PI / 2;
  m.position.set(x, y, z);
  parent.add(m);
}

function blob(r, color, x, y, z, sx, sy, sz) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), M(color));
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  return m;
}

function makeProp(parent, r, n, x, y, z, color = 0x26282b) {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  const blades = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const geo = new THREE.BoxGeometry(r * 0.15, r, 0.05);
    geo.translate(0, r / 2, 0);
    const b = new THREE.Mesh(geo, M(color));
    b.rotation.z = (k / n) * Math.PI * 2;
    blades.add(b);
  }
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(r, 20),
    new THREE.MeshBasicMaterial({ color: 0xd5dbe0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }),
  );
  disc.userData.noShadow = true;
  g.add(blades, disc);
  parent.add(g);
  return { blades, disc };
}

/** Intérieur vu depuis les yeux du pilote : planche de bord, capot, montants. */
function makeCockpit(eye, o) {
  const [ex, ey, ez] = eye, w = o.w, g = new THREE.Group();
  const pw = Math.min(w * 0.95, 0.86), ph = pw / 3.2;
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: instrumentTexture }));
  panel.position.set(ex, ey - 0.22 - ph / 2, ez - 0.7);
  g.add(panel);
  g.add(box(w * 1.14, ph + 0.4, 0.05, DARK, ex, ey - 0.4 - ph / 2, ez - 0.725));
  g.add(box(w * 1.16, 0.05, 0.24, DARK, ex, ey - 0.2, ez - 0.8));
  if (o.nose) {
    const nz = ez - 0.9 - o.nose.len / 2;
    g.add(box(o.nose.w, 0.4, o.nose.len, o.nose.color, ex, ey - 0.25 - 0.2 - (o.nose.drop || 0), nz));
  }
  for (const s of [-1, 1]) g.add(box(0.07, 0.5, 1.6, DARK, ex + s * (w / 2 + 0.04), ey - 0.47, ez - 0.1));
  if (o.frame) {
    const a = [w / 2 + 0.02, ey - 0.2, ez - 0.86], b = [w * 0.43, ey + 0.44, ez - 0.3];
    bar2(g, a, b, 0.05, DARK);
    bar(g, [-b[0], b[1], b[2]], b, 0.05, DARK);
    bar2(g, b, [b[0], b[1], ez + 0.7], 0.05, DARK);
    if (w > 1.6) bar(g, [0, ey - 0.2, ez - 0.86], [0, b[1], b[2]], 0.05, DARK);
  } else {
    // simple pare-brise de cockpit ouvert
    bar2(g, [w / 2 - 0.02, ey - 0.2, ez - 0.84], [w * 0.36, ey + 0.08, ez - 0.74], 0.03, METAL);
    bar(g, [-w * 0.36, ey + 0.08, ez - 0.74], [w * 0.36, ey + 0.08, ez - 0.74], 0.03, METAL);
  }
  g.traverse((m) => { m.userData.noShadow = true; });
  g.visible = false;
  return g;
}

function base() {
  const root = new THREE.Group(), hull = new THREE.Group(), always = new THREE.Group();
  root.add(hull, always);
  return { root, hull, always, props: [], flames: [], gear: null, tips: [], surfaces: [] };
}

// ---------------------------------------------------------------------------
function tourisme(spec) {
  const m = base(), { hull, always } = m;
  const W = 0xf4f1ea, R = 0xd8432f;
  hull.add(tube(0.05, 0.22, -3.72, -3.36, R));
  hull.add(tube(0.44, 0.6, -3.36, -2.3, W, { sy: 0.96 }));
  hull.add(tube(0.6, 0.64, -2.3, 0.3, W, { sy: 1.1 }));
  hull.add(tube(0.64, 0.15, 0.3, 4.4, W, { y: 0.12 }));
  hull.add(box(1.1, 0.5, 1.9, GLASS, 0, 0.5, -1.15));
  hull.add(box(1.3, 0.13, 2.7, R, 0, -0.02, -1.0));
  wingS(m, hull, [1.75, 1.0, 0.62, 0.08, 0.22], W, 0.08, 0.3, 3.95, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  finS(m, hull, [1.55, 1.35, 0.6, 0.09, 0.75], R, 0, 0.3, 3.7, 0, 0.4);
  bar(hull, [0, -0.45, -2.5], [0, -1.1, -2.62], 0.07, METAL);
  wheel(hull, 0.24, 0.14, 0, -1.12, -2.62);
  bar2(hull, [0.45, -0.5, -0.35], [1.12, -1.05, -0.25], 0.09, W);
  wheel(hull, 0.27, 0.16, 1.2, -1.09, -0.25); wheel(hull, 0.27, 0.16, -1.2, -1.09, -0.25);

  wingS(m, always, [5.3, 1.6, 1.25, 0.17, 0.05, 0.14], W, 0.25, 0.86, -1.05,
    [{ kind: 'flap', t0: 0.02, t1: 0.5 }, { kind: 'aileron', t0: 0.53, t1: 0.97 }], 0.26);
  always.add(box(0.6, 0.17, 1.6, W, 0, 0.86, -1.05));
  always.add(box(0.24, 0.1, 1.25, R, 5.5, 1.0, -1.0), box(0.24, 0.1, 1.25, R, -5.5, 1.0, -1.0));
  bar2(always, [0.58, -0.25, -1.0], [2.5, 0.8, -1.0], 0.07, W);
  m.props.push(makeProp(always, 0.98, 2, 0, 0, -3.52));
  m.cockpit = makeCockpit(spec.eye, { w: 1.0, frame: true, nose: { w: 0.98, len: 1.9, color: W } });
  m.tips = [[5.6, 1.0, -0.8], [-5.6, 1.0, -0.8]];
  return m;
}

function biplan(spec) {
  const m = base(), { hull, always } = m;
  const R = 0xc93a2c, Y = 0xf2c230, K = 0x33373c;
  hull.add(tube(0.05, 0.18, -2.97, -2.75, METAL));
  hull.add(tube(0.5, 0.57, -2.75, -2.1, K));
  hull.add(tube(0.56, 0.52, -2.1, 0.3, R, { sy: 1.1 }));
  hull.add(tube(0.52, 0.12, 0.3, 3.45, R, { y: 0.06 }));
  const ws = box(0.62, 0.28, 0.05, GLASS, 0, 0.72, -0.8); ws.rotation.x = 0.45; hull.add(ws);
  hull.add(blob(0.17, 0x6b4a2f, 0, 0.8, -0.28, 1, 1, 1));
  wingS(m, hull, [1.35, 0.85, 0.55, 0.07, 0.15], Y, 0.05, 0.16, 3.05, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.42);
  finS(m, hull, [1.15, 1.05, 0.5, 0.07, 0.5], Y, 0, 0.2, 2.85, 0, 0.42);
  bar2(hull, [0.35, -0.45, -1.55], [0.9, -1.12, -1.62], 0.08, K);
  bar(hull, [-0.95, -1.14, -1.62], [0.95, -1.14, -1.62], 0.06, K);
  wheel(hull, 0.32, 0.14, 1.0, -1.14, -1.62); wheel(hull, 0.32, 0.14, -1.0, -1.14, -1.62);
  bar(hull, [0, -0.1, 3.0], [0, -0.5, 3.3], 0.06, K);

  wingS(m, always, [3.55, 1.2, 1.05, 0.12, 0, 0.12], Y, 0.3, -0.32, -0.85, [{ kind: 'aileron', t0: 0.4, t1: 0.97 }], 0.25);
  always.add(box(0.7, 0.12, 1.2, Y, 0, -0.32, -0.85));
  wingS(m, always, [3.9, 1.25, 1.1, 0.12, 0, 0.05], Y, 0, 1.28, -1.3, [{ kind: 'aileron', t0: 0.4, t1: 0.97 }], 0.25);
  bar2(always, [2.7, -0.2, -1.15], [2.7, 1.28, -1.6], 0.06, K);
  bar2(always, [2.7, -0.2, -0.55], [2.7, 1.28, -1.0], 0.06, K);
  bar2(always, [0.38, 0.5, -1.5], [0.34, 1.26, -1.6], 0.05, K);
  bar2(always, [0.38, 0.5, -0.95], [0.34, 1.26, -1.05], 0.05, K);
  m.props.push(makeProp(always, 0.98, 2, 0, 0, -2.9, 0x6b4a2b));
  m.cockpit = makeCockpit(spec.eye, { w: 0.74, frame: false, nose: { w: 0.9, len: 1.95, color: R, drop: 0.05 } });
  m.tips = [[3.9, 1.3, -1.1], [-3.9, 1.3, -1.1]];
  return m;
}

function hydravion(spec) {
  const m = base(), { hull, always } = m;
  const W = 0xf5f2ea, O = 0xf08a2c, F = 0xe2e8ec;
  hull.add(tube(0.05, 0.24, -4.0, -3.62, METAL));
  hull.add(tube(0.48, 0.66, -3.62, -2.5, O, { sy: 0.96 }));
  hull.add(tube(0.66, 0.7, -2.5, 0.8, W, { sy: 1.12 }));
  hull.add(tube(0.7, 0.17, 0.8, 5.0, W, { y: 0.13 }));
  hull.add(box(1.22, 0.52, 2.4, GLASS, 0, 0.55, -1.2));
  hull.add(box(1.42, 0.13, 3.1, O, 0, 0, -0.9));
  wingS(m, hull, [2.0, 1.1, 0.7, 0.09, 0.25], W, 0.08, 0.35, 4.5, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  finS(m, hull, [1.8, 1.5, 0.7, 0.1, 0.85], O, 0, 0.35, 4.2, 0, 0.4);
  for (const s of [-1, 1]) {
    const o = { x: s * 1.5, y: -1.58, sy: 0.8 };
    hull.add(tube(0.1, 0.44, -3.5, -2.5, F, o), tube(0.44, 0.44, -2.5, 0.9, F, o), tube(0.44, 0.12, 0.9, 2.6, F, o));
  }
  bar2(hull, [0.45, -0.5, -1.9], [1.5, -1.3, -1.9], 0.08, METAL);
  bar2(hull, [0.45, -0.5, 0.1], [1.5, -1.3, 0.1], 0.08, METAL);
  bar(hull, [-1.5, -1.3, -1.9], [1.5, -1.3, -1.9], 0.06, METAL);
  bar(hull, [-1.5, -1.3, 0.1], [1.5, -1.3, 0.1], 0.06, METAL);

  wingS(m, always, [6.05, 1.75, 1.3, 0.18, 0.05, 0.15], W, 0.25, 0.95, -1.05,
    [{ kind: 'flap', t0: 0.02, t1: 0.52 }, { kind: 'aileron', t0: 0.55, t1: 0.97 }], 0.26);
  always.add(box(0.6, 0.18, 1.75, W, 0, 0.95, -1.05));
  always.add(box(0.26, 0.1, 1.3, O, 6.25, 1.1, -1.0), box(0.26, 0.1, 1.3, O, -6.25, 1.1, -1.0));
  bar2(always, [0.64, -0.25, -1.0], [2.8, 0.88, -1.0], 0.07, W);
  m.props.push(makeProp(always, 1.1, 3, 0, 0, -3.8));
  m.cockpit = makeCockpit(spec.eye, { w: 1.1, frame: true, nose: { w: 1.05, len: 2.2, color: O } });
  m.tips = [[6.35, 1.1, -0.8], [-6.35, 1.1, -0.8]];
  return m;
}

function chasseur(spec) {
  const m = base(), { hull, always } = m;
  const G = 0x5f6f3f, Y = 0xf2c230, W = 0xf4f1ea;
  hull.add(tube(0.05, 0.34, -4.7, -4.05, Y));
  hull.add(tube(0.5, 0.64, -4.05, -1.6, G, { sy: 1.04 }));
  hull.add(tube(0.64, 0.62, -1.6, 0.7, G, { sy: 1.1 }));
  hull.add(tube(0.62, 0.14, 0.7, 4.6, G, { y: 0.1 }));
  hull.add(box(1.34, 0.1, 1.0, DARK, 0, 0.1, -3.0));
  hull.add(blob(0.5, GLASS, 0, 0.66, -0.35, 0.86, 0.82, 2.3));
  hull.add(tube(0.52, 0.475, 1.7, 2.05, W, { y: 0.1 }));
  wingS(m, hull, [1.95, 1.05, 0.6, 0.08, 0.28], G, 0.08, 0.25, 4.0, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  finS(m, hull, [1.6, 1.4, 0.6, 0.09, 0.7], G, 0, 0.3, 3.7, 0, 0.4);
  const gear = new THREE.Group();
  bar2(gear, [1.5, -0.35, -1.35], [1.5, -1.33, -1.45], 0.1, METAL);
  wheel(gear, 0.36, 0.2, 1.5, -1.34, -1.45); wheel(gear, 0.36, 0.2, -1.5, -1.34, -1.45);
  bar(gear, [0, -0.2, 4.0], [0, -0.5, 4.08], 0.06, METAL);
  wheel(gear, 0.15, 0.1, 0, -0.52, 4.08);
  hull.add(gear); m.gear = gear;

  wingS(m, always, [5.35, 2.3, 1.1, 0.22, 0.3, 0.55, 0.4], G, 0.25, -0.32, -1.15,
    [{ kind: 'flap', t0: 0.03, t1: 0.5 }, { kind: 'aileron', t0: 0.53, t1: 0.93 }], 0.24);
  always.add(box(0.6, 0.22, 2.3, G, 0, -0.32, -1.15));
  always.add(box(0.22, 0.1, 1.1, Y, 5.55, 0.24, -0.85), box(0.22, 0.1, 1.1, Y, -5.55, 0.24, -0.85));
  m.props.push(makeProp(always, 1.5, 3, 0, 0, -4.4));
  m.cockpit = makeCockpit(spec.eye, { w: 0.8, frame: true, nose: { w: 0.95, len: 3.3, color: G } });
  m.tips = [[5.65, 0.24, -0.6], [-5.65, 0.24, -0.6]];
  return m;
}

function jet(spec) {
  const m = base(), { hull, always } = m;
  const A = 0xaab3bc, D = 0x7d8791, N = 0x33383d;
  hull.add(tube(0.06, 0.62, -8.0, -5.0, D, { sy: 0.88 }));
  hull.add(tube(0.62, 0.9, -5.0, -2.2, A, { sy: 0.92 }));
  hull.add(tube(0.9, 0.95, -2.2, 5.4, A, { sx: 1.75, sy: 0.78 }));
  hull.add(tube(0.42, 0.3, -2.6, 3.2, A, { y: 0.55, sy: 0.7 }));
  hull.add(blob(0.5, GLASS, 0, 0.8, -3.7, 0.8, 0.75, 2.9));
  for (const s of [-1, 1]) {
    hull.add(box(0.8, 0.9, 1.7, D, s * 1.08, -0.05, -2.9));
    hull.add(box(0.68, 0.78, 0.06, N, s * 1.08, -0.05, -3.77));
    hull.add(tube(0.52, 0.44, 5.4, 6.5, N, { x: s * 0.62 }));
    const flame = tube(0.4, 0.04, 6.5, 9.4, 0, { x: s * 0.62, mat: new THREE.MeshBasicMaterial({ color: 0xffa53a, transparent: true, opacity: 0.85, depthWrite: false }) });
    flame.userData.noShadow = true;
    flame.userData.z0 = 6.5; flame.userData.len = 2.9;
    flame.visible = false;
    hull.add(flame); m.flames.push(flame);
  }
  finS(m, hull, [2.5, 2.6, 1.0, 0.1, 1.5], D, 1.05, 0.55, 3.5, 0.3, 0.3, 0.1, 0.85);
  finS(m, hull, [2.5, 2.6, 1.0, 0.1, 1.5], D, -1.05, 0.55, 3.5, -0.3, 0.3, 0.1, 0.85);
  wingS(m, hull, [2.4, 2.1, 0.8, 0.1, 1.3], A, 1.25, 0, 5.2, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.45);
  const gear = new THREE.Group();
  bar(gear, [0, -0.5, -4.7], [0, -1.82, -4.8], 0.1, METAL);
  wheel(gear, 0.26, 0.16, 0, -1.84, -4.8);
  bar2(gear, [1.2, -0.5, 0.9], [1.55, -1.72, 1.0], 0.12, METAL);
  wheel(gear, 0.36, 0.22, 1.6, -1.74, 1.0); wheel(gear, 0.36, 0.22, -1.6, -1.74, 1.0);
  hull.add(gear); m.gear = gear;

  wingS(m, always, [4.1, 4.8, 1.35, 0.17, 2.7, -0.12, 0.4], A, 1.3, 0.02, 0.9,
    [{ kind: 'flap', t0: 0.02, t1: 0.46 }, { kind: 'aileron', t0: 0.5, t1: 0.9 }], 0.22);
  m.cockpit = makeCockpit(spec.eye, { w: 0.8, frame: true, nose: { w: 0.9, len: 3.6, color: D, drop: 0.06 } });
  m.tips = [[5.4, -0.1, 3.9], [-5.4, -0.1, 3.9]];
  return m;
}

function cargo(spec) {
  const m = base(), { hull, always } = m;
  const W = 0xf2f2ee, B = 0x2f5fa8, G = 0x8d959d;
  hull.add(tube(0.75, 2.1, -15, -11.6, W, { y: -0.25, sy: 0.95 }));
  hull.add(tube(2.1, 2.1, -11.6, 6, W));
  hull.add(tube(2.1, 0.55, 6, 15, W, { y: 0.85 }));
  hull.add(box(2.9, 0.75, 1.5, GLASS, 0, 1.1, -12.3));
  hull.add(box(3.96, 0.4, 17.6, B, 0, 0.25, -2.8));
  finS(m, hull, [6.6, 5.6, 3.0, 0.45, 3.3], B, 0, 1.9, 10.4, 0, 0.32, 0.05, 0.9);
  wingS(m, hull, [6.6, 3.3, 1.8, 0.26, 1.3], W, 0, 8.45, 13.9, [{ kind: 'elevator', t0: 0.04, t1: 1 }], 0.38);
  hull.add(box(1.3, 1.3, 6.5, G, 2.25, -1.75, 0.6), box(1.3, 1.3, 6.5, G, -2.25, -1.75, 0.6));
  const gear = new THREE.Group();
  for (const s of [-1, 1]) {
    wheel(gear, 0.62, 0.5, s * 2.45, -2.93, -0.4); wheel(gear, 0.62, 0.5, s * 2.45, -2.93, 1.6);
    bar(gear, [s * 2.45, -1.9, 0.6], [s * 2.45, -2.9, 0.6], 0.25, METAL);
    wheel(gear, 0.52, 0.3, s * 0.32, -3.03, -10.9);
  }
  bar(gear, [0, -1.5, -10.8], [0, -3.0, -10.9], 0.2, METAL);
  hull.add(gear); m.gear = gear;

  wingS(m, always, [19.2, 5.4, 2.4, 0.6, 1.3, -0.9, 0.45], W, 0.8, 2.35, -1.6,
    [{ kind: 'flap', t0: 0.02, t1: 0.6 }, { kind: 'aileron', t0: 0.63, t1: 0.96 }], 0.22);
  always.add(box(1.7, 0.6, 5.4, W, 0, 2.35, -1.6));
  for (const x of [-12.4, -6.2, 6.2, 12.4]) {
    const t = (Math.abs(x) - 0.8) / 19.2, y = 2.35 - 0.9 * t - 0.5, zc = -1.6 + 1.3 * t;
    always.add(tube(0.5, 0.8, zc - 4.6, zc - 0.2, G, { x, y }));
    always.add(tube(0.05, 0.3, zc - 5.1, zc - 4.6, DARK, { x, y }));
    m.props.push(makeProp(always, 2.05, 4, x, y, zc - 4.85));
  }
  m.cockpit = makeCockpit(spec.eye, { w: 2.3, frame: true, nose: { w: 2.3, len: 1.9, color: W, drop: 0.1 } });
  m.tips = [[20, 1.45, -0.2], [-20, 1.45, -0.2]];
  return m;
}

const BUILDERS = { tourisme, biplan, hydravion, chasseur, jet, cargo };
const cache = new Map();

/** Construit (une seule fois) le modèle 3D d'un avion. */
export function getModel(spec) {
  if (cache.has(spec.id)) return cache.get(spec.id);
  const m = BUILDERS[spec.id](spec);
  m.root.add(m.cockpit);
  m.root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.castShadow = true; });
  cache.set(spec.id, m);
  return m;
}

/** Hélices, train, flammes ; cockpitView : vue intérieure (on masque le fuselage). */
const DEF = { aileron: 0.36, elevator: 0.4, rudder: 0.42, flap: [0, 0.3, 0.65] };
export function animateModel(m, dt, { throttle, gear, burner, cockpitView, ctrl, flaps = 0 }) {
  // gouvernes : angle positif = bord de fuite vers le bas (ou vers la droite pour la direction)
  if (ctrl) {
    const fl = flaps <= 1 ? DEF.flap[1] * flaps : lerp(DEF.flap[1], DEF.flap[2], flaps - 1);
    for (const s of m.surfaces) {
      let a = 0;
      if (s.kind === 'aileron') a = -s.side * ctrl.roll * DEF.aileron;  // roulis à droite : aileron droit levé
      else if (s.kind === 'elevator') a = -ctrl.pitch * DEF.elevator;  // cabrer : profondeur levée
      else if (s.kind === 'rudder') a = ctrl.yaw * DEF.rudder;
      else if (s.kind === 'flap') a = fl;
      s.node.rotation.x = -a;
    }
  }
  const rpm = 0.22 + 0.78 * throttle;
  for (const p of m.props) {
    p.blades.rotation.z -= (9 + rpm * 38) * dt;
    p.blades.visible = rpm < 0.42;
    p.disc.material.opacity = 0.05 + 0.15 * clamp((rpm - 0.3) / 0.4, 0, 1);
  }
  if (m.gear) {
    m.gear.visible = gear > 0.03;
    m.gear.scale.y = Math.max(0.03, gear);
  }
  for (const f of m.flames) {
    f.visible = burner > 0.01;
    f.scale.z = 0.55 + burner * (0.75 + Math.random() * 0.35);
    f.position.z = f.userData.z0 + (f.userData.len * f.scale.z) / 2;
  }
  m.hull.visible = !cockpitView;
  m.cockpit.visible = cockpitView;
}
