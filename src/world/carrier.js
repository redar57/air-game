import * as THREE from 'three';
import { carrier, buildCarrier, lightsPoints, spinners, DECK_AXIS_X } from './airfields.js';
import { moveDeck } from './decks.js';
import { addMoving } from './colliders.js';
import { BIG } from './terrain.js';
import { kit } from './ports.js';
import { parkedGeo } from './milbase.js';
import { usFlag } from './flag.js';
import { Puffs } from './puffs.js';
import { mergeColored, xform, mulberry32, toWorld, damp } from '../util.js';

// Le porte-avions fait route lentement (toute la flotte le suit) et son pont vit : avions garés, ascenseur, déflecteur
// derrière la catapulte, équipe en gilets de couleur, tracteurs, pompe à carburant. Repère du navire : -Z vers l'avant.

export const SPEED = 6;
/** Route en « stade » : deux longues lignes droites est-ouest, reliées par de larges demi-tours vers le sud. */
const route = { x0: 0, x1: 0, z: 0, r: 0, s: 0 };
const JET = [0x8d979f, 0x6f7981, 0x33383d];
const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const _w = { x: 0, z: 0 }, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color(), UP = new THREE.Vector3(0, 1, 0);

function at(s, out) {
  const { x0, x1, z, r } = route, L = x1 - x0, A = Math.PI * r;
  s = ((s % (2 * (L + A))) + 2 * (L + A)) % (2 * (L + A));
  if (s < L) { out.x = x0 + s; out.z = z; out.yaw = -Math.PI / 2; }
  else if ((s -= L) < A) { const t = s / r; out.x = x1 + r * Math.sin(t); out.z = z + r - r * Math.cos(t); out.yaw = -Math.PI / 2 - t; }
  else if ((s -= A) < L) { out.x = x1 - s; out.z = z + 2 * r; out.yaw = -1.5 * Math.PI; }
  else { const t = (s - L) / r; out.x = x0 - r * Math.sin(t); out.z = z + r + r * Math.cos(t); out.yaw = -1.5 * Math.PI - t; }
  return out;
}

/** Zones de mer que la flotte occupe le long de sa route (les petits bateaux les évitent). */
export function fleetZones() {
  const out = [], o = {}, total = 2 * (route.x1 - route.x0 + Math.PI * route.r);
  for (let s = 0; s < total; s += 700) { at(s, o); out.push({ x: o.x, z: o.z, r: 1000 }); }
  return out;
}

const VEST = { yellow: 0xf2c230, green: 0x2f9a4a, blue: 0x2f5fa8, red: 0xd8312b, brown: 0x8a5a33, purple: 0x7a3f9a, white: 0xf4f4ee };

export function buildFleetFlagship(scene) {
  const C = carrier, Y = C.deckY, G = buildCarrier(scene), k = kit(), rnd = mulberry32(6868), cols = G.userData.cols;
  Object.assign(route, BIG ? { x0: 3400, x1: 8500, z: C.z, r: 1925 } : { x0: -2600, x1: 1200, z: C.z, r: 750 });
  route.s = C.x - route.x0;
  const box = (lx, lz, hw, hd, h, ry = 0) => { const o = { lx, lz, ry, c: addMoving(hw, hd, Y, Y + h) }; cols.push(o); return o; };

  // --- îlot : vitres, antennes, numéro, grand radar tournant
  const WH = 0xe9ecee, GR = 0x8a949c, DK = 0x3b434a, GL = 0x22384a, YE = 0xf2c230;
  for (const y of [6, 9.4]) k.B(9.1, 0.9, 30, GL, 24, Y + y, 12);
  k.B(10, 0.5, 35, GR, 24, Y + 10.2, 12); k.B(8.4, 0.5, 24, GR, 24, Y + 16.2, 9); k.B(3, 3, 3, DK, 24, Y + 11.6, 26);
  for (const z of [0, 16]) k.parts.push({ geo: new THREE.SphereGeometry(1.5, 10, 7), color: WH, matrix: xform(24, Y + 19.6, z) });
  for (const [z, h] of [[4, 9], [12, 11], [15, 7]]) k.C(0.07, 0.1, h, WH, 21.6, Y + 19 + h / 2, z, 5);
  const radar = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(7, 2.4, 0.4), color: WH, matrix: xform(0, 1.4, 0.8) }, { geo: new THREE.CylinderGeometry(0.3, 0.5, 1.6, 8), color: GR, matrix: xform(0, 0, 0) }]), lam());
  radar.position.set(24, Y + 13.4, 27); G.add(radar); spinners.push({ obj: radar, rate: 0.9 });
  const flag = usFlag(3.4); flag.position.set(24, Y + 36, 8); flag.rotation.y = Math.PI / 2; G.add(flag);
  k.C(0.08, 0.1, 6, WH, 24, Y + 36, 8, 5);

  // --- marquages et matériel : aire de carburant, véhicules, rails de catapulte
  const f = C.fuel, line = (w, d, x, z, c = YE) => k.B(w, 0.05, d, c, x, Y + 0.06, z);
  for (const s of [-1, 1]) { line(f.half * 2, 0.6, f.lx, f.lz + s * f.half); line(0.6, f.half * 2, f.lx + s * f.half, f.lz); }
  line(5, 0.8, f.lx, f.lz); line(0.8, 5, f.lx, f.lz);
  k.B(1.6, 2, 5, VEST.purple, 28.2, Y + 1, f.lz); k.B(1.7, 0.4, 5.1, WH, 28.2, Y + 1.5, f.lz);
  for (const dz of [-1.5, 1.5]) { k.parts.push({ geo: new THREE.TorusGeometry(0.8, 0.22, 5, 14).rotateY(Math.PI / 2), color: 0x1f2428, matrix: xform(27.2, Y + 1.1, f.lz + dz) }); k.B(4, 0.14, 0.14, 0x1f2428, 25, Y + 0.12, f.lz + dz); }
  const tractor = (p, x, y, z, c = YE) => { p.push({ geo: new THREE.BoxGeometry(1.7, 0.8, 3.2), color: c, matrix: xform(x, y + 0.7, z) }, { geo: new THREE.BoxGeometry(1.4, 0.5, 0.9), color: 0x2b2e33, matrix: xform(x, y + 1.2, z + 0.5) }); for (const a of [-0.8, 0.8]) for (const b of [-1, 1]) p.push({ geo: new THREE.CylinderGeometry(0.38, 0.38, 0.3, 8).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(x + a, y + 0.38, z + b) }); };
  tractor(k.parts, 26, Y, 36); tractor(k.parts, 12.5, Y, -38, VEST.white);
  k.B(2.2, 2, 4.6, VEST.red, 26.4, Y + 1.3, 42); k.B(1.8, 0.8, 1.4, GL, 26.4, Y + 2.2, 40.4); // camion incendie
  k.B(2.6, 1.6, 6, YE, -25, Y + 1.2, 40); k.B(0.5, 7, 0.5, YE, -25, Y + 4.8, 42, 0, 0.5); // grue de pont
  // aire de l'ascenseur : découpe cerclée et porte de hangar dans le flanc
  for (const dz of [-11, 11]) line(0.5, 0.5, 29.6, 60 + dz); k.B(0.6, 9, 24, 0x15181b, 23.2, 11.5, 60);
  for (const dz of [-10.5, 10.5]) k.B(0.8, 18, 0.8, DK, 29.8, 11.5, 60 + dz);
  G.add(k.mesh());

  // --- appareils garés (les uns derrière les autres, en épi, à l'avant de l'îlot)
  const jet = parkedGeo('jet', JET), vtol = parkedGeo('vertical', [0x7f8a92, 0x5f6970, 0x33383d]), hel = parkedGeo('helico', [0x7d8790, 0x5d666e, 0x2b3138]), mat = lam();
  const park = (g, x, z, ry, parent = G) => {
    const m = new THREE.Mesh(g.geo, mat); m.position.set(x, (parent === G ? Y : 0) + g.spec.gearH, z); m.rotation.y = ry; m.castShadow = true; parent.add(m);
    if (parent === G) box(x, z, g.spec.span * 0.4, g.spec.len * 0.45, 3, ry);
    return m;
  };
  for (const z of [-30, -47, -64, -81]) park(jet, 21, z, 0.75);
  park(vtol, 22, -101, 0.75); park(hel, 20.5, 44, -0.5); park(jet, -24, -66, 0); park(vtol, -24.6, 70, 0);

  // --- ascenseur latéral avec un Jet dessus
  const lift = new THREE.Group();
  lift.add(new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(14, 1.2, 21), color: 0x40454b, matrix: xform(0, -0.62, 0) }, { geo: new THREE.BoxGeometry(13.6, 0.06, 0.4), color: YE, matrix: xform(0, 0.02, -10) }, { geo: new THREE.BoxGeometry(13.6, 0.06, 0.4), color: YE, matrix: xform(0, 0.02, 10) }, { geo: new THREE.BoxGeometry(0.4, 0.06, 20), color: YE, matrix: xform(6.6, 0.02, 0) }]), lam()));
  park(jet, 0, 0, 0.15, lift); lift.position.set(37.2, Y, 60); G.add(lift);
  const liftCol = box(37.2, 60, 5, 8, 3); let liftY = Y, liftT = 0;

  // --- déflecteur de jet derrière la catapulte
  const jbd = new THREE.Group(); jbd.position.set(DECK_AXIS_X, Y + 0.05, 126);
  const jp = []; for (let i = 0; i < 5; i++) jp.push({ geo: new THREE.BoxGeometry(2.3, 0.25, 4.2), color: i % 2 ? 0x596068 : 0x4d545b, matrix: xform((i - 2) * 2.4, 0.05, 2.1) }, { geo: new THREE.BoxGeometry(0.3, 0.2, 3.6), color: 0x2b3036, matrix: xform((i - 2) * 2.4, 0.22, 2.1) });
  const jm = new THREE.Mesh(mergeColored(jp), lam()); jm.castShadow = true; jbd.add(jm); G.add(jbd);

  // --- équipe de pont : gilets et casques de couleur ; quelques-uns marchent, l'officier de catapulte fait signe
  const body = mergeColored([{ geo: new THREE.BoxGeometry(0.52, 0.72, 0.32), color: 0xffffff, matrix: xform(0, 1.15, 0) }, { geo: new THREE.BoxGeometry(0.42, 0.8, 0.28), color: 0x39404a, matrix: xform(0, 0.4, 0) },
    { geo: new THREE.BoxGeometry(0.28, 0.26, 0.28), color: 0xd9a583, matrix: xform(0, 1.64, 0) }, { geo: new THREE.BoxGeometry(0.36, 0.22, 0.36), color: 0xffffff, matrix: xform(0, 1.84, 0) }]);
  const crew = [];
  const man = (c, x, z, yaw, walk = null) => crew.push({ c: VEST[c], x, z, yaw, walk, ph: rnd() * 9 });
  man('yellow', -17, 92, -1.2); man('green', -18.5, 84, -1.4); man('green', -18, 100, -1.7); man('red', -20, 110, -1.5); man('white', -21, 60, -1.2);
  man('purple', 24.5, f.lz - 4, 1.2); man('purple', 25, f.lz + 3.5, 1.7); man('blue', 14, -24, 1); man('blue', 13.5, -42, 1.4); man('brown', 15, -55, 1.8); man('brown', 14, -73, 1.2);
  man('yellow', 13, -92, 2); man('red', 25, 46.5, 0); man('yellow', 28, 70.5, -0.4); man('blue', 27, 49, -2.6); man('green', -25, 46, 1.2); man('white', 18, 33, 0.6);
  man('blue', 12, -20, 0, [[13, -20], [13, -100]]); man('green', 16, 36, 0, [[16, 36], [14, 82]]); man('brown', -24, -10, 0, [[-24, -50], [-24, 30]]); man('yellow', -22, 80, 0, [[-22, 85], [-22, 125]]); man('red', 16, 118, 0, [[12, 116], [27, 122]]);
  const cm = new THREE.InstancedMesh(body, lam(), crew.length); cm.castShadow = true; cm.frustumCulled = false;
  crew.forEach((o, i) => cm.setColorAt(i, _c.setHex(o.c))); G.add(cm);
  const arms = [-1, 1].map((s) => { const a = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(0.16, 0.8, 0.16), color: VEST.yellow, matrix: xform(0, 0.4, 0) }, { geo: new THREE.BoxGeometry(0.1, 0.5, 0.1), color: 0xff7a1f, matrix: xform(0, 1, 0) }]), lam()); a.position.set(-17, Y + 1.4, 92 + s * 0.32); G.add(a); return a; });

  // --- tracteur en ronde, vapeur de la catapulte, sillage
  const tp = []; tractor(tp, 0, 0, 0); const tug = new THREE.Mesh(mergeColored(tp), lam()); tug.castShadow = true; G.add(tug);
  const steam = new Puffs(scene, 50, { opacity: 0.45 }); let shot = 0;
  const wm = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide });
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute([-18, 0, 138, 18, 0, 138, 46, 0, 420, -18, 0, 138, 46, 0, 420, -46, 0, 420, 0, 0, -142, 10, 0, -118, 34, 0, -20, 0, 0, -142, -34, 0, -20, -10, 0, -118], 3));
  const wake = new THREE.Mesh(wg, wm); wake.position.y = 0.25; wake.renderOrder = 1; G.add(wake);
  G.add(lightsPoints([24, Y + 34, 8, 24, Y + 20, 27], 0xff3020, 5));

  const o = {}, api = {
    group: G, route, liftLevel: () => liftY,
    catapult() { shot = 1.6; },
    update(dt, time, plane, cam) {
      route.s += SPEED * dt; at(route.s, o);
      moveDeck(C, o.x, o.z, o.yaw, dt);
      G.position.set(o.x, 0, o.z); G.rotation.y = o.yaw;
      if (cam && Math.hypot(cam.x - o.x, cam.z - o.z) > 4500) { place(); return; }
      // ascenseur : 25 s en haut, descend, 15 s en bas, remonte
      liftT = (liftT + dt) % 60;
      const want = liftT < 25 ? Y : liftT < 45 ? 8.5 : Y;
      liftY += Math.max(-1.6 * dt, Math.min(1.6 * dt, want - liftY)); lift.position.y = liftY;
      liftCol.c.y0 = liftY; liftCol.c.y1 = liftY + 3;
      place();
      // le déflecteur se lève quand un petit appareil met les gaz devant lui
      let up = 0, near = false;
      if (plane && plane.onGround && plane.deck === C) {
        const cs = Math.cos(o.yaw), sn = Math.sin(o.yaw), dx = plane.pos.x - o.x, dz = plane.pos.z - o.z, lx = dx * cs - dz * sn, lz = dx * sn + dz * cs;
        near = lz > 40;
        if (Math.abs(lx - DECK_AXIS_X) < 8 && lz > 60 && lz < 118 && plane.spec.len < 19 && plane.throttle > 0.5) up = 1;
      }
      jbd.rotation.x = damp(jbd.rotation.x, up * -0.95, 1.6, dt);
      // équipe
      crew.forEach((m, i) => {
        let { x, z, yaw } = m, b = 0;
        if (m.walk) {
          const [p, q] = m.walk, L = Math.hypot(q[0] - p[0], q[1] - p[1]), u = ((time * 1.3 + m.ph * 8) % (2 * L)) / L, t = u < 1 ? u : 2 - u, d = u < 1 ? 1 : -1;
          x = p[0] + (q[0] - p[0]) * t; z = p[1] + (q[1] - p[1]) * t; yaw = Math.atan2((p[0] - q[0]) * d, (p[1] - q[1]) * d); b = Math.abs(Math.sin(time * 5 + m.ph)) * 0.07;
        } else yaw += 0.25 * Math.sin(time * 0.4 + m.ph);
        cm.setMatrixAt(i, _m.compose(_p.set(x, Y + b + 0.03, z), _q.setFromAxisAngle(UP, yaw), _s));
      });
      cm.instanceMatrix.needsUpdate = true;
      arms.forEach((a, i) => { a.rotation.x = near ? (i ? 1 : -1) * (0.5 + 0.5 * Math.sin(time * 4)) : (i ? 1 : -1) * 2.7; });
      const tu = (time * 0.02) % 1, tz = tu < 0.5 ? -110 + tu * 2 * 130 : 20 - (tu - 0.5) * 2 * 130;
      tug.position.set(tu < 0.5 ? 12.4 : 14.8, Y, tz); tug.rotation.y = tu < 0.5 ? Math.PI : 0;
      // vapeur le long du rail : un filet permanent, un panache au catapultage
      shot = Math.max(0, shot - dt);
      if (Math.random() < dt * (shot > 0 ? 40 : 2.5)) { toWorld(C, DECK_AXIS_X, -130 + Math.random() * (shot > 0 ? 200 : 60), _w); steam.emit(_w.x, Y + 0.3, _w.z, C.vx, 1.4, C.vz, 0.5, shot > 0 ? 3.4 : 1.6, 2.4); }
      steam.update(dt);
    },
  };
  function place() {
    for (const q of cols) { toWorld(C, q.lx, q.lz, _w); q.c.x = _w.x; q.c.z = _w.z; q.c.yaw = C.yaw + (q.ry || 0); }
  }
  api.update(0, 0, null, null);
  return api;
}
