import * as THREE from 'three';
import { runways, lightsPoints } from './airfields.js';
import { addBox, addMoving } from './colliders.js';
import { kit, prism } from './ports.js';
import { parkedGeo } from './milbase.js';
import { People } from './people.js';
import { mergeColored, xform, mulberry32, toWorld, damp, clamp } from '../util.js';

// Aérogare de l'aéroport principal : jetée vitrée, quatre portes à passerelle, avions au parking, bus, chariots à bagages,
// passagers ; et le tracteur qui repousse le Long-Courrier depuis sa porte. Repère local de la piste (elle est le long de Z).

const lam = (o = {}) => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, ...o });
const GATES = [-130, -205, -280, -355], MINE = 1, NOSE = 98; // la porte 2 attend le joueur
const _w = { x: 0, z: 0 };

export function buildAirport(scene) {
  const rw = runways[0], S = rw.width / 2, k = kit(), rnd = mulberry32(3434), red = [], lamps = [];
  const G = new THREE.Group(); G.position.set(rw.x, rw.alt, rw.z); G.rotation.y = rw.yaw; scene.add(G);
  const collide = (x, z, hw, hd, h, ry = 0) => { toWorld(rw, x, z, _w); addBox(_w.x, _w.z, rw.yaw + ry, hw, hd, rw.alt, rw.alt + h); };
  const CO = 0x595c62, YE = 0xf2c230, WH = 0xf4f4f0, GL = 0x2f4f66, ST = 0xb9bfc5;
  // --- sols : voie de circulation jusqu'au seuil ouest, aire de trafic, parking des voitures
  k.B(24, 0.3, 652, CO, S + 27, 0.04, -394); k.B(30, 0.3, 36, CO, S + 14, 0.035, -702); k.B(64, 0.3, 344, 0x66696f, S + 70, 0.05, -250); k.B(66, 0.3, 66, CO, S + 92, 0.06, -468);
  k.B(0.5, 0.06, 650, YE, S + 27, 0.24, -394); k.B(26, 0.06, 0.5, YE, S + 14, 0.24, -702);
  for (const z of GATES) { k.B(62, 0.06, 0.5, YE, S + 64, 0.25, z); k.B(0.5, 0.06, 9, 0xd8312b, S + NOSE + 1, 0.25, z); for (const s of [-1, 1]) k.B(50, 0.06, 0.3, WH, S + 72, 0.25, z + s * 30); }
  k.B(6, 0.06, 330, 0x50535a, S + 104.5, 0.24, -250); for (let z = -412; z < -90; z += 8) k.B(0.25, 0.04, 4, WH, S + 104.5, 0.28, z);
  // --- aérogare : verrière inclinée, toit en vague, tour de verre, enseigne bleue
  const X = S + 122, Z = -250;
  k.B(26, 8, 306, WH, X, 4, Z); k.B(0.6, 6.4, 300, GL, X - 13.1, 4.6, Z); for (let z = -398; z <= -102; z += 6) k.B(0.8, 7.6, 0.4, ST, X - 13.2, 4.2, z);
  k.parts.push({ geo: new THREE.CylinderGeometry(15.5, 15.5, 310, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), color: 0xdfe5e9, matrix: xform(X, 8, Z, 0, 1, 0.42, 1) });
  k.B(30, 11, 60, WH, X + 2, 5.5, Z); k.B(30.4, 5.6, 52, GL, X + 1.8, 6.4, Z); k.parts.push({ geo: new THREE.CylinderGeometry(19, 19, 64, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2), color: 0xcfd6db, matrix: xform(X + 2, 11, Z, 0, 1, 0.42, 1) });
  k.B(0.5, 2.6, 26, 0x1f5fa8, X - 14.2, 11.6, Z); for (let i = 0; i < 9; i++) k.B(0.3, 1.4, 1.6, WH, X - 14.5, 11.6, Z - 10.4 + i * 2.6);
  collide(X, Z, 14, 154, 15); collide(X + 2, Z, 16, 31, 19);
  for (let z = -400; z <= -100; z += 100) { k.C(0.25, 0.4, 18, 0x8d959c, S + 107, 9, z, 6); k.B(3, 0.8, 1, 0x3a3f45, S + 106, 18, z); lamps.push(S + 105.5, 17.6, z); }
  // --- passerelles : rotonde fixe et tunnel qui pivote (celui de la porte du joueur s'écarte au repoussage)
  const bridges = GATES.map((z) => {
    k.C(2.2, 2.2, 3.4, ST, S + 105, 5.2, z - 17, 10); k.C(0.7, 0.9, 4, 0x8d959c, S + 105, 2, z - 17, 8); k.B(6, 2.8, 3, ST, S + 108, 5.2, z - 17); k.B(1, 0.4, 1, 0xd8312b, S + 105, 7.2, z - 17);
    const g = new THREE.Group(); g.position.set(S + 105, 5.2, z - 17);
    const p = [{ geo: new THREE.BoxGeometry(2.8, 2.7, 10), color: WH, matrix: xform(0, 0, 6) }, { geo: new THREE.BoxGeometry(2.4, 2.4, 8), color: ST, matrix: xform(0, 0, 13) }, { geo: new THREE.BoxGeometry(3.4, 3.1, 2.4), color: 0x3a3f45, matrix: xform(0, 0, 17) }, { geo: new THREE.BoxGeometry(2.84, 0.8, 9), color: GL, matrix: xform(0, 0.3, 6) }, { geo: new THREE.BoxGeometry(0.8, 4.4, 0.8), color: 0x8d959c, matrix: xform(0, -2.6, 13) }, { geo: new THREE.CylinderGeometry(0.6, 0.6, 2, 10).rotateZ(Math.PI / 2), color: 0x1b1c1e, matrix: xform(0, -4.4, 13) }];
    const m = new THREE.Mesh(mergeColored(p), lam()); m.castShadow = true; g.add(m);
    g.rotation.y = Math.atan2(-11.6, 14.5 - 2.6); G.add(g); // vers la porte avant gauche de l'avion
    return { g, on: g.rotation.y, off: g.rotation.y - 0.55 };
  });
  // --- avions au parking
  const park = (id, colors, gate) => {
    const { geo, spec } = parkedGeo(id, colors), m = new THREE.Mesh(geo, lam()), x = S + NOSE - spec.len / 2, z = GATES[gate];
    m.position.set(x, spec.gearH + 0.2, z); m.rotation.y = -Math.PI / 2; m.castShadow = true; G.add(m);
    collide(x, z, spec.len / 2, 2.8, spec.gearH + 3); collide(x - 3, z, 5, spec.span * 0.45, spec.gearH + 1);
  };
  park('ligne', [0xf6f6f2, 0xe0533d, 0xf2c230], 0); park('ligne', [0xf6f6f2, 0x2f6b47, 0xc9d94a], 2); park('bipoutre', [0xf2f2ee, 0x2f7fdc, 0x2b3440], 3);
  // --- matériel au sol : escabeaux, camion-citerne, chariots à bagages, cônes
  for (const gate of [0, 2, 3]) {
    const z = GATES[gate];
    k.B(2.6, 2.4, 9, WH, S + 70, 1.7, z + 14); k.B(2.5, 2, 2.2, 0xd8312b, S + 70, 1.4, z + 8.6); k.B(2, 1.2, 4, YE, S + 80, 0.9, z + 8); k.B(1.2, 0.3, 8, 0x3a3f45, S + 78, 2.2, z + 6, 0.6, 0, 0.25);
    for (let i = 0; i < 4; i++) k.parts.push({ geo: new THREE.ConeGeometry(0.3, 0.8, 6), color: 0xf27a1f, matrix: xform(S + 60 + i * 8, 0.6, z - 24) });
    for (let i = 0; i < 3; i++) { k.B(1.8, 1, 2.8, ST, S + 86 - i * 3.6, 1, z + 7); for (let j = 0; j < 3; j++) k.B(0.7, 0.5, 0.8, [0x8e1f3a, 0x2f5fa8, 0x2b2e33, 0x8a5a33][(i + j) % 4], S + 86 - i * 3.6, 1.7, z + 6.2 + j * 0.8); }
  }
  // voitures au parking et navette
  const CC = [0xd8312b, 0x2f5fa8, 0xf4f4ee, 0x2b2e33, 0x9aa3ab, 0xf2c230, 0x2f8a5a];
  for (let r = 0; r < 4; r++) for (let i = 0; i < 17; i++) { if (rnd() < 0.3) continue; const x = S + 64 + i * 3.4, z = -492 + r * 15; k.B(1.8, 0.8, 4.2, CC[Math.floor(rnd() * 7)], x, 0.8, z); k.B(1.6, 0.6, 2.2, GL, x, 1.45, z + 0.2); }
  for (let z = -498; z <= -440; z += 19) { k.C(0.1, 0.14, 7, 0x8d959c, S + 60, 3.5, z, 5); lamps.push(S + 60, 7, z); }
  G.add(k.mesh(), lightsPoints(red, 0xff3020, 5), lightsPoints(lamps, 0xfff0c8, 7));
  const tl = []; for (let z = -715; z <= -80; z += 35) tl.push(S + 15, 0.6, z, S + 39, 0.6, z); G.add(lightsPoints(tl, 0x4f8fff, 3));

  // --- véhicules animés : bus, train de chariots, navette, qui suivent des boucles
  const bus = (c) => [{ geo: new THREE.BoxGeometry(2.8, 2.9, 12), color: c, matrix: xform(0, 1.9, 0) }, { geo: new THREE.BoxGeometry(2.84, 1.2, 11), color: GL, matrix: xform(0, 2.3, 0) }, { geo: new THREE.BoxGeometry(2.6, 0.6, 10), color: 0x1b1c1e, matrix: xform(0, 0.4, 0) }];
  const tugG = (c) => [{ geo: new THREE.BoxGeometry(1.6, 1, 2.8), color: c, matrix: xform(0, 0.8, 0) }, { geo: new THREE.BoxGeometry(1.4, 0.8, 1), color: GL, matrix: xform(0, 1.6, 0.3) }, { geo: new THREE.BoxGeometry(1.7, 0.4, 2), color: 0x1b1c1e, matrix: xform(0, 0.3, 0) }];
  const cart = () => [{ geo: new THREE.BoxGeometry(1.6, 0.2, 2.4), color: ST, matrix: xform(0, 0.6, 0) }, { geo: new THREE.BoxGeometry(1.3, 0.8, 1.9), color: CC[Math.floor(rnd() * 5)], matrix: xform(0, 1.1, 0) }, { geo: new THREE.BoxGeometry(1.6, 0.1, 2.4), color: 0x2f5fa8, matrix: xform(0, 1.9, 0) }];
  const V = (parts, loop, v, lag = 0) => { const m = new THREE.Mesh(mergeColored(parts), lam()); m.castShadow = true; G.add(m); return { m, v, s: -lag, pts: new THREE.CatmullRomCurve3(loop.map(([x, z]) => new THREE.Vector3(x, 0.2, z)), true, 'catmullrom', 0.25) }; };
  const ring = [[S + 103, -405], [S + 103, -250], [S + 103, -95], [S + 106, -92], [S + 106.2, -250], [S + 106.2, -408]];
  const trip = [[S + 103, -390], [S + 101.5, -310], [S + 84, -296], [S + 82, -302], [S + 101, -314], [S + 101.5, -340], [S + 106, -330], [S + 106, -150], [S + 101, -154], [S + 84, -148], [S + 82, -154], [S + 100, -165], [S + 101.5, -240], [S + 103, -330]];
  const movers = [V(bus(0x2f7fdc), ring, 7), V(bus(WH), ring, 7, 260), V(tugG(YE), trip, 5), V(cart(), trip, 5, 3.4), V(cart(), trip, 5, 6.2), V(cart(), trip, 5, 9), V(tugG(0xd8312b), ring, 9, 420)];
  for (const o of movers) o.len = o.pts.getLength();
  // --- passagers et personnel (coordonnées monde)
  const P = (x, z) => { toWorld(rw, x, z, _w); return { x: _w.x, z: _w.z }; }, list = [];
  for (let i = 0; i < 26; i++) { const z = -430 - rnd() * 60, x = S + 66 + rnd() * 50; list.push({ loop: [P(x, z), P(S + 108 + rnd() * 6, -412), P(x + 6, z + 5)] }); }
  for (const gate of GATES) for (let i = 0; i < 6; i++) { const p = P(S + 62 + rnd() * 34, gate + 6 + rnd() * 16); list.push(i < 3 ? { ...p, yaw: rnd() * 6 } : { loop: [p, P(S + 90, gate + 12), P(S + 96, gate + 4)] }); }
  for (let i = 0; i < 14; i++) list.push({ loop: [P(S + 100, GATES[3] + 4 + i * 0.3), P(S + 84, GATES[3] + 5), P(S + 100, GATES[3] + 3)] }); // embarquement à pied
  const people = new People(scene, list, () => rw.alt + 0.3, 77);

  // --- repoussage
  const tow = new THREE.Mesh(mergeColored([{ geo: new THREE.BoxGeometry(3.2, 1.3, 6.4), color: YE, matrix: xform(0, 1, 0) }, { geo: new THREE.BoxGeometry(2.2, 1.1, 1.6), color: GL, matrix: xform(0, 2.1, 1.2) }, { geo: new THREE.BoxGeometry(2.3, 0.2, 1.7), color: 0xd8312b, matrix: xform(0, 2.75, 1.2) }, { geo: new THREE.BoxGeometry(3.3, 0.9, 1.6), color: 0x1b1c1e, matrix: xform(0, 0.55, -1.9) }, { geo: new THREE.BoxGeometry(3.3, 0.9, 1.6), color: 0x1b1c1e, matrix: xform(0, 0.55, 1.9) }, { geo: new THREE.BoxGeometry(0.2, 0.2, 5), color: 0xd8312b, matrix: xform(0, 0.8, 5.4) }]), lam());
  tow.castShadow = true; tow.rotation.order = 'YXZ'; scene.add(tow);
  const beacon = lightsPoints([0, 3.1, 1.2], 0xffa020, 6); tow.add(beacon);
  const tcol = addMoving(1.6, 3.2, 0, 1), home = { x: S + 101, z: GATES[MINE] + 22 };
  const push = { state: 'off', s: 0, plane: null, home: 0 };
  const R = 25, BACK = 22.5, gz = GATES[MINE], TOTAL = BACK + (R * Math.PI) / 2, _o = { x: 0, z: 0, yaw: 0 };
  /** Position de l'avion après s mètres de recul (repère local). */
  const path = (s, x0, o) => {
    if (s < BACK) { o.x = x0 - s; o.z = gz; o.yaw = -Math.PI / 2; } else { const t = Math.min(Math.PI / 2, (s - BACK) / R); o.x = x0 - BACK - R * Math.sin(t); o.z = gz + R - R * Math.cos(t); o.yaw = -Math.PI / 2 + t; }
    return o;
  };
  const seat = () => {
    const p = push.plane, o = path(push.s, push.x0, _o); toWorld(rw, o.x, o.z, _w);
    p.pos.x = _w.x; p.pos.z = _w.z; p.yawG = rw.yaw + o.yaw; p.throttle = 0; p.groundSpeed = 0; p.vel.set(0, 0, 0);
  };
  const setTow = (x, z, yaw) => { toWorld(rw, x, z, _w); tow.position.set(_w.x, rw.alt + 0.2, _w.z); tow.rotation.y = rw.yaw + yaw; Object.assign(tcol, { x: _w.x, z: _w.z, yaw: tow.rotation.y, y0: rw.alt, y1: rw.alt + 3 }); };
  let tx = home.x, tz = home.z, ty = Math.PI / 2, v = 0;
  return {
    push,
    /** Vrai si l'appareil attend à sa porte. */
    get ready() { return push.state === 'gate'; },
    get busy() { return push.state === 'push'; },
    /** Installe l'avion à la porte, nez vers l'aérogare. */
    spawn(plane, world) {
      push.x0 = S + NOSE - plane.spec.len / 2; push.s = 0; push.plane = plane; push.state = 'gate';
      path(0, push.x0, _o); toWorld(rw, _o.x, _o.z, _w); plane.placeOnGround(_w.x, _w.z, rw.yaw + _o.yaw, world);
    },
    start() { if (push.state === 'gate') { push.state = 'push'; v = 0; return true; } return false; },
    leave() { push.state = 'off'; push.plane = null; },
    update(dt, t, cam, plane) {
      if (push.plane && (push.plane !== plane || plane.crashed || !plane.onGround || (push.state !== 'done' && push.state !== 'push' && plane.groundSpeed > 1.5))) { push.plane = null; push.state = 'off'; }
      let done = false;
      if (push.state === 'push') {
        v = damp(v, push.s > TOTAL - 5 ? Math.max(0.25, (TOTAL - push.s) * 0.45) : push.s < 1 ? 0.8 : 2.4, 1.2, dt);
        push.s = Math.min(TOTAL, push.s + v * dt); seat();
        if (push.s >= TOTAL - 0.05) { push.state = 'done'; push.home = 0; done = true; }
      }
      const near = !cam || Math.hypot(cam.x - rw.x, cam.z - rw.z) < 3500;
      const b = bridges[MINE]; b.g.rotation.y = damp(b.g.rotation.y, push.state === 'gate' ? b.on : b.off, 0.7, dt);
      // le tracteur : attelé au nez, ou en train de rentrer
      if (push.plane && (push.state === 'gate' || push.state === 'push')) {
        const o = path(push.s, push.x0, _o), d = push.plane.spec.len / 2 + 7.2;
        tx = o.x - Math.sin(o.yaw) * d; tz = o.z - Math.cos(o.yaw) * d; ty = o.yaw + Math.PI; // sa barre de remorquage vers l'avion
        ty = o.yaw; push.home = 0;
      } else if (Math.hypot(home.x - tx, home.z - tz) > 1) {
        push.home += dt; if (push.home > 2) { const a = Math.atan2(-(home.x - tx), -(home.z - tz)), sp = Math.min(5, Math.hypot(home.x - tx, home.z - tz)); let d = a - ty; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; ty += clamp(d, -1.2 * dt, 1.2 * dt); if (Math.abs(d) < 0.6) { tx -= Math.sin(ty) * sp * dt; tz -= Math.cos(ty) * sp * dt; } else { tx -= Math.sin(ty) * 1.2 * dt; tz -= Math.cos(ty) * 1.2 * dt; } }
      }
      setTow(tx, tz, ty); beacon.visible = push.state === 'push' && (t * 2) % 1 < 0.5;
      people.update(dt, t, cam);
      if (!near) return done;
      for (const o of movers) {
        o.s += o.v * dt; const u = (((o.s / o.len) % 1) + 1) % 1, p = o.pts.getPointAt(u), q = o.pts.getTangentAt(u);
        o.m.position.copy(p); o.m.rotation.y = Math.atan2(-q.x, -q.z);
      }
      return done;
    },
  };
}
