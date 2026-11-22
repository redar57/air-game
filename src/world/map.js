import { toWorld } from '../util.js';
import { fuelStation, loadPad, seaBase, extraPumps, launchSite } from './airfields.js';
import { country } from './country.js';
import { hospital } from './sites.js';
import { city, cityPort, fishPort, islets, circuit, castle, monastery, rig, windFarm, peaks } from './places.js';
import { BIG, highWaters } from './terrain.js';
import { cityOutline } from './city.js';
import { decks } from './decks.js';

// Carte de l'île : un fond pré-calculé une fois (relief ombré, plages, pistes), puis à chaque image
// une mini-carte qui tourne avec l'avion et, sur demande (touche N), la grande carte.

let E = 7200;   // demi-côté de la zone cartographiée (m)
let S = 384;    // résolution du fond
const _w = { x: 0, z: 0 };

const lerp = (a, b, t) => a + (b - a) * t;
function mix(c1, c2, t) { return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)]; }

export class IslandMap {
  constructor(heightAt, runways, carrier, deckAxisX) {
    this.runways = runways; this.carrier = carrier; this.deckAxisX = deckAxisX;
    if (BIG) { E = 14700; S = 640; }
    this.bg = document.createElement('canvas');
    this.bg.width = this.bg.height = S;
    const g = this.bg.getContext('2d'), img = g.createImageData(S, S), H = new Float32Array(S * S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) H[j * S + i] = heightAt(this.wx(i + 0.5), this.wz(j + 0.5));
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const h = H[j * S + i];
        let c;
        if (highWaters.some((w) => h < w.level && w.has(this.wx(i + 0.5), this.wz(j + 0.5)))) c = [62, 132, 190];
        else if (h < 0) c = mix([60, 140, 205], [24, 78, 150], Math.min(1, -h / 60));
        else if (h < 5) c = [233, 216, 163];
        else if (h < 180) c = mix([111, 176, 82], [86, 140, 64], h / 180);
        else if (h < 520) c = mix([86, 140, 64], [138, 124, 104], (h - 180) / 340);
        else c = mix([138, 124, 104], [236, 236, 236], Math.min(1, (h - 520) / 500));
        if (h >= 0) { // ombrage du relief (lumière venant du nord-ouest)
          const hx = H[j * S + Math.min(S - 1, i + 1)] - H[j * S + Math.max(0, i - 1)];
          const hz = H[Math.min(S - 1, j + 1) * S + i] - H[Math.max(0, j - 1) * S + i];
          const k = Math.max(0.55, Math.min(1.35, 1 - (hx + hz) * 0.012));
          c = c.map((v) => v * k);
        }
        const o = (j * S + i) * 4;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // pistes et porte-avions
    g.fillStyle = '#3b3f45';
    for (const rw of runways) this.rect(g, rw, 0, 0, rw.width * 1.6, rw.length);
    // campagne (grande carte) : champs, chemins, villages
    g.fillStyle = '#d6bd62';
    for (const fl of country.fields) this.rect(g, fl, 0, 0, fl.hw * 2, fl.hl * 2);
    g.lineJoin = 'round';
    for (const path of country.roads) {
      g.strokeStyle = path.paved ? '#f4f1e6' : '#e6d3a3'; g.lineWidth = Math.max(1, S / (path.paved ? 420 : 600));
      g.beginPath();
      path.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, this.px(p.x), this.px(p.z)));
      g.stroke();
    }
    if (country.rail) { // voie ferrée : trait sombre à traverses claires
      const line = (w, col, dash) => {
        g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash);
        g.beginPath();
        country.rail.pts.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, this.px(p.x), this.px(p.z)));
        g.closePath(); g.stroke();
      };
      line(Math.max(1.5, S / 320), '#4a3f36', []);
      line(Math.max(1, S / 640), '#e9e2d0', [S / 200, S / 200]);
      g.setLineDash([]);
    }
    if (city.active) { // grande ville (pâtés de maisons) et quais
      const poly = (r) => { g.beginPath(); cityOutline(r).forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, this.px(city.x + p.x), this.px(city.z + p.z))); g.closePath(); };
      g.fillStyle = '#d9d2c4'; poly(425); g.fill(); g.strokeStyle = '#8f9499'; g.lineWidth = Math.max(0.6, S / 900);
      for (const r of [56, 128, 205, 285, 362]) { poly(r); g.stroke(); }
      for (let a = 0; a < 8; a++) { g.beginPath(); for (const r of [56, 205, 285, 425]) { const p = cityOutline(r, 8)[a]; g.lineTo(this.px(city.x + p.x), this.px(city.z + p.z)); } g.stroke(); }
      g.fillStyle = '#8f9499'; for (const o of [cityPort, fishPort]) this.rect(g, o, 0, 0, o.halfWid * 2, o.halfLen * 2);
    }
    if (peaks.dam && peaks.dam.river) { // rivière
      g.strokeStyle = 'rgb(62,132,190)'; g.lineWidth = Math.max(1, S / 420); g.beginPath();
      peaks.dam.river.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, this.px(p[0]), this.px(p[2]))); g.stroke();
    }
    // circuit, château
    g.strokeStyle = '#3f4247'; g.lineWidth = Math.max(1, S / 520); g.beginPath();
    for (let i = 0; i <= 24; i++) { const a = i * 0.2618; toWorld(circuit, Math.cos(a) * 150, Math.sin(a) * 270, _w); (i ? g.lineTo : g.moveTo).call(g, this.px(_w.x), this.px(_w.z)); }
    g.stroke(); g.fillStyle = '#9f9482'; this.rect(g, castle, 0, 0, 90, 100);
    g.fillStyle = '#b9472f';
    for (const v of country.villages) {
      if (v.city) continue; g.beginPath(); g.arc(this.px(v.x), this.px(v.z), Math.max(2, v.r * S / (2 * E) * 0.6), 0, 6.283); g.fill(); }
  }

  wx(i) { return (i / S) * 2 * E - E; }
  wz(j) { return (j / S) * 2 * E - E; }
  px(x) { return ((x + E) / (2 * E)) * S; }

  rect(g, o, lx, lz, w, l) {
    g.save();
    toWorld(o, lx, lz, _w);
    g.translate(this.px(_w.x), this.px(_w.z));
    g.rotate(-o.yaw);
    const k = S / (2 * E);
    g.fillRect((-w / 2) * k, (-l / 2) * k, w * k, l * k);
    g.restore();
  }

  /** Dessine les repères (thermiques, montgolfières, feux…) ; f(x, z) -> [px, py] sur le canevas. */
  marks(g, f, extras, scale, rk) {
    const { thermals = [], balloons = [], fires = [], fuel = false, load = false, mail = null, pins = [] } = extras;
    for (const p of pins) { // objectifs des missions (blessés, charges, zones de saut…)
      const [x, y] = f(p.x, p.z), r = (p.r || 6) * scale;
      g.fillStyle = p.color; g.strokeStyle = '#1b1d21'; g.lineWidth = scale;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); g.stroke();
      g.fillStyle = '#1b1d21'; g.font = `800 ${Math.round(r * 1.2)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(p.icon, x, y + r * 0.06);
    }
    if (load && loadPad.rw) { // aire de chargement de l'épandeur
      const [x, y] = f(loadPad.x, loadPad.z), r = 5 * scale;
      g.fillStyle = '#3f9e4a'; g.strokeStyle = '#0d2b12'; g.lineWidth = scale;
      g.beginPath(); g.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.35); g.fill(); g.stroke();
      g.font = `800 ${Math.round(r * 1.4)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('🌾', x, y + r * 0.08);
    }
    if (mail) { // village où livrer le courrier
      const [x, y] = f(mail.x, mail.z), r = 6 * scale;
      g.fillStyle = '#ffd34d'; g.strokeStyle = '#2b2205'; g.lineWidth = scale;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill(); g.stroke();
      g.fillStyle = '#2b2205'; g.font = `800 ${Math.round(r * 1.3)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('✉', x, y + r * 0.06);
    }
    // ponts mobiles (porte-avions, plateformes) : dessinés à leur place du moment
    for (const d of decks) {
      const w = {}, pt = (lx, lz) => { toWorld(d, lx, lz, w); return f(w.x, w.z); }, big = d.kind === 'carrier';
      if (!big) { const [x, y] = f(d.x, d.z); g.fillStyle = '#4a5158'; g.beginPath(); g.arc(x, y, 2.2 * scale, 0, 6.283); g.fill(); continue; }
      const K = Math.max(1, (1.4 * scale) / (d.hw * rk * 1.2)), c = f(d.x, d.z);
      g.fillStyle = '#3b3f45'; g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = scale * 0.6; g.beginPath();
      [[0, -d.hl], [d.hw, -d.hl * 0.6], [d.hw, d.hl], [-d.hw, d.hl], [-d.hw, -d.hl * 0.6]].forEach(([a, b], i) => { const q = pt(a, b); (i ? g.lineTo : g.moveTo).call(g, c[0] + (q[0] - c[0]) * K, c[1] + (q[1] - c[1]) * K); });
      g.closePath(); g.fill(); g.stroke();
    }
    const pumps = [fuelStation, ...extraPumps];
    for (const d of decks) if (d.fuel) { const w = {}; toWorld(d, d.fuel.lx, d.fuel.lz, w); pumps.push(w); }
    if (seaBase.active) { const w = {}; toWorld(seaBase, seaBase.fuel.lx, seaBase.fuel.lz, w); pumps.push(w); }
    if (fuel) for (const st of pumps) { // stations de carburant
      const [x, y] = f(st.x, st.z), r = 5 * scale;
      g.fillStyle = '#f2c230'; g.strokeStyle = '#2b2205'; g.lineWidth = scale;
      g.beginPath(); g.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.35); g.fill(); g.stroke();
      g.fillStyle = '#2b2205'; g.font = `800 ${Math.round(r * 1.5)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('⛽', x, y + r * 0.08);
    }
    g.lineWidth = Math.max(1, scale * 0.8);
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.setLineDash([3 * scale, 3 * scale]);
    for (const t of thermals) {
      const [x, y] = f(t.x, t.z);
      g.beginPath(); g.arc(x, y, Math.max(4 * scale, t.r * rk), 0, 6.283); g.stroke();
    }
    g.setLineDash([]);
    for (const b of balloons) {
      if (!b.alive) continue;
      const [x, y] = f(b.pos.x, b.pos.z);
      g.fillStyle = '#e84c3d'; g.beginPath(); g.arc(x, y, 3.5 * scale, 0, 6.283); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = scale; g.stroke();
    }
    for (const fi of fires) {
      if (fi.out) continue;
      const [x, y] = f(fi.x, fi.z), r = (3.5 + 2.5 * fi.power) * scale;
      g.fillStyle = '#ff7a1f';
      g.beginPath(); g.moveTo(x, y - r * 1.4); g.quadraticCurveTo(x + r, y, x, y + r * 0.6); g.quadraticCurveTo(x - r, y, x, y - r * 1.4); g.fill();
      g.strokeStyle = '#ffe08a'; g.lineWidth = scale; g.stroke();
    }
  }

  get k() { return S / (2 * E); }

  /** Mini-carte ronde, l'avion au centre, le nez vers le haut ; range = rayon couvert (m). */
  drawMini(cv, plane, heading, extras, range = 2200) {
    const g = cv.getContext('2d'), W = cv.width, R = W / 2, z = R / (range * this.k);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(R, R, R - 2, 0, 6.283); g.clip();
    g.fillStyle = '#2a6aa8'; g.fillRect(0, 0, W, W);
    g.translate(R, R); g.rotate(-heading); g.scale(z, z);
    g.translate(-this.px(plane.pos.x), -this.px(plane.pos.z));
    g.imageSmoothingEnabled = true;
    g.drawImage(this.bg, 0, 0);
    g.restore();
    g.save();
    g.beginPath(); g.arc(R, R, R - 2, 0, 6.283); g.clip();
    const c = Math.cos(-heading), s = Math.sin(-heading), K = z * this.k;
    this.marks(g, (x, y) => {
      const dx = (x - plane.pos.x) * K, dy = (y - plane.pos.z) * K;
      return [R + dx * c - dy * s, R + dx * s + dy * c];
    }, extras, W / 170, K);
    g.restore();
    // nord, bord, avion
    g.strokeStyle = 'rgba(255,255,255,.85)'; g.lineWidth = 2; g.beginPath(); g.arc(R, R, R - 2, 0, 6.283); g.stroke();
    const na = -heading - Math.PI / 2;
    g.fillStyle = '#ffd34d'; g.font = `800 ${Math.round(W / 11)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('N', R + Math.cos(na) * (R - W / 12), R + Math.sin(na) * (R - W / 12));
    this.planeIcon(g, R, R, 0, W / 170);
  }

  planeIcon(g, x, y, ang, s) {
    g.save(); g.translate(x, y); g.rotate(ang); g.scale(s, s);
    g.fillStyle = '#ffd34d'; g.strokeStyle = '#2b2205'; g.lineWidth = 1.2;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }

  /** Grande carte : toute l'île, avec noms des terrains. */
  drawFull(cv, plane, heading, extras) {
    const g = cv.getContext('2d'), W = cv.width, k = W / S;
    g.clearRect(0, 0, W, W);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.bg, 0, 0, W, W);
    const f = (x, z) => [this.px(x) * k, this.px(z) * k];
    this.marks(g, f, extras, W / 380, k * this.k);
    g.font = `700 ${Math.round(W / 55)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'bottom';
    const label = (o, text, dy = -10) => {
      const [x, y] = f(o.x, o.z);
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,20,40,.7)'; g.strokeText(text, x, y + dy);
      g.fillStyle = '#fff'; g.fillText(text, x, y + dy);
    };
    for (const rw of this.runways) label(rw, rw.name, -14);
    g.font = `italic 600 ${Math.round(W / 70)}px sans-serif`;
    for (const v of country.villages) if (!v.city) label(v, v.name, -8);
    for (const o of islets) label(o, o.name, 4);
    if (fishPort.active) label(fishPort, fishPort.name, 18);
    for (const o of [circuit, castle, monastery, rig]) label(o, o.name, -6);
    if (windFarm.spots.length) label(windFarm, windFarm.name, -6);
    if (peaks.dam) label(peaks.dam, 'Barrage', 16);
    if (peaks.ski) label(peaks.ski, 'Station de ski', -6);
    if (peaks.ramp) label(peaks.ramp, 'Rampe de vol libre', 14);
    g.font = `700 ${Math.round(W / 55)}px sans-serif`;
    label(this.carrier, 'Porte-avions', -14);
    if (city.active) label(city, 'Grande Ville', -16);
    if (seaBase.active) label(seaBase, 'Base nautique', -14);
    label(launchSite, 'Site de lancement', -14);
    if (hospital.active) label(hospital, 'Hôpital', -12);
    if (extras.fuel) label(fuelStation, 'Carburant', 22 * W / 1100 + 14);
    const [x, y] = f(plane.pos.x, plane.pos.z);
    this.planeIcon(g, x, y, heading, W / 300);
  }
}
