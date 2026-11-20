// Synthèse des moteurs, échantillon par échantillon (AudioWorklet).
//
//  piston     : chaque cylindre qui s'allume envoie une impulsion dans un « pot d'échappement »
//               (filtres résonants) ; les petites irrégularités d'un cylindre à l'autre donnent
//               le grondement caractéristique. L'hélice ajoute un bourdonnement à la fréquence de
//               passage des pales et un souffle « whup-whup ».
//  turboprop  : sifflement de turbine + grosse hélice à vitesse constante, plusieurs moteurs
//               légèrement désaccordés (les battements donnent l'effet « quadrimoteur »).
//  jet        : soufflante, sifflement du compresseur, grondement des gaz, et en postcombustion
//               un grondement grave plein de crépitements.
//
// Paramètres : rpm (0 = ralenti, 1 = plein régime), load (puissance), burner, pitch (effet Doppler),
// speed (vitesse / vitesse maxi : l'hélice tourne un peu plus vite en piqué).

const TAB = 4096;
const SIN = new Float32Array(TAB + 1);
for (let i = 0; i <= TAB; i++) SIN[i] = Math.sin((i / TAB) * Math.PI * 2);
const sinp = (ph) => SIN[((ph - Math.floor(ph)) * TAB) | 0]; // ph en tours

class SVF {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.set(1000, 1); }
  set(f, q) {
    const g = Math.tan(Math.PI * Math.min(f, sampleRate * 0.45) / sampleRate);
    this.k = 1 / q; this.a1 = 1 / (1 + g * (g + this.k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  run(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1;
    return v1;
  }
}

class EngineProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'rpm', defaultValue: 0, minValue: 0, maxValue: 1.2, automationRate: 'k-rate' },
      { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'burner', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'pitch', defaultValue: 1, minValue: 0.3, maxValue: 3, automationRate: 'k-rate' },
      { name: 'speed', defaultValue: 0, minValue: 0, maxValue: 2, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();
    const o = this.o = { cyl: 4, idle: 700, max: 2700, blades: 2, gear: 1, exhaust: 100, rough: 0.4, count: 1, prop: 1000, ...options.processorOptions };
    this.seed = 0x9e3779b9 ^ ((Math.random() * 1e9) | 0);
    // piston
    this.firePh = 0; this.cylIdx = 0; this.env = 0; this.propPh = 0;
    this.cylVar = Array.from({ length: o.cyl }, () => 1 + (this.rand() - 0.5) * o.rough * 0.6);
    this.ex1 = new SVF(); this.ex2 = new SVF(); this.body = new SVF(); this.whupF = new SVF();
    // turbines
    this.voices = Array.from({ length: o.count }, (_, i) => ({
      det: 1 + (i - (o.count - 1) / 2) * 0.009 + (this.rand() - 0.5) * 0.004,
      w: this.rand(), p: this.rand(), gas: new SVF(), slapF: (() => { const f = new SVF(); f.set(320, 0.9); return f; })(),
    }));
    this.fan = 0; this.comp = 0; this.roar = new SVF(); this.roar2 = new SVF(); this.rumble = new SVF();
    this.crk = 0; this.crkF = new SVF(); this.dc = 0; this.dcIn = 0;
    this.alive = true;
    this.port.onmessage = (e) => { if (e.data === 'stop') this.alive = false; };
  }

  rand() { // xorshift32, rapide et suffisant pour du bruit
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x >>> 0;
    return this.seed / 4294967296;
  }

  process(_in, outputs, p) {
    if (!this.alive) return false; // avion changé : le processeur peut disparaître
    const out = outputs[0][0];
    if (!out) return true;
    const rpm = p.rpm[0], load = p.load[0], burner = p.burner[0], pitch = p.pitch[0], speed = p.speed[0];
    const kind = this.o.kind;
    if (kind === 'jet') this.jet(out, rpm, load, burner, pitch);
    else if (kind === 'turboprop') this.turboprop(out, rpm, load, pitch);
    else this.piston(out, rpm, load, pitch, speed);
    // coupe le continu, sature en douceur
    for (let i = 0; i < out.length; i++) {
      const x = out[i];
      this.dc = 0.995 * (this.dc + x - this.dcIn); this.dcIn = x;
      out[i] = Math.tanh(this.dc);
    }
    return true;
  }

  piston(out, rpm, load, pitch, speed) {
    const o = this.o, sr = sampleRate;
    const f = Math.max(0, rpm);
    const rpmAbs = (o.idle + (o.max - o.idle) * f + 0.12 * (o.max - o.idle) * speed * (1 - f)) * pitch;
    const crank = rpmAbs / 60, fireHz = (crank * o.cyl) / 2, bladeHz = crank * o.gear * o.blades;
    const tau = Math.min(0.012, 0.55 / fireHz), decay = Math.exp(-1 / (sr * tau));
    const exh = o.exhaust * (0.85 + 0.5 * f) * pitch;
    this.ex1.set(exh, 1.6); this.ex2.set(exh * 2.7, 2.2); this.body.set(exh * 6, 0.7);
    this.whupF.set(900 + 700 * f, 0.8);
    const propAmp = (0.12 + 0.88 * f ** 1.4) * (0.35 + 0.65 * load + 0.25 * speed);
    const fireAmp = 0.45 + 0.55 * load;
    for (let i = 0; i < out.length; i++) {
      this.firePh += fireHz / sr;
      if (this.firePh >= 1) {
        this.firePh -= 1;
        this.cylIdx = (this.cylIdx + 1) % o.cyl;
        let a = fireAmp * this.cylVar[this.cylIdx] * (1 + (this.rand() - 0.5) * o.rough * (1 - 0.5 * load));
        if (f < 0.08 && this.rand() < 0.025 * o.rough) a *= 0.15; // raté au ralenti
        this.env = a;
      }
      const n = this.rand() * 2 - 1;
      const exc = this.env * (1 + 0.7 * n);
      this.env *= decay;
      const e1 = this.ex1.run(exc), e2 = this.ex2.run(exc);
      this.body.run(exc);
      const engine = e1 * 2.2 + e2 * 0.9 + this.body.lp * 0.35;
      // hélice
      this.propPh += bladeHz / sr;
      if (this.propPh > 1e6) this.propPh -= 1e6;
      const ph = this.propPh;
      const tone = sinp(ph) + 0.55 * sinp(2 * ph) + 0.35 * sinp(3 * ph) + 0.22 * sinp(4 * ph) + 0.14 * sinp(5 * ph);
      const blade = 0.5 + 0.5 * sinp(ph + 0.25);
      const whup = this.whupF.run(n) * blade * blade * blade;
      out[i] = 0.7 * (engine * 0.75 + propAmp * (tone * 0.16 + whup * 0.9));
    }
  }

  turboprop(out, rpm, load, pitch) {
    const o = this.o, sr = sampleRate, f = Math.max(0, rpm);
    const propHz = (o.prop / 60) * (0.9 + 0.1 * f) * o.blades * pitch;
    const whineHz = (4200 + 2600 * f) * pitch;
    const gasAmp = 0.18 + 0.5 * f, propAmp = 0.25 + 0.75 * load, whineAmp = 0.025 + 0.035 * f;
    for (const v of this.voices) v.gas.set((350 + 900 * f) * v.det, 0.7);
    const nv = this.voices.length, norm = 1 / Math.sqrt(nv);
    for (let i = 0; i < out.length; i++) {
      let s = 0;
      for (const v of this.voices) {
        v.p += (propHz * v.det) / sr; v.w += (whineHz * v.det) / sr;
        if (v.p > 1e6) v.p -= 1e6;
        if (v.w > 1e6) v.w -= 1e6;
        const n = this.rand() * 2 - 1;
        const blade = 0.5 + 0.5 * sinp(v.p + 0.25);
        const tone = sinp(v.p) + 0.6 * sinp(2 * v.p) + 0.3 * sinp(3 * v.p) + 0.15 * sinp(4 * v.p);
        v.gas.run(n);
        const whine = whineAmp * (sinp(v.w) + 0.5 * sinp(v.w * 0.51));
        if (o.heli) {
          // hélicoptère : chaque pale qui passe claque (« whop ») — tout le souffle du rotor bat à ce rythme,
          // plus une impulsion grave à chaque passage
          const b2 = blade * blade, slap = b2 * b2 * b2;
          v.slapF.run(n);
          const am = 0.3 + 1.3 * slap * (0.5 + 0.5 * load);
          s += (propAmp * (tone * 0.12 + n * 0.12) + gasAmp * v.gas.lp * 0.7) * am + whine
            + slap * (0.4 + 0.6 * load) * v.slapF.lp * 3.2;
        } else {
          s += propAmp * (tone * 0.2 + n * blade * blade * 0.18) + gasAmp * v.gas.lp * 0.9 + whine;
        }
      }
      out[i] = s * norm * 1.8;
    }
  }

  jet(out, rpm, load, burner, pitch) {
    const sr = sampleRate, f = Math.max(0, rpm);
    const fanHz = (700 + 2300 * f) * pitch, compHz = (2800 + 4800 * f) * pitch;
    this.roar.set((220 + 2600 * f * f) * pitch, 0.6);
    this.roar2.set((500 + 1300 * f) * pitch, 1.1);
    this.rumble.set(120 * pitch, 0.8);
    const roarAmp = 0.45 + 0.9 * f * f, fanAmp = 0.09 + 0.05 * f, compAmp = 0.03 + 0.02 * f;
    const crkRate = burner * 55 / sr;
    for (let i = 0; i < out.length; i++) {
      const n = this.rand() * 2 - 1;
      this.fan += fanHz / sr; this.comp += compHz / sr;
      if (this.fan > 1e6) this.fan -= 1e6;
      if (this.comp > 1e6) this.comp -= 1e6;
      this.roar.run(n); this.roar2.run(n); this.rumble.run(n);
      let s = roarAmp * (this.roar.lp * 0.8 + this.roar2.bp * 0.5)
        + fanAmp * (sinp(this.fan) + 0.4 * sinp(this.fan * 2.01))
        + compAmp * (sinp(this.comp) + 0.6 * sinp(this.comp * 1.007));
      if (burner > 0.01) {
        if (this.rand() < crkRate) { this.crk = 0.6 + this.rand(); this.crkF.set(700 + this.rand() * 1600, 3); }
        this.crk *= 0.993;
        s += burner * (this.rumble.lp * 4.5 + this.crkF.run(n * this.crk) * 1.6);
      }
      out[i] = s;
    }
  }
}

registerProcessor('engine', EngineProcessor);
