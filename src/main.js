import * as THREE from 'three';
import { buildTerrain, heightAt, normalAt } from './world/terrain.js';
import { defineAirfields, buildAirfields, buildCarrier, runways, carrier, runwayAt, onCarrierDeck, DECK_AXIS_X } from './world/airfields.js';
import { Sky } from './world/sky.js';
import { buildScenery } from './world/scenery.js';
import { hitObstacle } from './world/colliders.js';
import { PLANES, STARTS } from './planes/catalog.js';
import { getModel, animateModel } from './planes/models.js';
import { drawInstruments } from './planes/instruments.js';
import { Plane, IDLE } from './flight/physics.js';
import { approachInfo } from './approach.js';
import { Missiles } from './weapons.js';
import { VERSION } from './version.js';
import { Tricks } from './flight/tricks.js';
import { CameraRig } from './camera.js';
import { Input, keyLabels } from './input.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { Effects } from './fx.js';
import { toWorld, clamp } from './util.js';

const STEP = 1 / 120;       // pas fixe de la physique
const EDGE = 7600;          // au-delà (en mètres du centre de l'île), on est ramené en douceur
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
};

let sky, scenery, rig, ui, fx, plane, model, missiles;
const _sv = new THREE.Vector3();
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
  model = getModel(spec);
  scene.add(model.root);
  sky.setShadowSpan(Math.max(45, spec.span * 1.7));
  sound.setPlane(spec);
  ui.showPlane(spec);
  if (state === 'menu') plane.placeInAir(show.x, show.y, show.z, show.yaw, 0);
}

function setStart(i) {
  selStart = (i + STARTS.length) % STARTS.length;
  ui.showStart(selStart);
}

function enterMenu() {
  state = 'menu';
  missiles.reset(); ui.lock(null);
  ui.pause(false); ui.hud(false); ui.clearHint(); ui.menu(true);
  rig.set('orbit');
  plane.placeInAir(show.x, show.y, show.z, show.yaw, 0);
}

function startFlight() {
  sound.start();
  const id = STARTS[selStart].id, spec = plane.spec;
  if (id === 'vol') {
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
    ui.hint(ui.flightHint);
  }
  state = 'fly';
  accu = 0; edgeWarned = false;
  tricks.reset();
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
      const water = e.kind === 'water';
      fx.explode(plane.pos, water, clamp(plane.spec.span / 11, 0.8, 2.6));
      if (water) sound.splash(); else sound.boom();
      input.rumble(1, 1, 700);
      ui.toast(water ? 'Plouf !' : 'Crash !', 1500);
    } else if (e.type === 'touchdown' && e.airTime > 2.5) {
      sound.touchdown(e.surface, e.sink);
      input.rumble(clamp(e.sink / 5, 0.2, 1), 0.5, 160);
      if (e.belly) ui.toast('Posé sur le ventre… (G sort le train)', 3200);
      else if (e.surface === 'carrier') ui.toast('Appontage réussi !');
      else if (e.surface === 'water') ui.toast('Amerrissage !');
      else if (e.surface === 'runway') ui.toast(e.sink < 2 ? 'Atterrissage en douceur !' : 'Posé !');
      else ui.toast("Posé dans l'herbe !");
    } else if (e.type === 'catapult') { ui.toast('Catapulte !', 1400); sound.catapult(); }
    else if (e.type === 'gear') sound.gear(e.down);
    else if (e.type === 'flaps') { sound.flaps(); if (e.blown) ui.toast('Volets rentrés : trop vite !', 1600); }
    else if (e.type === 'takeoff') ui.clearHint();
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
  if (msg) ui.toast(msg);

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
      if (code === 'ArrowLeft' || code === 'KeyA') setPlane(selPlane - 1);
      else if (code === 'ArrowRight' || code === 'KeyD') setPlane(selPlane + 1);
      else if (code === 'ArrowUp' || code === 'KeyW') setStart(selStart - 1);
      else if (code === 'ArrowDown' || code === 'KeyS') setStart(selStart + 1);
      else if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') startFlight();
      else if (key === 'i') toggleInvert();
      else if (key === 't') sky.cycle();
    } else if (state === 'pause') {
      if (code === 'Escape' || code === 'Enter' || key === 'p') resume();
    } else if (state === 'fly') {
      if (code === 'Escape' || key === 'p') { state = 'pause'; ui.pause(true); }
      else if (code === 'Backspace') respawnInAir(plane.pos.x, plane.pos.z);
      else if (key === 'c') ui.toast(rig.next(), 1300);
      else if (key === 'g') ui.toast(plane.toggleGear(), 1300);
      else if (key === 'v') ui.toast(plane.cycleFlaps(), 1300);
      else if (key === 'x') {
        if (!plane.spec.missiles) ui.toast('Missiles : seulement sur le jet de chasse', 1500);
        else if (missiles.fire(plane, scenery.balloons)) input.rumble(0.25, 0.35, 120);
      }
      else if (key === 't') ui.toast(sky.cycle(), 1500);
      else if (key === 'h') ui.toggleHud();
      else if (key === 'm') ui.toast(sound.toggleMute() ? 'Son coupé' : 'Son activé', 1200);
    }
  }
}

function toggleInvert() {
  input.invert = !input.invert;
  ui.setInvert(input.invert);
}
function resume() {
  if (state !== 'pause') return;
  state = 'fly';
  ui.pause(false);
}

/** Missiles en vol, montgolfières touchées, cadre de visée. */
function updateWeapons(dt) {
  for (const b of missiles.update(dt, world, scenery.balloons, camera.position)) {
    scenery.pop(b);
    // lambeaux d'enveloppe qui retombent
    for (let i = 0; i < 26; i++) {
      _sv.set(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(30);
      fx.emit(b.pos, _sv, 2.5 + Math.random() * 2, 1.2 + Math.random() * 1.6, i % 2 ? 0xe84c3d : 0xfff1d6, -0.2, 7);
    }
    ui.toast(`Montgolfière abattue ! (${missiles.hits})`, 1800);
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
    gearWarn: s.retract && !p.gearDown && !p.onGround && p.agl < 80 && tele.vs < -0.5 && p.speed < s.stall * 1.6,
    lowAlt: !p.onGround && p.agl < 60 && tele.vs < -6,
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
  }
  if (!paused) {
    const hdg = Math.atan2(plane.fwd.x, -plane.fwd.z);
    if (tele.prev !== null && dt > 0) {
      let d = hdg - tele.prev;
      if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
      tele.turn += (d / dt - tele.turn) * (1 - Math.exp(-4 * dt));
    }
    tele.prev = hdg; tele.hdg = hdg;
    tele.vs += (plane.vel.y - tele.vs) * (1 - Math.exp(-3 * dt));
    if (state === 'fly') tele.gMax = Math.max(tele.gMax, plane.gLoad);
  }
  if (cockpit && frameNo % 2 === 0) drawInstruments(cockpitData());

  const dist = Math.hypot(plane.pos.x, plane.pos.z);
  sky.update(dt, camera, plane.pos, 1 - 0.8 * clamp((dist - 6300) / 3200, 0, 1));

  if (state === 'fly') {
    const flags = [];
    if (plane.stalling) flags.push('DÉCROCHAGE');
    if (plane.burner > 0) flags.push('POSTCOMBUSTION');
    if (plane.flaps) flags.push(`VOLETS ${plane.flaps}`);
    if (!plane.onGround && plane.gLoad > 3) flags.push(`${plane.gLoad.toFixed(1)} G`);
    if (plane.spec.retract && plane.gearDown && !plane.onGround) flags.push('TRAIN SORTI');
    if (plane.onGround && plane.retractUp) flags.push('SUR LE VENTRE');
    if (plane.braking) flags.push(plane.onGround ? 'FREINS' : 'AÉROFREINS');
    const vs = Math.abs(tele.vs) < 0.05 ? 0 : tele.vs;
    ui.setHud(String(Math.round(plane.speed * 3.6)), String(Math.max(0, Math.round(plane.pos.y - plane.standH))),
      String(Math.round(plane.throttle * 100)), flags.join(' · '), `${vs > 0 ? '▲' : vs < 0 ? '▼' : ''}${Math.abs(vs).toFixed(1)}`);
    ui.compass(tele.hdg);
    if (frameNo % 5 === 0) ui.approach(plane.agl < 900 ? approachInfo(plane, runways, carrier, DECK_AXIS_X) : null);
  } else ui.approach(null);
  sound.update({
    plane, camera, cockpit, dt, active: state === 'fly' || state === 'crash',
    engineOn: state === 'fly',
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
  fx = new Effects(scene);
  missiles = new Missiles(scene, fx, sound);
  rig = new CameraRig(camera, canvas);
  ui = new UI(STARTS, labels);

  const rw = runways[0];
  show = { x: rw.x - 500, y: rw.alt + 250, z: rw.z + 1250, yaw: rw.yaw + 0.5 };

  ui.on('plane', (d) => setPlane(selPlane + d));
  ui.on('start-select', setStart);
  ui.on('go', startFlight);
  ui.on('invert', toggleInvert);
  ui.on('resume', resume);
  ui.on('menu', enterMenu);
  input.onPad = (on) => { ui.gamepad(on); ui.toast(on ? 'Manette connectée 🎮' : 'Manette déconnectée', 1800); };

  state = 'menu';
  setPlane(0);
  setStart(0);
  enterMenu();
  ui.loaded();

  // petit accès pour le débogage depuis la console
  window.airgame = {
    get plane() { return plane; }, get state() { return state; },
    world, rig, sky, input, sound, get missiles() { return missiles; }, get scenery() { return scenery; }, runways, carrier, PLANES, heightAt, scene, camera, renderer,
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
