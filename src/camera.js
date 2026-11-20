import * as THREE from 'three';
import { clamp, lerp, damp } from './util.js';

const MODES = [
  { id: 'chase', name: 'Vue extérieure' },
  { id: 'cockpit', name: 'Vue cockpit' },
  { id: 'orbit', name: 'Vue libre (glisser la souris)' },
  { id: 'flyby', name: 'Vue passage' },
];
const TILT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.1);
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.index = 0;
    this.q = new THREE.Quaternion();
    this.az = 0.7; this.el = 0.22; this.zoom = 1;
    this.lookYaw = 0; this.lookPitch = 0;
    this.dragging = false;
    this.fly = { t: 0, side: 1 };
    this.target = new THREE.Vector3();

    dom.addEventListener('pointerdown', (e) => { this.dragging = true; dom.setPointerCapture(e.pointerId); });
    dom.addEventListener('pointerup', () => { this.dragging = false; });
    dom.addEventListener('pointercancel', () => { this.dragging = false; });
    dom.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.az -= e.movementX * 0.006;
      this.el = clamp(this.el + e.movementY * 0.005, -0.5, 1.4);
      this.lookYaw = clamp(this.lookYaw + e.movementX * -0.005, -2.5, 2.5);
      this.lookPitch = clamp(this.lookPitch + e.movementY * -0.004, -0.7, 1.1);
    });
    dom.addEventListener('wheel', (e) => { this.zoom = clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.45, 4); }, { passive: true });
  }

  get mode() { return MODES[this.index].id; }

  /** Stick droit de la manette : regarder autour (cockpit) ou tourner autour de l'avion (vue libre). */
  padLook(x, y, dt) {
    this.padActive = Math.abs(x) + Math.abs(y) > 0;
    if (!this.padActive) return;
    this.az -= x * 2.2 * dt;
    this.el = clamp(this.el + y * 1.5 * dt, -0.5, 1.4);
    this.lookYaw = clamp(this.lookYaw - x * 2.6 * dt, -2.5, 2.5);
    this.lookPitch = clamp(this.lookPitch - y * 1.8 * dt, -0.7, 1.1);
  }
  set(id) { this.index = Math.max(0, MODES.findIndex((m) => m.id === id)); this.fly.t = 0; }
  next() { this.index = (this.index + 1) % MODES.length; this.fly.t = 0; return MODES[this.index].name; }
  snap(plane) { this.q.copy(plane.quat); }

  update(dt, plane, world, menu) {
    const cam = this.camera, spec = plane.spec, mode = this.mode;
    let fov = 60, near = 2;

    if (mode === 'chase') {
      this.q.slerp(plane.quat, 1 - Math.exp(-(plane.onGround ? 5 : 3.2) * dt));
      cam.position.copy(_v.set(0, spec.cam.height, spec.cam.dist).applyQuaternion(this.q)).add(plane.pos);
      cam.quaternion.copy(this.q).multiply(TILT);
      fov = 58 + 16 * clamp(plane.speed / spec.maxSpeed, 0, 1.25) ** 2;
    } else if (mode === 'cockpit') {
      if (!this.dragging && !this.padActive) { this.lookYaw = damp(this.lookYaw, 0, 5, dt); this.lookPitch = damp(this.lookPitch, 0, 5, dt); }
      cam.position.set(spec.eye[0], spec.eye[1], spec.eye[2]).applyQuaternion(plane.quat).add(plane.pos);
      cam.quaternion.copy(plane.quat).multiply(_q.setFromEuler(_e.set(this.lookPitch, this.lookYaw, 0, 'YXZ')));
      fov = 74; near = 0.25;
    } else if (mode === 'orbit') {
      if (menu || (!this.dragging && !this.padActive)) this.az += (menu ? 0.16 : 0.04) * dt;
      const d = spec.cam.dist * (menu ? 1.0 : 1.2) * this.zoom;
      const el = menu ? 0.2 : this.el;
      cam.position.set(Math.cos(el) * Math.sin(this.az), Math.sin(el), Math.cos(el) * Math.cos(this.az)).multiplyScalar(d).add(plane.pos);
      cam.up.set(0, 1, 0);
      // au menu, on vise sous l'avion pour le laisser dans la moitié haute de l'écran
      this.target.copy(plane.pos);
      if (menu) this.target.y -= d * 0.2;
      cam.lookAt(this.target);
      fov = menu ? 42 : 55;
    } else {
      // vue « passage » : caméra fixe plantée devant l'avion, qui le regarde passer
      const f = this.fly;
      f.t -= dt;
      const far = cam.position.distanceTo(plane.pos);
      if (f.t <= 0 || far > 500 + plane.speed * 3) {
        f.side = -f.side; f.t = 9;
        cam.position.copy(plane.pos).addScaledVector(plane.vel, 2.4)
          .addScaledVector(plane.right, f.side * (spec.span * 1.3 + 10)).addScaledVector(plane.up, -spec.span * 0.25);
      }
      cam.up.set(0, 1, 0);
      cam.lookAt(plane.pos);
      fov = clamp((2 * Math.atan((spec.span * 2.4) / Math.max(far, 1)) * 180) / Math.PI, 7, 55);
    }

    // tremblements : avion près du décrochage ou sous forts G, roulage dans l'herbe
    this.t = (this.t || 0) + dt;
    if (!menu && (mode === 'chase' || mode === 'cockpit')) {
      const rough = plane.onGround ? (plane.surface === 'land' ? 1 : 0.3) * clamp(plane.groundSpeed / 30, 0, 1) : 0;
      const amp = (plane.buffet || 0) * (mode === 'cockpit' ? 0.009 : 0.005) + rough * 0.0035;
      if (amp > 1e-4) {
        const t = this.t * 31;
        cam.quaternion.multiply(_q.setFromEuler(_e.set(
          amp * (Math.sin(t) + Math.sin(t * 2.3 + 1)), amp * 0.6 * Math.sin(t * 1.7 + 2), amp * Math.sin(t * 1.3 + 4), 'YXZ')));
      }
    }

    // jamais sous le sol ni sous l'eau (sauf dans le cockpit)
    if (mode !== 'cockpit') {
      const floor = world.groundAt(cam.position.x, cam.position.z, cam.position.y + 3).h + 1.6;
      if (cam.position.y < floor) cam.position.y = floor;
      if (mode === 'flyby') cam.lookAt(plane.pos);
    }
    const nf = mode === 'flyby' ? fov : lerp(cam.fov, fov, 1 - Math.exp(-4 * dt));
    if (Math.abs(nf - cam.fov) > 0.01 || cam.near !== near) {
      cam.fov = nf; cam.near = near;
      cam.updateProjectionMatrix();
    }
  }
}
