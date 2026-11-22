import * as THREE from 'three';
import { clamp, lerp, damp } from '../util.js';

// Modèle de vol « arcade + un peu de réalisme » :
//  - la vitesse vient des gaz, de la traînée et de la pente (on ralentit en montée, on accélère en piqué) ;
//  - la portance dépend de la vitesse² : sous la vitesse de décrochage l'avion s'enfonce et le nez tombe ;
//  - le taux de virage est limité par la portance disponible et par le facteur de charge maxi ;
//  - incliner l'avion le fait virer, et le nez retombe doucement si on ne tire pas ;
//  - les commandes ont de l'inertie (un gros porteur s'incline lentement, un biplan aussitôt)
//    et leur efficacité dépend de la vitesse ;
//  - le facteur de charge est plafonné : à grande vitesse on vire moins sec (et on perd de la vitesse) ;
//  - le moteur met un peu de temps à monter en régime (beaucoup pour un réacteur) ;
//  - volets, effet de sol, turbulences légères, tremblement avant décrochage et aile qui tombe.

const G = 9.81;
const ARCADE = 1.5; // coup de pouce sur la maniabilité par rapport à un vrai avion
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3(), _vdir = new THREE.Vector3(), _acc = new THREE.Vector3();
const _n = new THREE.Vector3(), _p = new THREE.Vector3(), _v0 = new THREE.Vector3();
export const IDLE = 0.22; // régime de ralenti (fraction du régime maxi)
// crans de volets : vitesse de décrochage multipliée par `stall`, traînée en plus
const FLAPS = [{ stall: 1, drag: 0, name: 'Volets rentrés' }, { stall: 0.9, drag: 0.2, name: 'Volets : décollage' },
  { stall: 0.8, drag: 0.6, name: 'Volets : atterrissage' }];
/** Petit bruit lisse (somme de sinus) pour les turbulences. */
const wobble = (t, a) => Math.sin(t * 1.31 + a) * 0.5 + Math.sin(t * 2.87 + a * 1.7) * 0.3 + Math.sin(t * 0.53 + a * 2.3) * 0.6;
/** Sa dérivée : appliquée comme vitesse de rotation, l'avion oscille autour de son attitude sans dériver. */
const wobbleD = (t, a) => Math.cos(t * 1.31 + a) * 0.655 + Math.cos(t * 2.87 + a * 1.7) * 0.861 + Math.cos(t * 0.53 + a * 2.3) * 0.318;

export class Plane {
  constructor(spec) {
    this.spec = spec;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.fwd = new THREE.Vector3(0, 0, -1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.right = new THREE.Vector3(1, 0, 0);
    this.gNormal = new THREE.Vector3(0, 1, 0);
    this.ctrl = { pitch: 0, roll: 0, yaw: 0 };
    this.extAcc = new THREE.Vector3(); // accélération imposée de l'extérieur (charge suspendue sous un hélicoptère)
    this.events = [];
    this.hitPts = [
      new THREE.Vector3(0, 0, -spec.len / 2),
      new THREE.Vector3(0, 0.3, spec.len * 0.45),
      new THREE.Vector3(spec.span / 2, spec.wingY, 0),
      new THREE.Vector3(-spec.span / 2, spec.wingY, 0),
    ];
    if (spec.airship) { // l'enveloppe est au-dessus du centre : points d'impact à son niveau
      this.hitPts = [[0, 6.6, -spec.len / 2], [0, 6.6, spec.len / 2], [6.5, 6.6, 0], [-6.5, 6.6, 0], [0, 13, 0]].map((p) => new THREE.Vector3(...p));
    }
    if (spec.balloon) this.hitPts = [[0, 8, 0], [9, 17, 0], [-9, 17, 0], [0, 17, 9], [0, 17, -9], [0, 27, 0]].map((p) => new THREE.Vector3(...p));
    // décollage vertical : tuyères vers le bas, il se pilote comme un hélicoptère (avec ces réglages-là)
    this.hoverSpec = spec.hover ? Object.assign(Object.create(spec), spec.hover) : spec;
    this.reset();
  }

  /** Vol vertical (hélicoptère, ou avion à décollage vertical tuyères vers le bas). */
  get hovering() { return this.spec.heli || this.vtol; }

  reset() {
    this.levelT = 0;
    this.vtol = !!this.spec.hover; this.vtolAnim = this.vtol ? 1 : 0;
    this.deck = null; this.reverse = 0; this.drogue = 0; this.drogueUsed = false;
    this.chute = 0; this.chuteOpen = false; this.flare = 0; this.flame = 0; this.wind = null;
    this.throttle = 0; this.onGround = false; this.crashed = false;
    this.gearDown = true; this.gearAnim = 1;
    this.ctrl.pitch = this.ctrl.roll = this.ctrl.yaw = 0;
    this.pitchRate = 0; this.rollRate = 0; this.gLoad = 1;
    this.yawG = 0; this.groundSpeed = 0; this.groundPitch = 0;
    this.speed = 0; this.agl = 0; this.surface = 'land';
    this.stalling = false; this.braking = false; this.arrest = false; this.catapult = false;
    this.airTime = 0; this.time = 0;
    this.rpm = IDLE; this.flaps = 0; this.flapAnim = 0; this.yawRate = 0;
    this.buffet = 0; this.dropSide = 0; this.ground = 0; this.seed = Math.random() * 100;
    this.hPitch = 0; this.hBank = 0;
    this.fuel = 1; this.failure = null; this.fuelWarned = false; this.refuelT = 0; this.airLift = 0;
    this.events.length = 0;
  }

  get retractUp() { return this.spec.retract && !this.gearDown; }
  // amphibie sur l'eau : il flotte sur sa coque, roues sorties ou non
  get standH() { return this.retractUp || (this.spec.amphibian && this.surface === 'water') ? this.spec.bellyH : this.spec.gearH; }
  get burner() {
    return this.spec.afterburner && !this.vtol ? clamp((this.throttle - 0.9) * 10, 0, 1) * clamp((this.rpm - 0.88) * 12, 0, 1) : 0;
  }
  /** Le moteur tourne-t-il ? (carburant et pannes, si l'option est activée) */
  get engineRunning() { return !this.spec.glider && !(this.fuelOn && (this.fuel <= 0 || this.failure === 'stop')); }
  /** Part de la puissance disponible (1 normal, 0,45 moteur affaibli, 0 coupé). */
  get engineFactor() { return !this.engineRunning ? 0 : this.fuelOn && this.failure === 'partial' ? 0.45 : 1; }

  /** Carburant : consommation en vol, plein à la station de l'aéroport (devant les hangars). */
  stepFuel(dt, world) {
    const s = this.spec;
    if (!this.fuelOn || s.glider) return;
    const load = s.heli ? this.throttle : this.power;
    if (this.fuel > 0) {
      this.fuel = Math.max(0, this.fuel - ((0.12 + 0.88 * load + 2.2 * this.burner) / (s.endurance || 540)) * dt);
      if (!this.fuelWarned && this.fuel < 0.15) { this.fuelWarned = true; this.events.push({ type: 'fuel', what: 'low' }); }
      if (this.fuel <= 0) this.events.push({ type: 'fuel', what: 'empty' });
    }
    // plein : arrêté sur l'aire de la station de carburant
    const pit = this.onGround && this.groundSpeed < 1 && this.speed < 1 && !!(world && world.atFuel && world.atFuel(this.pos.x, this.pos.z));
    this.atPump = pit;
    if (pit && this.fuel < 0.999) {
      this.refuelT += dt;
      this.fuel = Math.min(1, this.fuel + dt / 6);
      if (this.refuelT > 3 && this.fuel >= 0.999) {
        this.fuelWarned = false; this.refuelT = 0;
        this.events.push({ type: 'fuel', what: 'full' });
      }
    } else this.refuelT = 0;
  }

  /** Puissance réellement délivrée (0 au ralenti, 1 plein gaz), en retard sur la manette. */
  get power() { return clamp((this.rpm - IDLE) / (1 - IDLE), 0, 1); }
  /** Vitesse de décrochage du moment (les volets et l'effet de sol l'abaissent). */
  get stallSpeed() {
    const f = FLAPS[1].stall, fl = this.flapAnim;
    const flap = fl <= 1 ? lerp(1, f, fl) : lerp(f, FLAPS[2].stall, fl - 1);
    return this.spec.stall * flap / Math.sqrt(1 + 0.22 * this.ground);
  }
  get takeoffSpeed() { return this.stallSpeed * 1.12; }
  get pitch() { return Math.asin(clamp(this.fwd.y, -1, 1)); }
  get roll() { return Math.atan2(-this.right.y, this.up.y); }

  thrust() {
    return this.spec.accel * this.power * (1 + (this.spec.afterburner || 0) * this.burner);
  }

  axes() {
    this.fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  placeOnGround(x, z, yaw, world) {
    this.reset();
    const g = world.groundAt(x, z, 1e4);
    this.surface = g.type;
    this.pos.set(x, g.h + this.standH, z);
    this.yawG = yaw;
    this.quat.setFromAxisAngle(Y, yaw);
    this.vel.set(0, 0, 0);
    this.onGround = true;
    this.surface = g.type; this.deck = g.deck || null;
    if (this.spec.foot || this.spec.balloon) this.throttle = 0;
    this.axes();
  }
  /** Tourne sur place avec le pont qui le porte. */
  turnWith(dy) {
    this.yawG += dy;
    this.quat.premultiply(_q.setFromAxisAngle(Y, dy));
    this.axes();
  }

  placeInAir(x, y, z, yaw, speed) {
    this.reset();
    this.pos.set(x, y, z);
    this.quat.setFromAxisAngle(Y, yaw);
    this.axes();
    this.vel.copy(this.fwd).multiplyScalar(speed);
    this.speed = speed;
    this.vtol = false; this.vtolAnim = 0;
    this.throttle = this.spec.heli || this.spec.balloon ? 0.5 : this.spec.foot ? 0 : 0.7; // hélico : pile le stationnaire
    this.rpm = IDLE + (1 - IDLE) * this.throttle;
    this.gearDown = !this.spec.retract;
    this.gearAnim = this.gearDown ? 1 : 0;
    this.airTime = 10;
    this.agl = 100;
  }

  /** Renvoie un petit message à afficher, ou null. */
  toggleGear() {
    const s = this.spec;
    if (!s.retract) return s.heli ? 'Patins fixes' : s.floats ? 'Flotteurs fixes' : 'Train fixe';
    // amphibie : sur l'eau on peut sortir/rentrer les roues (pour remonter une rampe) ; à terre, non
    if (this.onGround && (s.amphibian ? this.surface !== 'water' : this.gearDown)) return 'Train verrouillé au sol';
    this.gearDown = !this.gearDown;
    this.events.push({ type: 'gear', down: this.gearDown });
    if (s.amphibian) return this.gearDown ? 'Roues sorties : pour la piste' : "Roues rentrées : pour l'eau";
    return this.gearDown ? 'Train sorti' : 'Train rentré';
  }
  /** Posé (ou glissant) sur le ventre : pas pour un hydravion sur l'eau, qui flotte normalement. */
  get onBelly() { return this.retractUp && !(this.spec.floats && this.surface === 'water'); }

  /** Cran de volets suivant (0 -> 1 -> 2 -> 0). Renvoie un message. */
  cycleFlaps() {
    if (this.spec.hover) return this.toggleNozzles();
    if (!this.spec.flaps) return 'Pas de volets sur cet avion';
    const next = (this.flaps + 1) % FLAPS.length;
    if (next > 0 && !this.onGround && this.speed > this.flapLimit) return 'Trop vite pour sortir les volets';
    this.flaps = next;
    this.events.push({ type: 'flaps', level: next });
    return FLAPS[next].name;
  }
  /** Avion à décollage vertical : oriente les tuyères vers le bas (vol stationnaire) ou vers l'arrière (vol normal). */
  toggleNozzles() {
    const s = this.spec;
    if (this.vtol) {
      const fwd = this.vel.x * this.fwd.x + this.vel.z * this.fwd.z;
      if (!this.onGround && fwd < s.stall * 1.02) return `Prends d'abord de la vitesse : ${Math.round(s.stall * 1.02 * 3.6)} km/h`;
      this.vtol = false; this.yawG = Math.atan2(-this.fwd.x, -this.fwd.z); this.groundSpeed = 0;
      if (!this.onGround) { this.levelT = 2.5; this.throttle = Math.max(this.throttle, 0.85); this.rpm = Math.max(this.rpm, 0.8); this.gearDown = false; this.events.push({ type: 'gear', down: false }); }
    } else {
      if (this.onGround && this.groundSpeed > 3) return 'Arrête-toi pour orienter les tuyères';
      if (!this.onGround && this.speed > 120) return "Trop vite : ralentis sous 430 km/h";
      this.vtol = true; this.throttle = this.onGround ? 0.2 : 0.5;
      this.hPitch = this.pitch; this.hBank = 0;
      if (!this.gearDown) { this.gearDown = true; this.events.push({ type: 'gear', down: true }); }
    }
    this.events.push({ type: 'flaps', level: this.vtol ? 1 : 0 });
    return this.vtol ? 'Tuyères vers le bas : vol vertical' : "Tuyères vers l'arrière : vol normal";
  }
  get flapLimit() { return this.spec.maxSpeed * 0.68; }

  crash(kind, why) {
    this.crashed = true;
    this.events.push({ type: 'crash', kind, why });
  }

  step(dt, input, world) {
    if (this.crashed) return;
    this.time += dt;
    const c = this.ctrl, s = this.spec;
    // au clavier, une touche tapée donne une petite correction, maintenue elle va à fond :
    // on avance vite vers le neutre, plus progressivement vers le débattement maxi
    const ease = (cur, want, slow) => {
      const rate = input.analog ? 18 : Math.abs(want) > Math.abs(cur) && want * cur >= 0 ? slow : 14;
      return cur + (want - cur) * (1 - Math.exp(-rate * dt));
    };
    const ir = s.inputRate || 5;
    c.pitch = ease(c.pitch, input.pitch, ir);
    c.roll = ease(c.roll, input.roll, ir * 1.4);
    c.yaw = ease(c.yaw, input.yaw, ir);
    this.throttle = clamp(this.throttle + input.throttle * 0.6 * dt, 0, 1);
    // régime moteur : un piston répond vite, une turbine monte lentement en régime (surtout au ralenti)
    // (hélicoptère : le rotor tourne à régime constant, c'est le pas collectif qui varie)
    this.stepFuel(dt, world);
    const ef = this.engineFactor;
    const target = ef === 0 ? 0 : s.heli ? 1 : this.vtol ? IDLE + (1 - IDLE) * (this.onGround ? this.throttle : 0.55 + 0.45 * this.throttle) : IDLE + (1 - IDLE) * this.throttle * ef, e = s.engine || {};
    const spool = e.spool ? (0.3 + 1.7 * this.rpm * this.rpm) / e.spool : 5;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-spool * dt));
    this.flapAnim = damp(this.flapAnim, this.flaps, 1.4, dt);
    this.gearAnim = damp(this.gearAnim, this.gearDown ? 1 : 0, 5, dt);
    this.braking = input.brake;
    this.vtolAnim = damp(this.vtolAnim, this.vtol ? 1 : 0, 2.5, dt);
    if (!this.onGround) this.reverse = damp(this.reverse, 0, 4, dt);
    if (this.hovering) this.stepHeli(dt, input, world);
    else if (s.balloon) this.stepBalloon(dt, input, world);
    else if (s.jumper) this.stepJump(dt, input, world);
    else if (s.airship) this.stepShip(dt, input, world);
    else if (this.onGround) this.stepGround(dt, input, world);
    else this.stepAir(dt, input, world);
    this.speed = this.vel.length();
  }

  // -------------------------------------------------------------------------
  stepAir(dt, input, world) {
    const s = this.spec, q = this.quat, v = this.vel, c = this.ctrl, pos = this.pos;
    const { fwd, up, right } = this;
    this.airTime += dt;
    if (s.foot) this.throttle = 0;
    let V = v.length();
    // effet de sol : à moins d'une demi-envergure du sol, l'aile porte mieux (on « flotte » à l'arrondi)
    this.ground = clamp(1 - this.agl / (0.6 * s.span), 0, 1) ** 2;
    const st = this.stallSpeed, vr = V / st;
    const lf = clamp(vr * vr, 0, 1); // part du poids que les ailes peuvent porter
    // efficacité des gouvernes : faible à basse vitesse, un peu plus dure tout près de la vitesse maxi
    const auth = clamp((vr - 0.15) / 0.85, 0.12, 1) * (1 - 0.25 * clamp((V / s.maxSpeed - 0.95) * 3, 0, 1));
    const nMax = Math.min(s.gLimit, vr * vr);
    const Vs = Math.max(V, 5);
    const maxPitch = Math.min(s.pitchRate, ((s.arcade || ARCADE) * nMax * G) / Vs, (1.2 * s.gLimit * G) / Vs) * (0.25 + 0.75 * lf);
    let pr = c.pitch * maxPitch;
    if (pr < 0) pr *= 0.75;
    // limiteur de G : le virage incliné consomme déjà une partie du facteur de charge disponible
    const horiz0 = Math.sqrt(Math.max(0, 1 - fwd.y * fwd.y));
    const nOther = lf * (Math.abs(up.y) + 1.35 * Math.abs(right.y) * horiz0);
    const nRoom = Math.max(0.6, 1.1 * s.gLimit - nOther);
    if (pr > 0) pr = Math.min(pr, (nRoom * G) / Vs);
    if (this.gLoad > 1.1 * s.gLimit && pr > 0) pr *= (1.1 * s.gLimit) / this.gLoad;
    let rr = (c.roll * s.rollRate + c.yaw * s.rollRate * 0.15) * auth; // le palonnier fait aussi pencher l'avion
    const yr = c.yaw * s.yawRate * auth;

    // décrochage : tremblement à l'approche, puis une aile tombe si on insiste
    const airborne = this.airTime > 1.2;
    this.buffet = airborne ? Math.max(clamp((1.1 - vr) / 0.1, 0, 1), clamp((this.gLoad / s.gLimit - 0.85) * 5, 0, 1) * 0.6) : 0;
    if (airborne && vr < 0.97 && (c.pitch > 0.3 || vr < 0.8)) {
      if (!this.dropSide) this.dropSide = Math.random() < 0.5 ? -1 : 1;
      rr += this.dropSide * s.stallBite * 1.6 * clamp((1 - vr) * 6, 0, 1);
    } else if (vr > 1.05) this.dropSide = 0;
    // turbulences : plus fortes près du relief, et pour les avions légers
    // (amplitude en radians : quelques degrés au plus)
    const tb = s.turb * (0.02 + 0.04 * clamp(1 - this.agl / 500, 0, 1)) * clamp(vr, 0, 1.5) * (this.surface === 'water' ? 0.6 : 1)
      + this.buffet * 0.012;
    const tf = 1 + this.buffet * 5, tt = this.time * tf + this.seed;
    pr += tb * tf * wobbleD(tt, 0.3);
    rr += tb * tf * 1.6 * 1.13 * wobbleD(tt * 1.13, 2.1);

    // vol libre : le pilote pend sous l'aile, qui revient d'elle-même à son allure de plané
    if (s.foot) {
      pr += clamp((-0.1 - 0.35 * clamp(1.45 - vr, 0, 0.6) - Math.asin(clamp(fwd.y, -1, 1))) * 1.3, -0.4, 0.6) * (1 - Math.min(1, Math.abs(c.pitch)));
      rr = clamp(((c.roll + c.yaw * 0.3) * 0.8 - this.roll) * 2, -s.rollRate, s.rollRate) * auth;
    }
    if (this.levelT > 0) { this.levelT -= dt; pr += clamp((0.06 - Math.asin(clamp(fwd.y, -1, 1))) * 2.2, -0.6, 0.6) * (1 - Math.min(1, Math.abs(c.pitch))); } // tuyères rabattues : le nez se relève

    // inertie : la vitesse de rotation rejoint la consigne en `inertia` secondes environ
    const ki = 1 - Math.exp(-dt / s.inertia);
    this.pitchRate += (pr - this.pitchRate) * ki;
    this.rollRate += (rr - this.rollRate) * ki * 1.3;
    this.yawRate += (yr - this.yawRate) * ki;
    pr = this.pitchRate; rr = this.rollRate;

    q.multiply(_q.setFromAxisAngle(X, pr * dt));
    q.multiply(_q.setFromAxisAngle(Z, -rr * dt));
    q.multiply(_q.setFromAxisAngle(Y, -this.yawRate * dt));
    this.axes();
    const horiz = Math.sqrt(Math.max(0, 1 - fwd.y * fwd.y));

    // inclinaison -> virage
    q.premultiply(_q.setFromAxisAngle(Y, right.y * (G / Math.max(V, st)) * 1.35 * lf * horiz * dt));
    // le nez retombe quand l'avion est incliné (ou sur le dos)
    // … et aussi quand on vole trop lentement : gaz réduits, l'avion se met de lui-même en descente
    if (horiz > 0.05) {
      _axis.set(fwd.z, 0, -fwd.x).normalize();
      //   (jusqu'à une pente de plané qui dépend du manque de vitesse, pas au-delà)
      const slow = clamp(1.35 - vr, 0, 1);
      const excess = Math.asin(clamp(fwd.y, -1, 1)) + 0.45 * slow;
      const glide = excess > 0 ? Math.min(0.3 * slow + 0.04, excess * 2) * (c.pitch > 0.2 ? 0.35 : 1) : 0;
      q.premultiply(_q.setFromAxisAngle(_axis, (0.1 * (1 - up.y) * lf + glide) * horiz * dt));
    }
    // décrochage : le nez rejoint la trajectoire (il tombe)
    if (lf < 1 && V > 2) {
      this.axes();
      _vdir.copy(v).multiplyScalar(1 / V);
      _axis.crossVectors(fwd, _vdir);
      const sn = _axis.length();
      if (sn > 1e-4) {
        const ang = Math.asin(Math.min(1, sn)) * (1 - Math.exp(-(1 - lf) * 2.2 * dt));
        q.premultiply(_q.setFromAxisAngle(_axis.multiplyScalar(1 / sn), ang));
      }
    }
    q.normalize();
    this.axes();

    // forces
    if (V > 0.5) _vdir.copy(v).multiplyScalar(1 / V); else _vdir.copy(fwd);
    const kd = s.dragK ?? s.accel / (s.maxSpeed * s.maxSpeed);
    const n = (Math.abs(pr) * V) / G + lf;
    const flapDrag = this.flapAnim <= 1 ? FLAPS[1].drag * this.flapAnim : lerp(FLAPS[1].drag, FLAPS[2].drag, this.flapAnim - 1);
    let drag = kd * V * V * (1 + (s.retract && this.gearAnim > 0.5 ? 0.35 : 0) + (input.brake ? 1.6 : 0) + flapDrag);
    drag += (s.inducedK ?? 0.08) * n * n * G * Math.min(4, (st / Math.max(V, 1)) ** 2) * (1 - 0.5 * this.ground);
    const gAlong = -G * _vdir.y;
    _acc.copy(fwd).multiplyScalar(this.thrust()).addScaledVector(_vdir, gAlong - drag);
    const ul = 1 - lf;
    if (ul > 0) {
      _acc.x -= _vdir.x * gAlong * ul;
      _acc.y += (-G - _vdir.y * gAlong) * ul;
      _acc.z -= _vdir.z * gAlong * ul;
    }
    // rafales verticales (atténuées tout près du sol pour ne pas gâcher les atterrissages)
    _acc.y += s.turb * 0.9 * (clamp(1 - this.agl / 400, 0.15, 1) + 1.6 * (this.cloud || 0)) * clamp(vr - 0.5, 0, 1) * (1 - 0.7 * this.ground) * wobble(tt * 0.8, 4.2);
    _v0.copy(v);
    v.addScaledVector(_acc, dt);

    // la trajectoire rejoint l'axe de l'avion
    V = v.length();
    if (V > 0.5) {
      _vdir.copy(v).multiplyScalar(1 / V).lerp(fwd, 1 - Math.exp(-4.5 * lf * lf * dt)).normalize();
      v.copy(_vdir).multiplyScalar(V);
    }
    pos.addScaledVector(v, dt);
    // ascendances (thermiques) : la masse d'air emporte l'avion
    this.airLift = world.updraft ? world.updraft(pos.x, pos.y, pos.z) : 0;
    pos.y += this.airLift * dt;
    // facteur de charge ressenti (accélération réelle, gravité comprise, dans l'axe vertical de l'avion)
    _v0.subVectors(v, _v0).multiplyScalar(1 / dt);
    _v0.y += G;
    this.gLoad = damp(this.gLoad, _v0.dot(up) / G, 10, dt);
    // volets sortis trop vite : ils se rentrent d'eux-mêmes
    if (this.flaps > 0 && V > this.flapLimit * 1.08) {
      this.flaps = 0;
      this.events.push({ type: 'flaps', level: 0, blown: true });
    }

    // sol
    const g = world.groundAt(pos.x, pos.z, pos.y);
    this.agl = pos.y - this.standH - g.h;
    this.surface = g.type;
    this.stalling = vr < 1 && this.agl > 2 && this.airTime > 1.5;
    this.stallWarn = vr < 1.08 && this.agl > 2 && this.airTime > 2.5;
    if (this.agl <= 0) { this.touchdown(g, world); return; }
    if (this.agl < Math.max(40, s.span * 2)) {
      for (const hp of this.hitPts) {
        _p.copy(hp).applyQuaternion(q).add(pos);
        const gp = world.groundAt(_p.x, _p.z, _p.y);
        if (_p.y < gp.h - 0.25) { this.crash(gp.type === 'water' ? 'water' : 'ground'); return; }
      }
    }
    // obstacles
    if (world.hit(pos.x, pos.y, pos.z)) { this.crash('obstacle'); return; }
    for (const hp of this.hitPts) {
      _p.copy(hp).applyQuaternion(q).add(pos);
      if (world.hit(_p.x, _p.y, _p.z)) { this.crash('obstacle'); return; }
    }
  }

  // -------------------------------------------------------------------------
  // Hélicoptère, version arcade :
  //  - la manette des gaz (R / F, gâchettes) règle le pas collectif et ne bouge jamais toute seule :
  //    50 % = vol stationnaire, plus = on monte, moins = on descend ;
  //  - le manche avant / arrière incline l'appareil pour avancer ou reculer (avec un coup de pouce arcade) ;
  //  - le manche gauche / droite fait virer (en s'inclinant), même en stationnaire ; le palonnier pivote sur place ;
  //  - Espace : retour automatique au vol stationnaire (assiette à plat, gaz à 50 %).
  stepHeli(dt, input, world) {
    const s = this.hoverSpec, q = this.quat, v = this.vel, c = this.ctrl, pos = this.pos;
    const hdg0 = Math.atan2(-this.fwd.x, -this.fwd.z);
    const fx = -Math.sin(hdg0), fz = -Math.cos(hdg0);           // avant (horizontal)
    const vFwd = v.x * fx + v.z * fz, vSide = v.x * -fz + v.z * fx; // vitesse avant / vers la droite
    if (input.brake) this.throttle = damp(this.throttle, 0.5, 3, dt);

    if (this.onGround) {
      this.hPitch = damp(this.hPitch, 0, 6, dt); this.hBank = damp(this.hBank, 0, 6, dt);
      this.yawRate = damp(this.yawRate, (c.yaw + c.roll * 0.5) * s.yawRate * 0.6, 4, dt);
      q.setFromUnitVectors(Y, this.gNormal).multiply(_q.setFromAxisAngle(Y, hdg0 - this.yawRate * dt));
      this.axes();
      v.set(0, 0, 0);
      this.gLoad = 1; this.stalling = false; this.stallWarn = false; this.buffet = 0; this.pitchRate = 0; this.rollRate = 0;
      if (this.throttle > 0.53) { // assez de pas : on décolle
        this.onGround = false; this.airTime = 0; v.y = 0.8; pos.y += 0.05; this.leaveDeck();
        this.events.push({ type: 'takeoff' });
      }
      return;
    }
    this.airTime += dt;

    // assiette voulue
    // (en stationnaire, le manche latéral fait surtout pivoter : peu d'inclinaison, donc peu de glissade)
    const fwdK = clamp(vFwd / 25, 0, 1);
    let tp = c.pitch * s.tilt, tb = c.roll * s.tilt * 0.7 * (0.25 + 0.75 * fwdK);
    if (input.brake) {
      tp = clamp(vFwd * 0.03, -s.tilt, s.tilt);
      tb = clamp(-vSide * 0.04, -s.tilt, s.tilt);
    }
    const p0 = this.hPitch, b0 = this.hBank;
    this.hPitch = damp(this.hPitch, tp, 1 / s.inertia, dt);
    this.hBank = damp(this.hBank, tb, 1.2 / s.inertia, dt);
    this.pitchRate = (this.hPitch - p0) / dt; this.rollRate = (this.hBank - b0) / dt;
    // lacet : palonnier + virage commandé par le manche (plus franc avec de la vitesse)
    const turn = c.roll * s.turnRate * (0.6 + 0.4 * clamp(vFwd / 30, 0, 1));
    this.yawRate = damp(this.yawRate, c.yaw * s.yawRate + turn, 5, dt);
    const hdg = hdg0 - this.yawRate * dt;
    q.setFromAxisAngle(Y, hdg).multiply(_q.setFromAxisAngle(X, this.hPitch)).multiply(_q.setFromAxisAngle(Z, -this.hBank));
    this.axes();

    // portance : 50 % de gaz = stationnaire (quelle que soit l'inclinaison)
    let liftV = G * (1 + (this.throttle - 0.5) * 2.4);
    // moteur coupé : autorotation (on descend doucement, toujours pilotable) ; affaibli : on monte à peine
    const ef = this.engineFactor;
    if (ef === 0) liftV = Math.min(liftV, G * 0.84); else if (ef < 1) liftV = Math.min(liftV, G * 1.06);
    if (this.agl < 12) { // coussin arcade près du sol : on ne s'écrase pas en descendant à la verticale
      const vmin = -(1.5 + this.agl * 0.3);
      if (v.y < vmin) liftV += (vmin - v.y) * 4;
    }
    const lift = clamp(liftV / Math.max(this.up.y, 0.5), 0, G * 3);
    this.gLoad = lift / G;

    // forces : rotor, poids, poussée arcade du manche, traînée
    _acc.copy(this.up).multiplyScalar(lift);
    _acc.y -= G;
    const push = s.push * (input.brake ? 0 : 1);
    _acc.x += fx * -c.pitch * push;
    _acc.z += fz * -c.pitch * push;
    // la vitesse latérale s'amortit vite (l'hélico « suit » son nez dans les virages)
    _acc.x -= -fz * vSide * 0.8; _acc.z -= fx * vSide * 0.8;
    const vh = Math.hypot(v.x, v.z), kd = 0.02 + 0.001 * vh;
    _acc.x -= v.x * kd; _acc.z -= v.z * kd;
    _acc.y -= v.y * 1.2;
    _acc.add(this.extAcc);
    _acc.y += s.turb * 0.6 * wobble((this.time + this.seed) * 0.9, 1.3); // petites turbulences
    v.addScaledVector(_acc, dt);
    pos.addScaledVector(v, dt);
    this.airLift = world.updraft ? world.updraft(pos.x, pos.y, pos.z) * 0.5 : 0;
    pos.y += this.airLift * dt;

    // sol
    const g = world.groundAt(pos.x, pos.z, pos.y);
    this.agl = pos.y - this.standH - g.h;
    this.surface = g.type;
    this.stalling = false; this.stallWarn = false; this.buffet = 0;
    if (this.agl <= 0) {
      if (g.type === 'land') world.normalAt(pos.x, pos.z, _n); else _n.set(0, 1, 0);
      const hs = Math.hypot(v.x - (g.deck ? g.deck.vx : 0), v.z - (g.deck ? g.deck.vz : 0)), ok = g.type !== 'water' && -v.y < s.maxSink && hs < 14 && this.up.y > 0.82 && _n.y > 0.85;
      if (!ok) { this.crash(g.type === 'water' ? 'water' : 'ground'); return; }
      pos.y = g.h + this.standH; this.agl = 0;
      this.onGround = true; this.gNormal.copy(_n); this.surface = g.type; this.deck = g.deck || null;
      this.events.push({ type: 'touchdown', surface: g.type, sink: -v.y, airTime: this.airTime });
      v.set(0, 0, 0);
      // posé : on réduit les gaz sous le stationnaire pour rester au sol
      this.throttle = Math.min(this.throttle, 0.45);
      return;
    }
    if (this.agl < 20) {
      for (const hp of this.hitPts) {
        _p.copy(hp).applyQuaternion(q).add(pos);
        const gp = world.groundAt(_p.x, _p.z, _p.y);
        if (_p.y < gp.h - 0.25) { this.crash(gp.type === 'water' ? 'water' : 'ground'); return; }
      }
    }
    if (world.hit(pos.x, pos.y, pos.z)) { this.crash('obstacle'); return; }
    for (const hp of this.hitPts) {
      _p.copy(hp).applyQuaternion(q).add(pos);
      if (world.hit(_p.x, _p.y, _p.z)) { this.crash('obstacle'); return; }
    }
  }

  /** Vitesse du pont quitté (porte-avions en route, frégate…) ajoutée à celle de l'appareil. */
  leaveDeck() {
    if (this.deck) { this.vel.x += this.deck.vx; this.vel.z += this.deck.vz; }
    this.deck = null;
  }

  // -------------------------------------------------------------------------
  // Montgolfière : R chauffe l'air (elle monte), F ouvre la soupape (elle descend). Elle va où va le vent, qui tourne
  // et forcit avec l'altitude ; un petit ventilateur (le manche) aide à viser, le palonnier fait tourner la nacelle.
  stepBalloon(dt, input, world) {
    const s = this.spec, q = this.quat, v = this.vel, c = this.ctrl, pos = this.pos;
    const hdg0 = Math.atan2(-this.fwd.x, -this.fwd.z);
    // la manette est la température de l'enveloppe : 50 % = équilibre ; l'air refroidit tout seul
    this.flame = damp(this.flame, input.throttle > 0.05 ? 1 : 0, 12, dt);
    this.throttle = clamp(this.throttle - 0.6 * input.throttle * dt + (input.throttle > 0 ? 0.13 : input.throttle < 0 ? -0.16 : this.throttle > 0.5 ? -0.006 : this.onGround ? -0.02 : 0) * dt, 0, 1);
    this.rpm = IDLE;
    this.yawRate = damp(this.yawRate, c.yaw * 0.5 + c.roll * 0.35, 1.5, dt);
    this.hBank = damp(this.hBank, 0.02 * Math.sin((this.time + this.seed) * 0.7), 2, dt);
    q.setFromAxisAngle(Y, hdg0 - this.yawRate * dt).multiply(_q.setFromAxisAngle(X, 0.018 * Math.sin((this.time + this.seed) * 0.9))).multiply(_q.setFromAxisAngle(Z, this.hBank));
    this.axes();
    this.gLoad = 1; this.stalling = this.stallWarn = false; this.buffet = this.pitchRate = this.rollRate = 0;
    const w = this.wind = world.wind ? world.wind(pos.x, pos.y, pos.z) : { x: 0, z: 0 };
    if (this.onGround) {
      v.set(0, 0, 0); this.groundSpeed = 0;
      if (this.throttle > 0.53) { this.onGround = false; this.airTime = 0; v.y = 0.4; pos.y += 0.05; this.leaveDeck(); this.events.push({ type: 'takeoff' }); }
      return;
    }
    this.airTime += dt;
    const fx = -Math.sin(hdg0), fz = -Math.cos(hdg0), fan = -c.pitch * 2.6, slow = clamp(this.agl / 25, 0.25, 1);
    const k = 1 - Math.exp(-dt * 0.45);
    v.x += (w.x * slow + fx * fan - v.x) * k; v.z += (w.z * slow + fz * fan - v.z) * k;
    const lift = (this.throttle - 0.5) * 7;
    v.y += (lift - v.y * 0.55) * dt;
    if (this.agl < 14) v.y = Math.max(v.y, -0.7 - this.agl * 0.22); // l'air chaud amortit l'arrivée
    if (input.brake) v.y = damp(v.y, 0, 0.8, dt);
    pos.addScaledVector(v, dt);
    this.airLift = world.updraft ? world.updraft(pos.x, pos.y, pos.z) * 0.3 : 0; pos.y += this.airLift * dt;
    const g = world.groundAt(pos.x, pos.z, pos.y);
    this.agl = pos.y - this.standH - g.h; this.surface = g.type;
    if (this.agl <= 0) {
      pos.y -= this.agl; this.agl = 0;
      if (g.type === 'water') { v.y = Math.max(0.5, v.y); this.throttle = Math.max(this.throttle, 0.52); return; } // effleure l'eau et repart
      if (g.type === 'land') world.normalAt(pos.x, pos.z, _n); else _n.set(0, 1, 0);
      if (-v.y > s.maxSink || _n.y < 0.75) { this.crash('ground'); return; }
      this.onGround = true; this.gNormal.copy(_n); this.deck = g.deck || null;
      this.events.push({ type: 'touchdown', surface: g.type, sink: -v.y, airTime: this.airTime });
      this.throttle = Math.min(this.throttle, 0.46); v.set(0, 0, 0);
      return;
    }
    if (world.hit(pos.x, pos.y, pos.z)) { this.crash('obstacle'); return; }
    for (const hp of this.hitPts) {
      _p.copy(hp).applyQuaternion(q).add(pos);
      if (world.hit(_p.x, _p.y, _p.z)) { this.crash('obstacle'); return; }
      const gp = world.groundAt(_p.x, _p.z, _p.y); if (_p.y < gp.h - 0.5) { this.crash('ground'); return; }
    }
  }

  // -------------------------------------------------------------------------
  // Parachutiste : chute libre (le manche fait dériver), puis voile ouverte (X, ou toute seule près du sol) qu'on dirige.
  stepJump(dt, input, world) {
    const q = this.quat, v = this.vel, c = this.ctrl, pos = this.pos;
    let hdg = Math.atan2(-this.fwd.x, -this.fwd.z);
    this.gLoad = 1; this.stalling = this.stallWarn = false; this.buffet = 0; this.throttle = 0;
    if (this.onGround) { v.set(0, 0, 0); this.groundSpeed = 0; this.chute = damp(this.chute, 0, 1.5, dt); this.hPitch = damp(this.hPitch, 0, 4, dt); q.setFromAxisAngle(Y, hdg); this.axes(); return; }
    this.airTime += dt;
    if (!this.chuteOpen && this.agl < 170 && this.airTime > 1) this.openChute();
    this.chute = damp(this.chute, this.chuteOpen ? 1 : 0, 1.6, dt);
    const ch = this.chute, turn = (c.roll + c.yaw) * lerp(1.2, 0.95, ch);
    this.yawRate = damp(this.yawRate, turn, 3, dt);
    hdg -= this.yawRate * dt;
    // à plat ventre en chute libre, debout sous la voile
    this.flare = damp(this.flare, ch > 0.5 && input.brake ? 1 : 0, 3, dt);
    this.hPitch = damp(this.hPitch, lerp(-1.2 + 0.35 * c.pitch, 0.1 * c.pitch, ch), 3, dt);
    this.hBank = damp(this.hBank, this.yawRate * lerp(0.25, 0.4, ch), 3, dt);
    q.setFromAxisAngle(Y, hdg).multiply(_q.setFromAxisAngle(Z, -this.hBank)).multiply(_q.setFromAxisAngle(X, this.hPitch));
    this.axes();
    const fx = -Math.sin(hdg), fz = -Math.cos(hdg);
    const ahead = lerp(6 + 22 * Math.max(0, -c.pitch), 9.5 - 3 * Math.max(0, c.pitch) + 2.5 * Math.max(0, -c.pitch) - 5 * this.flare, ch);
    const sink = lerp(56 + 14 * Math.max(0, -c.pitch) - 8 * Math.max(0, c.pitch), 4.6 + 2 * Math.max(0, -c.pitch) + 2.2 * Math.abs(this.yawRate) - 3.2 * this.flare, ch);
    const k = 1 - Math.exp(-dt * lerp(0.35, 2.2, ch));
    v.x += (fx * ahead - v.x) * k; v.z += (fz * ahead - v.z) * k; v.y += (-sink - v.y) * (1 - Math.exp(-dt * lerp(0.28, 1.8, ch)));
    pos.addScaledVector(v, dt);
    this.airLift = world.updraft ? world.updraft(pos.x, pos.y, pos.z) * 0.6 * ch : 0; pos.y += this.airLift * dt;
    const g = world.groundAt(pos.x, pos.z, pos.y);
    this.agl = pos.y - this.standH - g.h; this.surface = g.type;
    if (this.agl <= 0) {
      if (-v.y > 14) { this.crash(g.type === 'water' ? 'water' : 'ground'); return; }
      pos.y -= this.agl; this.agl = 0; this.onGround = true; this.deck = g.deck || null; this.yawG = hdg;
      this.events.push({ type: 'touchdown', surface: g.type, sink: -v.y, airTime: this.airTime });
      v.set(0, 0, 0);
      return;
    }
    if (world.hit(pos.x, pos.y, pos.z)) this.crash('obstacle');
  }
  openChute() {
    if (this.chuteOpen || !this.spec.jumper) return;
    this.chuteOpen = true;
    this.events.push({ type: 'chute' });
  }

  // -------------------------------------------------------------------------
  // Dirigeable : il flotte tout seul. Les gaz donnent la vitesse, le manche l'assiette (et un peu de montée même à
  // l'arrêt), il vire lentement au manche ou au palonnier. Espace : moteurs en marche arrière, il s'arrête suspendu.
  stepShip(dt, input, world) {
    const s = this.spec, q = this.quat, v = this.vel, c = this.ctrl, pos = this.pos;
    const hdg0 = Math.atan2(-this.fwd.x, -this.fwd.z);
    if (input.brake) this.throttle = damp(this.throttle, 0, 2, dt);
    let fx = -Math.sin(hdg0), fz = -Math.cos(hdg0);
    const vFwd = v.x * fx + v.z * fz, vSide = v.x * -fz + v.z * fx;
    if (this.onGround) {
      this.hPitch = damp(this.hPitch, 0, 2, dt); this.hBank = 0; this.yawRate = damp(this.yawRate, (c.yaw + c.roll) * s.turnRate * 0.5, 1.5, dt);
      q.setFromAxisAngle(Y, hdg0 - this.yawRate * dt); this.axes(); v.multiplyScalar(Math.exp(-2 * dt)); pos.addScaledVector(v, dt); this.groundSpeed = v.length();
      this.gLoad = 1; this.stalling = this.stallWarn = false; this.buffet = this.pitchRate = this.rollRate = 0;
      if (c.pitch > 0.25 || this.throttle > 0.5) { this.onGround = false; this.airTime = 0; v.y = 1; pos.y += 0.05; this.leaveDeck(); this.events.push({ type: 'takeoff' }); }
      return;
    }
    this.airTime += dt;
    const k = 1 - Math.exp(-dt / s.inertia), p0 = this.hPitch, b0 = this.hBank;
    const nose = this.agl < 25 ? Math.max(c.pitch, -0.1 - 0.035 * this.agl) : c.pitch; // près du sol, il garde le nez haut
    this.hPitch += (nose * s.tilt - this.hPitch) * k * 0.8;
    this.yawRate += (clamp(c.roll + c.yaw, -1, 1) * s.turnRate * (0.55 + 0.45 * clamp(vFwd / 12, 0, 1)) - this.yawRate) * k;
    this.hBank += (this.yawRate * 0.5 - this.hBank) * k;
    this.pitchRate = (this.hPitch - p0) / dt; this.rollRate = (this.hBank - b0) / dt;
    const w = this.time + this.seed, hdg = hdg0 - this.yawRate * dt;
    q.setFromAxisAngle(Y, hdg).multiply(_q.setFromAxisAngle(X, this.hPitch + 0.012 * Math.sin(w * 0.6))).multiply(_q.setFromAxisAngle(Z, -this.hBank + 0.015 * Math.sin(w * 0.45)));
    this.axes();
    fx = -Math.sin(hdg); fz = -Math.cos(hdg);
    // vitesse voulue, atteinte en plusieurs secondes ; moteurs coupés, il dérive puis s'arrête
    const want = s.maxSpeed * this.power * (input.brake ? 0 : 1), cp = Math.cos(this.hPitch);
    const nf = vFwd + (want * cp - vFwd) * (1 - Math.exp(-dt * (input.brake ? 0.45 : 0.14))), ns = vSide * Math.exp(-dt * 0.8);
    const vy = vFwd * Math.tan(this.hPitch) * 0.9 + c.pitch * 3.2 + 0.25 * s.turb * wobble(w * 0.6, 1);
    v.set(fx * nf - fz * ns, v.y + (clamp(vy, -9, 9) - v.y) * (1 - Math.exp(-dt * 0.9)), fz * nf + fx * ns);
    pos.addScaledVector(v, dt);
    this.airLift = world.updraft ? world.updraft(pos.x, pos.y, pos.z) * 0.35 : 0;
    pos.y += this.airLift * dt;
    this.gLoad = 1; this.stalling = this.stallWarn = false; this.buffet = 0; this.ground = 0;
    const g = world.groundAt(pos.x, pos.z, pos.y);
    this.agl = pos.y - this.standH - g.h; this.surface = g.type;
    if (this.agl <= 0) {
      const hs = Math.hypot(v.x, v.z);
      if (g.type === 'land') world.normalAt(pos.x, pos.z, _n); else _n.set(0, 1, 0);
      if (g.type === 'water') { pos.y -= this.agl; v.y = Math.max(0.6, v.y); this.agl = 0; return; } // rebondit au ras de l'eau
      if (-v.y > s.maxSink || hs > 15 || _n.y < 0.8) { this.crash('ground'); return; }
      pos.y = g.h + this.standH; this.agl = 0; this.onGround = true; this.gNormal.copy(_n); this.deck = g.deck || null;
      this.events.push({ type: 'touchdown', surface: g.type, sink: -v.y, airTime: this.airTime });
      this.throttle = Math.min(this.throttle, 0.2); v.y = 0;
      return;
    }
    if (this.agl < 30) for (const hp of this.hitPts) { _p.copy(hp).applyQuaternion(q).add(pos); const gp = world.groundAt(_p.x, _p.z, _p.y); if (_p.y < gp.h - 0.25) { this.crash('ground'); return; } }
    if (world.hit(pos.x, pos.y, pos.z)) { this.crash('obstacle'); return; }
    for (const hp of this.hitPts) { _p.copy(hp).applyQuaternion(q).add(pos); if (world.hit(_p.x, _p.y, _p.z)) { this.crash('obstacle'); return; } }
  }

  touchdown(g, world) {
    const s = this.spec, { fwd, up, right, pos, vel } = this;
    if (g.type === 'land') world.normalAt(pos.x, pos.z, _n); else _n.set(0, 1, 0);
    const sink = -vel.dot(_n);
    const pitch = this.pitch, bank = Math.abs(right.y);
    let ok = up.y > 0.6 && sink < s.maxSink && bank < 0.42 && pitch > -0.2 && pitch < 0.55 && -this.agl < 1.3;
    if (g.type === 'water' && !s.floats) ok = false;
    if (g.type === 'land' && _n.y < (s.foot ? 0.7 : s.tundra ? 0.82 : 0.9)) ok = false;
    if (!ok) { this.crash(g.type === 'water' ? 'water' : 'ground'); return; }

    this.onGround = true;
    this.yawG = Math.atan2(-fwd.x, -fwd.z);
    this.deck = g.deck || null;
    const dvx = this.deck ? this.deck.vx : 0, dvz = this.deck ? this.deck.vz : 0;
    this.groundSpeed = Math.hypot(vel.x - dvx, vel.z - dvz);
    if (s.foot) this.throttle = 0;
    this.groundPitch = clamp(pitch, 0, 0.2);
    this.gNormal.copy(_n);
    this.arrest = g.type === 'carrier';
    pos.y = g.h + this.standH;
    this.agl = 0;
    this.surface = g.type;
    this.events.push({ type: 'touchdown', surface: g.type, sink, belly: this.onBelly, floats: !!s.floats, airTime: this.airTime });
  }

  // -------------------------------------------------------------------------
  stepGround(dt, input, world) {
    const s = this.spec, pos = this.pos, c = this.ctrl, q = this.quat;
    const belly = this.onBelly;
    let g = world.groundAt(pos.x, pos.z, pos.y + 2);
    let sp = this.groundSpeed;
    const hard = g.type === 'runway' || g.type === 'carrier' || g.type === 'deck';

    // direction (palonnier ou manche)
    const steer = clamp(c.roll + c.yaw, -1, 1);
    this.yawG -= steer * lerp(0.95, 0.1, clamp(sp / s.takeoff, 0, 1)) * clamp(sp / 2.5, 0, 1) * dt;
    const fx = -Math.sin(this.yawG), fz = -Math.cos(this.yawG);

    // accélération / freinage
    let acc = this.thrust() - (s.dragK ?? s.accel / (s.maxSpeed * s.maxSpeed)) * sp * sp;
    let fr = hard ? 0.35 : g.type === 'water' ? 1.5 : s.tundra ? 0.9 : 2.2;
    if (s.foot) { acc = 5 * this.throttle * clamp(1.45 - sp / 8, 0, 1); fr = this.throttle > 0.05 ? 0.2 : 3; } // on court
    // inverseurs de poussée (freins, gaz réduits) et parachute-frein du Jet
    const calm = input.brake && this.throttle < 0.35;
    this.reverse = damp(this.reverse, s.reverser && calm && sp > 8 && g.type !== 'carrier' ? 1 : 0, 3, dt);
    fr += this.reverse * 5;
    if (s.drogue && calm && sp > 32 && !this.drogueUsed && g.type === 'runway') { this.drogueUsed = true; this.drogue = 0.01; this.events.push({ type: 'drogue', open: true }); }
    if (this.drogue > 0) {
      this.drogue = Math.min(1, this.drogue + dt * 1.6); fr += 0.0024 * this.drogue * sp * sp;
      if (sp < 7) { this.drogue = 0; this.events.push({ type: 'drogue', open: false }); }
    }
    if (belly) fr += 14;
    if (input.brake) fr += g.type === 'water' ? 3 : s.brake;
    if (g.type === 'carrier') {
      if (this.arrest) {
        // brins d'arrêt
        if (sp < 3 || this.throttle > 0.5) this.arrest = false; else fr += 30;
      } else if (this.throttle > 0.92 && !input.brake && sp > 1 && !belly) {
        acc += 17;
        if (!this.catapult) { this.catapult = true; this.events.push({ type: 'catapult' }); }
      }
    }
    if (g.type !== 'carrier' || this.throttle < 0.9) this.catapult = false;
    if (g.type === 'land') {
      const ha = world.groundAt(pos.x + fx * 4, pos.z + fz * 4, pos.y + 2).h;
      acc -= G * clamp((ha - g.h) / 4, -0.5, 0.5);
    }
    if (sp < 0.05 && acc <= fr) sp = 0; else sp = Math.max(0, sp + (acc - fr) * dt);

    // on lève le nez quand il y a assez de vitesse
    this.ground = 1;
    const vto = this.takeoffSpeed;
    const auth = clamp((sp - 0.5 * vto) / (0.4 * vto), 0, 1);
    this.groundPitch = damp(this.groundPitch, belly ? 0 : Math.max(0, c.pitch) * 0.2 * auth, 3.5, dt);

    pos.x += fx * sp * dt; pos.z += fz * sp * dt;
    g = world.groundAt(pos.x, pos.z, pos.y + 2);
    const ty = g.h + this.standH;
    if (pos.y - ty <= 0.9) this.deck = g.deck || null;
    this.surface = g.type; this.agl = 0; this.groundSpeed = sp;
    this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0; this.gLoad = 1; this.stalling = false;

    if (pos.y - ty > 0.9) { this.liftOff(sp, false); return; } // bord du pont, falaise…
    pos.y = ty;
    if (g.type === 'water' && !s.floats) { this.crash('water'); return; }
    if (g.type === 'land') world.normalAt(pos.x, pos.z, _n); else _n.set(0, 1, 0);
    if (g.type === 'land' && _n.y < 0.78 && sp > 10) { this.crash('ground'); return; }
    this.gNormal.lerp(_n, 1 - Math.exp(-6 * dt)).normalize();

    let bob = 0;
    if (g.type === 'water') {
      bob = Math.sin(this.time * 1.5) * 0.012;
      pos.y += Math.sin(this.time * 1.1) * 0.05;
    }
    q.setFromUnitVectors(Y, this.gNormal);
    q.multiply(_q.setFromAxisAngle(Y, this.yawG));
    q.multiply(_q.setFromAxisAngle(X, this.groundPitch + bob));
    this.axes();
    this.vel.copy(this.fwd).multiplyScalar(sp);

    if (sp > 1) {
      _p.copy(this.hitPts[0]).applyQuaternion(q).add(pos);
      if (world.hit(pos.x, pos.y, pos.z) || world.hit(_p.x, _p.y, _p.z)) { this.crash('obstacle'); return; }
    }
    this.buffet = 0; this.stallWarn = false;
    if (!belly && sp >= vto && this.groundPitch > 0.06) this.liftOff(sp, true);
  }

  liftOff(sp, announce) {
    this.onGround = false;
    this.airTime = 0;
    this.vel.copy(this.fwd).multiplyScalar(sp);
    this.leaveDeck();
    this.drogue = 0; this.drogueUsed = false;
    if (announce) {
      this.vel.y += 1.2;
      this.pos.y += 0.05;
      this.events.push({ type: 'takeoff' });
    }
  }
}
