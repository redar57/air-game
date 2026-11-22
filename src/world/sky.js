import * as THREE from 'three';
import { HALF } from './terrain.js';
import { mulberry32, lerp, smoothstep } from '../util.js';
import { nightLights } from './airfields.js';

const dir = (elevDeg, azDeg) => {
  const e = (elevDeg * Math.PI) / 180, a = (azDeg * Math.PI) / 180;
  return new THREE.Vector3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
};
const C = (h) => new THREE.Color(h);

const PRESETS = [
  {
    name: 'Plein jour', top: C(0x2f7fdc), horizon: C(0xc3e4f8), sunDir: dir(50, -38), sunCol: C(0xfff3dc), sunInt: 2.9,
    hemiSky: C(0xd6ecff), hemiGround: C(0x8d9c78), hemiInt: 1.55, water: C(0x2a84c6), cloud: C(0xffffff), disc: C(0xfff6d8), night: 0,
  },
  {
    name: 'Coucher de soleil', top: C(0x2c4a8c), horizon: C(0xffac6e), sunDir: dir(7, 262), sunCol: C(0xff9a58), sunInt: 2.5,
    hemiSky: C(0xa9a4d6), hemiGround: C(0x6f5a52), hemiInt: 1.05, water: C(0x375f93), cloud: C(0xffc9a6), disc: C(0xffb36b), night: 0.35,
  },
  {
    name: 'Nuit claire', top: C(0x040817), horizon: C(0x1b2b4d), sunDir: dir(42, 140), sunCol: C(0x9db6ff), sunInt: 0.75,
    hemiSky: C(0x33457a), hemiGround: C(0x10151f), hemiInt: 0.75, water: C(0x0d2242), cloud: C(0x46527a), disc: C(0xe8eeff), night: 1,
  },
];

/** Les nuages se dissolvent quand la caméra s'en approche : on entre dedans au lieu de traverser des facettes. */
export function cloudDissolve(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
      float dCam = length(vViewPosition);
      if (dCam < 170.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) > smoothstep(25.0, 170.0, dCam)) discard;`);
  };
  return mat;
}

export class Sky {
  constructor(scene) {
    this.index = 0;
    this.cur = this.clonePreset(PRESETS[0]);
    this.night = 0;

    scene.fog = new THREE.Fog(this.cur.horizon.clone(), 1800, 17000);
    this.fog = scene.fog;
    this.fogScale = 1;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x888888, 1.5);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sh = this.sun.shadow;
    sh.mapSize.set(2048, 2048);
    sh.camera.near = 10; sh.camera.far = 900;
    sh.bias = -0.0004; sh.normalBias = 0.25;
    this.setShadowSpan(60);
    scene.add(this.sun, this.sun.target);

    // dôme du ciel
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(15000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() },
          sunDir: { value: new THREE.Vector3() }, disc: { value: new THREE.Color() }, mist: { value: new THREE.Color() }, mistK: { value: 0 },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `
          uniform vec3 top; uniform vec3 horizon; uniform vec3 sunDir; uniform vec3 disc; uniform vec3 mist; uniform float mistK; varying vec3 vDir;
          void main(){
            vec3 d = normalize(vDir);
            float h = max(d.y, 0.0);
            vec3 col = mix(horizon, top, pow(h, 0.5));
            float s = max(dot(d, sunDir), 0.0);
            col += disc * (smoothstep(0.9992, 0.9996, s) * 1.2 + pow(s, 90.0) * 0.35 + pow(s, 7.0) * 0.16);
            gl_FragColor = vec4(mix(col, mist, mistK), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -10;
    scene.add(this.dome);

    // étoiles
    const rnd = mulberry32(42), sp = [];
    for (let i = 0; i < 1100; i++) {
      const y = rnd(), a = rnd() * Math.PI * 2, r = Math.sqrt(1 - y * y);
      sp.push(r * Math.cos(a) * 14000, y * 14000 + 200, r * Math.sin(a) * 14000);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -9;
    scene.add(this.stars);

    // mer
    this.sea = new THREE.Mesh(
      new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2),
      new THREE.MeshPhongMaterial({ color: 0x2a84c6, shininess: 110, specular: 0x4c5a66, transparent: true, opacity: 0.84 }),
    );
    this.sea.renderOrder = -1;
    this.sea.receiveShadow = true;
    scene.add(this.sea);
    // fond marin au-delà du relief, de la même couleur que les grands fonds de l'île
    this.floor = new THREE.Mesh(
      new THREE.PlaneGeometry(90000, 90000).rotateX(-Math.PI / 2),
      new THREE.MeshLambertMaterial({ color: 0x1d6fae }),
    );
    scene.add(this.floor);

    // nuages low-poly
    const puffs = [];
    const wide = HALF / 5500;
    for (let c = 0; c < Math.round(46 * wide * 0.9); c++) {
      const a = rnd() * Math.PI * 2, r = 900 + rnd() * 8600 * wide;
      const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 950 + rnd() * 900, big = 0.7 + rnd() * 0.9;
      const n = 4 + Math.floor(rnd() * 5);
      for (let k = 0; k < n; k++) {
        puffs.push({
          x: cx + (rnd() - 0.5) * 330 * big, y: cy + (rnd() - 0.5) * 45 * big, z: cz + (rnd() - 0.5) * 190 * big,
          s: (55 + rnd() * 80) * big, ry: rnd() * 6,
        });
      }
    }
    // gros cumulus plus bas, à hauteur de vol des petits avions
    for (let c = 0; c < Math.round(16 * wide); c++) {
      const a = rnd() * Math.PI * 2, r = 1200 + rnd() * 6800 * wide, cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = 640 + rnd() * 220;
      for (let k = 0; k < 9; k++) {
        const d = Math.sqrt(rnd()) * 230, b = rnd() * 6.28;
        puffs.push({ x: cx + Math.cos(b) * d, y: cy + (1 - d / 230) * 80 * rnd(), z: cz + Math.sin(b) * d * 0.8, s: 95 + rnd() * 60 - d * 0.15, ry: rnd() * 6 });
      }
    }
    /** Boules de nuages (x, y, z, demi-axes a, b, c, lacet ry, drift : suit la dérive) pour savoir si l'on est dedans. */
    this.puffs = puffs.map((p) => ({ x: p.x, y: p.y, z: p.z, a: p.s * 1.25, b: p.s * 0.55, c: p.s, cs: Math.cos(p.ry), sn: Math.sin(p.ry), drift: 1 }));
    this.inCloud = 0; this.mist = new THREE.Color();
    this.cloudMat = cloudDissolve(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }));
    this.clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), this.cloudMat, puffs.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    puffs.forEach((pf, i) => {
      q.setFromEuler(e.set(0, pf.ry, 0));
      m.compose(new THREE.Vector3(pf.x, pf.y, pf.z), q, new THREE.Vector3(pf.s * 1.25, pf.s * 0.55, pf.s));
      this.clouds.setMatrixAt(i, m);
    });
    this.clouds.frustumCulled = false;
    scene.add(this.clouds);

    this.apply();
  }

  clonePreset(p) {
    const o = {};
    for (const k in p) o[k] = p[k] && p[k].clone ? p[k].clone() : p[k];
    return o;
  }

  setShadowSpan(span) {
    const cam = this.sun.shadow.camera;
    cam.left = -span; cam.right = span; cam.top = span; cam.bottom = -span;
    cam.updateProjectionMatrix();
  }

  /** Passe à l'ambiance suivante ; renvoie son nom. */
  cycle() {
    this.index = (this.index + 1) % PRESETS.length;
    return PRESETS[this.index].name;
  }

  apply() {
    const c = this.cur, u = this.dome.material.uniforms;
    u.top.value.copy(c.top); u.horizon.value.copy(c.horizon); u.sunDir.value.copy(c.sunDir); u.disc.value.copy(c.disc);
    this.fog.color.copy(c.horizon);
    this.hemi.color.copy(c.hemiSky); this.hemi.groundColor.copy(c.hemiGround); this.hemi.intensity = c.hemiInt;
    this.sun.color.copy(c.sunCol); this.sun.intensity = c.sunInt;
    this.sea.material.color.copy(c.water);
    this.cloudMat.color.copy(c.cloud);
    this.cloudMat.emissive.copy(c.cloud).multiplyScalar(0.5);
    this.stars.material.opacity = Math.max(0, c.night - 0.45) / 0.55;
    this.night = c.night;
    for (const m of nightLights) m.opacity = Math.min(1, c.night * 1.6);
  }

  /** focus : point autour duquel on calcule l'ombre (l'avion). fogScale < 1 épaissit la brume (au large). */
  update(dt, camera, focus, fogScale = 1) {
    const t = PRESETS[this.index], c = this.cur, k = 1 - Math.exp(-1.6 * dt);
    for (const key of ['top', 'horizon', 'sunCol', 'hemiSky', 'hemiGround', 'water', 'cloud', 'disc']) c[key].lerp(t[key], k);
    c.sunDir.lerp(t.sunDir, k).normalize();
    c.sunInt = lerp(c.sunInt, t.sunInt, k); c.hemiInt = lerp(c.hemiInt, t.hemiInt, k); c.night = lerp(c.night, t.night, k);
    this.apply();

    this.fogScale = lerp(this.fogScale, fogScale, 1 - Math.exp(-1.2 * dt));
    this.clouds.position.x = Math.sin(performance.now() * 0.00002) * 900;
    // dans un nuage : brouillard épais et clair, soleil voilé
    const inside = this.cloudAt(camera.position);
    this.inCloud = lerp(this.inCloud, inside, 1 - Math.exp(-5 * dt));
    const m = this.inCloud < 0.005 ? 0 : this.inCloud, q = m * (2 - m);
    const near = 1800 * this.fogScale, far = 17000 * (0.12 + 0.88 * this.fogScale);
    this.fog.near = lerp(near, 2, q);
    this.fog.far = far * Math.pow((55 + 2.6 * camera.position.distanceTo(focus)) / far, q);
    this.mist.copy(c.cloud).multiplyScalar(0.8).lerp(c.horizon, 0.35);
    this.fog.color.copy(c.horizon).lerp(this.mist, m);
    const u = this.dome.material.uniforms; u.mist.value.copy(this.fog.color); u.mistK.value = Math.min(1, m * 1.15);
    this.sun.intensity = c.sunInt * (1 - 0.65 * m); this.stars.material.opacity *= 1 - m;

    this.dome.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.sea.position.set(camera.position.x, 0, camera.position.z);
    this.floor.position.set(camera.position.x, -60.4, camera.position.z);
    this.sun.position.copy(focus).addScaledVector(c.sunDir, 420);
    this.sun.target.position.copy(focus);
  }

  /** Densité de nuage (0 à 1) au point p. */
  cloudAt(p) {
    let best = 0; const drift = this.clouds.position.x;
    for (const o of this.puffs) {
      const dx = p.x - o.x - (o.drift ? drift : 0), dy = p.y - o.y, dz = p.z - o.z;
      if (dx > 260 || dx < -260 || dz > 260 || dz < -260 || dy > 160 || dy < -160) continue;
      const lx = (dx * o.cs - dz * o.sn) / o.a, lz = (dx * o.sn + dz * o.cs) / o.c, ly = dy / o.b, d = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (d < 1.05) best = Math.max(best, smoothstep(1.05, 0.55, d));
    }
    return best;
  }
}
