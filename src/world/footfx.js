// Footstep feedback: churned silt clouds on bootfalls, and normal-mapped boot prints
// that read as depressions in the seabed rather than decals. Triggered from game.js off
// the diver rig's real heel strikes. OWNED BY: orchestrator.
import * as THREE from 'three';
import { scene } from '../core.js';
import { rng } from '../lib/math.js';
import { canvas2d, noiseCanvas, normalFromHeight } from '../lib/textures.js';
import { terrainH, terrainNormal } from './terrain.js';

// ---------------------------------------------------------------- dust sprite atlas
// 2x2 atlas of wispy silt clumps: soft blobs with their edges eaten by noise, so a
// particle reads as a churned clot of sediment instead of a smooth smoke dot.
const dustTex = (() => {
  const S = 256, C = S / 2;
  const { canvas, ctx } = canvas2d(S);
  const noise = noiseCanvas(128, 4, 1.1).getContext('2d').getImageData(0, 0, 128, 128).data;
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = ((cell / 2) | 0) * C;
    const img = ctx.createImageData(C, C);
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const dx = (x - C / 2) / (C / 2), dy = (y - C / 2) / (C / 2);
      const r = Math.hypot(dx, dy);
      // several offset lobes give the clump an irregular silhouette
      let lobes = 0;
      for (let l = 0; l < 3; l++) {
        const la = cell * 1.7 + l * 2.1, lr = 0.34;
        const lx = dx - Math.cos(la) * lr * 0.6, ly = dy - Math.sin(la) * lr * 0.6;
        lobes = Math.max(lobes, 1 - Math.hypot(lx, ly) / 0.72);
      }
      const n = noise[(((y * 517 + cell * 31) % 128) * 128 + ((x * 731 + cell * 57) % 128)) * 4] / 255;
      let a = Math.max(0, lobes) * (0.35 + 0.65 * n) * (1 - r * r * 0.85);
      a = Math.max(0, a);
      const i = ((oy + y) * S + ox + x) * 4;
      img.data[(y * C + x) * 4] = 235;
      img.data[(y * C + x) * 4 + 1] = 222;
      img.data[(y * C + x) * 4 + 2] = 196;
      img.data[(y * C + x) * 4 + 3] = Math.min(255, a * 255);
      // write directly into place below
      void i;
    }
    ctx.putImageData(img, ox, oy);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// ---------------------------------------------------------------- boot print maps
// Height field of a boot sole (rounded sole + heel block + tread bars) drives both the
// alpha and a normal map, so the lantern raking across a print shades it like a dent.
const printMaps = (() => {
  const S = 128;
  const { canvas: hc, ctx: h } = canvas2d(S);
  h.fillStyle = '#000';
  h.fillRect(0, 0, S, S);
  const sole = (x, y, w, hh, r) => {
    h.beginPath();
    h.roundRect(x, y, w, hh, r);
    h.fill();
  };
  // depth ramps in from the edge: draw the shape repeatedly, shrinking and brightening
  for (let i = 0; i < 6; i++) {
    const k = i / 5, inset = 6 * k;
    h.fillStyle = `rgb(${40 + 150 * k},${40 + 150 * k},${40 + 150 * k})`;
    sole(34 + inset, 12 + inset, 60 - inset * 2, 66 - inset * 2, 26 - inset * 2);   // sole
    sole(38 + inset, 88 + inset, 52 - inset * 2, 28 - inset * 2, 12 - inset);       // heel
  }
  // tread bars carved back out of the sole
  h.fillStyle = 'rgb(60,60,60)';
  for (let b = 0; b < 4; b++) sole(42, 22 + b * 14, 44, 6, 3);
  const { canvas: ac, ctx: a } = canvas2d(S);
  const hd = h.getImageData(0, 0, S, S).data;
  const ai = a.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = hd[i * 4];
    ai.data[i * 4] = ai.data[i * 4 + 1] = ai.data[i * 4 + 2] = 255;
    ai.data[i * 4 + 3] = v > 8 ? Math.min(255, 70 + v * 0.9) : 0;
  }
  a.putImageData(ai, 0, 0);
  const alpha = new THREE.CanvasTexture(ac);
  const nrm = new THREE.CanvasTexture(normalFromHeight(hc, 3.2));
  return { alpha, nrm };
})();

// ---------------------------------------------------------------- particle pool
const P_MAX = 420;
const pPos = new Float32Array(P_MAX * 3);
const pLife = new Float32Array(P_MAX);
const pMaxLife = new Float32Array(P_MAX);
const pSize = new Float32Array(P_MAX);
const pVel = new Float32Array(P_MAX * 3);
let pHead = 0;
let pAlive = 0;   // live-particle count: zero means zero buffer uploads this frame
let points = null;
const lanternU = { value: new THREE.Vector3(0, 1e9, 0) };

// ---------------------------------------------------------------- prints
const T_MAX = 144;
const TRACK_LIFE = 50;
let tracks = null;
const tAge = new Float32Array(T_MAX).fill(Infinity);
const tBase = [];
let tHead = 0;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
const _n = new THREE.Vector3(), _t1 = new THREE.Vector3(), _t2 = new THREE.Vector3();
const _p = new THREE.Vector3();

export function buildFootFX() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const aLife = new Float32Array(P_MAX * 2);  // (life01, size)
  const aSpin = new Float32Array(P_MAX * 2);  // (angle0, spin rate)
  const aCell = new Float32Array(P_MAX);      // atlas cell
  geo.setAttribute('aLife', new THREE.BufferAttribute(aLife, 2));
  geo.setAttribute('aSpin', new THREE.BufferAttribute(aSpin, 2));
  geo.setAttribute('aCell', new THREE.BufferAttribute(aCell, 1));
  geo.userData = { aLife, aSpin, aCell };
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: dustTex }, uTime: { value: 0 }, uLant: lanternU },
    transparent: true, depthWrite: false,
    vertexShader: `
      attribute vec2 aLife; attribute vec2 aSpin; attribute float aCell;
      uniform float uTime; uniform vec3 uLant;
      varying float vA; varying float vRot; varying float vCell; varying float vLit;
      void main(){
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aLife.y * (330.0 / -mv.z);
        vA = aLife.x;
        vRot = aSpin.x + uTime * aSpin.y;
        vCell = aCell;
        // silt catches the lantern: warm and bright near it, dim ambient away from it
        float d = distance(position, uLant);
        vLit = 0.30 + 1.30 * clamp(1.0 - d / 14.0, 0.0, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uTex;
      varying float vA; varying float vRot; varying float vCell; varying float vLit;
      void main(){
        vec2 c = gl_PointCoord - 0.5;
        float cs = cos(vRot), sn = sin(vRot);
        vec2 rc = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
        vec2 cell = vec2(mod(vCell, 2.0), floor(vCell / 2.0));
        vec4 tex = texture2D(uTex, (clamp(rc, 0.0, 1.0) + cell) * 0.5);
        float a = tex.a * vA * 0.55;
        if (a < 0.004) discard;
        vec3 col = tex.rgb * vec3(0.62, 0.57, 0.47) * vLit;
        gl_FragColor = vec4(col, a);
      }`
  });
  points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  scene.add(points);

  // prints: alpha-cut boot shape with a normal map, so light shades the depression
  const plane = new THREE.PlaneGeometry(0.36, 0.6);
  const tMat = new THREE.MeshStandardMaterial({
    color: 0x2a2f30, roughness: 1, metalness: 0,
    alphaMap: printMaps.alpha, transparent: true, opacity: 0.85,
    normalMap: printMaps.nrm, normalScale: new THREE.Vector2(1.4, 1.4),
    // DoubleSide stays: the left boot mirrors via negative scale, which flips winding,
    // so FrontSide would cull half the prints. forceSinglePass kills r163+'s transparent
    // double-pass split (the ground decal is never seen from below anyway).
    depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true,
    polygonOffset: true, polygonOffsetFactor: -2
  });
  tracks = new THREE.InstancedMesh(plane, tMat, T_MAX);
  tracks.frustumCulled = false;
  tracks.receiveShadow = true;
  _m.makeScale(0, 0, 0);
  for (let i = 0; i < T_MAX; i++) { tracks.setMatrixAt(i, _m); tBase.push(new THREE.Matrix4()); }
  tracks.instanceMatrix.needsUpdate = true;
  scene.add(tracks);
}

export function setLanternPos(v) { lanternU.value.copy(v); }

function emitPuff(x, y, z, count, strength) {
  for (let i = 0; i < count; i++) {
    const k = pHead; pHead = (pHead + 1) % P_MAX;
    if (pLife[k] <= 0) pAlive++;   // reusing a live slot keeps the count honest
    const a = rng(0, Math.PI * 2), r = rng(0.04, 0.28);
    pPos[k * 3] = x + Math.cos(a) * r;
    pPos[k * 3 + 1] = y + rng(0.02, 0.12);
    pPos[k * 3 + 2] = z + Math.sin(a) * r;
    // kicked silt mostly rolls low and outward; only a little lifts
    const lift = Math.random() < 0.3 ? rng(0.5, 1.1) : rng(0.12, 0.4);
    pVel[k * 3] = Math.cos(a) * rng(0.35, 1.0) * strength;
    pVel[k * 3 + 1] = lift * strength;
    pVel[k * 3 + 2] = Math.sin(a) * rng(0.35, 1.0) * strength;
    pMaxLife[k] = pLife[k] = rng(1.2, 2.4);
    pSize[k] = rng(0.5, 1.3) * strength;
    const g = points.geometry.userData;
    g.aSpin[k * 2] = rng(0, Math.PI * 2);
    g.aSpin[k * 2 + 1] = rng(-1.6, 1.6);
    g.aCell[k] = (Math.random() * 4) | 0;
  }
  points.geometry.attributes.aSpin.needsUpdate = true;
  points.geometry.attributes.aCell.needsUpdate = true;
}

// side: -1 left boot, +1 right. strength ~1 step, ~2 landing.
export function spawnFootfall(playerPos, yaw, side, zi, strength = 1) {
  const rx = Math.sin(yaw - Math.PI / 2), rz = Math.cos(yaw - Math.PI / 2);
  const fx = playerPos.x + rx * side * 0.26 + Math.sin(yaw) * 0.1;
  const fz = playerPos.z + rz * side * 0.26 + Math.cos(yaw) * 0.1;
  const fy = terrainH(fx, fz, zi);
  emitPuff(fx, fy, fz, Math.min(20, 9 + (strength * 6) | 0), strength);

  const k = tHead; tHead = (tHead + 1) % T_MAX;
  _n.copy(terrainNormal(fx, fz, zi));
  _t1.set(Math.sin(yaw), 0, Math.cos(yaw));
  _t1.addScaledVector(_n, -_n.dot(_t1)).normalize();
  _t2.crossVectors(_t1, _n);                 // right-handed: x = y cross z
  _m.makeBasis(_t2, _t1, _n);
  _q.setFromRotationMatrix(_m);
  // mirror the left boot's tread
  _s.set(side < 0 ? -1 : 1, 1, 1);
  _m.compose(_p.set(fx, fy + 0.02, fz), _q, _s);
  tBase[k].copy(_m);
  tAge[k] = 0;
}

export function updateFootFX(dt, t) {
  if (!points) return;
  points.material.uniforms.uTime.value = t || 0;
  // Idle skip: with zero live particles nothing in the buffers changes, so flagging
  // position/aLife needsUpdate would upload dead arrays to the GPU every frame.
  if (pAlive > 0) {
    const aLife = points.geometry.userData.aLife;
    const drag = Math.pow(0.3, dt);
    for (let k = 0; k < P_MAX; k++) {
      if (pLife[k] <= 0) continue;
      pLife[k] -= dt;
      if (pLife[k] <= 0) { aLife[k * 2] = 0; pAlive--; continue; }
      pVel[k * 3] *= drag;
      pVel[k * 3 + 1] = pVel[k * 3 + 1] * drag - 0.20 * dt;
      pVel[k * 3 + 2] *= drag;
      pPos[k * 3] += pVel[k * 3] * dt;
      pPos[k * 3 + 1] += pVel[k * 3 + 1] * dt;
      pPos[k * 3 + 2] += pVel[k * 3 + 2] * dt;
      const t01 = pLife[k] / pMaxLife[k];
      aLife[k * 2] = t01 * t01;
      aLife[k * 2 + 1] = pSize[k] * (1.7 - t01);
    }
    points.geometry.attributes.position.needsUpdate = true;
    points.geometry.attributes.aLife.needsUpdate = true;
  }

  let dirty = false;
  for (let i = 0; i < T_MAX; i++) {
    if (tAge[i] === Infinity) continue;
    tAge[i] += dt;
    const t01 = Math.min(1, tAge[i] / TRACK_LIFE);
    const s = 1 - t01 * t01;
    if (s <= 0.01) { tAge[i] = Infinity; _m.makeScale(0, 0, 0); }
    else { _m.copy(tBase[i]).scale(_s.set(s, s, 1)); }
    tracks.setMatrixAt(i, _m);
    dirty = true;
  }
  if (dirty) tracks.instanceMatrix.needsUpdate = true;
}
