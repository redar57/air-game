import * as THREE from 'three';
import { buildTerrain, heightAt, normalAt, setBig, BIG, HALF } from './world/terrain.js';
import { defineAirfields, buildAirfields, buildCarrier, runways, carrier, runwayAt, onCarrierDeck, atFuelStation, atLoadPad, DECK_AXIS_X } from './world/airfields.js';
import { Sky } from './world/sky.js';
import { buildScenery } from './world/scenery.js';
import { hitObstacle } from './world/colliders.js';
import { defineThermals, updraft, buildThermalClouds, thermals } from './world/thermals.js';
import { IslandMap } from './world/map.js';
import { Birds } from './world/birds.js';
import { Boats } from './world/boats.js';
import { PLANES, STARTS, LIVERIES } from './planes/catalog.js';
import { createWaterBomber, createSprayer, canScoop } from './missions.js';
import { country, treatedShare } from './world/country.js';
import { save } from './save.js';
// la taille du monde se choisit avant toute construction (le bouton du menu recharge la page)
// ?grande dans l'adresse : ouvre la grande carte sans changer le choix enregistré
setBig(new URLSearchParams(location.search).has('grande') || save.get('bigMap'));
import { getModel, animateModel } from './planes/models.js';
import { drawInstruments } from './planes/instruments.js';
import { Plane, IDLE } from './flight/physics.js';
import { approachInfo } from './approach.js';
import { Missiles, Guns } from './weapons.js';
import { VERSION } from './version.js';
import { Tricks } from './flight/tricks.js';
import { CameraRig } from './camera.js';
import { Input, keyLabels } from './input.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { Effects } from './fx.js';
import { toWorld, clamp } from './util.js';

const STEP = 1 / 120;       // pas fixe de la physique
const EDGE = BIG ? 13600 : 7600; // au-delà (en mètres du centre), on est ramené en douceur
const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion(), _w = { x: 0, z: 0 };

const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 2, 32000);
function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

/** Ce que la physique a besoin de savoir du monde. */
const world = {
  groundAt(x, z, y) {
    if (y > carrier.deckY - 2.5 && onCarrierDeck(x, z)) return { h: carrier.deckY, type: 'carrier' };
    const h = heightAt(x, z);
    if (h < 0) return { h: 0, type: 'water' };
    if (runwayAt(x, z)) return { h: h + 0.12, type: 'runway' };
    return { h, type: 'land' };
  },
  normalAt,
  hit: hitObstacle,
  updraft,
  atFuel: atFuelStation,
};

let birds, boats, sky, scenery, rig, ui, fx, plane, model, missiles, guns, islandMap = null;
let mission = null; // bombardier d'eau (hélicoptère rouge), ou null
const _sv = new THREE.Vector3();
let kills = 0; // montgolfières abattues depuis le lancement
const input = new Input(), sound = new Sound(), tricks = new Tricks();
let state = 'loading';
let selPlane = 0, selStart = 0;
let time = 0, last = 0, accu = 0, frameNo = 0;
let crashT = 0, edgeWarned = false, show = { x: 0, y: 300, z: 0, yaw: 0 };
// valeurs dérivées pour les instruments (lissées)
const tele = { vs: 0, turn: 0, prev: null, gMax: 1, hdg: 0 };

// ---------------------------------------------------------------------------
function setPlane(i) {
  selPlane = (i + PLANES.length) % PLANES.length;
  const spec = PLANES[selPlane];
  if (model) scene.remove(model.root);
  plane = new Plane(spec);
  plane.fuelOn = !!save.get('fuel');
  model = getModel(spec, LIVERIES[save.livery(spec.id)]);
  scene.add(model.root);
  sky.setShadowSpan(Math.max(45, spec.span * 1.7));
  sound.setPlane(spec);
  ui.showPlane(spec, selPlane);
  ui.showLiveries(spec, save.livery(spec.id));
  ui.showFires(canScoop(spec), !!save.get('fires'));
  if (state === 'menu') save.set('plane', selPlane);
  if (state === 'menu') plane.placeInAir(show.x, show.y, show.z, show.yaw, 0);
}

function setStart(i) {
  if (state === 'menu') sound.click(false);
  selStart = (i + STARTS.length) % STARTS.length;
  ui.showStart(selStart);
  save.set('start', selStart);
}

function toggleFires() {
  if (!canScoop(plane.spec)) return;
  const on = !save.get('fires');
  save.set('fires', on);
  ui.showFires(true, on);
  sound.click(on);
}

function setLivery(i) {
  save.setLivery(plane.spec.id, i);
  setPlane(selPlane);
  thumb(selPlane);
}

function endMission() {
  if (mission) mission.dispose();
  mission = null;
  ui.mission(null); ui.result(null);
}

function enterMenu() {
  endMission();
  state = 'menu';
  missiles.reset(); guns.reset(); ui.lock(null); ui.sight(null);
  ui.pause(false); ui.hud(false); ui.clearHint(); ui.menu(true);
  rig.set('orbit');
  plane.placeInAir(show.x, show.y, show.z, show.yaw, 0);
}

function startFlight() {
  sound.start();
  const id = STARTS[selStart].id, spec = plane.spec;
  if (spec.glider && id !== 'vol') {
    // planeur : pas de moteur, on part en altitude au-dessus du terrain choisi
    const site = id === 'porte-avions' ? carrier : runways.find((r) => r.id === id);
    const y = (id === 'porte-avions' ? carrier.deckY : site.alt) + 380;
    toWorld(site, 0, id === 'porte-avions' ? 600 : site.length / 2 + 900, _w);
    plane.placeInAir(_w.x, y, _w.z, site.yaw, 30);
    ui.hint(ui.gliderHint);
  } else if (id === 'vol') {
    const rw = runways[0];
    plane.placeInAir(rw.x - 2200, rw.alt + 420, rw.z + 700, rw.yaw, spec.maxSpeed * 0.7);
    ui.hint(ui.flightHint.split(' · ').slice(2).join(' · '));
  } else {
    if (id === 'porte-avions') {
      toWorld(carrier, DECK_AXIS_X, 112, _w);
      plane.placeOnGround(_w.x, _w.z, carrier.yaw, world);
    } else {
      const rw = runways.find((r) => r.id === id);
      toWorld(rw, 0, rw.length / 2 - 40 - spec.len, _w);
      plane.placeOnGround(_w.x, _w.z, rw.yaw, world);
    }
    ui.hint(spec.heli ? ui.heliHint : ui.flightHint);
    sound.startup(spec);
  }
  state = 'fly';
  accu = 0; edgeWarned = false;
  tricks.reset();
  endMission();
  if (canScoop(spec)) {
    const fires = !!save.get('fires');
    mission = createWaterBomber({ scene, sound, ui, scenery, save, heightAt, normalAt, runways, fires, plane: () => plane });
    ui.mission(mission.hud());
    const how = spec.heli ? "Écope en stationnaire au ras de l'eau (mer ou lac)" : "Écope en rasant l'eau (mer ou lac), roues rentrées <kbd>G</kbd>";
    ui.hint(fires
      ? `${how}, puis maintiens <kbd>X</kbd> au-dessus des flammes · <kbd>N</kbd> carte des feux`
      : `${how}, puis maintiens <kbd>X</kbd> pour larguer`);
  } else if (spec.sprayer) {
    mission = createSprayer({ scene, sound, ui, fields: country.fields, atLoad: atLoadPad, treated: treatedShare, plane: () => plane });
    ui.mission(mission.hud());
    ui.hint(country.fields.length
      ? "Maintiens <kbd>X</kbd> en rase-mottes au-dessus des champs jaunes · recharge sur l'aire verte devant la grange de la Prairie"
      : "Maintiens <kbd>X</kbd> en rase-mottes pour épandre · les champs sont sur la grande carte");
  }
  tele.gMax = 1; tele.prev = null;
  ui.menu(false); ui.hud(true);
  rig.set('chase'); rig.snap(plane);
}

/** Cap le plus dégagé autour d'un point, et hauteur du relief dans cette direction. */
function clearestHeading(x, z) {
  let best = null;
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4, dx = Math.sin(a), dz = Math.cos(a);
    let top = 0;
    for (let d = 250; d <= 2500; d += 250) top = Math.max(top, heightAt(x + dx * d, z + dz * d));
    if (!best || top < best.top) best = { top, yaw: Math.atan2(-dx, -dz) };
  }
  return best;
}

function respawnInAir(x, z) {
  const b = clearestHeading(x, z);
  const y = Math.max(Math.max(heightAt(x, z), 0) + 260, b.top + 140);
  plane.placeInAir(x, y, z, b.yaw, plane.spec.maxSpeed * 0.7);
  state = 'fly';
  accu = 0;
  tricks.reset();
  tele.gMax = 1; tele.prev = null;
  rig.snap(plane);
}

function handleEvents() {
  for (const e of plane.events) {
    if (e.type === 'crash') {
      state = 'crash'; crashT = 2.4;
      if (mission && mission.onCrash) mission.onCrash();
      const water = e.kind === 'water';
      fx.explode(plane.pos, water, clamp(plane.spec.span / 11, 0.8, 2.6));
      if (water) sound.splash(); else sound.boom();
      input.rumble(1, 1, 700);
      ui.toast(e.why === 'wheels' ? "Capoté : roues sorties sur l'eau !" : water ? 'Plouf !' : 'Crash !', e.why ? 2600 : 1500);
    } else if (e.type === 'touchdown' && e.airTime > 2.5) {
      sound.touchdown(e.surface, e.sink);
      input.rumble(clamp(e.sink / 5, 0.2, 1), 0.5, 160);
      if (e.belly) ui.toast(e.floats ? 'Posé sur les flotteurs… (G sort les roues)' : 'Posé sur le ventre… (G sort le train)', 3200);
      else if (e.surface === 'carrier') ui.toast('Appontage réussi !');
      else if (e.surface === 'water') ui.toast('Amerrissage !');
      else if (e.surface === 'runway') ui.toast(e.sink < 2 ? 'Atterrissage en douceur !' : 'Posé !');
      else ui.toast("Posé dans l'herbe !");
      if (plane.spec.glider) ui.hint('Planeur posé : <kbd>Retour arrière</kbd> pour repartir en vol', 6000);
    } else if (e.type === 'catapult') { ui.toast('Catapulte !', 1400); sound.catapult(); }
    else if (e.type === 'gear') sound.gear(e.down);
    else if (e.type === 'failure') {
      ui.toast(e.what === 'stop' ? 'PANNE MOTEUR ! Pose-toi sur une piste' : 'Moteur affaibli ! Pose-toi pour réparer', 3200);
      sound.failure(); input.rumble(0.8, 0.8, 500);
    } else if (e.type === 'fuel') {
      if (e.what === 'low') { ui.toast("Carburant bas : direction la station devant les hangars de l'aéroport (⛽ sur la carte)", 3400); sound.chime(2); }
      else if (e.what === 'empty') { ui.toast(plane.spec.heli ? 'Panne sèche ! Autorotation…' : 'Panne sèche ! Plane jusqu\'à un terrain', 3200); sound.failure(); }
      else if (e.what === 'full') { ui.toast('Plein fait ⛽', 2000); sound.chime(1); }
    }
    else if (e.type === 'flaps') { sound.flaps(); if (e.blown) ui.toast('Volets rentrés : trop vite !', 1600); }
    else if (e.type === 'takeoff') ui.clearHint();
    else if (e.type === 'wheelsWater') ui.toast("Roues sorties dans l'eau : ça freine ! (G pour les rentrer)", 2200);
  }
  plane.events.length = 0;
}

function simulate(dt) {
  const inp = input.read();
  accu += dt;
  while (accu >= STEP && state === 'fly') {
    plane.step(STEP, inp, world);
    accu -= STEP;
    if (plane.events.length) handleEvents();
  }
  if (state !== 'fly') return;
  const msg = tricks.update(dt, plane);
  if (msg) ui.toast(mission && mission.onTrick ? mission.onTrick(msg) : msg);
  if (mission && state === 'fly') {
    const res = mission.update(dt, plane, input);
    if (frameNo % 4 === 0) ui.mission(mission.hud());
    if (res) { state = 'result'; ui.mission(mission.hud()); ui.result(res); sound.chime(res.isNew ? 3 : 2); return; }
  }

  // bord du monde : le large… on est ramené vers l'île sans mur invisible
  const d = Math.hypot(plane.pos.x, plane.pos.z);
  if (d > EDGE && !plane.onGround) {
    if (!edgeWarned) { edgeWarned = true; ui.toast("Rien que l'océan par ici… demi-tour", 3000); }
    const want = Math.atan2(plane.pos.x, plane.pos.z);            // cap vers le centre
    const have = Math.atan2(-plane.fwd.x, -plane.fwd.z);
    let diff = want - have;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const turn = clamp(diff, -1, 1) * clamp((d - EDGE) / 1200, 0, 1) * 0.7 * dt;
    plane.quat.premultiply(_q.setFromAxisAngle(Y, turn));
    plane.vel.applyAxisAngle(Y, turn);
  } else if (d < EDGE - 600) edgeWarned = false;
}

function handleKeys() {
  input.poll();
  for (const { code, key, stick } of input.take()) {
    if (stick && state !== 'menu') continue;
    if (state === 'menu') {
      if (code === 'ArrowUp' || code === 'KeyW') { setPlane(ui.step(-1)); sound.click(); }
      else if (code === 'ArrowDown' || code === 'KeyS') { setPlane(ui.step(1)); sound.click(); }
      else if (code === 'ArrowLeft' || code === 'KeyA') setStart(selStart - 1);
      else if (code === 'ArrowRight' || code === 'KeyD') setStart(selStart + 1);
      else if (code === 'PadLB') ui.cycleCat(-1);
      else if (code === 'PadRB') ui.cycleCat(1);
      else if (key === 'm') ui.setMute(sound.toggleMute());
      else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') startFlight();
      else if (key === 'i') toggleInvert();
      else if (key === 't') ui.setDaytime(sky.cycle());
      else if (key === 'f') toggleFires();
    } else if (state === 'result') {
      if (code === 'Enter' || code === 'NumpadEnter') { ui.result(null); startFlight(); }
      else if (code === 'Escape' || code === 'Backspace') enterMenu();
    } else if (state === 'pause') {
      if (code === 'Escape' || code === 'Enter' || key === 'p') resume();
    } else if (state === 'fly') {
      if (code === 'Escape' || key === 'p') { state = 'pause'; ui.pause(true); }
      else if (code === 'Backspace') respawnInAir(plane.pos.x, plane.pos.z);
      else if (key === 'c') ui.toast(rig.next(), 1300);
      else if (key === 'g') ui.toast(plane.toggleGear(), 1300);
      else if (key === 'v') ui.toast(plane.cycleFlaps(), 1300);
      else if (key === 'n') ui.bigMap(!ui.bigMapOpen);
      else if (key === 'x') {
        if (plane.spec.guns || mission) { /* tir / largage maintenus : gérés ailleurs */ }
        else if (!plane.spec.missiles) ui.toast('Armes : missiles sur le jet, mitrailleuses sur le chasseur, eau sur l\'hélicoptère rouge et l\'écopeur, produit sur l\'épandeur', 1800);
        else if (missiles.fire(plane, scenery.balloons)) input.rumble(0.25, 0.35, 120);
      }
      else if (key === 't') { const n = sky.cycle(); ui.toast(n, 1500); ui.setDaytime(n); }
      else if (key === 'h') ui.toggleHud();
      else if (key === 'm') { const m = sound.toggleMute(); ui.setMute(m); ui.toast(m ? 'Son coupé' : 'Son activé', 1200); }
    }
  }
}

function toggleInvert() {
  input.invert = !input.invert;
  ui.setInvert(input.invert);
  save.set('invert', input.invert);
}
function resume() {
  if (state !== 'pause') return;
  state = 'fly';
  ui.pause(false);
}

/** Mini-carte (toutes les 3 images) et grande carte si elle est ouverte. */
function drawMaps() {
  if (!islandMap) return;
  const extras = { thermals, balloons: scenery.balloons, fires: mission && mission.fires ? mission.fires : [], fuel: plane.fuelOn && !plane.spec.glider, load: !!plane.spec.sprayer };
  if (frameNo % 3 === 0) islandMap.drawMini(document.getElementById('minimap'), plane, tele.hdg, extras, plane.spec.maxSpeed > 120 ? 3500 : 2200);
  if (ui.bigMapOpen && frameNo % 4 === 0) islandMap.drawFull(document.getElementById('bigmapc'), plane, tele.hdg, extras);
}

/** Missiles en vol, montgolfières touchées, cadre de visée. */
function updateWeapons(dt) {
  const firing = state === 'fly' && input.fireHeld();
  const shot = guns.update(dt, plane, firing, world, scenery.balloons);
  if (guns.firing && frameNo % 6 === 0) input.rumble(0.15, 0.3, 90);
  // réticule du chasseur : là où convergent les canons
  if (state === 'fly' && plane.spec.guns && !plane.onGround) {
    guns.aimPoint(plane, _sv).project(camera);
    ui.sight(_sv.z < 1 ? (_sv.x + 1) / 2 * window.innerWidth : null, (1 - _sv.y) / 2 * window.innerHeight);
  } else ui.sight(null);
  for (const b of [...missiles.update(dt, world, scenery.balloons, camera.position), ...shot]) {
    scenery.pop(b);
    if (mission && mission.onPop) mission.onPop(b);
    // lambeaux d'enveloppe qui retombent
    for (let i = 0; i < 26; i++) {
      _sv.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(30);
      fx.emit(b.pos, _sv, 2.5 + Math.random() * 2, 1.2 + Math.random() * 1.6, i % 2 ? 0xe84c3d : 0xfff1d6, -0.2, 7);
    }
    ui.toast(`Montgolfière abattue ! (${++kills})`, 1800);
    input.rumble(0.4, 0.6, 220);
  }
  const lk = state === 'fly' ? missiles.updateLock(dt, plane, scenery.balloons) : null;
  if (lk) {
    const t = lk.target;
    _sv.copy(t.pos).project(camera);
    if (_sv.z < 1) {
      ui.lock((_sv.x + 1) / 2 * window.innerWidth, (1 - _sv.y) / 2 * window.innerHeight, t.pos.distanceTo(plane.pos), lk.progress);
      return;
    }
  }
  ui.lock(null);
}

/** Vignettes du menu : chaque appareil rendu de trois quarts avant, dans un petit moteur à part. */
let thumbR = null, thumbScene, thumbCam;
function thumb(i) {
  const W = 184, H = 112;
  if (!thumbR) {
    try { thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); } catch { return; }
    thumbR.setPixelRatio(1); thumbR.setSize(W, H, false);
    thumbScene = new THREE.Scene();
    thumbScene.add(new THREE.HemisphereLight(0xe4f1ff, 0x6c7a58, 2.3));
    const sun = new THREE.DirectionalLight(0xffffff, 2.6); sun.position.set(-4, 6, -3); thumbScene.add(sun);
    thumbCam = new THREE.PerspectiveCamera(28, W / H, 0.1, 1000);
  }
  const spec = PLANES[i], m = getModel(spec, LIVERIES[save.livery(spec.id)]);
  const keep = [m.cockpit.visible, m.hull.visible, ...m.props.map((p) => [p.blades.visible, p.disc.visible])];
  m.cockpit.visible = false; m.hull.visible = true;
  for (const p of m.props) { p.blades.visible = true; p.disc.visible = false; }
  const root = m.root.clone(true);
  m.cockpit.visible = keep[0]; m.hull.visible = keep[1];
  m.props.forEach((p, k) => { [p.blades.visible, p.disc.visible] = keep[2 + k]; });
  root.position.set(0, 0, 0); root.quaternion.identity();
  thumbScene.add(root);
  const d = Math.max(spec.span, spec.len) * 1.45;
  thumbCam.position.set(-0.95, 0.5, -1.05).normalize().multiplyScalar(d);
  thumbCam.lookAt(0, -spec.gearH * 0.15, 0);
  thumbR.render(thumbScene, thumbCam);
  ui.setThumb(i, thumbR.domElement.toDataURL('image/png'));
  thumbScene.remove(root);
}
function makeThumbs() { PLANES.forEach((_, i) => thumb(i)); }

/** Tout ce qu'affiche la planche de bord. */
function cockpitData() {
  const p = plane, s = p.spec;
  return {
    speed: p.speed, maxSpeed: s.maxSpeed, stall: s.stall, flapLimit: p.flapLimit, hasFlaps: !!s.flaps,
    alt: p.pos.y - p.standH, agl: p.agl, onGround: p.onGround, pitch: p.pitch, roll: p.roll,
    heading: tele.hdg, vs: tele.vs, turnRate: tele.turn, slip: p.vel.dot(p.right) / Math.max(p.speed, 1),
    gLoad: p.onGround ? 1 : p.gLoad, gMax: tele.gMax, gLimit: s.gLimit,
    jet: s.engine.kind === 'jet', engine: s.engine, rpm: clamp((p.rpm - IDLE) / (1 - IDLE), 0, 1.05),
    power: p.power, throttle: p.throttle, burner: p.burner,
    retract: s.retract, floats: s.floats, gear: p.gearAnim, flaps: p.flapAnim, stallWarn: !!p.stallWarn, brake: p.braking,
    gearWarn: s.retract && !p.onGround && p.agl < 80 && tele.vs < -0.5 && p.speed < s.stall * 1.6
      && (s.amphibian ? p.gearDown === (p.surface === 'water') : !p.gearDown),
    lowAlt: !p.onGround && p.agl < 60 && tele.vs < -6,
    fuel: p.fuelOn && !s.glider ? p.fuel : null, failure: p.fuelOn ? p.failure : null,
  };
}

// ---------------------------------------------------------------------------
function loop(now) {
  requestAnimationFrame(loop);
  frame(now);
}

function frame(now) {
  // jamais négatif (horloge qui recule, outil tick() de débogage), jamais énorme (onglet en arrière-plan)
  const dt = clamp((now - last) / 1000 || 0.016, 0, 0.05);
  last = now;
  frameNo++;
  handleKeys();
  const paused = state === 'pause';
  if (!paused) time += dt;

  if (state === 'fly') simulate(dt);
  else if (state === 'crash') { crashT -= dt; if (crashT <= 0) respawnInAir(plane.pos.x, plane.pos.z); }
  else if (state === 'menu') {
    plane.pos.set(show.x, show.y + Math.sin(time * 0.6) * 1.5, show.z);
    plane.quat.setFromAxisAngle(Y, show.yaw).multiply(_q.setFromEuler(new THREE.Euler(0.04, 0, Math.sin(time * 0.45) * 0.14)));
    plane.axes();
    plane.throttle = 0.75; plane.rpm = 0.8;
  }

  const cockpit = rig.mode === 'cockpit' && (state === 'fly' || paused);
  model.root.position.copy(plane.pos);
  model.root.quaternion.copy(plane.quat);
  model.root.visible = !plane.crashed;
  if (!paused) {
    animateModel(model, dt, {
      throttle: plane.power, gear: plane.gearAnim, burner: plane.burner, cockpitView: cockpit,
      ctrl: plane.ctrl, flaps: plane.flapAnim,
    });
    fx.update(dt);
    updateWeapons(dt);
    fx.updateTrails(dt, plane, model.tips,
      state === 'fly' && !plane.onGround && (plane.gLoad > 3.2 || plane.speed > plane.spec.maxSpeed * 0.93));
    rig.padLook(input.look.x, input.look.y, dt);
    if (state !== 'crash') rig.update(dt, plane, world, state === 'menu');
    if (state === 'fly' && plane.buffet > 0.3 && frameNo % 12 === 0) input.rumble(0.25 * plane.buffet, 0.4 * plane.buffet, 180);
    scenery.update(time, sky.night, dt);
    birds.update(dt, time, plane);
    boats.update(dt, time);
  }
  if (!paused) {
    const hdg = Math.atan2(plane.fwd.x, -plane.fwd.z);
    if (tele.prev !== null && dt > 0) {
      let d = hdg - tele.prev;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      tele.turn += (d / dt - tele.turn) * (1 - Math.exp(-4 * dt));
    }
    tele.prev = hdg; tele.hdg = hdg;
    tele.vs += (plane.vel.y + (plane.airLift || 0) - tele.vs) * (1 - Math.exp(-3 * dt));
    if (state === 'fly') tele.gMax = Math.max(tele.gMax, plane.gLoad);
  }
  if (cockpit && frameNo % 2 === 0) drawInstruments(cockpitData());

  const dist = Math.hypot(plane.pos.x, plane.pos.z);
  sky.update(dt, camera, plane.pos, 1 - 0.8 * clamp((dist - (EDGE - 1300)) / 3200, 0, 1));

  if (state === 'fly') {
    const flags = [];
    if (plane.stalling) flags.push('DÉCROCHAGE');
    if (plane.burner > 0) flags.push('POSTCOMBUSTION');
    if (plane.fuelOn && !plane.spec.glider && plane.fuel <= 0) flags.push('PANNE SÈCHE');
    if (plane.fuelOn && plane.refuelT > 0) flags.push('PLEIN EN COURS…');
    if (plane.flaps) flags.push(`VOLETS ${plane.flaps}`);
    if (!plane.onGround && plane.gLoad > 3) flags.push(`${plane.gLoad.toFixed(1)} G`);
    if (plane.spec.amphibian && !plane.onGround) flags.push(plane.gearDown ? (plane.surface === 'water' ? "ROUES SORTIES AU-DESSUS DE L'EAU" : 'ROUES SORTIES') : (plane.surface === 'water' ? '' : 'ROUES RENTRÉES'));
    else if (plane.spec.retract && plane.gearDown && !plane.onGround) flags.push('TRAIN SORTI');
    if (plane.onGround && plane.onBelly) flags.push(plane.spec.floats ? 'SUR LES FLOTTEURS' : 'SUR LE VENTRE');
    if (plane.braking) flags.push(plane.onGround ? 'FREINS' : 'AÉROFREINS');
    const vs = Math.abs(tele.vs) < 0.05 ? 0 : tele.vs;
    ui.setHud(String(Math.round(plane.speed * 3.6)), String(Math.max(0, Math.round(plane.pos.y - plane.standH))),
      String(Math.round(plane.throttle * 100)), flags.filter(Boolean).join(' · '), `${vs > 0 ? '▲' : vs < 0 ? '▼' : ''}${Math.abs(vs).toFixed(1)}`);
    ui.compass(tele.hdg);
    drawMaps();
    ui.fuel(plane.fuelOn && !plane.spec.glider ? plane.fuel : null);
    if (frameNo % 5 === 0) ui.approach(plane.agl < 900 ? approachInfo(plane, runways, carrier, DECK_AXIS_X) : null);
  } else ui.approach(null);
  sound.update({
    plane, camera, cockpit, dt, active: state === 'fly' || state === 'crash',
    engineOn: state === 'fly' && plane.engineRunning,
  });
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
async function boot() {
  const labels = await keyLabels();
  document.getElementById('version').textContent = `Version ${VERSION}`;
  defineAirfields();
  scene.add(buildTerrain(runways));
  buildAirfields(scene);
  buildCarrier(scene);
  sky = new Sky(scene);
  scenery = buildScenery(scene);
  defineThermals(heightAt, HALF * 1.82, BIG ? 30 : 14);
  if (BIG) STARTS.splice(2, 0, { id: 'baie', name: 'La Baie' }, { id: 'prairie', name: 'La Prairie' });
  buildThermalClouds(scene);
  birds = new Birds(scene, heightAt, thermals, runways);
  boats = new Boats(scene, heightAt, [{ x: carrier.x, z: carrier.z, r: 450 }]);
  fx = new Effects(scene);
  missiles = new Missiles(scene, fx, sound);
  guns = new Guns(scene, fx, sound);
  rig = new CameraRig(camera, canvas);
  ui = new UI(STARTS, labels, PLANES, LIVERIES);

  const rw = runways[0];
  show = { x: rw.x - 500, y: rw.alt + 250, z: rw.z + 1250, yaw: rw.yaw + 0.5 };

  ui.on('plane-select', (i) => { setPlane(i); sound.click(); });
  // le son ne peut démarrer qu'après un geste : dès le premier clic ou la première touche au menu
  const wake = () => { sound.start(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  window.addEventListener('pointerdown', wake); window.addEventListener('keydown', wake);
  ui.on('fires', toggleFires);
  ui.on('livery-select', setLivery);
  ui.on('bigmap', () => { save.set('bigMap', !BIG); ui.toast('Chargement de la carte…', 4000); setTimeout(() => location.reload(), 60); });
  ui.on('fuel', () => { const on = !save.get('fuel'); save.set('fuel', on); plane.fuelOn = on; ui.setFuel(on); });
  ui.on('daytime', () => ui.setDaytime(sky.cycle()));
  ui.on('mute', () => ui.setMute(sound.toggleMute()));
  ui.on('start-select', setStart);
  ui.on('go', startFlight);
  ui.on('invert', toggleInvert);
  ui.on('resume', resume);
  ui.on('again', () => { ui.result(null); startFlight(); });
  ui.on('menu', enterMenu);
  input.onPad = (on) => { ui.gamepad(on); ui.toast(on ? 'Manette connectée 🎮' : 'Manette déconnectée', 1800); };

  state = 'menu';
  // réglages gardés de la dernière partie
  input.invert = !!save.get('invert'); ui.setInvert(input.invert);
  ui.setFuel(!!save.get('fuel'));
  ui.setBigMap(BIG);
  setPlane(Math.min(save.get('plane') || 0, PLANES.length - 1));
  setStart(save.get('start') || 0);
  enterMenu();
  ui.loaded();
  setTimeout(makeThumbs, 50);
  // fond de carte : calculé une fois, sans bloquer l'affichage du menu
  setTimeout(() => { islandMap = new IslandMap(heightAt, runways, carrier, DECK_AXIS_X); }, 400);

  // petit accès pour le débogage depuis la console
  window.airgame = {
    get plane() { return plane; }, get state() { return state; },
    world, rig, sky, input, sound, get missiles() { return missiles; }, get guns() { return guns; }, get mission() { return mission; }, get scenery() { return scenery; }, get birds() { return birds; }, get boats() { return boats; }, runways, carrier, PLANES, heightAt, scene, camera, renderer,
    select(planeId, startId) {
      setPlane(PLANES.findIndex((p) => p.id === planeId));
      setStart(STARTS.findIndex((s) => s.id === startId));
      startFlight();
    },
    /** Avance la simulation sans attendre l'affichage ; renvoie les événements survenus. */
    run(seconds, inp = {}) {
      const full = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false, ...inp }, log = [];
      for (let t = 0; t < seconds && !plane.crashed; t += STEP) {
        plane.step(STEP, full, world);
        for (const e of plane.events) log.push({ ...e, t: +t.toFixed(2) });
        const m = tricks.update(STEP, plane);
        if (m) log.push({ type: 'trick', m, t: +t.toFixed(2) });
        if (plane.events.length) handleEvents();
      }
      return log;
    },
  };
  /** Fait tourner le jeu complet (images comprises) pendant n secondes simulées, sans attendre l'écran. */
  window.airgame.tick = (seconds) => { for (let t = 0; t < seconds; t += 1 / 60) frame(last + 1000 / 60); };
  last = performance.now();
  requestAnimationFrame(loop);
}

// setTimeout (et non requestAnimationFrame) : le chargement se fait même si l'onglet est en arrière-plan.
setTimeout(() => boot().catch((err) => {
  console.error(err);
  document.getElementById('loading').textContent = `Erreur au chargement : ${err.message}`;
}), 60);
