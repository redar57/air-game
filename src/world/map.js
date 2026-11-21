import { toWorld } from '../util.js';
import { fuelStation, loadPad } from './airfields.js';
import { country } from './country.js';
import { BIG } from './terrain.js';

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
        if (h < 0) c = mix([60, 140, 205], [24, 78, 150], Math.min(1, -h / 60));
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
    this.rect(g, carrier, 0, 0, carrier.halfWid * 2.4, carrier.halfLen * 2);
    // campagne (grande carte) : champs, chemins, villages
    g.fillStyle = '#d6bd62';
    for (const fl of country.fields) this.rect(g, fl, 0, 0, fl.hw * 2, fl.hl * 2);
    g.strokeStyle = '#e6d3a3'; g.lineWidth = Math.max(1, S / 600); g.lineJoin = 'round';
    for (const path of country.roads) {
      g.beginPath();
      path.forEach((p, i) => (i ? g.lineTo : g.moveTo).call(g, this.px(p.x), this.px(p.z)));
      g.stroke();
    }
    g.fillStyle = '#b9472f';
    for (const v of country.villages) { g.beginPath(); g.arc(this.px(v.x), this.px(v.z), Math.max(2, v.r * S / (2 * E) * 0.6), 0, 6.283); g.fill(); }
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
    const { thermals = [], balloons = [], fires = [], fuel = false, load = false } = extras;
    if (load && loadPad.rw) { // aire de chargement de l'épandeur
      const [x, y] = f(loadPad.x, loadPad.z), r = 5 * scale;
      g.fillStyle = '#3f9e4a'; g.strokeStyle = '#0d2b12'; g.lineWidth = scale;
      g.beginPath(); g.roundRect(x - r, y - r, 2 * r, 2 * r, r * 0.35); g.fill(); g.stroke();
      g.font = `800 ${Math.round(r * 1.4)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText('🌾', x, y + r * 0.08);
    }
    if (fuel) { // station de carburant
      const [x, y] = f(fuelStation.x, fuelStation.z), r = 5 * scale;
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
    for (const v of country.villages) label(v, v.name, -8);
    g.font = `700 ${Math.round(W / 55)}px sans-serif`;
    label(this.carrier, 'Porte-avions', -14);
    if (extras.fuel) label(fuelStation, 'Carburant', 22 * W / 1100 + 14);
    const [x, y] = f(plane.pos.x, plane.pos.z);
    this.planeIcon(g, x, y, heading, W / 300);
  }
}
