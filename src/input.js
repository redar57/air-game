// Clavier. Les touches de pilotage sont lues par position physique (event.code),
// donc ZQSD sur un clavier AZERTY et WASD sur un QWERTY, sans réglage.

const GAME_CODES = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace', 'Tab', 'PageUp', 'PageDown',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF',
]);

/** Lettres imprimées sur les touches de pilotage, selon la disposition du clavier. */
export async function keyLabels() {
  const codes = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF'];
  const azerty = (navigator.language || 'fr').toLowerCase().startsWith('fr');
  const fallback = azerty ? ['Z', 'Q', 'S', 'D', 'A', 'E', 'R', 'F'] : ['W', 'A', 'S', 'D', 'Q', 'E', 'R', 'F'];
  const out = {};
  codes.forEach((c, i) => { out[c] = fallback[i]; });
  try {
    const map = await navigator.keyboard.getLayoutMap();
    for (const c of codes) if (map.get(c)) out[c] = map.get(c).toUpperCase();
  } catch { /* API absente : on garde la supposition */ }
  return out;
}

// Manette (Xbox, PlayStation, Switch Pro… en Bluetooth ou USB), disposition « standard » :
//   stick gauche : tangage / roulis      gâchettes RT / LT : plus / moins de gaz
//   LB / RB : palonnier                  stick droit : regarder autour (cockpit, vue libre)
//   A / Croix : freins (et valider)      B / Rond : volets      X / Carré : train
//   Y / Triangle : changer de vue        Start : pause          Select : réapparaître
//   croix directionnelle : choisir l'avion / le départ au menu, heure du jour en vol (haut)
const PAD_KEYS = {
  0: { code: 'Enter', key: 'enter' }, 1: { code: 'KeyV', key: 'v' }, 2: { code: 'KeyG', key: 'g' },
  3: { code: 'KeyC', key: 'c' }, 8: { code: 'Backspace', key: 'backspace' }, 9: { code: 'Escape', key: 'escape' },
  12: { code: 'ArrowUp', key: 't', pad: true }, 13: { code: 'ArrowDown', key: '', pad: true },
  14: { code: 'ArrowLeft', key: '' }, 15: { code: 'ArrowRight', key: '' },
};
const DEAD = 0.12;
/** Zone morte puis courbe « expo » : précis autour du neutre, plein débattement au bout. */
const curve = (v) => {
  const a = Math.abs(v);
  if (a < DEAD) return 0;
  const t = (a - DEAD) / (1 - DEAD);
  return Math.sign(v) * (0.35 * t + 0.65 * t * t * t);
};

export class Input {
  constructor() {
    this.down = new Set();
    this.pressed = [];
    this.invert = false;
    this.enabled = true;
    this.pad = null;           // index de la manette utilisée
    this.padPrev = [];
    this.look = { x: 0, y: 0 }; // stick droit
    this.onPad = null;          // rappel (connectée / déconnectée)
    window.addEventListener('gamepadconnected', (e) => { this.pad = e.gamepad.index; this.onPad?.(true, e.gamepad.id); });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.pad) { this.pad = null; this.onPad?.(false, e.gamepad.id); }
    });
    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (GAME_CODES.has(e.code) && this.enabled) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.push({ code: e.code, key: (e.key || '').toLowerCase() });
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.down.clear());
  }

  has(...codes) { return codes.some((c) => this.down.has(c)); }

  gamepad() {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.pad !== null && pads[this.pad]) return pads[this.pad];
    // certaines manettes ne déclenchent « gamepadconnected » qu'après un appui : on les cherche
    for (const p of pads) {
      if (p && p.connected && (p.buttons.some((b) => b.pressed) || p.axes.some((a) => Math.abs(a) > 0.5))) {
        this.pad = p.index; this.onPad?.(true, p.id);
        return p;
      }
    }
    return null;
  }

  /** À appeler à chaque image : transforme les appuis de la manette en « touches ». */
  poll() {
    const p = this.gamepad();
    if (!p) return;
    const prev = this.padPrev;
    p.buttons.forEach((b, i) => {
      if (b.pressed && !prev[i] && PAD_KEYS[i]) this.pressed.push({ ...PAD_KEYS[i], fromPad: true });
      prev[i] = b.pressed;
    });
    // au menu, le stick gauche sert aussi à choisir
    const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
    const dir = Math.abs(ax) > 0.7 ? (ax > 0 ? 'ArrowRight' : 'ArrowLeft') : Math.abs(ay) > 0.7 ? (ay > 0 ? 'ArrowDown' : 'ArrowUp') : null;
    if (dir && dir !== this.stickDir) this.pressed.push({ code: dir, key: '', fromPad: true, stick: true });
    this.stickDir = dir;
    this.look.x = curve(p.axes[2] || 0);
    this.look.y = curve(p.axes[3] || 0);
  }

  /** Petite vibration (si la manette et le navigateur le permettent). */
  rumble(strong, weak, ms) {
    const p = this.gamepad();
    const act = p && p.vibrationActuator;
    if (!act) return;
    try { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* pas de vibreur */ }
  }

  /** Touches enfoncées depuis le dernier appel. */
  take() {
    const p = this.pressed;
    this.pressed = [];
    return p;
  }

  /** État des commandes de vol : pitch > 0 = cabrer, roll > 0 = à droite, yaw > 0 = à droite. */
  read() {
    const ax = (neg, pos) => (this.has(...pos) ? 1 : 0) - (this.has(...neg) ? 1 : 0);
    let pitch = ax(['KeyW', 'ArrowUp'], ['KeyS', 'ArrowDown']);
    let roll = ax(['KeyA', 'ArrowLeft'], ['KeyD', 'ArrowRight']);
    let yaw = ax(['KeyQ'], ['KeyE']);
    let throttle = ax(['KeyF', 'PageDown'], ['KeyR', 'PageUp']);
    let brake = this.has('Space'), analog = false;
    const p = this.gamepad();
    if (p) {
      const btn = (i) => (p.buttons[i] ? p.buttons[i].value || (p.buttons[i].pressed ? 1 : 0) : 0);
      const sp = curve(p.axes[1] || 0), sr = curve(p.axes[0] || 0);
      if (sp || sr) analog = true;
      pitch += sp;            // stick tiré vers soi = cabrer
      roll += sr;
      yaw += btn(5) - btn(4);
      throttle += btn(7) - btn(6);
      brake = brake || btn(0) > 0.5;
    }
    const c = (v) => Math.max(-1, Math.min(1, v));
    if (this.invert) pitch = -pitch;
    return { pitch: c(pitch), roll: c(roll), yaw: c(yaw), throttle: c(throttle), brake, analog };
  }
}
