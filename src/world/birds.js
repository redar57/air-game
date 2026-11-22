import * as THREE from 'three';
import { mulberry32 } from '../util.js';
import { HALF, BIG } from './terrain.js';

// Oiseaux : des volées de mouettes qui tournent le long des côtes, et des rapaces qui spiralent
// dans les thermiques. Corps et ailes en InstancedMesh ; les ailes battent par à-coups puis planent.
// Les oiseaux s'écartent quand un avion passe trop près.

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _s = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _c = new THREE.Color();
const MIRROR = new THREE.Matrix4().makeScale(-1, 1, 1);
const KINDS = {
  //          envergure, couleur du corps, des ailes, battements/s, part du temps à battre des ailes
  gull: { size: 2.3, body: 0xf4f4f0, wing: 0xd9dde1, tip: 0x3a3d42, rate: 4.2, flapShare: 0.45 },
  raptor: { size: 3.2, body: 0x5e4129, wing: 0x6f4d30, tip: 0x2e2218, rate: 2.6, flapShare: 0.08 },
};

function wingGeometry() {
  // aile droite : de l'emplanture (x = 0) au bout (x = 1), légèrement en flèche ; repère oiseau : -Z vers l'avant
  const g = new THREE.BufferGeometry();
  const v = [0, 0, -0.2, 1, 0, 0.12, 0, 0, 0.28, 0.55, 0, -0.12, 1, 0, 0.12, 0, 0, -0.2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.computeVertexNormals();
  return g;
}

export class Birds {
  constructor(scene, heightAt, thermals, runways = [], extra = []) {
    this.heightAt = heightAt;
    const rnd = mulberry32(4242);
    this.flocks = [];
    this.birds = [];
    // mouettes : d'abord une volée près de chaque piste (on les voit dès le décollage), puis partout le long des côtes
    const spots = runways.map((r) => [r.x + 350, r.z - 300]);
    const want = BIG ? 40 : 20;
    for (let n = 0; n < 8000 && this.flocks.length < want; n++) {
      const home = spots.length > 0; // volée qui reste autour de sa piste
      const [x, z] = home ? spots.shift() : [(rnd() - 0.5) * HALF * 1.7, (rnd() - 0.5) * HALF * 1.7];
      const h = heightAt(x, z);
      if (!home && (h < -40 || h > 120 || this.flocks.some((f) => Math.hypot(f.x - x, f.z - z) < 800))) continue;
      const f = { kind: 'gull', fixed: home, x, z, tx: x, tz: z, alt: Math.max(h, 0) + 60 + rnd() * 140, r: 70 + rnd() * 90, w: (rnd() < 0.5 ? -1 : 1) * (0.1 + rnd() * 0.06), th: rnd() * 6.3 };
      this.flocks.push(f);
      const count = 12 + Math.floor(rnd() * 12);
      for (let k = 0; k < count; k++) this.addBird(f, rnd);
    }
    // mouettes des ports et des chalutiers : basses et serrées (follow : suivent un bateau)
    for (const o of extra) {
      const f = { kind: 'gull', fixed: true, low: true, follow: o.follow, x: o.x, z: o.z, alt: o.alt, r: o.r || 45, w: (rnd() < 0.5 ? -1 : 1) * 0.22, th: rnd() * 6.3 };
      this.flocks.push(f);
      for (let k = 0; k < (o.count || 16); k++) this.addBird(f, rnd);
    }
    // rapaces : un ou deux par thermique, haut et lents
    for (const t of thermals) {
      const f = { kind: 'raptor', x: t.x, z: t.z, fixed: true, alt: t.base + 250 + rnd() * 350, r: 55 + rnd() * 40, w: (rnd() < 0.5 ? -1 : 1) * 0.24, th: rnd() * 6.3 };
      this.flocks.push(f);
      for (let k = 0; k < 2 + Math.floor(rnd() * 3); k++) this.addBird(f, rnd);
    }

    const n = this.birds.length;
    const mat = new THREE.MeshLambertMaterial({ flatShading: true, side: THREE.DoubleSide });
    const body = new THREE.ConeGeometry(0.09, 0.75, 5).rotateX(-Math.PI / 2);
    this.body = new THREE.InstancedMesh(body, mat, n);
    this.wings = [new THREE.InstancedMesh(wingGeometry(), mat, n), new THREE.InstancedMesh(wingGeometry(), mat, n)];
    this.birds.forEach((b, i) => {
      const k = KINDS[b.f.kind];
      this.body.setColorAt(i, _c.set(k.body));
      for (const w of this.wings) w.setColorAt(i, _c.set(rnd() < 0.5 ? k.wing : k.tip).lerp(_c.clone().set(k.wing), 0.6));
    });
    for (const m of [this.body, ...this.wings]) { m.frustumCulled = false; scene.add(m); }
  }

  addBird(f, rnd) {
    const b = {
      f, a: rnd() * 6.283, dr: (rnd() - 0.5) * 0.5 * f.r, dy: (rnd() - 0.5) * 14,
      ph: rnd() * 100, rate: 0.85 + rnd() * 0.3, pos: new THREE.Vector3(), vel: new THREE.Vector3(), flee: 0,
      scale: KINDS[f.kind].size * (0.85 + rnd() * 0.3),
    };
    this.target(b, 0, _t);
    b.pos.copy(_t);
    this.birds.push(b);
  }

  /** Point que l'oiseau cherche à rejoindre : sur le cercle de sa volée, un peu décalé. */
  target(b, t, out) {
    const f = b.f, a = f.th + b.a, r = f.r + b.dr;
    out.set(f.x + Math.cos(a) * r, 0, f.z + Math.sin(a) * r);
    if (f.low) { out.y = Math.max(f.alt + b.dy * 0.5 + Math.sin(t * 0.3 + b.a) * 4, Math.max(0, this.heightAt(out.x, out.z)) + 4); return out; }
    out.y = Math.max(f.alt + b.dy + Math.sin(t * 0.3 + b.a) * 6, this.heightAt(out.x, out.z) + 30);
    return out;
  }

  update(dt, t, plane) {
    if (dt <= 0) return;
    // volées de mouettes : elles longent la côte d'un point à l'autre
    for (const f of this.flocks) {
      f.th += f.w * dt;
      if (f.follow) { f.x = f.follow.x; f.z = f.follow.z; }
      if (f.fixed) continue;
      const dx = f.tx - f.x, dz = f.tz - f.z, d = Math.hypot(dx, dz);
      if (d < 20) {
        const a = Math.random() * 6.283, r = 400 + Math.random() * 900;
        const nx = f.x + Math.cos(a) * r, nz = f.z + Math.sin(a) * r, h = this.heightAt(nx, nz);
        if (h > -40 && h < 120 && Math.hypot(nx, nz) < HALF * 0.9) { f.tx = nx; f.tz = nz; }
      } else { f.x += (dx / d) * 5 * dt; f.z += (dz / d) * 5 * dt; }
    }
    const pp = plane.pos, pv = plane.vel;
    this.birds.forEach((b, i) => {
      const k = KINDS[b.f.kind];
      this.target(b, t, _t);
      // vitesse voulue vers la cible, plus une fuite si un appareil fonce dessus
      _d.subVectors(_t, b.pos).multiplyScalar(0.6);
      const dp = b.pos.distanceTo(pp), danger = 60 + plane.speed * 1.2;
      if (dp < danger) {
        _s.subVectors(b.pos, pp).normalize();
        _s.y += 0.3 * Math.sign(b.pos.y - pp.y || 1);
        _d.addScaledVector(_s, 34 * (1 - dp / danger) + 10);
        b.flee = 2.5;
      }
      b.flee = Math.max(0, b.flee - dt);
      const spd = _d.length(), maxV = b.flee > 0 ? 26 : 17;
      if (spd > maxV) _d.multiplyScalar(maxV / spd);
      b.vel.lerp(_d, 1 - Math.exp(-2.2 * dt));
      if (b.vel.lengthSq() < 4) b.vel.addScaledVector(_s.set(-Math.sin(b.f.th + b.a), 0, Math.cos(b.f.th + b.a)), 0.5);
      b.pos.addScaledVector(b.vel, dt);

      // orientation : cap et pente d'après la vitesse, inclinaison dans le virage de la volée
      const v = b.vel, hs = Math.hypot(v.x, v.z) || 1;
      _e.set(Math.atan2(v.y, hs) * 0.8, Math.atan2(-v.x, -v.z), -Math.sign(b.f.w) * (b.flee > 0 ? 0.2 : 0.35));
      _q.setFromEuler(_e);
      _m.compose(b.pos, _q, _s.setScalar(b.scale * 2));
      this.body.setMatrixAt(i, _m);

      // battements par à-coups (en continu quand l'oiseau fuit ou monte), sinon vol plané ailes en léger dièdre
      const cyc = (t * 0.17 * b.rate + b.ph) % 1;
      const flapping = b.flee > 0 || v.y > 2 || cyc < k.flapShare;
      const ang = flapping ? Math.sin((t + b.ph) * k.rate * 6.283 * b.rate) * 0.65 + 0.1 : 0.12 + Math.sin(t * 0.7 + b.ph) * 0.04;
      for (let s = 0; s < 2; s++) {
        _w.makeRotationZ(ang);                  // bout d'aile vers le haut
        if (s) _w.premultiply(MIRROR);          // aile gauche : symétrique de la droite
        this.wings[s].setMatrixAt(i, _w.premultiply(_m));
      }
    });
    this.body.instanceMatrix.needsUpdate = true;
    for (const w of this.wings) w.instanceMatrix.needsUpdate = true;
  }
}
