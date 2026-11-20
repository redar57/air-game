import * as THREE from 'three';

// Missiles du jet de chasse : illimités, guidés vers la montgolfière visée.
// Ils n'abîment pas le décor : contre le sol, l'eau ou un bâtiment, ils explosent simplement.

// Verrouillage volontairement exigeant : il faut garder la cible dans un cône étroit (~10°) pendant
// LOCK_TIME secondes ; le missile vire assez mollement et perd sa cible s'il la dépasse.
const SPEED_MAX = 620, BOOST = 260, TURN = 1.3, LIFE = 9, COOLDOWN = 0.55;
const LOCK_RANGE = 2600, LOCK_COS = Math.cos(0.17), LOCK_TIME = 1.1, LOSE_COS = Math.cos(0.9);
const FWD = new THREE.Vector3(0, 0, -1);
const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _q = new THREE.Quaternion(), _v = new THREE.Vector3();

let template = null;
/** Les missiles partagent géométries et matériaux (clone() ne les recopie pas). */
export function newMissileMesh() { return (template ||= missileMesh()).clone(); }

function missileMesh() {
  const g = new THREE.Group();
  const white = new THREE.MeshLambertMaterial({ color: 0xe9ecef, flatShading: true });
  const red = new THREE.MeshLambertMaterial({ color: 0xd8432f, flatShading: true });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 2.6, 6).rotateX(Math.PI / 2), white);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 6).rotateX(-Math.PI / 2), red);
  nose.position.z = -1.55;
  g.add(body, nose);
  for (let k = 0; k < 4; k++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.42, 0.45), white);
    fin.position.set(0, 0, 1.05);
    const p = new THREE.Group(); p.rotation.z = (k * Math.PI) / 2 + Math.PI / 4; p.add(fin); fin.position.y = 0.2;
    g.add(p);
  }
  return g;
}

export class Missiles {
  constructor(scene, fx, sound) {
    this.scene = scene; this.fx = fx; this.sound = sound;
    this.list = [];
    this.cool = 0; this.side = 1; this.hits = 0;
    this.aim = null; this.aimT = 0; // cible dans le viseur, et depuis combien de temps
    this.flameMat = new THREE.MeshBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.9, depthWrite: false });
    this.flameGeo = new THREE.ConeGeometry(0.16, 1.4, 6).rotateX(Math.PI / 2).translate(0, 0, 2);
  }

  reset() {
    for (const m of this.list) this.scene.remove(m.mesh);
    this.list.length = 0;
    this.cool = 0; this.aim = null; this.aimT = 0;
  }

  /** Montgolfière la plus proche de l'axe de l'avion, dans un cône devant lui (ou null). */
  target(plane, balloons) {
    let best = null, bestCos = LOCK_COS;
    for (const b of balloons) {
      if (!b.alive) continue;
      _d.subVectors(b.pos, plane.pos);
      const dist = _d.length();
      if (dist > LOCK_RANGE || dist < 40) continue;
      const c = _d.dot(plane.fwd) / dist;
      if (c > bestCos) { bestCos = c; best = b; }
    }
    return best;
  }

  /** À chaque image : suit la cible visée ; renvoie { target, progress (0..1), locked } ou null. */
  updateLock(dt, plane, balloons) {
    const t = plane.spec.missiles && !plane.onGround ? this.target(plane, balloons) : null;
    if (t !== this.aim) { this.aim = t; this.aimT = 0; } else if (t) this.aimT += dt;
    if (!t) return null;
    const progress = Math.min(1, this.aimT / LOCK_TIME);
    return { target: t, progress, locked: progress >= 1 };
  }
  get locked() { return this.aim && this.aimT >= LOCK_TIME ? this.aim : null; }

  /** Tire un missile depuis l'aile gauche puis droite ; renvoie true si parti. */
  fire(plane, balloons) {
    const pts = plane.spec.missiles;
    if (!pts || this.cool > 0 || plane.onGround || plane.crashed) return false;
    this.cool = COOLDOWN;
    this.side = -this.side;
    const p = pts[this.side > 0 ? 0 : 1];
    const mesh = newMissileMesh();
    const flame = new THREE.Mesh(this.flameGeo, this.flameMat);
    mesh.add(flame);
    const pos = new THREE.Vector3(...p).applyQuaternion(plane.quat).add(plane.pos);
    mesh.position.copy(pos);
    mesh.quaternion.copy(plane.quat);
    this.scene.add(mesh);
    // largué un peu vers le bas, puis le moteur s'allume
    const vel = plane.vel.clone().addScaledVector(plane.up, -4);
    this.list.push({ mesh, flame, pos, vel, dir: plane.fwd.clone(), t: 0, smoke: 0, target: this.locked });
    this.sound.missile();
    return true;
  }

  /** Renvoie la liste des montgolfières touchées pendant ce pas. */
  update(dt, world, balloons, listener) {
    this.cool -= dt;
    const popped = [];
    for (let i = this.list.length - 1; i >= 0; i--) {
      const m = this.list[i];
      m.t += dt;
      const armed = m.t > 0.25;
      let speed = m.vel.length();
      if (armed) {
        if (m.target && !m.target.alive) m.target = null;
        // sans verrouillage, le missile part tout droit ; s'il dépasse sa cible, il la perd
        if (m.target) {
          _d.subVectors(m.target.pos, m.pos).normalize();
          if (_d.dot(m.dir) < LOSE_COS) m.target = null;
        }
        if (m.target) {
          const ang = Math.acos(Math.min(1, Math.max(-1, m.dir.dot(_d))));
          if (ang > 1e-4) {
            _a.crossVectors(m.dir, _d).normalize();
            m.dir.applyQuaternion(_q.setFromAxisAngle(_a, Math.min(ang, TURN * dt))).normalize();
          }
        }
        speed = Math.min(SPEED_MAX, speed + BOOST * dt);
        m.vel.copy(m.dir).multiplyScalar(speed);
      } else {
        m.vel.y -= 9.81 * dt;
      }
      m.pos.addScaledVector(m.vel, dt);
      m.mesh.position.copy(m.pos);
      m.mesh.quaternion.setFromUnitVectors(FWD, armed ? m.dir : _v.copy(m.vel).normalize());
      m.flame.visible = armed;
      m.flame.scale.z = 0.8 + Math.random() * 0.5;

      // traînée de fumée
      // traînée de fumée : une bouffée tous les ~6 m, réparties le long du trajet de l'image
      if (armed) {
        m.smoke += speed * dt;
        const n = Math.min(5, Math.floor(m.smoke / 6));
        m.smoke -= n * 6;
        for (let k = 0; k < n; k++) {
          _a.copy(m.pos).addScaledVector(m.vel, -dt * (k / Math.max(n, 1)));
          _v.set(Math.random() - 0.5, Math.random() - 0.5 + 0.5, Math.random() - 0.5);
          this.fx.emit(_a, _v, 1.1 + Math.random() * 0.7, 0.7, Math.random() < 0.5 ? 0xe4e7ea : 0xc9cdd1, 1.7, -0.3);
        }
      }

      // impacts
      let boom = null;
      for (const b of balloons) {
        if (b.alive && m.pos.distanceToSquared(b.pos) < (b.r + 3) ** 2) { popped.push(b); boom = 'air'; break; }
      }
      if (!boom) {
        const g = world.groundAt(m.pos.x, m.pos.z, m.pos.y);
        if (m.pos.y < g.h) boom = g.type === 'water' ? 'water' : 'ground';
        else if (world.hit(m.pos.x, m.pos.y, m.pos.z)) boom = 'ground';
        else if (m.t > LIFE) boom = 'air';
      }
      if (boom) {
        this.fx.explode(m.pos, boom === 'water', boom === 'air' && popped.length ? 1.4 : 0.7);
        this.sound.distantBoom(listener ? listener.distanceTo(m.pos) : 0, boom === 'water');
        this.scene.remove(m.mesh);
        this.list.splice(i, 1);
      }
    }
    this.hits += popped.length;
    return popped;
  }
}
