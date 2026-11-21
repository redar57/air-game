import * as THREE from 'three';
import { MTN, rawBase, BIG } from './terrain.js';
import { mergeColored, xform, toLocal, toWorld, clamp, smoothstep, lerp } from '../util.js';
import { addBox } from './colliders.js';

export const runways = [];
export const carrier = { x: 0, z: 0, yaw: -Math.PI / 2, deckY: 21, halfLen: 145, halfWid: 30 };
/** Station de carburant (devant les hangars de l'aéroport) : centre en coordonnées monde, demi-côté. */
export const fuelStation = { x: 0, z: 0, yaw: 0, lx: 0, lz: 0, half: 24 };
/** Matériaux des balises lumineuses (leur opacité suit la tombée de la nuit). */
export const nightLights = [];

const RUNWAY_LIFT = 0.12;
const _l = { x: 0, z: 0 }, _w = { x: 0, z: 0 };

/** Choisit l'emplacement des pistes et du porte-avions (avant la construction du relief). */
export function defineAirfields() {
  // Aéroport principal : plaine côtière au sud (au sud-est sur la grande île).
  const ax0 = BIG ? 2600 : 500;
  let zc = BIG ? 0 : 1500;
  while (zc < 5200 && rawBase(ax0, zc) > 2) zc += 25;
  runways.push({
    id: 'aeroport', name: 'Aéroport', x: ax0, z: zc - 560, yaw: Math.atan2(-1, 0), style: 'main',
    length: 1500, width: 46, alt: BIG ? Math.round(clamp(rawBase(ax0, zc - 560), 11, 120)) : 11, halfLen: 870, halfWid: 150, margin: 260, small: false,
  });

  // Altiport : petit plateau sur le flanc de la chaîne de montagnes.
  const ca = Math.cos(MTN.ang), sa = Math.sin(MTN.ang);
  const u = -700, v = -1150;
  const ax = MTN.x + u * ca - v * sa, az = MTN.z + u * sa + v * ca;
  runways.push({
    id: 'altiport', name: 'Altiport', x: ax, z: az, yaw: Math.atan2(-ca, -sa),
    length: 520, width: 26, alt: Math.round(clamp(rawBase(ax, az), 170, 400)), style: 'small',
    halfLen: 320, halfWid: 62, margin: 150, small: true,
  });

  if (BIG) { // grande carte : deux terrains de styles bien distincts
    // aérodrome de la Baie : piste courte en bord de mer, aérogare, radar, château d'eau
    runways.push({
      id: 'baie', name: 'Aérodrome de la Baie', x: -4300, z: 650, yaw: Math.atan2(-1, 0.25), style: 'coast',
      length: 900, width: 34, alt: Math.round(clamp(rawBase(-4300, 650), 8, 60)), halfLen: 510, halfWid: 130, margin: 220, small: false,
    });
    // piste en herbe de la Prairie : pas de goudron, une grange, une manche à air, des bottes de foin
    runways.push({
      id: 'prairie', name: 'Piste de la Prairie', x: 6000, z: 700, yaw: Math.atan2(-0.55, 0.84), style: 'grass',
      length: 700, width: 32, alt: Math.round(clamp(rawBase(6000, 700), 8, 160)), halfLen: 400, halfWid: 80, margin: 180, small: true,
    });
  }

  const main = runways[0];
  fuelStation.lx = main.width / 2 + 47; fuelStation.lz = main.length / 2 - 260;
  toWorld(main, fuelStation.lx, fuelStation.lz, _w);
  fuelStation.x = _w.x; fuelStation.z = _w.z; fuelStation.yaw = main.yaw; fuelStation.rw = main;

  carrier.x = BIG ? ax0 : -1900;
  carrier.z = zc + (BIG ? 2600 : 2000);
  return runways;
}

export function runwayAt(x, z) {
  for (const rw of runways) {
    toLocal(rw, x, z, _l);
    if (Math.abs(_l.x) <= rw.width / 2 && Math.abs(_l.z) <= rw.length / 2) return rw;
  }
  return null;
}

/** Vrai si (x, z) est sur l'aire de la station de carburant. */
export function atFuelStation(x, z) {
  if (!fuelStation.rw) return false;
  toLocal(fuelStation.rw, x, z, _l);
  return Math.abs(_l.x - fuelStation.lx) <= fuelStation.half && Math.abs(_l.z - fuelStation.lz) <= fuelStation.half;
}

export function onCarrierDeck(x, z) {
  toLocal(carrier, x, z, _l);
  return Math.abs(_l.x) <= carrier.halfWid && Math.abs(_l.z) <= carrier.halfLen;
}

// ---------------------------------------------------------------------------
function runwayTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 2048;
  const g = cv.getContext('2d');
  g.fillStyle = '#3d4046'; g.fillRect(0, 0, 128, 2048);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.06)';
    g.fillRect(Math.random() * 128, Math.random() * 2048, 2 + Math.random() * 3, 6 + Math.random() * 26);
  }
  g.fillStyle = '#f2f2ee';
  g.fillRect(5, 0, 3, 2048); g.fillRect(120, 0, 3, 2048);
  for (let y = 150; y < 1900; y += 96) g.fillRect(62, y, 4, 52);
  for (const y0 of [14, 2048 - 14 - 70]) for (let k = 0; k < 8; k++) g.fillRect(16 + k * 12.6, y0, 7, 70);
  for (const y0 of [230, 2048 - 230 - 60]) { g.fillRect(30, y0, 16, 60); g.fillRect(82, y0, 16, 60); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function grassTexture() {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 1024;
  const g = cv.getContext('2d');
  for (let y = 0; y < 1024; y += 64) { g.fillStyle = (y / 64) % 2 ? '#6aa84a' : '#7bb957'; g.fillRect(0, y, 128, 64); } // bandes de tonte
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,230,.06)' : 'rgba(20,50,10,.08)';
    g.fillRect(Math.random() * 128, Math.random() * 1024, 2 + Math.random() * 3, 3 + Math.random() * 8);
  }
  g.fillStyle = '#f4f4ee'; // balises blanches de bord de piste et seuils
  for (let y = 20; y < 1024; y += 90) { g.fillRect(2, y, 8, 26); g.fillRect(118, y, 8, 26); }
  for (const y0 of [10, 1024 - 10 - 12]) g.fillRect(14, y0, 100, 12);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function lightsPoints(positions, color, size) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false });
  nightLights.push(mat);
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  return pts;
}

export function buildAirfields(scene) {
  const tex = runwayTexture(), grass = grassTexture();
  for (const rw of runways) {
    const strip = new THREE.Mesh(
      new THREE.PlaneGeometry(rw.width, rw.length).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ map: rw.style === 'grass' ? grass : tex, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
    );
    strip.position.set(rw.x, rw.alt + RUNWAY_LIFT, rw.z);
    strip.rotation.y = rw.yaw;
    strip.receiveShadow = true;
    scene.add(strip);

    // décor : tarmac, hangars, tour
    const parts = [];
    const L = rw.length, side = rw.width / 2;
    const B = (w, h, d, color, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color, matrix: xform(x, y, z) });
    const hangar = (x, z, w, h, d, roofColor) => {
      B(w, h, d, 0xdfe3e6, x, h / 2, z);
      parts.push({
        geo: new THREE.CylinderGeometry(w / 2, w / 2, d, 8, 1, false, -Math.PI / 2, Math.PI),
        color: roofColor, matrix: xform(x, h, z, 0, 1, 1, 0.42, -Math.PI / 2),
      });
      B(w * 0.62, h * 0.8, 0.5, 0x4a5058, x, h * 0.4, z - d / 2 - 0.1);
      toWorld(rw, x, z, _w);
      addBox(_w.x, _w.z, rw.yaw, w / 2, d / 2, rw.alt, rw.alt + h + w * 0.21);
    };
    const collide = (x, z, hw, hd, h) => { toWorld(rw, x, z, _w); addBox(_w.x, _w.z, rw.yaw, hw, hd, rw.alt, rw.alt + h); };
    const C = (rt, rb, h, color, x, y, z, seg = 10) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color, matrix: xform(x, y, z) });
    if (rw.style === 'grass') {
      // grange rouge à toit en bâtière, manche à air, bottes de foin, clôture
      const gx = side + 40, gz = L / 2 - 120;
      B(16, 7, 24, 0xa63a2b, gx, 3.5, gz);
      const tri = new THREE.Shape([new THREE.Vector2(-9, 0), new THREE.Vector2(9, 0), new THREE.Vector2(0, 5.5)]);
      parts.push({ geo: new THREE.ExtrudeGeometry(tri, { depth: 25, bevelEnabled: false }), color: 0x4a4440, matrix: xform(gx, 7, gz - 12.5) });
      B(8, 5.5, 0.4, 0xf2ead8, gx, 2.75, gz - 12.1);
      B(0.5, 5.5, 0.45, 0xf2ead8, gx, 2.75, gz - 12.15);
      collide(gx, gz, 8, 12, 12.5);
      C(0.18, 0.22, 9, 0x9a9a9a, side + 14, 4.5, -L / 2 + 70, 6);
      parts.push({ geo: new THREE.CylinderGeometry(0.4, 1.0, 4, 8, 1, true).rotateZ(Math.PI / 2), color: 0xf07a1e, matrix: xform(side + 16, 8.7, -L / 2 + 70) });
      for (let k = 0; k < 7; k++) {
        parts.push({ geo: new THREE.CylinderGeometry(1.2, 1.2, 1.6, 10).rotateZ(Math.PI / 2), color: 0xd9b45a, matrix: xform(side + 60 + (k % 3) * 3.4, 1.2, L / 2 - 200 - Math.floor(k / 3) * 5, k * 0.7) });
      }
      for (let z = -L / 2; z <= L / 2; z += 12) B(0.25, 1.3, 0.25, 0x7a5a3c, -side - 30, 0.65, z);
      B(0.12, 0.12, L, 0x7a5a3c, -side - 30, 1.1, 0);
    } else if (rw.style === 'coast') {
      // aérogare vitrée, radar sous dôme, château d'eau en damier
      const tx = side + 70, tz = L / 2 - 210;
      B(60, 0.3, 150, 0x6b6e73, side + 36, 0.05, tz);
      B(22, 8, 72, 0xf4f2ec, tx + 10, 4, tz);
      B(22.4, 2.6, 72.4, 0x3b6e9c, tx + 10, 4.6, tz);
      B(24, 0.7, 74, 0x8f969c, tx + 10, 8.3, tz);
      B(8, 3, 8, 0xf4f2ec, tx + 10, 10, tz + 20);
      collide(tx + 10, tz, 12, 37, 13);
      const rx = side + 60, rz = -L / 2 + 160;
      C(2.6, 3.4, 15, 0xd9dcdf, rx, 7.5, rz, 8);
      parts.push({ geo: new THREE.SphereGeometry(7.5, 12, 8), color: 0xf8f8f6, matrix: xform(rx, 20, rz) });
      collide(rx, rz, 7.5, 7.5, 27.5);
      const wx = side + 105, wz = L / 2 - 40;
      for (const [dx, dz] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) B(0.6, 16, 0.6, 0x8a9199, wx + dx, 8, wz + dz);
      for (let k = 0; k < 4; k++) C(6, 6, 2, k % 2 ? 0xf4f4f0 : 0xd8402f, wx, 17 + k * 2, wz, 12);
      parts.push({ geo: new THREE.ConeGeometry(6.4, 3, 12), color: 0xd8402f, matrix: xform(wx, 26.5, wz) });
      collide(wx, wz, 6, 6, 28);
    } else if (rw.small) {
      B(34, 0.3, 60, 0x595c62, side + 22, 0.05, L / 2 - 90);
      hangar(side + 26, L / 2 - 130, 16, 5.5, 16, 0xc8452f);
    } else {
      B(72, 0.3, 230, 0x595c62, side + 62, 0.05, L / 2 - 260);
      B(30, 0.3, 26, 0x595c62, side + 13, 0.04, L / 2 - 170);
      B(30, 0.3, 26, 0x595c62, side + 13, 0.04, L / 2 - 350);
      hangar(side + 108, L / 2 - 180, 30, 9, 34, 0x3f79b8);
      hangar(side + 108, L / 2 - 230, 30, 9, 34, 0xc8452f);
      hangar(side + 108, L / 2 - 280, 30, 9, 34, 0xe8b23a);
      // station de carburant (aéroport principal seulement) : aire cerclée de jaune, pompes et panneau
      if (rw === runways[0]) {
      const fx = fuelStation.lx, fz = fuelStation.lz, hf = fuelStation.half;
      for (const [w, d, x, z] of [[hf * 2, 0.9, fx, fz - hf], [hf * 2, 0.9, fx, fz + hf], [0.9, hf * 2, fx - hf, fz], [0.9, hf * 2, fx + hf, fz]]) B(w, 0.06, d, 0xf2c230, x, 0.33, z);
      B(10, 0.06, 1.4, 0xf2c230, fx, 0.33, fz); B(1.4, 0.06, 10, 0xf2c230, fx, 0.33, fz);
      B(5, 0.5, 14, 0x9aa0a6, fx - hf - 4, 0.25, fz);                          // îlot
      for (const dz of [-4, 4]) {
        B(1.3, 2.1, 0.9, 0xd8402f, fx - hf - 4, 1.55, fz + dz);                // pompes
        B(1.0, 0.5, 0.95, 0xf5f5f0, fx - hf - 4, 2.2, fz + dz);
      }
      for (const dz of [-6.5, 6.5]) B(0.35, 5.2, 0.35, 0xb9bec4, fx - hf - 4, 2.6, fz + dz);
      B(6.4, 0.35, 16, 0xf2c230, fx - hf - 4, 5.3, fz);                        // auvent
      B(0.2, 2.4, 3.4, 0x1f8a4c, fx - hf - 4, 7.0, fz);                        // panneau
      }
      // tour de contrôle
      const tx = side + 104, tz = L / 2 - 350;
      parts.push({ geo: new THREE.CylinderGeometry(3, 3.6, 20, 8), color: 0xeceff1, matrix: xform(tx, 10, tz) });
      parts.push({ geo: new THREE.CylinderGeometry(6.2, 4.8, 4.6, 8), color: 0x29495f, matrix: xform(tx, 22.3, tz) });
      parts.push({ geo: new THREE.CylinderGeometry(6.6, 6.6, 0.8, 8), color: 0xc8452f, matrix: xform(tx, 25, tz) });
      toWorld(rw, tx, tz, _w);
      addBox(_w.x, _w.z, rw.yaw, 6, 6, rw.alt, rw.alt + 26);
    }
    const decor = new THREE.Mesh(
      mergeColored(parts),
      new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
    );
    decor.position.set(rw.x, rw.alt, rw.z);
    decor.rotation.y = rw.yaw;
    decor.receiveShadow = true;
    scene.add(decor);

    // balisage nocturne
    const pos = [];
    if (rw === runways[0]) {
      const fx = fuelStation.lx, fz = fuelStation.lz, hf = fuelStation.half;
      for (const [x, z] of [[-hf, -hf], [hf, -hf], [hf, hf], [-hf, hf]]) pos.push(fx + x, 0.7, fz + z);
    }
    if (rw.style !== 'grass') for (let z = -L / 2; z <= L / 2 + 1; z += 50) pos.push(-side - 1.5, 0.7, z, side + 1.5, 0.7, z);
    if (!pos.length) continue;
    const lights = lightsPoints(pos, 0xffe9a8, rw.small ? 4 : 6);
    lights.position.copy(decor.position);
    lights.rotation.y = rw.yaw;
    scene.add(lights);
  }
}

// ---------------------------------------------------------------------------
function deckTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 1024;
  const g = cv.getContext('2d');
  g.fillStyle = '#474c53'; g.fillRect(0, 0, 256, 1024);
  for (let i = 0; i < 1500; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.07)';
    g.fillRect(Math.random() * 256, Math.random() * 1024, 3 + Math.random() * 6, 6 + Math.random() * 20);
  }
  // axe de piste (le bâtiment de commandement est à tribord, donc l'axe est décalé à bâbord)
  const cx = 108;
  g.fillStyle = '#f0f0ea';
  for (let y = 30; y < 1000; y += 48) g.fillRect(cx - 2, y, 4, 28);
  g.fillStyle = '#e8c33a';
  g.fillRect(cx - 62, 12, 4, 1000); g.fillRect(cx + 62, 12, 4, 1000);
  g.fillStyle = '#f0f0ea';
  g.fillRect(6, 6, 244, 3); g.fillRect(6, 1015, 244, 3); g.fillRect(6, 6, 3, 1012); g.fillRect(247, 6, 3, 1012);
  // brins d'arrêt (vers la poupe)
  g.fillStyle = 'rgba(20,20,20,.75)';
  for (const y of [760, 800, 840, 880]) g.fillRect(cx - 62, y, 124, 3);
  // catapulte (vers la proue)
  g.fillStyle = 'rgba(240,240,234,.75)';
  g.fillRect(cx - 1, 40, 2, 300);
  g.font = 'bold 84px sans-serif'; g.textAlign = 'center'; g.fillStyle = 'rgba(240,240,234,.85)';
  g.fillText('07', cx, 120);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/** Décalage latéral de l'axe de piste du pont (repère local du navire). */
export const DECK_AXIS_X = (108 / 256 - 0.5) * 58;

export function buildCarrier(scene) {
  const C = carrier;
  const group = new THREE.Group();
  group.position.set(C.x, 0, C.z);
  group.rotation.y = C.yaw;

  // coque effilée
  const hull = new THREE.BoxGeometry(46, 21, 284, 2, 2, 16);
  const p = hull.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i) + 9.4, z = p.getZ(i);
    let wf = lerp(0.08, 1, smoothstep(-142, -78, z)) * lerp(0.78, 1, smoothstep(142, 112, z));
    if (y < 15) wf *= lerp(0.62, 0.9, smoothstep(-2, 15, y));
    p.setX(i, p.getX(i) * wf);
    p.setY(i, y);
    if (y < 5 && z < -100) p.setZ(i, z + 10);
  }
  const parts = [{ geo: hull, color: 0x5d6670 }];
  const B = (w, h, d, color, x, y, z) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color, matrix: xform(x, y, z) });
  B(60, 1.3, 290, 0x40454b, 0, C.deckY - 0.67, 0);
  B(9, 10, 34, 0x6f7780, 24, C.deckY + 5, 12);
  B(7, 6, 22, 0x7b838c, 24, C.deckY + 13, 9);
  B(7.3, 1.7, 22.3, 0x1f2f3d, 24, C.deckY + 13.6, 9);
  B(5, 3, 10, 0x6f7780, 24, C.deckY + 17.5, 10);
  parts.push({ geo: new THREE.CylinderGeometry(0.5, 0.7, 15, 6), color: 0x8a9199, matrix: xform(24, C.deckY + 26, 8) });
  B(7, 2.6, 0.6, 0x8a9199, 24, C.deckY + 30, 8);
  B(1.2, 1.2, 9, 0x8a9199, 24, C.deckY + 22, 13);
  const body = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  body.receiveShadow = true;
  group.add(body);

  const deck = new THREE.Mesh(
    new THREE.PlaneGeometry(58, 288).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: deckTexture(), polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }),
  );
  deck.position.y = C.deckY + 0.02;
  deck.receiveShadow = true;
  group.add(deck);

  const pos = [];
  for (let z = -140; z <= 140; z += 20) pos.push(-29, C.deckY + 0.6, z, 29, C.deckY + 0.6, z);
  group.add(lightsPoints(pos, 0xbfe0ff, 5));
  scene.add(group);

  // collisions : coque (sous le pont) et îlot de commandement
  addBox(C.x, C.z, C.yaw, 24, 143, -6, C.deckY - 2.6);
  toWorld(C, 24, 11, _w);
  addBox(_w.x, _w.z, C.yaw, 5.5, 18, C.deckY, C.deckY + 33);
  return group;
}
