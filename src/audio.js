import * as THREE from 'three';
import { clamp } from './util.js';
import { IDLE } from './flight/physics.js';

// Sons entièrement synthétisés (WebAudio), aucun fichier à charger.
//  - le moteur est calculé par engine-worklet.js (cylindres, hélice, turbine, postcombustion) ;
//  - les sons de l'avion s'atténuent avec la distance, se décalent en stéréo et en hauteur
//    (effet Doppler) : la vue « passage » fait entendre l'avion arriver puis s'éloigner ;
//  - dans le cockpit fermé, tout est étouffé (sauf dans le biplan, à l'air libre) ;
//  - alarme de décrochage, tremblements, train, volets, pneus, catapulte…

const C_SOUND = 343;
const _d = new THREE.Vector3(), _cv = new THREE.Vector3(), _q = new THREE.Quaternion();

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.spec = null;
    this.engine = null;
    this.worklet = false;
    this.lastCam = new THREE.Vector3();
    this.camVel = new THREE.Vector3();
    this.hasCam = false;
    this.wasBurner = 0;
    this.ground = 0;
  }

  /** À appeler après un geste de l'utilisateur (règle des navigateurs). */
  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.01; comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    // réverbération (réponse impulsionnelle synthétique) : profondeur des explosions et des sons lointains
    this.reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.35;
    this.reverbIn.connect(this.reverb).connect(this.master);

    // tout ce qui vient de l'avion passe par ici : distance, air, stéréo
    this.planeBus = ctx.createGain();
    this.airLP = ctx.createBiquadFilter(); this.airLP.type = 'lowpass'; this.airLP.frequency.value = 18000;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    this.planeBus.connect(this.airLP).connect(this.pan).connect(this.master);
    this.planeSend = ctx.createGain(); this.planeSend.gain.value = 0.08;
    this.pan.connect(this.planeSend).connect(this.reverbIn);

    // le moteur a son propre filtre (cockpit fermé = étouffé)
    this.engineGain = ctx.createGain(); this.engineGain.gain.value = 0;
    this.cabinLP = ctx.createBiquadFilter(); this.cabinLP.type = 'lowpass'; this.cabinLP.frequency.value = 20000;
    // dans le cockpit : les basses vibrent dans la carlingue
    this.cabinBass = ctx.createBiquadFilter(); this.cabinBass.type = 'lowshelf'; this.cabinBass.frequency.value = 180; this.cabinBass.gain.value = 0;
    this.startGain = ctx.createGain(); this.startGain.gain.value = 1; // séquence de démarrage
    this.engineGain.connect(this.startGain).connect(this.cabinLP).connect(this.cabinBass).connect(this.planeBus);

    // bruit blanc partagé
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(0, Math.random() * 1.9); return s; };
    const chain = (src, type, freq, q, dest) => {
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(dest);
      return { f, g };
    };

    // vent : souffle grave + sifflement aigu à grande vitesse
    this.wind = chain(noise(), 'lowpass', 400, 0.5, this.planeBus);
    this.whistle = chain(noise(), 'bandpass', 1800, 4, this.planeBus);
    // tremblements (décrochage, forts G) et roulage
    this.buffet = chain(noise(), 'lowpass', 70, 1.2, this.planeBus);
    this.roll = chain(noise(), 'lowpass', 300, 0.8, this.planeBus);
    this.water = chain(noise(), 'bandpass', 1400, 0.9, this.planeBus);
    // ressac : vagues qui vont et viennent quand on vole bas au-dessus de la mer (non lié à la position de l'avion)
    this.sea = chain(noise(), 'lowpass', 600, 0.6, this.master);

    // vario du planeur : bips de plus en plus aigus et rapides quand ça monte, grondement grave quand ça descend fort
    this.vario = ctx.createOscillator(); this.vario.type = 'triangle'; this.vario.frequency.value = 600;
    this.varioGain = ctx.createGain(); this.varioGain.gain.value = 0;
    this.vario.connect(this.varioGain).connect(this.master); this.vario.start();

    // alarme de décrochage (dans le cockpit surtout)
    this.horn = ctx.createOscillator(); this.horn.type = 'square'; this.horn.frequency.value = 440;
    const hornF = ctx.createBiquadFilter(); hornF.type = 'bandpass'; hornF.frequency.value = 900; hornF.Q.value = 1.2;
    this.hornGain = ctx.createGain(); this.hornGain.gain.value = 0;
    this.horn.connect(hornF).connect(this.hornGain).connect(this.master);
    this.horn.start();

    this.worklet = false;
    if (ctx.audioWorklet && window.isSecureContext) {
      // version « un seul fichier » (jouer.html) : le processeur est embarqué sous forme de texte
      const url = window.AIRGAME_WORKLET
        ? URL.createObjectURL(new Blob([window.AIRGAME_WORKLET], { type: 'text/javascript' }))
        : new URL('./engine-worklet.js', import.meta.url);
      ctx.audioWorklet.addModule(url)
        .then(() => { this.worklet = true; this.buildEngine(); })
        .catch((e) => { console.warn('Son moteur simplifié :', e); this.buildEngine(); });
    } else this.buildEngine();
  }

  setPlane(spec) {
    this.spec = spec;
    this.jet = !!spec.jet;
    if (this.ctx) this.buildEngine();
  }

  buildEngine() {
    if (!this.ctx || !this.spec) return;
    const ctx = this.ctx;
    if (this.engine) { try { this.engine.stop(); this.engine.node.disconnect(); } catch { /* déjà coupé */ } }
    const e = this.spec.engine || { kind: this.spec.jet ? 'jet' : 'piston' };
    if (e.kind === 'none') { this.engine = null; return; } // planeur : que le vent
    if (this.worklet) {
      const node = new AudioWorkletNode(ctx, 'engine', { numberOfInputs: 0, outputChannelCount: [1], processorOptions: e });
      const out = ctx.createGain();
      out.gain.value = e.kind === 'jet' ? 0.55 : e.kind === 'turboprop' ? 0.5 : 0.62;
      node.connect(out).connect(this.engineGain);
      const prm = (n) => node.parameters.get(n);
      this.engine = { node: out, stop() { node.port.postMessage('stop'); node.disconnect(); }, rpm: prm('rpm'), load: prm('load'), burner: prm('burner'), pitch: prm('pitch'), speed: prm('speed') };
    } else {
      // secours (navigateur ancien ou page ouverte sans http://localhost) : deux oscillateurs filtrés
      const o1 = ctx.createOscillator(), o2 = ctx.createOscillator();
      o1.type = 'sawtooth'; o2.type = 'square';
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600;
      const out = ctx.createGain(); out.gain.value = 0.25;
      o1.connect(lp); o2.connect(lp); lp.connect(out).connect(this.engineGain);
      o1.start(); o2.start();
      this.engine = { node: out, simple: { o1, o2, lp }, stop() { o1.stop(); o2.stop(); } };
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.6, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /**
   * active : sons de l'avion audibles (faux au menu et en pause) ; engineOn : moteur en marche.
   */
  update({ plane, camera, cockpit, active, engineOn, dt }) {
    if (!this.ctx || !plane) return;
    const ctx = this.ctx, t = ctx.currentTime, spec = plane.spec;
    const set = (param, v, tc = 0.06) => param.setTargetAtTime(v, t, tc);
    const on = active ? 1 : 0;

    // --- position de la caméra : distance, stéréo, Doppler
    if (this.hasCam && dt > 0) {
      _cv.subVectors(camera.position, this.lastCam).multiplyScalar(1 / dt);
      if (_cv.lengthSq() > 800 * 800) _cv.set(0, 0, 0); // téléportation de la caméra
      this.camVel.lerp(_cv, 0.3);
    }
    this.lastCam.copy(camera.position); this.hasCam = true;
    _d.subVectors(plane.pos, camera.position);
    const dist = Math.max(_d.length(), 0.1);
    _d.multiplyScalar(1 / dist);
    // vitesse d'éloignement (positive : l'avion s'éloigne de l'auditeur)
    const away = plane.vel.dot(_d) - this.camVel.dot(_d);
    const doppler = cockpit ? 1 : clamp(C_SOUND / (C_SOUND + away), 0.55, 1.8);
    const ref = spec.cam.dist * 1.1;
    const atten = cockpit ? 1 : clamp(ref / Math.max(dist, ref), 0.015, 1) ** 1.1;
    set(this.planeBus.gain, on * atten, 0.04);
    set(this.airLP.frequency, cockpit ? 20000 : clamp(20000 * Math.exp(-dist / 450), 700, 20000));
    if (this.pan.pan) {
      _q.copy(camera.quaternion).invert();
      _d.applyQuaternion(_q);
      set(this.pan.pan, cockpit ? 0 : clamp(_d.x * 0.85, -0.85, 0.85), 0.04);
    }

    // --- moteur
    const open = spec.id === 'biplan';
    const rpm = clamp((plane.rpm - IDLE) / (1 - IDLE), 0, 1.1);
    const speedRatio = clamp(plane.speed / spec.maxSpeed, 0, 1.6);
    set(this.cabinLP.frequency, cockpit ? (open ? 7000 : 1300) : 20000, 0.1);
    set(this.cabinBass.gain, cockpit && !open ? 7 : 0, 0.2);
    const swell = 0.55 + 0.45 * Math.sin(t * 0.9) * Math.sin(t * 0.37 + 1);
    const seaK = active && plane.surface === 'water' ? Math.max(0, 1 - plane.agl / 120) : 0;
    set(this.sea.g.gain, seaK * swell * (cockpit && !open ? 0.06 : 0.16), 0.3);
    set(this.sea.f.frequency, 380 + 500 * swell, 0.3);
    const cough = plane.fuelOn && plane.failure === 'partial' && Math.random() < 0.08 ? 0.15 : 1;
    set(this.engineGain.gain, engineOn ? (cockpit && !open ? 0.85 : 1) * cough : 0, engineOn ? (cough < 1 ? 0.01 : 0.05) : 0.6);
    const e = this.engine;
    if (e && !e.simple) {
      set(e.rpm, rpm, 0.03); set(e.load, spec.heli ? plane.throttle : plane.power, 0.05); set(e.burner, plane.burner, 0.08);
      set(e.pitch, doppler, 0.05); set(e.speed, speedRatio, 0.2);
    } else if (e) {
      const f = (this.jet ? 90 : 46) + 70 * rpm;
      set(e.simple.o1.frequency, f * doppler); set(e.simple.o2.frequency, f * 1.503 * doppler);
      set(e.simple.lp.frequency, 260 + 900 * rpm);
    }
    // allumage de la postcombustion : un « boum » sourd
    if (plane.burner > 0.3 && this.wasBurner <= 0.3 && engineOn) this.burst(220, 0.7, 0.9, this.planeBus);
    this.wasBurner = plane.burner;

    // --- vent, tremblements, roulage
    const s = speedRatio, inside = cockpit && !open ? 0.45 : 1;
    const flying = active && !plane.onGround ? 1 : 0;
    set(this.wind.f.frequency, 250 + 2200 * s);
    set(this.wind.g.gain, on * inside * (0.05 + 0.3 * s * s) * (open && cockpit ? 1.6 : 1) * (plane.speed > 1 ? 1 : 0));
    set(this.whistle.f.frequency, 1300 + 1600 * s);
    set(this.whistle.g.gain, on * inside * 0.05 * clamp(s - 0.55, 0, 1) ** 1.5 * 3);
    const gStress = clamp((plane.gLoad - 2.5) / (spec.gLimit - 2.5), 0, 1);
    set(this.buffet.g.gain, flying * (plane.buffet * 0.9 + gStress * 0.15) * (cockpit ? 1.3 : 0.8), 0.04);
    const gs = plane.onGround ? clamp(plane.groundSpeed / spec.takeoff, 0, 1.2) : 0;
    const land = plane.surface === 'land' ? 1.6 : plane.surface === 'water' ? 0 : 0.7;
    set(this.roll.f.frequency, 120 + 500 * gs);
    set(this.roll.g.gain, on * gs * land * 0.35);
    set(this.water.g.gain, on * (plane.onGround && plane.surface === 'water' ? 0.05 + gs * 0.4 : 0));

    // --- vario (planeur)
    let vg = 0;
    if (spec.glider && active && !plane.onGround) {
      const vs = plane.vel.y + (plane.airLift || 0);
      if (vs > 0.25) {
        const per = clamp(0.48 - vs * 0.07, 0.11, 0.48);
        this.vario.frequency.setTargetAtTime(Math.min(1500, 520 + vs * 120), t, 0.02);
        vg = (t % per) < per * 0.55 ? 0.09 : 0;
      } else if (vs < -2.8) { this.vario.frequency.setTargetAtTime(240, t, 0.05); vg = 0.035; }
    }
    this.varioGain.gain.setTargetAtTime(vg, t, 0.006);

    // --- alarme de décrochage : continue pour les avions à hélice, bips pour le jet
    let horn = flying && engineOn && plane.stallWarn ? 1 : 0;
    if (this.jet) { this.horn.frequency.value = 1050; horn *= Math.sin(t * Math.PI * 2 * 4) > 0 ? 1 : 0; }
    else this.horn.frequency.value = 430 + 15 * Math.sin(t * 9);
    set(this.hornGain.gain, on * horn * (cockpit ? 0.07 : 0.025), 0.015);
  }

  // ------------------------------------------------------------------ ponctuels
  burst(freq, dur, gain, dest = this.master, type = 'lowpass', q = 0.7) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t); f.frequency.exponentialRampToValueAtTime(Math.max(60, freq * 0.15), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  /** Petit moteur électrique (train, volets) qui finit par un « clac ». */
  motor(dur, f0, gain) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.7, t);
    o.frequency.linearRampToValueAtTime(f0, t + 0.3);
    o.frequency.setValueAtTime(f0, t + dur - 0.3);
    o.frequency.linearRampToValueAtTime(f0 * 0.6, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.15);
    g.gain.setValueAtTime(gain, t + dur - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.planeBus);
    o.start(t); o.stop(t + dur + 0.05);
    setTimeout(() => this.burst(500, 0.18, 0.5, this.planeBus), dur * 1000);
  }

  /** Départ d'un missile : souffle qui monte puis s'éloigne. */
  missile() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.9;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(2600, t + 0.25);
    f.frequency.exponentialRampToValueAtTime(900, t + 1.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + 1.8);
    this.burst(180, 0.3, 0.5);
  }

  /** Un coup de mitrailleuse : claquement sec + petit grave. */
  gunshot() {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(1600 + Math.random() * 500, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    const o = ctx.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.35, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    src.connect(f).connect(g).connect(this.master);
    o.connect(og).connect(this.master);
    src.start(t, Math.random() * 1.5); src.stop(t + 0.1); o.start(t); o.stop(t + 0.1);
  }

  /** Explosion lointaine : plus faible, plus sourde, et retardée (le son voyage à 343 m/s). */
  distantBoom(dist, water) {
    if (!this.ctx) return;
    const k = 1 / (1 + dist / 350), delay = Math.min(4, dist / C_SOUND) * 1000;
    setTimeout(() => {
      this.burst(Math.max(250, 1200 * k), 2, 1.4 * (1 - k * 0.5), this.reverbIn); // écho lointain
      this.burst(Math.max(250, 1200 * k), 1.4, 1.2 * k);
      this.burst(110, 2, 0.9 * k);
      if (water) this.burst(3000, 0.9, 0.5 * k);
    }, delay);
  }

  /** Ambiance des feux de forêt : crépitement selon la distance, écopage, largage. */
  fireAmbience(fires, pos, scooping, dropping) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.fireNodes) {
      const mk = (type, f, q) => {
        const s = ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; s.start(0, Math.random() * 1.5);
        const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        s.connect(fl).connect(g).connect(this.master);
        return g;
      };
      this.fireNodes = { crackle: mk('bandpass', 2400, 1.4), roar: mk('lowpass', 260, 0.7), scoop: mk('highpass', 1800, 0.6), drop: mk('lowpass', 900, 0.6) };
    }
    const n = this.fireNodes;
    let near = 1e9, pw = 0;
    if (pos) for (const f of fires) if (!f.out) { const d = Math.hypot(f.x - pos.x, f.y - pos.y, f.z - pos.z); if (d < near) { near = d; pw = f.power; } }
    const k = pos ? Math.max(0, 1 - near / 900) * Math.min(1, pw) : 0;
    n.crackle.gain.setTargetAtTime(k * (Math.random() < 0.3 ? 0.5 : 0.05), t, 0.01); // crépitement irrégulier
    n.roar.gain.setTargetAtTime(k * 0.5, t, 0.2);
    n.scoop.gain.setTargetAtTime(scooping ? 0.25 : 0, t, 0.1);
    n.drop.gain.setTargetAtTime(dropping ? 0.5 : 0, t, 0.08);
  }

  /** Panne : gros raté, toux du moteur. */
  failure() {
    this.burst(400, 0.35, 1.0, this.planeBus);
    setTimeout(() => this.burst(300, 0.3, 0.8, this.planeBus), 260);
    setTimeout(() => this.burst(200, 0.5, 0.6, this.planeBus), 620);
  }

  /** Petit carillon (n notes) pour les annonces. */
  chime(n = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    for (let k = 0; k < n; k++) {
      const t = ctx.currentTime + k * 0.18;
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.value = n > 1 ? 880 - k * 220 : 660 + k * 220;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.55);
    }
  }

  gear() { this.motor(this.spec?.id === 'cargo' ? 3.4 : 2.2, 120, 0.05); }
  flaps() { this.motor(1.1, 190, 0.03); }
  catapult() { this.burst(2400, 1.8, 0.7, this.planeBus, 'bandpass', 0.6); }

  /** Toucher des roues : choc + crissement des pneus (piste, pont) ou gerbe d'eau. */
  touchdown(surface, sink) {
    if (!this.ctx) return;
    const k = clamp(sink / 4, 0.25, 1.3);
    this.burst(260, 0.25, 0.7 * k, this.planeBus);
    if (surface === 'water') { this.burst(3200, 0.9, 0.6 * k, this.planeBus); return; }
    if (surface === 'land') { this.burst(900, 0.4, 0.3 * k, this.planeBus, 'bandpass', 0.8); return; }
    // crissement : bruit très résonant autour de 1,5 kHz qui glisse vers le bas
    const ctx = this.ctx, t = ctx.currentTime;
    for (const [d, gl] of [[0, 1], [0.09, 0.6]]) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 14;
      f.frequency.setValueAtTime(1750, t + d); f.frequency.exponentialRampToValueAtTime(1150, t + d + 0.4);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(1.1 * k * gl, t + d + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.42);
      src.connect(f).connect(g).connect(this.planeBus);
      src.start(t + d, Math.random()); src.stop(t + d + 0.5);
    }
  }

  /** Démarrage au sol : démarreur et toussotements (pistons) ou montée en régime (turbines), puis le moteur. */
  startup(spec) {
    if (!this.ctx || !spec.engine || spec.engine.kind === 'none') return;
    const ctx = this.ctx, t = ctx.currentTime, g = this.startGain.gain;
    const piston = spec.engine.kind === 'piston';
    g.cancelScheduledValues(t);
    g.setValueAtTime(0.0001, t);
    g.setValueAtTime(0.0001, t + (piston ? 1.1 : 0.3));
    g.exponentialRampToValueAtTime(1, t + (piston ? 1.6 : 2.6));
    if (piston) {
      // démarreur : grognement électrique qui accélère, quelques ratés, puis le moteur prend
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(14, t); o.frequency.linearRampToValueAtTime(28, t + 1.1);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.25, t + 0.1);
      sg.gain.setValueAtTime(0.25, t + 1.0); sg.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
      o.connect(lp).connect(sg).connect(this.planeBus); o.start(t); o.stop(t + 1.35);
      [0.55, 0.8, 1.0, 1.15].forEach((d, k) => setTimeout(() => this.burst(300 + k * 60, 0.18, 0.45, this.planeBus), d * 1000));
    } else {
      // turbine : sifflement qui monte
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(300, t); o.frequency.exponentialRampToValueAtTime(spec.heli ? 2400 : 3600, t + 2.4);
      const sg = ctx.createGain(); sg.gain.setValueAtTime(0.0001, t); sg.gain.exponentialRampToValueAtTime(0.05, t + 0.6);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 3);
      o.connect(sg).connect(this.planeBus); o.start(t); o.stop(t + 3.05);
    }
  }

  /** Petit clic d'interface (menu). */
  click(up = true) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(up ? 1250 : 900, t);
    o.frequency.exponentialRampToValueAtTime(up ? 1700 : 700, t + 0.05);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    o.connect(g).connect(this.master); o.start(t); o.stop(t + 0.09);
  }

  boom() { this.burst(900, 1.6, 1.4, this.reverbIn); this.burst(900, 1.6, 1.4); this.burst(120, 2.4, 1.2); }
  splash() { this.burst(3500, 1.1, 0.8); this.burst(300, 1.2, 0.6); }
  thump() { this.burst(260, 0.25, 0.7); }
}
