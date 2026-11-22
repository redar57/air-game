import * as THREE from 'three';
import { MTN, rawBase, BIG, LAKE, heightAt } from './terrain.js';
import { mergeColored, xform, toLocal, toWorld, clamp, smoothstep, lerp } from '../util.js';
import { addBox } from './colliders.js';
import { placeZones, definePlaces } from './places.js';

export const runways = [];
export const carrier = { x: 0, z: 0, yaw: -Math.PI / 2, deckY: 21, halfLen: 145, halfWid: 30 };
/** Station de carburant (devant les hangars de l'aéroport) : centre en coordonnées monde, demi-côté. */
export const fuelStation = { x: 0, z: 0, yaw: 0, lx: 0, lz: 0, half: 24 };
/** Aire de chargement de l'épandeur (devant la grange de la piste en herbe), repère local de sa piste. */
export const loadPad = { rw: null, lx: 0, lz: 0, half: 16, x: 0, z: 0 };
/**
 * Base nautique du lac (grande carte), faite pour l'écopeur : rampe de mise à l'eau, ponton, hangar,
 * pompe à carburant, et un plan d'eau balisé de bouées. Repère local : origine sur la rive, +Z vers le lac.
 */
export const seaBase = { active: false, x: 0, z: 0, yaw: 0, alt: 4, zone: null, fuel: { lx: 48, lz: -70, half: 14 } };
/**
 * Base militaire (grande carte) : sur l'îlot voisin du porte-avions. Piste, hangars, tour, radar, casernes,
 * hélisurfaces et aire d'embarquement des parachutistes (repère local de sa piste).
 */
export const milBase = { active: false, rw: null, board: { lx: 0, lz: 0, hw: 26, hd: 38, x: 0, z: 0 }, fuel: { lx: 0, lz: 0, half: 16 } };
/** Site de lancement de fusées, sur un îlot (c'est aussi sa zone aplanie). Repère local : le pas de tir vers -Z. */
export const launchSite = { x: 0, z: 0, yaw: 0, alt: 10, halfLen: 175, halfWid: 125, margin: 110 };
/** Hélisurfaces (base militaire, hôpital…) : { x, z, y, r, name }. */
export const helipads = [];
/** Pompes à carburant en plus de celle de l'aéroport : { x, z, yaw, half } (centre monde, demi-côté). */
export const extraPumps = [];
/** Objets animés à chaque image : { obj, rate } tourne sur lui-même (antenne), { tick(t) } fait ce qu'il veut. */
export const spinners = [];
/** Zones à aplanir : les pistes, plus l'esplanade de la base nautique. */
export function flatZones() { return [...runways, seaBase.zone, launchSite, ...placeZones].filter(Boolean); }
/** Matériaux des balises lumineuses (leur opacité suit la tombée de la nuit). */
export const nightLights = [];

const RUNWAY_LIFT = 0.12;
/** Grande carte : centres de l'aérodrome de la Baie et de la piste de la Prairie. */
const BAIE = { x: -6300, z: 800 }, PRAIRIE = { x: 8000, z: 300 };
const _l = { x: 0, z: 0 }, _w = { x: 0, z: 0 };

/** Choisit l'emplacement des pistes et du porte-avions (avant la construction du relief). */
export function defineAirfields() {
  // Aéroport principal : plaine côtière au sud (au sud-est sur la grande île).
  const ax0 = BIG ? 4300 : 500;
  let zc = BIG ? 0 : 1500;
  while (zc < (BIG ? 8000 : 5200) && rawBase(ax0, zc) > 2) zc += 25;
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
      id: 'baie', name: 'Aérodrome de la Baie', x: BAIE.x, z: BAIE.z, yaw: Math.atan2(-1, 0.25), style: 'coast',
      length: 900, width: 34, alt: Math.round(clamp(rawBase(BAIE.x, BAIE.z), 8, 60)), halfLen: 510, halfWid: 130, margin: 220, small: false,
    });
    // piste en herbe de la Prairie : pas de goudron, une grange, une manche à air, des bottes de foin
    runways.push({
      id: 'prairie', name: 'Piste de la Prairie', x: PRAIRIE.x, z: PRAIRIE.z, yaw: Math.atan2(-0.55, 0.84), style: 'grass',
      length: 700, width: 32, alt: Math.round(clamp(rawBase(PRAIRIE.x, PRAIRIE.z), 8, 160)), halfLen: 400, halfWid: 80, margin: 180, small: true,
    });
  }

  if (BIG) {
    // base militaire sur l'îlot au nord-est du porte-avions (au sud de l'île)
    const rw = {
      id: 'militaire', name: 'Base militaire', x: 4700, z: 8050, yaw: -Math.PI / 2 + 0.3, style: 'military',
      length: 1100, width: 40, alt: 12, halfLen: 620, halfWid: 235, margin: 230, small: false,
    };
    runways.push(rw);
    milBase.active = true; milBase.rw = rw;
    const side = rw.width / 2;
    Object.assign(milBase.board, { lx: side + 62, lz: 150 });
    toWorld(rw, milBase.board.lx, milBase.board.lz, _w); milBase.board.x = _w.x; milBase.board.z = _w.z;
    Object.assign(milBase.fuel, { lx: side + 55, lz: -330 });
    toWorld(rw, milBase.fuel.lx, milBase.fuel.lz, _w);
    extraPumps.push({ x: _w.x, z: _w.z, yaw: rw.yaw, half: milBase.fuel.half });
    for (const [lx, lz] of [[side + 95, 300], [side + 95, 370]]) {
      toWorld(rw, lx, lz, _w);
      helipads.push({ x: _w.x, z: _w.z, y: rw.alt, r: 12, name: 'Base militaire', base: true });
    }
  }

  Object.assign(launchSite, BIG ? { x: 12000, z: 5400, yaw: 0.5 } : { x: 3500, z: 4300, yaw: 0.8 });
  toWorld(launchSite, -78, -5, _w);
  helipads.push({ x: _w.x, z: _w.z, y: launchSite.alt, r: 12, name: 'Site de lancement', launch: true });

  if (BIG) {
    // base nautique sur la rive nord-ouest du lac : on part du centre du lac jusqu'à la terre ferme
    const dx = -0.55, dz = -0.83;
    let r = 200;
    while (r < 3000 && rawBase(LAKE.x + dx * r, LAKE.z + dz * r) < 0.5) r += 10;
    Object.assign(seaBase, { active: true, x: LAKE.x + dx * r, z: LAKE.z + dz * r, yaw: Math.atan2(-dx, -dz) });
    toWorld(seaBase, 0, -40, _w);
    seaBase.alt = Math.round(clamp(rawBase(_w.x, _w.z), 4, 10)); // esplanade basse : la rampe reste douce
    toWorld(seaBase, 0, -110, _w);
    seaBase.zone = { x: _w.x, z: _w.z, yaw: seaBase.yaw, halfLen: 60, halfWid: 90, margin: 60, alt: seaBase.alt };
    seaBase.site = { x: seaBase.x, z: seaBase.z, yaw: seaBase.yaw + Math.PI, alt: seaBase.alt, length: 200 };
  }

  const grass = runways.find((r) => r.style === 'grass');
  if (grass) {
    loadPad.rw = grass; loadPad.lx = grass.width / 2 + 40; loadPad.lz = grass.length / 2 - 168;
    toWorld(grass, loadPad.lx, loadPad.lz, _w); loadPad.x = _w.x; loadPad.z = _w.z;
  }

  const main = runways[0];
  fuelStation.lx = main.width / 2 + 47; fuelStation.lz = main.length / 2 - 260;
  toWorld(main, fuelStation.lx, fuelStation.lz, _w);
  fuelStation.x = _w.x; fuelStation.z = _w.z; fuelStation.yaw = main.yaw; fuelStation.rw = main;

  definePlaces();
  carrier.x = BIG ? ax0 : -1900;
  carrier.z = zc + (BIG ? 3200 : 2000);
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
  for (const p of extraPumps) {
    toLocal(p, x, z, _l);
    if (Math.abs(_l.x) <= p.half && Math.abs(_l.z) <= p.half) return true;
  }
  if (seaBase.active) { // seconde pompe, à la base nautique
    toLocal(seaBase, x, z, _l);
    if (Math.abs(_l.x - seaBase.fuel.lx) <= seaBase.fuel.half && Math.abs(_l.z - seaBase.fuel.lz) <= seaBase.fuel.half) return true;
  }
  if (!fuelStation.rw) return false;
  toLocal(fuelStation.rw, x, z, _l);
  return Math.abs(_l.x - fuelStation.lx) <= fuelStation.half && Math.abs(_l.z - fuelStation.lz) <= fuelStation.half;
}

/** Vrai si (x, z) est sur l'aire d'embarquement des parachutistes de la base militaire. */
export function atBoarding(x, z) {
  if (!milBase.active) return false;
  toLocal(milBase.rw, x, z, _l);
  const b = milBase.board;
  return Math.abs(_l.x - b.lx) <= b.hw && Math.abs(_l.z - b.lz) <= b.hd;
}

/** Vrai si (x, z) est sur l'aire de chargement de l'épandeur (à défaut, la station de carburant). */
export function atLoadPad(x, z) {
  if (!loadPad.rw) return atFuelStation(x, z);
  toLocal(loadPad.rw, x, z, _l);
  return Math.abs(_l.x - loadPad.lx) <= loadPad.half && Math.abs(_l.z - loadPad.lz) <= loadPad.half;
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

let _padTex = null;
/** Texture d'hélisurface : disque sombre, cercle jaune et grand H (croix rouge si `cross`). */
function padTexture() {
  if (_padTex) return _padTex;
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#3f4349'; g.beginPath(); g.arc(128, 128, 127, 0, 6.283); g.fill();
  g.strokeStyle = '#f2c230'; g.lineWidth = 12; g.beginPath(); g.arc(128, 128, 104, 0, 6.283); g.stroke();
  g.fillStyle = '#f4f4ee';
  g.fillRect(78, 58, 26, 140); g.fillRect(152, 58, 26, 140); g.fillRect(104, 115, 48, 26);
  _padTex = new THREE.CanvasTexture(cv); _padTex.colorSpace = THREE.SRGBColorSpace; _padTex.anisotropy = 8;
  return _padTex;
}
/** Hélisurface posée en (x, y, z), de rayon r, avec quatre balises lumineuses pour la nuit. */
export function helipadMesh(x, y, z, r) {
  const g = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 32).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: padTexture(), transparent: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
  disc.position.y = 0.2; disc.receiveShadow = true;
  g.add(disc);
  const pos = [];
  for (let k = 0; k < 8; k++) pos.push(Math.cos(k * 0.785) * (r + 1), 0.6, Math.sin(k * 0.785) * (r + 1));
  g.add(lightsPoints(pos, 0x9fe08a, 3.5));
  g.position.set(x, y, z);
  return g;
}

export function lightsPoints(positions, color, size) {
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
      // aire de chargement de l'épandeur : cadre vert, cuve de produit sur pieds et son tuyau
      const px = loadPad.lx, pz = loadPad.lz, hp = loadPad.half;
      for (const [w, d, x, z] of [[hp * 2, 0.9, px, pz - hp], [hp * 2, 0.9, px, pz + hp], [0.9, hp * 2, px - hp, pz], [0.9, hp * 2, px + hp, pz]]) B(w, 0.06, d, 0x3f9e4a, x, 0.08, z);
      for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) B(0.25, 3, 0.25, 0x8a9199, px + hp + 6 + dx, 1.5, pz + dz);
      parts.push({ geo: new THREE.CylinderGeometry(2.3, 2.3, 4.6, 12).rotateZ(Math.PI / 2), color: 0xf4f4f0, matrix: xform(px + hp + 6, 5.1, pz, Math.PI / 2) });
      B(0.9, 0.9, 4.7, 0x3f9e4a, px + hp + 6, 5.1, pz);
      B(hp - 2, 0.18, 0.18, 0x23272d, px + hp / 2 + 3, 0.3, pz);
      collide(px + hp + 6, pz, 2.5, 2.5, 7.5);
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
    } else if (rw.style === 'military') {
      const OL = 0x5f6b45, OD = 0x46502f, SA = 0xcdbf98, CO = 0x8f9399;
      // grand parking en béton le long de la piste, et bretelles
      B(150, 0.3, 860, 0x6e7177, side + 85, 0.05, 0);
      for (const z of [-300, 0, 300]) B(22, 0.3, 30, 0x6e7177, side + 4, 0.04, z);
      // hangars voûtés camouflés, portes tournées vers la piste
      for (const [z, col] of [[-210, OL], [-145, OD], [-80, OL]]) {
        const x = side + 150, w = 46, h = 10, d = 40;
        B(d, h, w, col, x, h / 2, z);
        parts.push({ geo: new THREE.CylinderGeometry(w / 2, w / 2, d, 10, 1, false, -Math.PI / 2, Math.PI), color: col, matrix: xform(x, h, z, Math.PI / 2, 1, 1, 0.42, -Math.PI / 2) });
        B(0.5, h * 0.85, w * 0.7, 0x3a3f36, x - d / 2 - 0.1, h * 0.42, z);
        collide(x, z, d / 2, w / 2, h + w * 0.21);
      }
      // tour de contrôle carrée en béton, vigie vitrée
      const tx = side + 125, tz = 60;
      B(8, 18, 8, CO, tx, 9, tz); B(11, 4, 11, 0x29495f, tx, 20, tz); B(12, 0.8, 12, CO, tx, 22.4, tz);
      C(0.12, 0.12, 6, 0x8a9199, tx + 3, 25.8, tz, 5);
      collide(tx, tz, 6, 6, 23);
      // bâtiment de commandement
      B(36, 7, 16, SA, side + 135, 3.5, 110); B(37, 0.8, 17, OD, side + 135, 7.3, 110);
      collide(side + 135, 110, 18, 8, 8);
      // casernes
      for (let k = 0; k < 4; k++) {
        const z = 200 + k * 42;
        B(16, 5, 34, SA, side + 190, 2.5, z);
        const tri = new THREE.Shape([new THREE.Vector2(-8.6, 0), new THREE.Vector2(8.6, 0), new THREE.Vector2(0, 3.4)]);
        parts.push({ geo: new THREE.ExtrudeGeometry(tri, { depth: 35, bevelEnabled: false }), color: OD, matrix: xform(side + 190, 5, z - 17.5) });
        collide(side + 190, z, 8, 17, 8.4);
      }
      // terrain de rassemblement (le mât, le drapeau et le reste du décor : milbase.js)
      B(40, 0.08, 40, 0xb9ab86, side + 135, 0.2, 165);
      // aire d'embarquement des parachutistes : cadre vert et pelotons alignés au bord
      const bx = milBase.board.lx, bz = milBase.board.lz, hw = milBase.board.hw, hd = milBase.board.hd;
      for (const [w, d, x, z] of [[hw * 2, 1, bx, bz - hd], [hw * 2, 1, bx, bz + hd], [1, hd * 2, bx - hw, bz], [1, hd * 2, bx + hw, bz]]) B(w, 0.06, d, 0x3fae4a, x, 0.33, z);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 6; j++) {
        const x = bx + hw + 6 + i * 1.6, z = bz - 6 + j * 1.5;
        B(0.55, 1.2, 0.4, OL, x, 0.9, z); B(0.42, 0.42, 0.42, 0xd9b48f, x, 1.7, z); B(0.5, 0.2, 0.5, OD, x, 1.98, z);
        B(0.45, 0.6, 0.3, 0x4a4a3a, x + 0.3, 1.1, z);
      }
      // carburant : aire jaune, deux citernes
      const fx = milBase.fuel.lx, fz = milBase.fuel.lz, hf = milBase.fuel.half;
      for (const [w, d, x, z] of [[hf * 2, 0.9, fx, fz - hf], [hf * 2, 0.9, fx, fz + hf], [0.9, hf * 2, fx - hf, fz], [0.9, hf * 2, fx + hf, fz]]) B(w, 0.06, d, 0xf2c230, x, 0.33, z);
      for (const dz of [-8, 8]) {
        parts.push({ geo: new THREE.CylinderGeometry(3.2, 3.2, 12, 12).rotateX(Math.PI / 2), color: 0xd9dcdf, matrix: xform(fx + hf + 14, 3.6, fz + dz, Math.PI / 2) });
        collide(fx + hf + 14, fz + dz, 6, 3.3, 7);
      }
      // véhicules garés : camions bâchés et jeeps
      for (let k = 0; k < 5; k++) {
        const x = side + 100, z = -20 + k * 9;
        B(2.4, 1.2, 7, OD, x, 1.2, z); B(2.4, 1.6, 2.2, OL, x, 2.1, z - 2.6); B(2.5, 2.2, 4.6, OL, x, 2.8, z + 1.1);
      }
      for (let k = 0; k < 3; k++) { const x = side + 112, z = -14 + k * 8; B(1.8, 1, 3.6, OL, x, 0.9, z); B(1.6, 0.7, 1.2, 0x2b3027, x, 1.7, z + 0.4); }
      // de l'autre côté de la piste : soutes à munitions couvertes de terre, manche à air
      for (let k = 0; k < 3; k++) {
        const z = -320 + k * 70;
        parts.push({ geo: new THREE.SphereGeometry(14, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2), color: 0x6f9a4a, matrix: xform(-side - 110, 0, z, 0, 1, 0.5, 1.4) });
        B(7, 5, 1, CO, -side - 110, 2.5, z - 19.4);
        collide(-side - 110, z, 13, 19, 7);
      }
      C(0.18, 0.22, 9, 0x9a9a9a, -side - 30, 4.5, -L / 2 + 120, 6);
      parts.push({ geo: new THREE.CylinderGeometry(0.4, 1.0, 4, 8, 1, true).rotateZ(Math.PI / 2), color: 0xf07a1e, matrix: xform(-side - 28, 8.7, -L / 2 + 120) });
      // radar : pylône (l'antenne tournante est ajoutée à part)
      const rx = side + 175, rz = -380;
      for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) B(0.4, 14, 0.4, 0x9aa0a6, rx + dx, 7, rz + dz);
      B(5, 0.6, 5, CO, rx, 14.2, rz);
      collide(rx, rz, 3, 3, 20);
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
    if (rw.style === 'military') {
      const radar = new THREE.Mesh(mergeColored([
        { geo: new THREE.BoxGeometry(9, 3.2, 0.4), color: 0xe8eaec, matrix: xform(0, 2, 0.6, 0, 1, 1, 1, -0.25) },
        { geo: new THREE.BoxGeometry(0.6, 2, 0.6), color: 0x6b7178, matrix: xform(0, 0.5, 0) },
      ]), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      toWorld(rw, side + 175, -380, _w);
      radar.position.set(_w.x, rw.alt + 14.5, _w.z);
      scene.add(radar);
      spinners.push({ obj: radar, rate: 1.1 });
      for (const p of helipads) if (p.base) scene.add(helipadMesh(p.x, p.y, p.z, p.r));
    }

    // balisage nocturne
    const pos = [];
    if (rw.style === 'military') {
      const fx = milBase.fuel.lx, fz = milBase.fuel.lz, hf = milBase.fuel.half;
      for (const [x, z] of [[-hf, -hf], [hf, -hf], [hf, hf], [-hf, hf]]) pos.push(fx + x, 0.7, fz + z);
    }
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
/** Construit la base nautique (si elle existe). */
export function buildSeaBase(scene) {
  if (!seaBase.active) return;
  const S = seaBase, parts = [], y0 = S.alt;
  const B = (w, h, d, color, x, y, z, ry = 0) => parts.push({ geo: new THREE.BoxGeometry(w, h, d), color, matrix: xform(x, y, z, ry) });
  const C = (rt, rb, h, color, x, y, z, seg = 10) => parts.push({ geo: new THREE.CylinderGeometry(rt, rb, h, seg), color, matrix: xform(x, y, z) });
  const collide = (x, z, hw, hd, h) => { toWorld(S, x, z, _w); addBox(_w.x, _w.z, S.yaw, hw, hd, y0, y0 + h); };
  // esplanade
  B(170, 0.3, 120, 0x8c9096, 0, y0 + 0.05, -110);
  // hangar des écopeurs : grande porte tournée vers le lac, toit rouge en arc
  const hx = -45, hz = -135;
  B(46, 13, 40, 0xeef0f2, hx, y0 + 6.5, hz);
  parts.push({ geo: new THREE.CylinderGeometry(23, 23, 40, 10, 1, false, -Math.PI / 2, Math.PI), color: 0xc8402f, matrix: xform(hx, y0 + 13, hz, 0, 1, 1, 0.42, -Math.PI / 2) });
  B(32, 11, 0.5, 0x4a5058, hx, y0 + 5.5, hz + 20.1);
  B(46.4, 1.4, 40.4, 0xf2c230, hx, y0 + 11.6, hz);
  collide(hx, hz, 23, 20, 20);
  // bâtiment des opérations avec sa vigie
  const ox = 45, oz = -145;
  B(26, 8, 16, 0xf6f3ec, ox, y0 + 4, oz);
  B(26.3, 1.2, 16.3, 0xc8402f, ox, y0 + 6.2, oz);
  B(9, 4, 9, 0x2a4a62, ox + 6, y0 + 10, oz);
  B(10, 0.6, 10, 0xf6f3ec, ox + 6, y0 + 12.3, oz);
  C(0.15, 0.15, 9, 0x8a9199, ox - 8, y0 + 12.5, oz, 5);
  collide(ox, oz, 13, 8, 13);
  // pompe à carburant (aire jaune)
  const { lx: fx, lz: fz, half: hf } = S.fuel;
  for (const [w, d, x, z] of [[hf * 2, 0.9, fx, fz - hf], [hf * 2, 0.9, fx, fz + hf], [0.9, hf * 2, fx - hf, fz], [0.9, hf * 2, fx + hf, fz]]) B(w, 0.06, d, 0xf2c230, x, y0 + 0.24, z);
  B(1.4, 2.2, 1, 0xd8402f, fx + hf + 3, y0 + 1.2, fz);
  B(3.4, 0.3, 4, 0xf2c230, fx + hf + 3, y0 + 4.2, fz);
  for (const dz of [-1.6, 1.6]) B(0.25, 4, 0.25, 0xb9bec4, fx + hf + 3, y0 + 2.1, fz + dz);
  // manche à air
  C(0.18, 0.22, 9, 0x9a9a9a, -85, y0 + 4.5, -60, 6);
  parts.push({ geo: new THREE.CylinderGeometry(0.4, 1.0, 4, 8, 1, true).rotateZ(Math.PI / 2), color: 0xf07a1e, matrix: xform(-83, y0 + 8.7, -60) });
  const decor = new THREE.Mesh(mergeColored(parts), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  decor.position.set(S.x, 0, S.z); decor.rotation.y = S.yaw; decor.receiveShadow = true;
  scene.add(decor);

  // rampe de mise à l'eau (suit la berge, puis plonge sous l'eau) et ponton en bois
  const ramp = [], dock = [], W = 15;
  const P = (lx, lz) => { toWorld(S, lx, lz, _w); return [_w.x, _w.z]; };
  for (let lz = -55; lz < 60; lz += 5) {
    const row = [];
    for (const lx of [-W, W]) for (const z of [lz, lz + 5]) {
      const [x, wz] = P(lx, z);
      row.push([x, Math.max(heightAt(x, wz) + 0.25, -1.8), wz]);
    }
    const [a, b, c, d] = [row[0], row[1], row[2], row[3]]; // (-W,lz) (-W,lz+5) (W,lz) (W,lz+5)
    ramp.push(...a, ...b, ...c, ...c, ...b, ...d);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(ramp, 3));
  rg.computeVertexNormals();
  const rmesh = new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ color: 0xa3a7ab, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
  rmesh.receiveShadow = true;
  scene.add(rmesh);
  for (let lz = -10; lz <= 110; lz += 6) {
    dock.push({ geo: new THREE.BoxGeometry(4, 0.3, 6.1), color: 0x9a7650, matrix: xform(40, 0.7, lz) });
    for (const s of [-1, 1]) dock.push({ geo: new THREE.CylinderGeometry(0.22, 0.22, 4, 6), color: 0x6b5036, matrix: xform(40 + s * 1.8, -1, lz) });
  }
  dock.push({ geo: new THREE.BoxGeometry(24, 0.3, 6), color: 0x9a7650, matrix: xform(40, 0.7, 114) });
  const dmesh = new THREE.Mesh(mergeColored(dock), new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  dmesh.position.set(S.x, 0, S.z); dmesh.rotation.y = S.yaw;
  scene.add(dmesh);

  // bouées jaunes : deux lignes qui balisent le plan d'eau d'écopage, le long du grand axe du lac
  const buoy = mergeColored([
    { geo: new THREE.CylinderGeometry(0.9, 1.1, 1.4, 8), color: 0xf2c230, matrix: xform(0, 0.3, 0) },
    { geo: new THREE.ConeGeometry(0.7, 1.4, 8), color: 0xf2c230, matrix: xform(0, 1.7, 0) },
  ]);
  const spots = [];
  for (let x = -LAKE.rx * 0.75; x <= LAKE.rx * 0.75; x += 150) for (const dz of [-70, 70]) {
    const bx = LAKE.x + x, bz = LAKE.z + dz;
    if (heightAt(bx, bz) < -2) spots.push([bx, bz]);
  }
  const im = new THREE.InstancedMesh(buoy, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), spots.length);
  const m4 = new THREE.Matrix4();
  spots.forEach(([x, z], i) => im.setMatrixAt(i, m4.makeTranslation(x, 0, z)));
  scene.add(im);
  const lp = [];
  spots.forEach(([x, z]) => lp.push(x, 2.8, z));
  scene.add(lightsPoints(lp, 0xffd34d, 4));
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
