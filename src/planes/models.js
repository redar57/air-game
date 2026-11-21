import * as THREE from 'three';
import { lerp, clamp } from '../util.js';
import { instrumentTexture } from './instruments.js';
import { newMissileMesh } from '../weapons.js';

// Repère avion : -Z vers l'avant, +X aile droite, +Y vers le haut. Origine près du centre de gravité.

const mats = new Map();
let PAINT = null; // livrée en cours de construction : couleur d'origine -> nouvelle couleur
function M(color, opts) {
  if (PAINT && PAINT.has(color)) color = PAINT.get(color);
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
  // roues d'amphibie : elles sortent sous les flotteurs (et y rentrent en glissant vers le haut)
  const gear = new THREE.Group();
  for (const s of [-1, 1]) {
    wheel(gear, 0.2, 0.14, s * 1.5, -2.15, -2.4);
    wheel(gear, 0.27, 0.18, s * 1.5, -2.08, 0.45);
    bar(gear, [s * 1.5, -1.75, -2.4], [s * 1.5, -2.15, -2.4], 0.07, METAL);
    bar(gear, [s * 1.5, -1.75, 0.45], [s * 1.5, -2.08, 0.45], 0.08, METAL);
  }
  hull.add(gear); m.gear = gear; m.gearSlide = 0.55;

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

/** Bombardier d'eau amphibie : coque de bateau, aile haute, deux turbopropulseurs, empennage en T. */
function canadair(spec) {
  const m = base(), { hull, always } = m;
  const Y = 0xf2c230, R = 0xd8352a, W = 0xf4f1ea;
  // coque : nez arrondi, fond en V (bande rouge), queue relevée
  hull.add(tube(0.35, 1.25, -9.9, -8.2, Y, { y: -0.15, sy: 1.05 }));
  hull.add(tube(1.25, 1.4, -8.2, -5.5, Y, { sy: 1.12 }));
  hull.add(tube(1.4, 1.4, -5.5, 2.5, Y, { sy: 1.15 }));
  hull.add(tube(1.4, 0.45, 2.5, 9.9, Y, { y: 0.6, sy: 1.05 }));
  hull.add(box(2.1, 0.55, 12.5, R, 0, -1.35, -2.4));                  // carène
  const keel = box(1.1, 0.4, 4.6, R, 0, -1.05, 4.6); keel.rotation.x = -0.12; hull.add(keel); // redan arrière
  hull.add(box(2.85, 0.16, 15.5, W, 0, 0.15, -1.6));                  // liseré
  hull.add(box(2.0, 0.55, 1.4, GLASS, 0, 1.05, -7.6));                // pare-brise
  hull.add(box(2.62, 0.38, 2.6, GLASS, 0, 0.9, -6.2));
  hull.add(box(0.5, 0.95, 2.6, R, 0, 1.55, -2.2));                     // carénage d'aile
  // trappes de largage sous la soute
  hull.add(box(1.5, 0.08, 3.2, DARK, 0, -1.63, -1.4));
  // empennage en T
  finS(m, hull, [4.4, 3.6, 2.1, 0.3, 1.8], Y, 0, 1.1, 7.6, 0, 0.36, 0.06, 0.92);
  wingS(m, hull, [4.6, 2.2, 1.3, 0.2, 0.7], Y, 0, 5.45, 9.3, [{ kind: 'elevator', t0: 0.03, t1: 1 }], 0.38);
  hull.add(box(0.7, 0.4, 2.4, R, 0, 5.45, 9.3));
  // train : roues principales sur les flancs, roulette de nez ; rentrent dans la coque
  const gear = new THREE.Group();
  for (const s of [-1, 1]) {
    wheel(gear, 0.48, 0.34, s * 1.75, -2.77, 0.6);
    bar(gear, [s * 1.45, -1.0, 0.6], [s * 1.75, -2.75, 0.6], 0.2, METAL);
  }
  wheel(gear, 0.36, 0.26, 0, -2.89, -7.0);
  bar(gear, [0, -1.2, -7.0], [0, -2.85, -7.0], 0.15, METAL);
  hull.add(gear); m.gear = gear; m.gearSlide = 1.5;

  // aile haute avec moteurs et flotteurs de bout d'aile
  wingS(m, always, [13.4, 3.4, 2.1, 0.42, 0.35, 0.1, 0.6], Y, 0.85, 1.95, -2.2,
    [{ kind: 'flap', t0: 0.03, t1: 0.55 }, { kind: 'aileron', t0: 0.58, t1: 0.96 }], 0.25);
  always.add(box(1.8, 0.5, 3.4, Y, 0, 1.95, -2.2));
  for (const s of [-1, 1]) {
    const x = s * 4.6;
    always.add(tube(0.55, 0.75, -5.6, -2.9, W, { x, y: 1.75 }), tube(0.75, 0.3, -2.9, 0.6, W, { x, y: 1.75 }));
    always.add(tube(0.08, 0.32, -6.2, -5.6, DARK, { x, y: 1.75 }));
    m.props.push(makeProp(always, 2.0, 4, x, 1.75, -5.95));
    const fx = s * 11.4;
    always.add(tube(0.1, 0.38, -2.2, -1.2, R, { x: fx, y: -0.25 }), tube(0.38, 0.12, -1.2, 1.0, R, { x: fx, y: -0.25 }));
    bar(always, [fx, 0.05, -1.4], [fx, 1.9, -1.6], 0.12, METAL);
    always.add(box(0.3, 0.1, 2.3, R, s * 14.3, 2.08, -1.9));
  }
  m.cockpit = makeCockpit(spec.eye, { w: 1.6, frame: true, nose: { w: 2.1, len: 2.2, color: Y, drop: 0.15 } });
  m.tips = [[14.4, 2.1, -1.6], [-14.4, 2.1, -1.6]];
  return m;
}

function chasseur(spec) {
  // façon chasseur embarqué à aile en W inversé : énorme moteur en étoile, long capot, cockpit reculé
  const m = base(), { hull, always } = m;
  const B = 0x22395a, W = 0xf4f1ea, Y = 0xf2c230;
  hull.add(tube(0.05, 0.32, -5.4, -4.98, DARK));                               // cône d'hélice
  hull.add(tube(0.8, 0.8, -4.98, -4.9, DARK, { seg: 14 }));                    // face du moteur
  hull.add(tube(0.82, 0.8, -4.9, -4.2, B, { seg: 14 }));                       // capot rond
  hull.add(tube(0.8, 0.74, -4.2, -0.9, B, { seg: 12 }));                       // long nez
  hull.add(tube(0.74, 0.66, -0.9, 1.3, B, { seg: 12, sy: 1.05 }));
  hull.add(tube(0.66, 0.13, 1.3, 5.3, B, { y: 0.14 }));
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) hull.add(box(0.12, 0.12, 0.45, DARK, s * 0.72, -0.15 - k * 0.2, -3.95)); // échappements
  hull.add(blob(0.5, GLASS, 0, 0.66, 0.15, 0.84, 0.82, 2.1));                  // verrière
  bar(hull, [0, 1.06, -0.4], [0, 1.06, 0.75], 0.05, B);
  hull.add(box(0.9, 0.1, 0.5, B, 0, 0.62, 1.25));                              // dos derrière la verrière
  hull.add(tube(0.6, 0.55, 2.4, 2.75, W, { y: 0.1, seg: 12 }));                // bande claire
  wingS(m, hull, [2.3, 1.2, 0.72, 0.08, 0.25], B, 0.08, 0.3, 4.5, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  finS(m, hull, [1.8, 1.65, 0.8, 0.09, 0.62], B, 0, 0.35, 4.25, 0, 0.4);
  // train : jambes courtes au coude de l'aile, roulette de queue
  const gear = new THREE.Group();
  for (const s of [-1, 1]) {
    bar(gear, [s * 2.75, -1.05, -1.25], [s * 2.75, -1.32, -1.45], 0.12, METAL);
    gear.add(box(0.06, 0.55, 0.75, B, s * 2.62, -1.25, -1.4));                  // trappe
    wheel(gear, 0.4, 0.2, s * 2.85, -1.3, -1.45);
  }
  bar(gear, [0, -0.15, 4.6], [0, -0.55, 4.75], 0.06, METAL);
  wheel(gear, 0.16, 0.1, 0, -0.57, 4.75);
  hull.add(gear); m.gear = gear;

  // aile en W inversé : tronçon intérieur qui plonge, tronçon extérieur qui remonte
  wingS(m, always, [2.3, 2.5, 2.25, 0.3, 0.06, -0.85, 0.9], B, 0.55, -0.3, -1.0, [{ kind: 'flap', t0: 0.05, t1: 0.95 }], 0.24);
  wingS(m, always, [3.4, 2.25, 1.05, 0.26, 0.42, 0.85, 0.45], B, 2.85, -1.15, -0.94,
    [{ kind: 'flap', t0: 0.02, t1: 0.35 }, { kind: 'aileron', t0: 0.4, t1: 0.95 }], 0.24);
  always.add(box(1.2, 0.3, 2.5, B, 0, -0.3, -1.0));
  for (const s of [-1, 1]) {
    always.add(box(1.3, 0.14, 0.18, DARK, s * 1.55, -0.68, -2.2));             // entrées d'air au bord d'attaque
    always.add(box(0.26, 0.12, 1.0, Y, s * 6.15, -0.3, -0.62));                // saumons
  }
  m.props.push(makeProp(always, 1.6, 3, 0, 0, -5.1));
  m.cockpit = makeCockpit(spec.eye, { w: 0.8, frame: true, nose: { w: 1.2, len: 4.6, color: B } });
  m.tips = [[6.25, -0.3, -0.5], [-6.25, -0.3, -0.5]];
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
  // missiles sur leurs rails (toujours là : ils sont illimités)
  for (const p of spec.missiles || []) { const ms = newMissileMesh(); ms.position.set(...p); always.add(ms); }
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

/** Rotor d'hélicoptère : n pales fines + disque flou ; rot = orientation du moyeu (Euler). */
function rotorAt(m, parent, r, n, chord, x, y, z, rot, color = 0x2b2d31) {
  const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.set(rot[0], rot[1], rot[2]);
  const blades = new THREE.Group();
  for (let k = 0; k < n; k++) {
    const geo = new THREE.BoxGeometry(chord, r, 0.05); geo.translate(0, r / 2, 0);
    const b = new THREE.Mesh(geo, M(color)); b.rotation.z = (k / n) * Math.PI * 2; blades.add(b);
  }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 28),
    new THREE.MeshBasicMaterial({ color: 0xd5dbe0, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
  disc.userData.noShadow = true;
  g.add(blades, disc); parent.add(g);
  m.props.push({ blades, disc });
}
const ROTOR_UP = [-Math.PI / 2, 0, 0], ROTOR_SIDE = [0, Math.PI / 2, 0];

// Hélicoptère bombardier d'eau : design original (rouge et blanc, nez rond, queue rayée, patins).
function helico(spec) {
  const m = base(), { hull, always } = m;
  const R = 0xd8352a, W = 0xf3f1ec, K = 0x2a2e33;
  // cabine : un gros œuf rouge sur un ventre blanc, nez arrondi
  hull.add(blob(1.5, R, 0, 0.35, -0.9, 1.0, 1.0, 1.75));
  hull.add(blob(1.48, W, 0, -0.15, -0.95, 1.02, 0.78, 1.72));
  hull.add(blob(1.0, GLASS, 0, 0.62, -2.72, 1.18, 0.6, 0.9));     // grand pare-brise bombé
  for (const s of [-1, 1]) {
    hull.add(box(0.05, 0.5, 0.75, GLASS, s * 1.47, 0.55, -0.55));  // hublots
    hull.add(box(0.05, 0.5, 0.6, GLASS, s * 1.4, 0.55, 0.45));
    hull.add(box(0.06, 0.08, 3.2, W, s * 1.5, 0.95, -0.4));        // liseré blanc
    hull.add(box(0.45, 0.32, 2.3, R, s * 1.42, -0.85, 0.1));        // réservoirs latéraux
  }
  // bosse moteur, entrées d'air, mât
  hull.add(blob(0.95, R, 0, 1.55, 0.1, 0.95, 0.62, 1.9));
  for (const s of [-1, 1]) hull.add(box(0.06, 0.28, 0.6, K, s * 0.86, 1.62, -0.55));
  always.add(tube(0.16, 0.16, -0.1, 0.1, METAL, { y: 2.05 }));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 0.7, 8), M(METAL));
  mast.position.set(0, 2.0, -0.05); always.add(mast);
  always.add(blob(0.32, R, 0, 2.38, -0.05, 1, 0.55, 1));
  // poutre de queue, stabilisateur, dérive rayée rouge et blanc
  hull.add(tube(0.78, 0.26, 1.0, 7.6, R, { y: 0.75 }));
  hull.add(box(2.8, 0.09, 0.7, R, 0, 0.82, 6.2));
  for (let k = 0; k < 6; k++) hull.add(box(0.14, 0.38, 0.62 - k * 0.04, k % 2 ? W : R, 0, 1.05 + k * 0.38, 7.55 + k * 0.05));
  hull.add(box(0.12, 0.7, 0.5, R, 0, 0.45, 7.45));                 // petite dérive basse
  // patins
  for (const s of [-1, 1]) {
    hull.add(tube(0.07, 0.07, -2.3, 1.7, METAL, { x: s * 1.25, y: -1.59 }));
    bar(hull, [s * 1.25, -1.59, -2.3], [s * 1.25, -1.3, -2.78], 0.14, METAL); // bout relevé
    bar(hull, [s * 0.75, -0.9, -1.4], [s * 1.25, -1.59, -1.4], 0.08, METAL);
    bar(hull, [s * 0.75, -0.9, 0.9], [s * 1.25, -1.59, 0.9], 0.08, METAL);
  }
  // rotor principal (4 pales fines) et rotor de queue
  rotorAt(m, always, 6.2, 4, 0.38, 0, 2.48, -0.05, ROTOR_UP);
  rotorAt(m, always, 1.05, 2, 0.2, -0.32, 2.75, 7.75, ROTOR_SIDE);
  m.cockpit = makeCockpit(spec.eye, { w: 1.55, frame: true, nose: { w: 1.5, len: 0.8, color: R, drop: 0.35 } });
  m.tips = [[6.1, 2.48, 0], [-6.1, 2.48, 0]];
  return m;
}

// Petit hélicoptère à bulle (jaune et noir)
function libellule(spec) {
  const m = base(), { hull, always } = m;
  const Y = 0xf2c230, K = 0x26292d;
  hull.add(blob(1.0, GLASS, 0, 0.32, -0.55, 0.95, 0.95, 1.15));   // bulle
  hull.add(blob(0.98, Y, 0, -0.12, -0.2, 0.97, 0.7, 1.15));
  hull.add(box(0.9, 0.75, 1.3, K, 0, 0.32, 0.85));                  // moteur
  hull.add(box(0.6, 0.12, 1.4, Y, 0, 0.75, 0.8));
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), M(METAL));
  mast.position.set(0, 1.05, 0.35); always.add(mast);
  hull.add(tube(0.16, 0.07, 1.4, 5.7, Y, { y: 0.48 }));            // poutre
  hull.add(box(1.4, 0.05, 0.35, K, 0, 0.5, 5.1));
  hull.add(box(0.06, 0.75, 0.5, K, 0, 0.72, 5.55));
  for (const s of [-1, 1]) {
    hull.add(tube(0.05, 0.05, -1.5, 1.2, METAL, { x: s * 0.82, y: -1.0 }));
    bar(hull, [s * 0.82, -1.0, -1.5], [s * 0.82, -0.82, -1.85], 0.1, METAL);
    bar(hull, [s * 0.45, -0.55, -0.7], [s * 0.82, -1.0, -0.7], 0.06, METAL);
    bar(hull, [s * 0.45, -0.55, 0.65], [s * 0.82, -1.0, 0.65], 0.06, METAL);
  }
  rotorAt(m, always, 4.2, 2, 0.24, 0, 1.38, 0.35, ROTOR_UP);
  rotorAt(m, always, 0.62, 2, 0.12, -0.12, 0.95, 5.75, ROTOR_SIDE);
  m.cockpit = makeCockpit(spec.eye, { w: 1.2, frame: false, nose: { w: 1.0, len: 0.4, color: Y, drop: 0.4 } });
  m.tips = [[4.1, 1.38, 0.35], [-4.1, 1.38, 0.35]];
  return m;
}

// Hélicoptère de transport à rotors en tandem (kaki)
function birotor(spec) {
  const m = base(), { hull, always } = m;
  const O = 0x6b7448, D = 0x4d5434, W = 0xe9e4d4;
  hull.add(box(2.9, 2.7, 15.5, O, 0, 0, 0));
  hull.add(blob(1.45, O, 0, -0.05, -7.75, 1.0, 0.93, 0.85));
  hull.add(blob(1.0, GLASS, 0, 0.55, -8.25, 1.2, 0.55, 0.65));
  hull.add(box(2.95, 0.12, 15.6, W, 0, -0.45, 0));                  // bande claire
  for (let k = 0; k < 5; k++) for (const s of [-1, 1]) hull.add(box(0.05, 0.5, 0.6, GLASS, s * 1.46, 0.45, -5 + k * 2.2));
  hull.add(box(1.5, 1.1, 2.6, O, 0, 1.75, -6.4));                    // pylône avant
  hull.add(box(1.8, 2.6, 4.2, O, 0, 2.3, 6.2));                      // pylône arrière
  for (const s of [-1, 1]) {
    hull.add(box(0.7, 0.9, 5.5, D, s * 1.75, -0.6, 0.5));            // carénages de train
    wheel(hull, 0.45, 0.35, s * 1.75, -1.75, -0.6); wheel(hull, 0.45, 0.35, s * 1.75, -1.75, 1.6);
    wheel(hull, 0.4, 0.3, s * 0.9, -1.8, -6.3);
    bar(hull, [s * 0.9, -1.3, -6.3], [s * 0.9, -1.8, -6.3], 0.15, METAL);
  }
  for (const z of [-6.4, 6.3]) {
    const y = z < 0 ? 2.45 : 3.75;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 0.6, 8), M(METAL));
    mast.position.set(0, y - 0.25, z); always.add(mast);
    rotorAt(m, always, 9, 3, 0.55, 0, y, z, ROTOR_UP);
  }
  m.cockpit = makeCockpit(spec.eye, { w: 2.2, frame: true, nose: { w: 2.2, len: 0.9, color: O, drop: 0.3 } });
  m.tips = [[0, 2.45, -15.4], [0, 3.75, 15.3]];
  return m;
}

// Avion de course (rouge et blanc)
function racer(spec) {
  const m = base(), { hull, always } = m;
  const R = 0xd62f2f, W = 0xf5f3ee, K = 0x2a2d31;
  hull.add(tube(0.05, 0.24, -3.45, -3.12, W));                       // cône d'hélice
  hull.add(tube(0.36, 0.5, -3.12, -1.6, R, { sy: 1.05 }));
  hull.add(tube(0.5, 0.45, -1.6, 0.6, R, { sy: 1.15 }));
  hull.add(tube(0.45, 0.1, 0.6, 3.9, R, { y: 0.06 }));
  hull.add(tube(0.51, 0.47, -1.0, -0.2, W, { sy: 1.16 }));           // bande blanche
  hull.add(blob(0.38, GLASS, 0, 0.5, -0.05, 0.8, 0.75, 1.8));        // verrière
  hull.add(box(0.12, 0.28, 1.6, R, 0, 0.42, 1.2));                   // dos
  wingS(m, hull, [1.25, 0.75, 0.45, 0.06, 0.18], R, 0.06, 0.1, 3.5, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.42);
  finS(m, hull, [1.1, 1.0, 0.45, 0.07, 0.6], W, 0, 0.18, 3.3, 0, 0.42);
  for (const s of [-1, 1]) {
    bar(hull, [s * 0.4, -0.35, -1.3], [s * 0.85, -0.95, -1.35], 0.07, K);
    hull.add(blob(0.36, W, s * 0.88, -0.95, -1.35, 0.45, 0.6, 1.3)); // carénage de roue
    wheel(hull, 0.3, 0.12, s * 0.88, -0.97, -1.35);
  }
  wheel(hull, 0.12, 0.06, 0, -0.22, 3.6);
  wingS(m, always, [3.3, 1.45, 0.8, 0.13, 0.12, 0.18], W, 0.3, -0.38, -0.85,
    [{ kind: 'aileron', t0: 0.45, t1: 0.95 }], 0.26, R);
  m.props.push(makeProp(always, 0.95, 3, 0, 0, -3.2));
  m.cockpit = makeCockpit(spec.eye, { w: 0.62, frame: true, nose: { w: 0.85, len: 2.6, color: R, drop: 0.05 } });
  m.tips = [[3.6, -0.2, -0.6], [-3.6, -0.2, -0.6]];
  return m;
}

// Épandeur : avion agricole à aile basse, grosse trémie devant un cockpit perché, rampe d'épandage
function epandeur(spec) {
  const m = base(), { hull, always } = m;
  const Y = 0xf2c230, G = 0x2f7a3a, W = 0xf4f1ea;
  hull.add(tube(0.05, 0.26, -4.25, -3.95, W));                       // cône d'hélice
  hull.add(tube(0.56, 0.64, -3.95, -2.95, G, { seg: 9 }));           // capot du moteur en étoile
  hull.add(tube(0.64, 0.62, -2.95, -0.4, Y, { sy: 1.1 }));
  hull.add(tube(0.62, 0.13, -0.4, 4.6, Y, { y: 0.16 }));
  hull.add(box(1.25, 0.95, 1.7, Y, 0, 0.62, -1.85));                 // trémie
  hull.add(box(0.85, 0.08, 1.05, G, 0, 1.12, -1.9));                 // trappe de remplissage
  hull.add(box(1.02, 0.72, 1.35, GLASS, 0, 1.0, -0.15));             // verrière perchée
  hull.add(box(1.08, 0.09, 1.42, Y, 0, 1.4, -0.15));
  hull.add(box(1.3, 0.14, 5.2, G, 0, -0.05, 0.9));                   // bande verte
  bar(hull, [0, 1.42, -0.85], [0, 0.75, -2.75], 0.05, DARK);          // coupe-câble
  wingS(m, hull, [2.1, 1.0, 0.7, 0.08, 0.2], Y, 0.08, 0.38, 4.25, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  finS(m, hull, [1.7, 1.45, 0.7, 0.09, 0.7], G, 0, 0.38, 4.05, 0, 0.4);
  for (const s of [-1, 1]) {                                          // train classique fixe
    bar(hull, [s * 0.45, -0.5, -1.55], [s * 1.35, -1.25, -1.7], 0.1, W);
    wheel(hull, 0.3, 0.17, s * 1.42, -1.25, -1.7);
  }
  bar(hull, [0, -0.05, 4.2], [0, -1.4, 4.4], 0.06, DARK);
  wheel(hull, 0.15, 0.08, 0, -1.4, 4.4);
  wingS(m, always, [6.3, 1.8, 1.35, 0.19, 0.05, 0.38], Y, 0.5, -0.35, -0.75,
    [{ kind: 'flap', t0: 0.02, t1: 0.5 }, { kind: 'aileron', t0: 0.53, t1: 0.97 }], 0.26);
  always.add(box(1.1, 0.19, 1.8, Y, 0, -0.35, -0.75));
  for (const s of [-1, 1]) always.add(box(0.3, 0.1, 1.3, G, s * 6.7, 0.03, -0.7));
  always.add(box(12.6, 0.07, 0.07, METAL, 0, -0.62, 0.35));          // rampe d'épandage et ses buses
  for (let x = -6; x <= 6; x += 1) always.add(box(0.06, 0.14, 0.06, DARK, x, -0.7, 0.35));
  m.props.push(makeProp(always, 1.2, 3, 0, 0, -4.15));
  m.cockpit = makeCockpit(spec.eye, { w: 1.0, frame: true, nose: { w: 1.25, len: 2.6, color: Y, drop: -0.1 } });
  m.tips = [[6.8, 0.03, -0.6], [-6.8, 0.03, -0.6]];
  return m;
}

// Postier : aile haute, train classique, soute à courrier sous le ventre
function postier(spec) {
  const m = base(), { hull, always } = m;
  const C = 0xf4ead6, R = 0xc8402f, N = 0x24324a;
  hull.add(tube(0.05, 0.24, -3.85, -3.5, N));                        // cône d'hélice
  hull.add(tube(0.48, 0.62, -3.5, -2.45, N, { sy: 0.96 }));          // capot
  hull.add(tube(0.62, 0.66, -2.45, 0.4, C, { sy: 1.12 }));
  hull.add(tube(0.66, 0.15, 0.4, 4.5, C, { y: 0.14 }));
  hull.add(box(1.12, 0.5, 1.8, GLASS, 0, 0.52, -1.2));
  hull.add(box(1.34, 0.16, 6.4, R, 0, 0.0, 0.6));                    // bande rouge
  hull.add(box(1.0, 0.62, 2.6, R, 0, -0.78, -0.5));                  // soute à courrier
  hull.add(box(0.8, 0.05, 1.1, N, 0, -1.1, 0.0));                    // trappe de largage
  hull.add(box(1.36, 0.5, 0.6, C, 0, 0.1, 1.4));                     // porte de la soute
  wingS(m, hull, [1.8, 1.0, 0.64, 0.08, 0.22], C, 0.08, 0.32, 4.05, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  finS(m, hull, [1.6, 1.4, 0.62, 0.09, 0.75], R, 0, 0.32, 3.8, 0, 0.4);
  for (const s of [-1, 1]) {                                          // train classique fixe
    bar(hull, [s * 0.45, -0.5, -1.75], [s * 1.25, -1.2, -1.85], 0.09, N);
    wheel(hull, 0.3, 0.16, s * 1.32, -1.2, -1.85);
  }
  bar(hull, [0, -0.05, 4.1], [0, -1.05, 4.3], 0.06, DARK);
  wheel(hull, 0.14, 0.08, 0, -1.05, 4.3);
  wingS(m, always, [5.6, 1.6, 1.2, 0.17, 0.05, 0.12], C, 0.25, 0.9, -1.1,
    [{ kind: 'flap', t0: 0.02, t1: 0.5 }, { kind: 'aileron', t0: 0.53, t1: 0.97 }], 0.26);
  always.add(box(0.6, 0.17, 1.6, C, 0, 0.9, -1.1));
  for (const s of [-1, 1]) always.add(box(0.26, 0.1, 1.25, R, s * 5.8, 1.02, -1.05));
  bar2(always, [0.6, -0.3, -1.0], [2.6, 0.84, -1.05], 0.07, N);
  m.props.push(makeProp(always, 1.0, 2, 0, 0, -3.65));
  m.cockpit = makeCockpit(spec.eye, { w: 1.0, frame: true, nose: { w: 1.0, len: 1.9, color: N } });
  m.tips = [[5.9, 1.0, -0.85], [-5.9, 1.0, -0.85]];
  return m;
}

// Planeur (blanc, saumons rouges, empennage en T)
function planeur(spec) {
  const m = base(), { hull, always } = m;
  const W = 0xf6f6f2, R = 0xd8312b;
  hull.add(tube(0.05, 0.42, -3.5, -2.6, W));
  hull.add(tube(0.42, 0.44, -2.6, -0.5, W, { sy: 1.05 }));
  hull.add(tube(0.42, 0.11, -0.5, 4.4, W, { y: 0.12 }));
  hull.add(blob(0.36, GLASS, 0, 0.36, -1.85, 0.95, 0.85, 3.0));
  wheel(hull, 0.3, 0.12, 0, -0.45, -0.7);
  bar(hull, [0, -0.25, 4.0], [0, -0.32, 4.25], 0.05, DARK);
  finS(m, hull, [1.35, 1.15, 0.62, 0.08, 0.5], W, 0, 0.25, 3.75, 0, 0.36);
  wingS(m, hull, [1.35, 0.62, 0.4, 0.06, 0.12], R, 0, 1.6, 4.3, [{ kind: 'elevator', t0: 0, t1: 1 }], 0.4);
  wingS(m, always, [8.75, 1.05, 0.42, 0.12, 0.22, 0.4, 0.5], W, 0.25, 0.32, -0.65, [{ kind: 'aileron', t0: 0.55, t1: 0.96 }], 0.26);
  for (const s of [-1, 1]) always.add(box(0.7, 0.09, 0.45, R, s * 8.65, 0.73, -0.45));
  m.cockpit = makeCockpit(spec.eye, { w: 0.62, frame: true, nose: { w: 0.8, len: 1.4, color: W, drop: 0.12 } });
  m.tips = [[9, 0.72, -0.4], [-9, 0.72, -0.4]];
  return m;
}

const BUILDERS = { planeur, tourisme, postier, biplan, epandeur, hydravion, canadair, chasseur, jet, cargo, helico, libellule, birotor, racer };
const cache = new Map();

/** Construit (une seule fois par livrée) le modèle 3D d'un appareil. */
export function getModel(spec, livery = null) {
  const key = `${spec.id}:${livery ? livery.name : ''}`;
  if (cache.has(key)) return cache.get(key);
  PAINT = livery && livery.colors && spec.paint ? new Map(spec.paint.map((c, i) => [c, livery.colors[i]])) : null;
  const m = BUILDERS[spec.id](spec);
  PAINT = null;
  m.root.add(m.cockpit);
  m.root.traverse((o) => { if (o.isMesh && !o.userData.noShadow) o.castShadow = true; });
  cache.set(key, m);
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
      s.node.rotation.x = a; // (rotation autour de la charnière : un angle positif abaisse le bord de fuite)
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
    if (m.gearSlide) m.gear.position.y = (1 - gear) * m.gearSlide; // rentre dans les flotteurs
    else m.gear.scale.y = Math.max(0.03, gear);
  }
  for (const f of m.flames) {
    f.visible = burner > 0.01;
    f.scale.z = 0.55 + burner * (0.75 + Math.random() * 0.35);
    f.position.z = f.userData.z0 + (f.userData.len * f.scale.z) / 2;
  }
  m.hull.visible = !cockpitView;
  m.cockpit.visible = cockpitView;
}
