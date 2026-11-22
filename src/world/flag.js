import * as THREE from 'three';
import { spinners } from './airfields.js';

let tex = null;
/** Drapeau des États-Unis : 13 bandes, canton bleu à 50 étoiles (proportions officielles 10:19). */
export function usFlagTexture() {
  if (tex) return tex;
  const H = 520, W = 988, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), s = H / 13;
  for (let k = 0; k < 13; k++) { g.fillStyle = k % 2 ? '#ffffff' : '#b31942'; g.fillRect(0, k * s, W, s + 1); }
  const cw = W * 0.4, ch = s * 7;
  g.fillStyle = '#0a3161'; g.fillRect(0, 0, cw, ch);
  g.fillStyle = '#ffffff';
  for (let r = 0; r < 9; r++) for (let c = r % 2; c < 11; c += 2) {
    const x = ((c + 1) * cw) / 12, y = ((r + 1) * ch) / 10, R = s * 0.31;
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5, q = k % 2 ? R * 0.382 : R;
      g[k ? 'lineTo' : 'moveTo'](x + Math.cos(a) * q, y + Math.sin(a) * q);
    }
    g.fill();
  }
  tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

/** Drapeau qui flotte (hauteur h) ; origine au bas de la hampe, côté mât, tissu vers +X. */
export function usFlag(h) {
  const w = h * 1.9, geo = new THREE.PlaneGeometry(w, h, 16, 5).translate(w / 2, h / 2, 0);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: usFlagTexture(), side: THREE.DoubleSide, flatShading: true }));
  mesh.castShadow = true;
  const p = geo.attributes.position, x0 = Array.from(p.array);
  spinners.push({
    tick(t) {
      for (let i = 0; i < p.count; i++) {
        const x = x0[i * 3], y = x0[i * 3 + 1], k = x / w; // l'ondulation grandit vers le bord libre
        p.setZ(i, Math.sin((x / h) * 3.6 - t * 5.5 + y * 0.15) * h * 0.11 * k + Math.sin((x / h) * 7 - t * 8) * h * 0.025 * k);
        p.setY(i, y - k * k * h * 0.08);
      }
      p.needsUpdate = true;
    },
  });
  return mesh;
}
