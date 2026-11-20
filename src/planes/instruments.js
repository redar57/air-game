import * as THREE from 'three';
import { clamp } from '../util.js';

// Planche de bord, sur deux rangées :
//   anémomètre · horizon artificiel · altimètre · compte-tours
//   bille-aiguille ou accéléromètre (G) · conservateur de cap · variomètre · voyants (train, volets, gaz…)
const W = 1024, H = 320, R = 68;
const cv = document.createElement('canvas');
cv.width = W; cv.height = H;
const g = cv.getContext('2d');

export const instrumentTexture = new THREE.CanvasTexture(cv);
instrumentTexture.colorSpace = THREE.SRGBColorSpace;
instrumentTexture.anisotropy = 4;

const TAU = Math.PI * 2, D2R = Math.PI / 180;
const INK = '#eef1f4', DIM = '#8f98a3', YEL = '#ffd34d', GRN = '#3fbf5a', RED = '#e8433a', WHT = '#f2f4f6';
const A0 = -225 * D2R, SWEEP = 270 * D2R; // cadran classique : de 7 h 30 à 4 h 30

function bezel(cx, cy) {
  g.fillStyle = '#0b0d10';
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.fill();
  g.strokeStyle = '#555d67'; g.lineWidth = 4; g.stroke();
}
function label(cx, cy, text, dy = -24, size = 11) {
  g.fillStyle = DIM; g.font = `600 ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cx, cy + dy);
}
function digits(cx, cy, text, dy = 34, color = INK, size = 17) {
  g.fillStyle = color; g.font = `700 ${size}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, cx, cy + dy);
}
const ang = (f) => A0 + clamp(f, 0, 1) * SWEEP;
function ticks(cx, cy, n, major, r0 = R - 5) {
  g.strokeStyle = INK;
  for (let k = 0; k <= n; k++) {
    const a = ang(k / n), big = k % major === 0;
    g.lineWidth = big ? 2.5 : 1.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    g.lineTo(cx + Math.cos(a) * (r0 - (big ? 11 : 6)), cy + Math.sin(a) * (r0 - (big ? 11 : 6)));
    g.stroke();
  }
}
function arc(cx, cy, f0, f1, color, r = R - 8, w = 6) {
  if (f1 <= f0) return;
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'butt';
  g.beginPath(); g.arc(cx, cy, r, ang(f0), ang(f1)); g.stroke();
}
function numbers(cx, cy, vals, toFrac, r = R - 24) {
  g.fillStyle = INK; g.font = '600 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const v of vals) {
    const a = ang(toFrac(v));
    g.fillText(String(v), cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
}
function needle(cx, cy, a, len, color = WHT, w = 4) {
  g.strokeStyle = color; g.lineWidth = w; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - Math.cos(a) * 10, cy - Math.sin(a) * 10); g.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len); g.stroke();
}
function hub(cx, cy) { g.fillStyle = '#c9ced4'; g.beginPath(); g.arc(cx, cy, 5, 0, TAU); g.fill(); }

// --------------------------------------------------------------------------- cadrans
function airspeed(cx, cy, s) {
  bezel(cx, cy);
  const top = Math.ceil((s.maxSpeed * 1.4 * 3.6) / 50) * 50, f = (kmh) => kmh / top;
  const vs = s.stall * 3.6, vsf = s.stall * 0.8 * 3.6, vfe = s.flapLimit * 3.6, vno = s.maxSpeed * 0.95 * 3.6, vne = s.maxSpeed * 1.3 * 3.6;
  if (s.hasFlaps) arc(cx, cy, f(vsf), f(vfe), '#e9edf0', R - 14, 4);
  arc(cx, cy, f(vs), f(vno), GRN);
  arc(cx, cy, f(vno), f(vne), YEL);
  arc(cx, cy, f(vne), f(vne) + 0.012, RED, R - 8, 10);
  ticks(cx, cy, 20, 4);
  const step = top / 5;
  numbers(cx, cy, [1, 2, 3, 4].map((k) => Math.round(k * step)), f);
  label(cx, cy, 'KM/H');
  needle(cx, cy, ang(f(s.speed * 3.6)), R - 12, WHT);
  hub(cx, cy);
  digits(cx, cy, String(Math.round(s.speed * 3.6)), 34, s.stallWarn ? RED : INK);
}

function attitude(cx, cy, s) {
  const PX = 2.6; // pixels par degré de tangage
  g.save();
  g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.clip();
  g.translate(cx, cy); g.rotate(-s.roll);
  const off = clamp(s.pitch / D2R, -90, 90) * PX;
  g.translate(0, off);
  g.fillStyle = '#3c8ad8'; g.fillRect(-300, -600, 600, 600);
  g.fillStyle = '#7a4f2c'; g.fillRect(-300, 0, 600, 600);
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-300, 0); g.lineTo(300, 0); g.stroke();
  g.fillStyle = '#fff'; g.font = '600 10px sans-serif'; g.textBaseline = 'middle';
  for (let d = -60; d <= 60; d += 5) {
    if (!d) continue;
    const y = -d * PX, w = d % 10 === 0 ? 22 : 10;
    if (Math.abs(y + off) > R + 20) continue;
    g.lineWidth = d % 10 === 0 ? 2 : 1.2;
    g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
    if (d % 10 === 0) { g.textAlign = 'left'; g.fillText(String(Math.abs(d)), w + 4, y); }
  }
  g.restore();
  // échelle d'inclinaison
  g.save(); g.translate(cx, cy);
  g.strokeStyle = '#fff'; g.lineWidth = 2;
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = (d - 90) * D2R, l = d % 30 === 0 ? 10 : 6;
    g.beginPath(); g.moveTo(Math.cos(a) * (R - 2), Math.sin(a) * (R - 2)); g.lineTo(Math.cos(a) * (R - 2 - l), Math.sin(a) * (R - 2 - l)); g.stroke();
  }
  g.rotate(-s.roll);
  g.fillStyle = YEL;
  g.beginPath(); g.moveTo(0, -R + 14); g.lineTo(-6, -R + 24); g.lineTo(6, -R + 24); g.fill();
  g.restore();
  g.strokeStyle = '#555d67'; g.lineWidth = 4; g.beginPath(); g.arc(cx, cy, R, 0, TAU); g.stroke();
  // maquette de l'avion
  g.strokeStyle = YEL; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 38, cy); g.lineTo(cx - 14, cy); g.lineTo(cx - 6, cy + 7);
  g.moveTo(cx + 38, cy); g.lineTo(cx + 14, cy); g.lineTo(cx + 6, cy + 7); g.stroke();
  g.fillStyle = YEL; g.beginPath(); g.arc(cx, cy, 3.5, 0, TAU); g.fill();
}

function altimeter(cx, cy, s) {
  bezel(cx, cy);
  g.strokeStyle = INK;
  for (let k = 0; k < 50; k++) {
    const a = (k / 50) * TAU - Math.PI / 2, big = k % 5 === 0;
    g.lineWidth = big ? 2.5 : 1.2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * (R - 5), cy + Math.sin(a) * (R - 5));
    g.lineTo(cx + Math.cos(a) * (R - (big ? 15 : 10)), cy + Math.sin(a) * (R - (big ? 15 : 10)));
    g.stroke();
  }
  g.fillStyle = INK; g.font = '700 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * TAU - Math.PI / 2;
    g.fillText(String(k), cx + Math.cos(a) * (R - 25), cy + Math.sin(a) * (R - 25));
  }
  label(cx, cy, 'ALT ×100 M', -22, 9);
  const alt = Math.max(0, s.alt);
  // petite aiguille : milliers de mètres ; grande : centaines
  needle(cx, cy, (alt / 10000) * TAU - Math.PI / 2, R - 38, WHT, 6);
  needle(cx, cy, ((alt % 1000) / 1000) * TAU - Math.PI / 2, R - 12, WHT, 3);
  hub(cx, cy);
  g.fillStyle = '#000'; g.fillRect(cx - 30, cy + 22, 60, 22);
  digits(cx, cy, String(Math.round(alt)), 33, INK, 15);
  if (s.agl < 300 && !s.onGround) { // sonde radio en approche
    g.fillStyle = s.agl < 30 ? YEL : '#5fd0ff'; g.font = '700 11px sans-serif';
    g.fillText(`SOL ${Math.round(s.agl)}`, cx, cy + 54);
  }
}

function tacho(cx, cy, s) {
  bezel(cx, cy);
  if (s.jet) {
    // régime du réacteur en %
    const f = (p) => p / 110;
    arc(cx, cy, f(60), f(100), GRN); arc(cx, cy, f(100), f(110), RED);
    ticks(cx, cy, 22, 4);
    numbers(cx, cy, [20, 40, 60, 80, 100], f);
    label(cx, cy, 'RÉGIME %');
    needle(cx, cy, ang(f(s.rpm * 102)), R - 12);
    hub(cx, cy);
    digits(cx, cy, s.burner > 0.05 ? 'PC' : String(Math.round(s.rpm * 102)), 34, s.burner > 0.05 ? '#ff8a3a' : INK);
  } else {
    const e = s.engine, idle = e.idle || 700, max = e.max || 2600;
    const top = Math.ceil((max * 1.15) / 500) * 500, f = (r) => r / top;
    const rpm = e.kind === 'turboprop' ? (e.prop || 1000) * (0.9 + 0.1 * s.rpm) : idle + (max - idle) * s.rpm;
    const red = e.kind === 'turboprop' ? (e.prop || 1000) * 1.02 : max;
    const t = e.kind === 'turboprop' ? Math.ceil(red * 1.3 / 500) * 500 : top, ff = (r) => r / t;
    arc(cx, cy, ff(red * 0.75), ff(red), GRN); arc(cx, cy, ff(red), ff(red) + 0.015, RED, R - 8, 10);
    ticks(cx, cy, t / 100, 5);
    numbers(cx, cy, Array.from({ length: t / 500 - 1 }, (_, k) => (k + 1) * 5), (v) => (v * 100) / t);
    label(cx, cy, 'TR/MIN ×100', -24, 9);
    needle(cx, cy, ang(ff(rpm)), R - 12);
    hub(cx, cy);
    digits(cx, cy, String(Math.round(rpm / 10) * 10));
    void f;
  }
}

function turnOrG(cx, cy, s) {
  bezel(cx, cy);
  if (s.gLimit >= 7) {
    // accéléromètre : facteur de charge, avec mémoire du maxi
    const lo = -3, hi = Math.ceil(s.gLimit + 1), f = (n) => (n - lo) / (hi - lo);
    arc(cx, cy, f(lo), f(-1.5), YEL); arc(cx, cy, f(-1.5), f(s.gLimit * 0.85), GRN);
    arc(cx, cy, f(s.gLimit * 0.85), f(s.gLimit), YEL); arc(cx, cy, f(s.gLimit), f(hi), RED);
    ticks(cx, cy, hi - lo, 1);
    numbers(cx, cy, [-2, 0, 2, 4, 6, 8].filter((v) => v <= hi), f);
    label(cx, cy, 'G');
    needle(cx, cy, ang(f(s.gMax)), R - 16, '#ff8a3a', 2);
    needle(cx, cy, ang(f(s.gLoad)), R - 12);
    hub(cx, cy);
    digits(cx, cy, s.gLoad.toFixed(1));
  } else {
    // indicateur de virage et bille
    label(cx, cy, 'VIRAGE', -40, 9);
    g.strokeStyle = INK; g.lineWidth = 3;
    for (const sgn of [-1, 1]) {
      const a = sgn * 20 * D2R;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 6) * sgn, cy + Math.sin(a) * (R - 6));
      g.lineTo(cx + Math.cos(a) * (R - 16) * sgn, cy + Math.sin(a) * (R - 16)); g.stroke();
    }
    g.beginPath(); g.moveTo(cx - R + 6, cy); g.lineTo(cx - R + 16, cy); g.moveTo(cx + R - 6, cy); g.lineTo(cx + R - 16, cy); g.stroke();
    // maquette inclinée selon le taux de virage (repère « 2 min » = 3°/s -> 20°)
    const bank = clamp((s.turnRate / D2R / 3) * 20, -40, 40) * D2R;
    g.save(); g.translate(cx, cy); g.rotate(bank);
    g.strokeStyle = WHT; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-40, 0); g.lineTo(40, 0); g.moveTo(0, 0); g.lineTo(0, -10); g.stroke();
    g.fillStyle = WHT; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    g.restore();
    // bille
    g.fillStyle = '#20262c'; g.strokeStyle = '#6a737d'; g.lineWidth = 1.5;
    g.beginPath(); g.ellipse(cx, cy + 32, 38, 9, 0, 0, TAU); g.fill(); g.stroke();
    g.strokeStyle = '#9aa3ad';
    g.beginPath(); g.moveTo(cx - 9, cy + 23); g.lineTo(cx - 9, cy + 41); g.moveTo(cx + 9, cy + 23); g.lineTo(cx + 9, cy + 41); g.stroke();
    g.fillStyle = '#111'; g.beginPath(); g.arc(cx + clamp(s.slip * 140, -30, 30), cy + 32, 7, 0, TAU); g.fill();
    g.strokeStyle = '#ccc'; g.lineWidth = 1; g.stroke();
  }
}

function heading(cx, cy, s) {
  bezel(cx, cy);
  g.save(); g.translate(cx, cy); g.rotate(-s.heading);
  g.strokeStyle = INK; g.fillStyle = INK; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 5) {
    const big = d % 30 === 0, l = big ? 11 : d % 10 === 0 ? 7 : 4;
    g.lineWidth = big ? 2.5 : 1.2;
    g.save(); g.rotate(d * D2R);
    g.beginPath(); g.moveTo(0, -R + 5); g.lineTo(0, -R + 5 + l); g.stroke();
    if (big) {
      const t = { 0: 'N', 90: 'E', 180: 'S', 270: 'O' }[d] || String(d / 10);
      g.font = t.length === 1 && Number.isNaN(+t) ? '800 15px sans-serif' : '600 11px sans-serif';
      g.fillStyle = t === 'N' ? '#ff8a3a' : INK;
      g.fillText(t, 0, -R + 26);
    }
    g.restore();
  }
  g.restore();
  // repère fixe et avion
  g.fillStyle = YEL; g.beginPath(); g.moveTo(cx, cy - R + 3); g.lineTo(cx - 6, cy - R - 5); g.lineTo(cx + 6, cy - R - 5); g.fill();
  g.strokeStyle = YEL; g.lineWidth = 3.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx, cy - 18); g.lineTo(cx, cy + 16); g.moveTo(cx - 16, cy - 2); g.lineTo(cx + 16, cy - 2);
  g.moveTo(cx - 7, cy + 14); g.lineTo(cx + 7, cy + 14); g.stroke();
  g.fillStyle = '#000'; g.fillRect(cx - 24, cy + 25, 48, 20);
  digits(cx, cy, `${String(Math.round(((s.heading / D2R) % 360 + 360) % 360) % 360).padStart(3, '0')}°`, 35, INK, 14);
}

function vario(cx, cy, s) {
  bezel(cx, cy);
  // 0 à 9 h, montée vers le haut, ±15 m/s, échelle comprimée au-delà de 5
  const map = (v) => Math.sign(v) * (Math.abs(v) <= 5 ? Math.abs(v) / 5 * 0.55 : 0.55 + (Math.min(Math.abs(v), 15) - 5) / 10 * 0.4);
  const angV = (v) => Math.PI - map(v) * Math.PI;
  g.strokeStyle = INK;
  for (const v of [-15, -10, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 10, 15]) {
    const a = angV(v), big = v % 5 === 0;
    g.lineWidth = big ? 2.5 : 1.2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 5), cy - Math.sin(a) * (R - 5));
    g.lineTo(cx + Math.cos(a) * (R - (big ? 16 : 11)), cy - Math.sin(a) * (R - (big ? 16 : 11))); g.stroke();
  }
  g.fillStyle = INK; g.font = '600 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const v of [0, 5, 10, 15]) {
    for (const sg of v ? [1, -1] : [1]) {
      const a = angV(v * sg);
      g.fillText(String(v), cx + Math.cos(a) * (R - 27), cy - Math.sin(a) * (R - 27));
    }
  }
  label(cx, cy, '▲ M/S', -14, 9); label(cx, cy, '▼', 14, 9);
  const a = angV(clamp(s.vs, -15, 15));
  needle(cx, cy, -a, R - 12);
  hub(cx, cy);
  g.fillStyle = '#000'; g.fillRect(cx - 58, cy + 18, 42, 20);
  digits(cx - 37, cy, `${s.vs >= 0 ? '+' : ''}${s.vs.toFixed(1)}`, 28, s.vs < -6 && s.agl < 60 ? RED : INK, 13);
}

function lamp(x, y, w, h, on, color, text) {
  g.fillStyle = on ? color : '#1d2227';
  g.fillRect(x, y, w, h);
  g.strokeStyle = '#3a4149'; g.lineWidth = 1.5; g.strokeRect(x, y, w, h);
  g.fillStyle = on ? '#101010' : '#5d666f'; g.font = '700 11px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x + w / 2, y + h / 2 + 1);
}

function annunciators(x0, y0, s) {
  g.fillStyle = '#15191e'; g.fillRect(x0 + 8, y0 + 8, 240, 144);
  // train : trois voyants verts sortis et verrouillés, rouges en transit
  label(x0 + 52, y0 + 26, 'TRAIN', 0, 10);
  if (!s.retract) {
    g.fillStyle = DIM; g.font = '700 12px sans-serif'; g.fillText(s.floats ? 'FLOTTEURS' : 'FIXE', x0 + 52, y0 + 52);
  } else {
    const moving = s.gear > 0.02 && s.gear < 0.98;
    const col = moving ? RED : GRN, on = moving || s.gear >= 0.98;
    for (const [dx, dy] of [[0, 0], [-18, 20], [18, 20]]) {
      g.fillStyle = on ? col : '#1d2227';
      g.beginPath(); g.arc(x0 + 52 + dx, y0 + 46 + dy, 8, 0, TAU); g.fill();
      g.strokeStyle = '#3a4149'; g.lineWidth = 1.5; g.stroke();
    }
  }
  // volets : jauge 0 / 1 / 2
  label(x0 + 128, y0 + 26, 'VOLETS', 0, 10);
  if (s.hasFlaps) {
    g.fillStyle = '#0b0d10'; g.fillRect(x0 + 110, y0 + 38, 36, 52);
    g.fillStyle = DIM; g.font = '600 10px sans-serif'; g.textAlign = 'left';
    ['0', '1', '2'].forEach((t, i) => g.fillText(t, x0 + 150, y0 + 42 + i * 22));
    g.fillStyle = s.flaps > 0.05 ? '#5fd0ff' : WHT;
    g.fillRect(x0 + 112, y0 + 38 + (s.flaps / 2) * 44, 32, 8);
  } else { g.fillStyle = DIM; g.font = '700 12px sans-serif'; g.textAlign = 'center'; g.fillText('—', x0 + 128, y0 + 60); }
  // manette des gaz
  label(x0 + 210, y0 + 26, 'GAZ', 0, 10);
  g.fillStyle = '#0b0d10'; g.fillRect(x0 + 200, y0 + 36, 20, 60);
  g.fillStyle = s.burner > 0.05 ? '#ff8a3a' : s.throttle > 0.9 ? YEL : GRN;
  g.fillRect(x0 + 202, y0 + 94 - 56 * s.throttle, 16, 56 * s.throttle);
  g.fillStyle = WHT; g.fillRect(x0 + 197, y0 + 94 - 56 * s.power - 1, 26, 2);
  // alarmes
  const blink = (performance.now() % 600) < 340;
  lamp(x0 + 16, y0 + 106, 108, 18, s.stallWarn && blink, RED, 'DÉCROCHAGE');
  lamp(x0 + 132, y0 + 106, 108, 18, s.brake, YEL, s.onGround ? 'FREINS' : 'AÉROFREINS');
  lamp(x0 + 16, y0 + 128, 108, 18, s.gearWarn && blink, RED, 'TRAIN !');
  lamp(x0 + 132, y0 + 128, 108, 18, s.lowAlt && blink, YEL, 'ALTITUDE');
}

/** s : état de l'avion préparé par main.js (voir cockpitData). */
export function drawInstruments(s) {
  g.fillStyle = '#1c2026'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#23282f'; g.fillRect(0, 158, W, 4);
  const cx = (i) => 128 + i * 256;
  airspeed(cx(0), 80, s);
  attitude(cx(1), 80, s);
  altimeter(cx(2), 80, s);
  tacho(cx(3), 80, s);
  turnOrG(cx(0), 240, s);
  heading(cx(1), 240, s);
  vario(cx(2), 240, s);
  annunciators(768, 160, s);
  instrumentTexture.needsUpdate = true;
}
