// THE SAND PLUME (roadmap/brooder-ground-plume.md). Owner, 2026-10-03: "when it smacks
// down we should plume the sand, this could be used to sals advantage to rush to get under
// the crab."
//
// Every hammer blow throws a heavy, slow cloud of seabed off the impact: it bursts low and
// outward, rolls along the floor, climbs a few units, hangs, and settles back over ~6 s.
// Heavy footfalls throw a small one. The cloud is REAL to her: brooder.js asks plumeTau()
// for the optical depth on the line from her eyes to Sal, and above a threshold she loses
// him (keeps striking where she last saw him, eyes searching).
//
// Render: ONE instanced draw of camera-facing quads (a ring of 448), all motion analytic in
// the vertex shader off a clock uniform; the CPU writes a particle's attributes once, when it
// is born. Lit like the silt it is: the scene's own ambient/hemisphere/key (read off the
// lights, divided by PI exactly as a Lambert surface takes them), the lantern's slot from
// the fog chunk (abyssaLampA), and the water's own extinction + in-scatter (fog: true, the
// globally patched chunk). Never additive, never self-lit. Quads fade out within ~3 u of
// the lens and a full-screen VEIL takes over (its alpha from the same density model at the
// camera), so a camera inside the cloud sees murk, not a bare lens.
//
// The density model the gameplay reads is one ellipsoid per plume, sized and thinned on
// the same clocks the particles spread on (checked against frames; see the card).
//
// Budget: 1 draw (+1 veil draw while the camera is inside a cloud). CPU per frame: a clock,
// a light read, the veil density (<= 24 plume records: Task 8's rise ring). Zero per-frame allocation.
import * as THREE from 'three';
import { scene, camera } from '../../core.js';
import { canvas2d, noiseCanvas, seededRand } from '../../lib/textures.js';
import { terrainH } from '../../world/terrain.js';

const N0 = 448, NW = 192, N = N0 + NW;   // particle ring: [0, N0) the plumes, [N0, N) her wake (render only)
const PL = 24;                       // plume records (density model): 0..3 the hammer's, 4..11 footfalls', 12..23 the rise's
// the three kinds: a hammer blow, a footfall, and (velkath-buried-rock Task 8) her rise out of the sand
export const PLUME = {
  big: { n: 38, life: [4.6, 6.0], vr: [3.0, 14.0], vy: [1.0, 6.5], s0: [3.5, 5.5], s1: [9, 13], a: 0.72, kd: 1.05,
    rh0: 2.0, rhA: 10.5, rhK: 1.0, hv0: 1.6, hvA: 4.4, hvK: 0.8, D: 3.6 },
  small: { n: 7, life: [2.4, 3.4], vr: [1.2, 3.8], vy: [0.4, 1.4], s0: [1.2, 1.8], s1: [3.0, 4.4], a: 0.30, kd: 1.3,
    rh0: 0.8, rhA: 2.8, rhK: 1.2, hv0: 0.6, hvA: 1.3, hvK: 1.0, D: 0.9 },
  // THE RISE (velkath-buried-rock §2): the sand pouring off her as she comes up out of it. A ring at the crack, more as the sheets
  // fall; it spreads to 15-20 u and climbs, and it is REAL to her (the density model): the SIGHT rule blinds her in it, no new rule.
  // Long-lived and slow (kd), so the line from her eyes stays thick past her first look (standE 0.5, ~3 s in).
  // (sandrise, 2026-10-31; Michael: "when she rises the sand rolls off in a slight dust cloud", approved "yes do all three for the sand")
  // THE DRAWN CLOUD IS LOW AND SANDY NOW; THE DENSITY MODEL IS UNCHANGED. The kind's two halves are independent: n .. kd and the
  // tint / flat / lamp below are RENDER (the vertex shader); rh*, hv*, D are the DENSITY MODEL sight() reads, so the blind spell
  // (lost ~3.2-4.0 s, found ~6.6-7.9 s), the footprint and the climb are the shipped ones by construction. What is drawn: a low ring
  // at the crack (rn particles a record, not n) and the POUR (spawnPour, render only): sand falling off her rim to the bed and
  // spreading along it, heavy (vy small, the floor reached as it travels), sprites flattened (flat), the zone's silt colour (tint x
  // uAlb), the lantern's share cut (lamp: the pale puff round him was his lantern on the silt). Reference (out/report.md): sediment
  // released at the bed runs as a low, laterally spreading turbid layer; only a few percent of it rises 2 m over the bed.
  rise: { n: 16, life: [5.5, 6.5], vr: [1.0, 3.5], vy: [2.0, 7.0], s0: [4.0, 6.0], s1: [8, 12], a: 0.62, kd: 0.55,
    rh0: 2.0, rhA: 3.0, rhK: 0.45, hv0: 2.0, hvA: 12.0, hvK: 0.45, D: 4.2,
    rn: 8, rlife: [6.0, 8.5], rvr: [1.5, 4.5], rvy: [0.15, 0.6], rs0: [2.2, 3.4], rs1: [5.0, 8.0], ra: 0.42, rkd: 0.45 },
  // the pour off her rim (spawnPour): a puff of n particles from a point of her shell's outline, outward along her rim's bearing (+- arc rad)
  pour: { n: 5, life: [5.0, 8.0], vr: [0.8, 3.0], vy: [0.0, 0.35], s0: [1.2, 2.0], s1: [3.8, 6.5], a: 0.42, kd: 0.5, arc: 0.9 }
};
// (sandrise) the drawn sand's colour and weight: tint x uAlb (0.60, 0.55, 0.45): the shipped pale silt x the zone-0 seabed's own silt hue
// relative to it; flat squashes the sprite's height (1 = round); lamp scales the lantern's light on it; veilMax caps the share of the lens's
// veil the rise kind can bring (a camera inside the low cloud sees murk, never a whiteout); veilTint pulls the veil toward the tint
export const RISE_LOOK = { tint: [0.78, 0.88, 0.9], flat: 0.55, lamp: 0.25, veilMax: 0.35, on: 1 };
// HER WAKE (brooder-clutch: "the chase must read"): a footfall at a run throws a low, slow
// cloud that HANGS where she went, so in the zone-0 murk her path is a pale haze on the dark
// ground. Render only: it is not in the density model (her sight never reads it, the plume
// rush is unchanged) and it has its own ring, so it never evicts a hammer cloud.
export const WAKE = { n: 2, life: [7.0, 10.0], vr: [0.5, 2.0], vy: [0.8, 2.4], s0: [2.2, 3.2], s1: [5.5, 8.5], a: 0.30, kd: 0.8 };
export const PLUME_TUNE = { ambK: 1.6, lampK: 0.6, veilK: 1.0, sink: 0.30, off: false };   // off: render A/B (the gameplay model still runs)

let mesh = null, veil = null, uni = null, head = 0, headW = 0, clock = 0, alive = 0;
const rec = new Float32Array(PL * 8);   // x y z t0 life kindIdx(0 big / 1 small / 2 rise) k used
let recHead = 0, recHeadS = 0;    // two rings: a footfall never evicts a hammer cloud
// (Task 8) the rise's own ring of 12 (a rise spawns at most 6 + 2 x 3 = 12 clouds, brooder.js: none evicts another while it lives), and
// two counts the burial probe reads: a live rise record overwritten (riseEvicted) and a still-living particle's quad overwritten in the
// ring of 448 (quadEvicted; the ring wraps by construction, so a count of quads could not fail, a live one overwritten can)
let recHeadR = 0, riseEvicted = 0, quadEvicted = 0;
const KINDS = [PLUME.big, PLUME.small, PLUME.rise];
let lights = null;
const _c = new THREE.Color();

function puffTexture() {
  // 2x2 atlas of billowing clumps: lobed soft mass, edges eaten by noise; RGB = fine detail
  const S = 256, C = S / 2, rnd = seededRand(0x51A7);
  const { canvas, ctx } = canvas2d(S);
  const nz = noiseCanvas(128, 5, 1.0, rnd).getContext('2d').getImageData(0, 0, 128, 128).data;
  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell % 2) * C, oy = ((cell / 2) | 0) * C, img = ctx.createImageData(C, C);
    const lobes = [];
    for (let l = 0; l < 5; l++) { const a = rnd() * 6.283, r = 0.18 + 0.22 * rnd(); lobes.push(Math.cos(a) * r, Math.sin(a) * r, 0.42 + 0.2 * rnd()); }
    for (let y = 0; y < C; y++) for (let x = 0; x < C; x++) {
      const dx = (x - C / 2) / (C / 2), dy = (y - C / 2) / (C / 2);
      let m = Math.max(0, 1 - Math.hypot(dx, dy) / 0.62);
      for (let l = 0; l < 15; l += 3) m = Math.max(m, 1 - Math.hypot(dx - lobes[l], dy - lobes[l + 1]) / lobes[l + 2]);
      const n = nz[(((y * 2 + cell * 37) % 128) * 128 + ((x * 2 + cell * 53) % 128)) * 4] / 255;
      const r = Math.hypot(dx, dy);
      let a = Math.max(0, m) * (0.45 + 0.75 * n) * Math.max(0, 1 - r * r);
      a = Math.min(1, a * a * 1.6);
      const o = (y * C + x) * 4, v = (150 + 105 * n) | 0;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = (a * 255) | 0;
    }
    ctx.putImageData(img, ox, oy);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.generateMipmaps = true;
  return t;
}

function build() {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  const mk = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
  g.setAttribute('aA', mk()); g.setAttribute('aB', mk()); g.setAttribute('aC', mk()); g.setAttribute('aD', mk());
  // (sandrise) aE: the particle's tint (rgb, x uAlb) and its sprite's height share (w); (1, 1, 1, 1) the shipped silt
  { const e = mk(), ea = e.array; for (let i = 0; i < ea.length; i++) ea[i] = 1; g.setAttribute('aE', e); }
  // dead until born: life 0
  g.instanceCount = N;
  uni = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), {
    uTime: { value: 0 }, uTex: { value: puffTexture() }, uAlb: { value: new THREE.Color(0.60, 0.55, 0.45) },
    uAmb: { value: new THREE.Vector3(0.05, 0.06, 0.06) }, uLampK: { value: 1 }, uSink: { value: PLUME_TUNE.sink }, uLampR: { value: 1 }
  });
  // THE WATER, PER VERTEX. The patched fog chunk (water.js: stratified Beer-Lambert, both
  // lamp in-scatter slots, the bolt) is the costliest thing a fragment of this cloud would
  // run, and the cloud is many layers deep on screen. It is affine in the colour it is
  // given (out = c * T + S), and a quad's corners span a few units of water, so the
  // VERTEX runs it twice (on black and on white) and hands T and S down. Measured: the
  // per-fragment version cost ~1.5-2 ms more on a near cloud. The chunk's text is taken as
  // shipped; only its output variable is renamed (gl_FragColor is a fragment built-in) and
  // its bolt normal is the sprite's facing (ABYSSA_LIT: no screen derivatives in a VS).
  const FOGV = THREE.ShaderChunk.fog_fragment.replace(/gl_FragColor/g, 'fogTmp');
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, depthTest: true, fog: true,
    vertexShader: /* glsl */`
      uniform float uTime, uSink, uLampR;
      attribute vec4 aA, aB, aC, aD, aE;
      varying vec2 vUv; varying float vA, vH, vCell, vLampR; varying vec3 vW, vFogT, vFogS, vTint;
      #define ABYSSA_LIT
      #include <fog_pars_fragment>
      void main(){
        float age = uTime - aA.w, life = aC.z;
        vA = 0.0; vUv = vec2(0.0); vH = 0.0; vCell = 0.0; vW = vec3(0.0); vTint = aE.rgb; vLampR = aE.w < 0.999 ? uLampR : 1.0;
        vec3 w = vec3(0.0, -1e5, 0.0);
        if (age > 0.0 && age < life) {
          float kd = aD.w, rp = 1.0 - exp(-kd * age);
          float r = aB.z / kd * rp;
          float sz = mix(aC.x, aC.y, 1.0 - exp(-0.55 * age));
          // heavy silt: a burst that climbs while it slows, then sinks back
          float rise = aB.w / 0.9 * (1.0 - exp(-0.9 * age)) - uSink * max(0.0, age - 1.4);
          // the roll: what flies out furthest curls up as it stalls
          rise += 0.18 * aB.z * rp * rp * (1.0 - rp);
          vec3 c = vec3(aA.x + aB.x * r, 0.0, aA.z + aB.y * r);
          float fl = mix(aA.y, aD.z, rp);
          c.y = fl + max(sz * 0.30, rise + sz * 0.22);
          c.x += sin(uTime * 0.40 + aD.x * 31.0) * 0.5 * rp;
          c.z += cos(uTime * 0.33 + aD.x * 17.0) * 0.5 * rp;
          float ang = aD.x * 6.283 + aD.y * age;
          vec2 q = position.xy, qr = vec2(q.x * cos(ang) - q.y * sin(ang), q.x * sin(ang) + q.y * cos(ang)) * sz;
          qr.y *= aE.w;
          vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          w = c + right * qr.x + up * qr.y;
          vUv = q + 0.5;
          vCell = floor(fract(aD.x * 7.13) * 4.0);
          vH = (w.y - c.y) / sz;
          float env = smoothstep(0.0, 0.28, age) * (1.0 - smoothstep(life * 0.45, life, age));
          vA = aC.w * env * mix(1.0, aC.x / sz, 0.55);
          vW = w;
        }
        vec4 mvPosition = viewMatrix * vec4(w, 1.0);
        vA *= smoothstep(1.2, 3.5, -mvPosition.z);           // the veil carries it inside 3 u
        gl_Position = projectionMatrix * mvPosition;
        vFogT = vec3(1.0); vFogS = vec3(0.0);
        #include <fog_vertex>
        #ifdef USE_FOG
        {
          vec3 normal = vec3(0.0, 0.0, 1.0);
          vec4 fogTmp = vec4(0.0, 0.0, 0.0, 1.0);
          ${FOGV}
          vFogS = fogTmp.rgb;
          fogTmp = vec4(1.0);
          ${FOGV}
          vFogT = fogTmp.rgb - vFogS;
        }
        #endif
      }`,
    fragmentShader: /* glsl */`
      uniform sampler2D uTex; uniform vec3 uAlb, uAmb; uniform float uLampK;
      uniform vec4 abyssaLampA, abyssaLampAC;
      varying vec2 vUv; varying float vA, vH, vCell, vLampR; varying vec3 vW, vFogT, vFogS, vTint;
      void main(){
        if (vA < 0.002) discard;
        vec2 cell = vec2(mod(vCell, 2.0), floor(vCell / 2.0));
        vec4 tx = texture2D(uTex, (vUv + cell) * 0.5);
        float a = tx.a * vA;
        if (a < 0.003) discard;
        // lit from above like a cloud: the crown takes the light, the underside is its own shadow
        float sh = clamp(0.62 + 0.85 * vH, 0.22, 1.1) * (0.7 + 0.3 * tx.r);
        vec3 E = uAmb * sh;
        if (abyssaLampA.w > 0.0) {
          vec3 dl = vW - abyssaLampA.xyz;
          float d2 = dot(dl, dl), q = d2 / max(abyssaLampAC.w * abyssaLampAC.w, 1.0), wn = clamp(1.0 - q * q, 0.0, 1.0);
          E += abyssaLampAC.rgb * (abyssaLampA.w * wn * wn / max(d2, 1.0) * 0.3183 * uLampK * vLampR * (0.55 + 0.45 * sh));
        }
        gl_FragColor = vec4(uAlb * vTint * E * vFogT + vFogS, a);
      }`
  });
  mesh = new THREE.Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = 2;
  scene.add(mesh);

  // the veil: a full-screen quad, drawn last, alpha from the density at the lens
  const vg = new THREE.PlaneGeometry(2, 2);
  const vm = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color() }, uA: { value: 0 } },
    transparent: true, depthWrite: false, depthTest: false, fog: false,
    vertexShader: 'varying vec2 vQ; void main(){ vQ = position.xy; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform vec3 uCol; uniform float uA; varying vec2 vQ;
      void main(){ float e = 1.0 - 0.25 * dot(vQ, vQ); gl_FragColor = vec4(uCol * (0.85 + 0.15 * e), uA * (0.8 + 0.2 * e)); }`
  });
  veil = new THREE.Mesh(vg, vm);
  veil.frustumCulled = false;
  veil.visible = false;
  veil.renderOrder = 999;
  scene.add(veil);
}

const rr = (a) => a[0] + (a[1] - a[0]) * Math.random();
const AKEYS = ['aA', 'aB', 'aC', 'aD', 'aE'];
// (sandrise) a particle's look: the rise's sand (tint, flat) or the shipped silt (1, 1, 1, 1)
function lookAt(e, p, rise) {
  if (rise && RISE_LOOK.on) { const t = RISE_LOOK.tint; e[p] = t[0]; e[p + 1] = t[1]; e[p + 2] = t[2]; e[p + 3] = RISE_LOOK.flat; }
  else { e[p] = 1; e[p + 1] = 1; e[p + 2] = 1; e[p + 3] = 1; }
}

// A plume at x,y(floor),z: kind 'big' (the hammer), 'small' (a footfall) or 'rise' (Task 8: her rise out of the sand); k scales it.
export function spawnPlume(x, y, z, kind, k = 1, zi = 0) {
  if (!mesh) build();
  const ki = kind === 'small' ? 1 : kind === 'rise' ? 2 : 0, K = KINDS[ki];
  const A = mesh.geometry.attributes, a = A.aA.array, b = A.aB.array, c = A.aC.array, d = A.aD.array, e = A.aE.array;
  // (sandrise) the rise kind draws its own low cloud (rn .. rkd, RISE_LOOK): its density record below is the shipped one
  const R = ki === 2 && RISE_LOOK.on, life0 = R ? K.rlife : K.life, vr0 = R ? K.rvr : K.vr, vy0 = R ? K.rvy : K.vy, s00 = R ? K.rs0 : K.s0, s10 = R ? K.rs1 : K.s1;
  const a0 = R ? K.ra : K.a, kd0 = R ? K.rkd : K.kd;
  const n = R ? Math.max(0, Math.round(K.rn * (0.6 + 0.4 * k))) : Math.max(1, Math.round(K.n * (0.6 + 0.4 * k)));
  const start = head;
  let lifeMax = 0;
  for (let i = 0; i < n; i++) {
    const p = head * 4; head = (head + 1) % N0;
    if (c[p + 2] > 0 && clock - a[p + 3] < c[p + 2]) quadEvicted++;   // (Task 8) that slot's particle is still alive
    const ang = Math.random() * 6.283, vr = rr(vr0) * (0.7 + 0.3 * k), kd = kd0;
    const dx = Math.cos(ang), dz = Math.sin(ang), life = rr(life0);
    if (life > lifeMax) lifeMax = life;
    // a third of a big cloud starts as the core column straight off the impact
    const core = ki === 0 && i % 3 === 0;
    const vrr = core ? vr * 0.25 : vr, vy = rr(vy0) * (core ? 1.35 : 1) * (0.75 + 0.25 * k);
    a[p] = x + dx * 0.6; a[p + 1] = y; a[p + 2] = z + dz * 0.6; a[p + 3] = clock + Math.random() * 0.12;
    b[p] = dx; b[p + 1] = dz; b[p + 2] = vrr; b[p + 3] = vy;
    c[p] = rr(s00) * (0.75 + 0.25 * k); c[p + 1] = rr(s10) * (0.7 + 0.3 * k); c[p + 2] = life; c[p + 3] = a0;
    lookAt(e, p, ki === 2);
    const reach = vrr / kd;
    d[p] = Math.random(); d[p + 1] = (Math.random() - 0.5) * 0.5; d[p + 2] = terrainH(x + dx * reach, z + dz * reach, zi); d[p + 3] = kd;
  }
  // (no clearUpdateRanges here: three clears them after each upload, and a wake spawned in
  // the same frame has its own ranges queued)
  for (const key of AKEYS) {
    const at = A[key];
    if (!n) break;
    if (start + n <= N0) at.addUpdateRange(start * 4, n * 4);
    else { at.addUpdateRange(start * 4, (N0 - start) * 4); at.addUpdateRange(0, (start + n - N0) * 4); }
    at.needsUpdate = true;
  }
  let o;
  if (ki === 0) { o = recHead * 8; recHead = (recHead + 1) % 4; }
  else if (ki === 2) { o = (12 + recHeadR) * 8; if (rec[o + 7] && clock - rec[o + 3] < rec[o + 4]) riseEvicted++; recHeadR = (recHeadR + 1) % 12; }
  // (Task 8) the footfalls' ring is its shipped 8 (records 4..11), written out: as PL - 4 it would run on into the rise's records, and her
  // legs step during the rise (standE > 0.35: brooder.js's 'small' plume on a heavy footfall), inside her blind window
  else { o = (4 + recHeadS) * 8; recHeadS = (recHeadS + 1) % 8; }
  rec[o] = x; rec[o + 1] = y; rec[o + 2] = z; rec[o + 3] = clock; rec[o + 4] = lifeMax; rec[o + 5] = ki; rec[o + 6] = k; rec[o + 7] = 1;
  alive = Math.max(alive, clock + lifeMax + 0.2);
  mesh.visible = true;
}

// Her wake at a footfall (x, floor y, z), k 0..1 (how hard she is going). Render only.
export function spawnWake(x, y, z, k = 1, zi = 0) {
  if (!mesh) build();
  const K = WAKE, A = mesh.geometry.attributes, a = A.aA.array, b = A.aB.array, c = A.aC.array, d = A.aD.array;
  let lifeMax = 0;
  for (let i = 0; i < K.n; i++) {
    const q = N0 + headW, p = q * 4; headW = (headW + 1) % NW;
    const ang = Math.random() * 6.283, vr = rr(K.vr) * (0.6 + 0.4 * k), dx = Math.cos(ang), dz = Math.sin(ang), life = rr(K.life);
    if (life > lifeMax) lifeMax = life;
    a[p] = x + dx * 0.8; a[p + 1] = y; a[p + 2] = z + dz * 0.8; a[p + 3] = clock + Math.random() * 0.2;
    b[p] = dx; b[p + 1] = dz; b[p + 2] = vr; b[p + 3] = rr(K.vy) * (0.7 + 0.3 * k);
    c[p] = rr(K.s0); c[p + 1] = rr(K.s1) * (0.75 + 0.25 * k); c[p + 2] = life; c[p + 3] = K.a * (0.6 + 0.4 * k);
    const reach = vr / K.kd;
    d[p] = Math.random(); d[p + 1] = (Math.random() - 0.5) * 0.3; d[p + 2] = terrainH(x + dx * reach, z + dz * reach, zi); d[p + 3] = K.kd;
    lookAt(A.aE.array, p, false);
    for (const key of AKEYS) A[key].addUpdateRange(p, 4);
  }
  for (const key of AKEYS) A[key].needsUpdate = true;
  alive = Math.max(alive, clock + lifeMax + 0.2);
  mesh.visible = true;
}

// (sandrise) THE POUR, render only (no density record: sight() reads the rise records spawnPlume writes, unchanged): sand falling off her
// rim at (x, y, z) (her shell's outline, high over the bed) to the bed and spreading out along it, outward along (ox, oz) +- PLUME.pour.arc.
// It falls because a particle's floor eases from its spawn height to the bed under where it travels (the vertex shader's fl): a heavy
// sheet, not a burst. k 0..1 scales it. Particles in the plumes' ring of 448 (quadEvicted counts a live one overwritten)
export function spawnPour(x, y, z, ox, oz, k = 1, zi = 0) {
  if (!mesh) build();
  if (!RISE_LOOK.on) return;
  const K = PLUME.pour, A = mesh.geometry.attributes, a = A.aA.array, b = A.aB.array, c = A.aC.array, d = A.aD.array, e = A.aE.array;
  const n = Math.max(1, Math.round(K.n * k)), start = head, base = Math.atan2(oz, ox);
  let lifeMax = 0;
  for (let i = 0; i < n; i++) {
    const p = head * 4; head = (head + 1) % N0;
    if (c[p + 2] > 0 && clock - a[p + 3] < c[p + 2]) quadEvicted++;
    const ang = base + (Math.random() * 2 - 1) * K.arc, dx = Math.cos(ang), dz = Math.sin(ang), life = rr(K.life), vr = rr(K.vr) * (0.7 + 0.3 * k);
    if (life > lifeMax) lifeMax = life;
    a[p] = x + dx * 0.3; a[p + 1] = y; a[p + 2] = z + dz * 0.3; a[p + 3] = clock + Math.random() * 0.15;
    b[p] = dx; b[p + 1] = dz; b[p + 2] = vr; b[p + 3] = rr(K.vy);
    c[p] = rr(K.s0); c[p + 1] = rr(K.s1) * (0.7 + 0.3 * k); c[p + 2] = life; c[p + 3] = K.a;
    const reach = vr / K.kd;
    d[p] = Math.random(); d[p + 1] = (Math.random() - 0.5) * 0.4; d[p + 2] = terrainH(x + dx * reach, z + dz * reach, zi); d[p + 3] = K.kd;
    lookAt(e, p, true);
  }
  for (const key of AKEYS) {
    const at = A[key];
    if (start + n <= N0) at.addUpdateRange(start * 4, n * 4);
    else { at.addUpdateRange(start * 4, (N0 - start) * 4); at.addUpdateRange(0, (start + n - N0) * 4); }
    at.needsUpdate = true;
  }
  pourN += n;
  alive = Math.max(alive, clock + lifeMax + 0.2);
  mesh.visible = true;
}
let pourN = 0, veilR = 0;

// Density per unit length at a point (the model the gameplay reads).
function densRec(o, x, y, z) {
  if (!rec[o + 7]) return 0;
  const age = clock - rec[o + 3], life = rec[o + 4];
  if (age <= 0 || age >= life) return 0;
  const K = KINDS[rec[o + 5]], k = rec[o + 6];
  const rh = (K.rh0 + K.rhA * (1 - Math.exp(-K.rhK * age))) * (0.7 + 0.3 * k);
  const hv = (K.hv0 + K.hvA * (1 - Math.exp(-K.hvK * age))) * (0.75 + 0.25 * k);
  const hc = rec[o + 1] + hv * 0.75;
  const dx = x - rec[o], dz = z - rec[o + 2], dy = (y - hc) / hv;
  const q = 1 - (dx * dx + dz * dz) / (rh * rh) - dy * dy;
  if (q <= 0) return 0;
  const env = Math.min(1, age / 0.3) * (1 - THREE.MathUtils.smoothstep(age, life * 0.45, life)) * Math.exp(-0.10 * age);
  return K.D / rh * env * q * k;
}
export function plumeDensity(x, y, z) {
  let s = 0;
  for (let i = 0; i < PL; i++) s += densRec(i * 8, x, y, z);
  return s;
}
// (Task 8, the burial probe's footprint and climb) one kind's share of the same density; debug only, never in a frame
function densKind(x, y, z, kind) {
  const ki = kind === 'small' ? 1 : kind === 'rise' ? 2 : 0;
  let s = 0;
  for (let i = 0; i < PL; i++) if (rec[i * 8 + 5] === ki) s += densRec(i * 8, x, y, z);
  return s;
}
// Optical depth along a->b (16 midpoint samples).
export function plumeTau(ax, ay, az, bx, by, bz) {
  let live = false;
  for (let i = 0; i < PL; i++) if (rec[i * 8 + 7] && clock - rec[i * 8 + 3] < rec[i * 8 + 4]) { live = true; break; }
  if (!live) return 0;
  const len = Math.hypot(bx - ax, by - ay, bz - az), S = 16;
  let t = 0;
  for (let s = 0; s < S; s++) {
    const u = (s + 0.5) / S;
    t += plumeDensity(ax + (bx - ax) * u, ay + (by - ay) * u, az + (bz - az) * u);
  }
  return t * len / S;
}

function findLights() {
  lights = { amb: [], hemi: [], dir: [] };
  scene.traverse(o => {
    if (o.isAmbientLight) lights.amb.push(o);
    else if (o.isHemisphereLight) lights.hemi.push(o);
    else if (o.isDirectionalLight) lights.dir.push(o);
  });
}

// THE FISSURE's opening (world/fissure.js) throws these clouds too, in any zone. It builds the
// mesh at boot (buildPlumes: the loader's warm frames then draw it, so no first cloud compiles
// anything) and keeps the clock running where no Brooder does: plumeTicks() counts the calls here,
// and fissure.js ticks the clouds itself only on a frame that follows one nobody ticked.
let ticks = 0;
export const plumeTicks = () => ticks;
export function buildPlumes() { if (!mesh) build(); }
export function updatePlumes(dt) {
  ticks++;
  if (!mesh) return;
  clock += dt;
  uni.uTime.value = clock;
  uni.uLampK.value = PLUME_TUNE.lampK;
  uni.uSink.value = PLUME_TUNE.sink;
  uni.uLampR.value = RISE_LOOK.lamp;
  const on = clock < alive && !PLUME_TUNE.off;
  mesh.visible = on;
  if (!on) { veil.visible = false; return; }
  // the light the silt takes: what a Lambert surface gets from the same lights
  if (!lights) findLights();
  let r = 0, g = 0, b = 0;
  for (const l of lights.amb) { r += l.color.r * l.intensity; g += l.color.g * l.intensity; b += l.color.b * l.intensity; }
  for (const l of lights.hemi) { const i = l.intensity * 0.5; r += (l.color.r + l.groundColor.r) * i; g += (l.color.g + l.groundColor.g) * i; b += (l.color.b + l.groundColor.b) * i; }
  for (const l of lights.dir) { const i = l.intensity * 0.45; r += l.color.r * i; g += l.color.g * i; b += l.color.b * i; }
  const k = PLUME_TUNE.ambK / Math.PI;
  uni.uAmb.value.set(r * k, g * k, b * k);
  // the veil
  const cp = camera.position, dc = plumeDensity(cp.x, cp.y, cp.z);
  // (sandrise) the rise kind's share of the veil is capped (RISE_LOOK.veilMax) and tinted: the lens in her low cloud sees sandy murk, never
  // a whiteout (at the anchor the shove carried the lens into the model's 14 u ellipsoids and the veil read 0.9: the pale puff round him)
  let dr = 0;
  if (RISE_LOOK.on) for (let i = 12; i < PL; i++) dr += densRec(i * 8, cp.x, cp.y, cp.z);
  const vo = 1 - Math.exp(-(dc - dr) * 4.5 * PLUME_TUNE.veilK), vr = Math.min(RISE_LOOK.veilMax, 1 - Math.exp(-dr * 4.5 * PLUME_TUNE.veilK));
  const va = (1 - (1 - vo) * (1 - vr)) * 0.92, vrs = vr / Math.max(1e-6, vo + vr);
  veilR = vr;
  veil.visible = va > 0.01;
  if (veil.visible) {
    let lr = 0, lg = 0, lb = 0;
    const LA = uni.abyssaLampA && uni.abyssaLampA.value, LC = uni.abyssaLampAC && uni.abyssaLampAC.value;
    if (LA && LA[3] > 0) {
      const d2 = (cp.x - LA[0]) ** 2 + (cp.y - LA[1]) ** 2 + (cp.z - LA[2]) ** 2, q = d2 / Math.max(LC[3] * LC[3], 1), wn = Math.max(0, 1 - q * q);
      const e = LA[3] * wn * wn / Math.max(d2, 1) * 0.3183 * PLUME_TUNE.lampK * 0.7;
      lr = LC[0] * e; lg = LC[1] * e; lb = LC[2] * e;
    }
    const A = uni.uAlb.value, U = uni.uAmb.value, T = RISE_LOOK.tint, lk = 1 - vrs * (1 - RISE_LOOK.lamp);
    const tr = 1 + vrs * (T[0] - 1), tg = 1 + vrs * (T[1] - 1), tb = 1 + vrs * (T[2] - 1);
    _c.setRGB(A.r * tr * (U.x * 0.8 + lr * lk), A.g * tg * (U.y * 0.8 + lg * lk), A.b * tb * (U.z * 0.8 + lb * lk));
    veil.material.uniforms.uCol.value.copy(_c);
    veil.material.uniforms.uA.value = va;
  }
}

export function clearPlumes() {
  rec.fill(0);
  recHeadR = riseEvicted = quadEvicted = 0; pourN = 0; veilR = 0;   // (Task 8) every new sleeper calls this on dispose: a rise's counters belong to that rise
  alive = 0;
  if (mesh) { mesh.visible = false; veil.visible = false; }
}
export function plumeState() {
  let n = 0, big = 0, rise = 0;
  for (let i = 0; i < PL; i++) if (rec[i * 8 + 7] && clock - rec[i * 8 + 3] < rec[i * 8 + 4]) { n++; if (i < 4) big++; else if (i >= 12) rise++; }
  return { live: n, big, rise, riseEvicted, quadEvicted, clock, pourN, veilR: +veilR.toFixed(3), visible: !!(mesh && mesh.visible), veil: veil ? +veil.material.uniforms.uA.value.toFixed(3) : 0, veilOn: !!(veil && veil.visible) };
}
if (typeof window !== 'undefined') window.__plume = { state: plumeState, tune: PLUME_TUNE, kinds: PLUME, tau: plumeTau, dens: plumeDensity, densKind, rec, spawn: spawnPlume, clear: clearPlumes,
  look: RISE_LOOK, pour: spawnPour,
  // (sandrise, sandpix-probe's A/B) every plume and the veil hidden while off (PLUME_TUNE.off: updatePlumes re-sets mesh.visible each frame)
  show: on => { PLUME_TUNE.off = !on; if (mesh && !on) { mesh.visible = false; veil.visible = false; } return !!mesh; } };
