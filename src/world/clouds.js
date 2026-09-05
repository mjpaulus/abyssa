// PUFF-CLUSTER CLOUDS — real 3D clouds in the air over the sea. OWNED BY: clouds agent.
//
// THE RULING that made this file: the painted dome layer (water.js skyRadiance) was
// taken through a shaping pass and a dimension pass and Michael still read it as "a flat
// map on the sky". It always would: a coverage map projected onto a hemisphere has no
// depth to give. A cloud does not read as an object because its silhouette is ragged and
// its base is dark — it reads as an object because it MOVES AGAINST the clouds behind it
// when you take a step, and because one clump passes in front of another. Both of those
// are geometry. So the clouds are geometry now.
//
// The painted layer is NOT deleted. GLASS.cloud.dome fades it to a distant backdrop
// (0.28 shipped) and the storm envelope drives it back to a full lid on its own, which
// is the storm handoff: as env.sky rises the clusters flatten, darken, sink toward a
// common deck and fade out exactly as the painted deck closes over them. dome = 1 is the
// A/B that restores the shipped painted sky bit-for-bit.
//
// ARCHITECTURE
//   ONE InstancedMesh, ONE material, ONE draw call, at most 16 clusters x 30 puffs = 480
//   camera-facing soft discs on a procedurally generated alpha texture (no assets).
//   The LAYOUT is dealt from a mulberry32 stream seeded only by the day index, so day 4
//   is day 4 forever; the deal writes in place into buffers sized once at build.
//   The FORM is per-puff and lives in the VERTEX SHADER, dotted against the live SUN.dir,
//   so the lit flank travels with the sun through the day instead of being baked.
//   The COLOURS are water.js's own uCloudLit/uCloudBase (via `cloudLook`) — the same two
//   the painted dome mixes between. That is what makes the two systems one sky.
//
// WHY THE CPU WRITES THE INSTANCE BUFFERS EVERY FRAME
//   Alpha-blended sprites with depthWrite off are order-dependent, and "one clump passes
//   in front of another" is half the point of the exercise. So the puffs are depth-sorted
//   back-to-front each frame and the four instance attributes are written in that order.
//   n <= 480 and the order is nearly sorted frame to frame, so the sort is an insertion
//   pass over an Int32Array (~n compares in the steady state) and the upload is 27 kB.
//   Every buffer, scratch array and temp here is allocated ONCE at build; the per-frame
//   path allocates nothing.
//
// RENDERING DISCIPLINE (all of it load-bearing, see the notes at buildClouds)
//   fog: false          — they are in AIR; the globally patched Beer-Lambert fog chunk
//                         would turn a cloud teal in metres (the raft-lantern lesson).
//   depthWrite: false, depthTest: true — the raft's mast may occlude a cloud; a cloud
//                         may never occlude another cloud by z-fighting.
//   renderOrder: -2     — BEFORE the sea surface (-1). The sea does not write depth, so
//                         a cloud drawn after it would paint over the water below the
//                         horizon line. Drawn before, the sea correctly covers anything
//                         beyond the horizon, which is also the milky merge at the
//                         waterline. From underwater the surface is the ceiling and it
//                         paints over them the same way — the clouds you see through
//                         Snell's window come from renderRefraction's air-side render,
//                         which they join for free (they are in the scene, above the
//                         clip plane, and unfogged).
//   frustumCulled: false — the mesh's own bounding box is meaningless; the instances
//                         move every frame.
import * as THREE from 'three';
import { scene, camera, renderer } from '../core.js';
import { SUN, GLASS } from '../config.js';
import { windState, airAmbience, cloudLook, skyState } from './water.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const ms = (x, a, b) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Hard ceilings. The buffers are sized for these once and never grow; GLASS.puff's own
// nMax/pMax are clamped into them so poking the lab can never reallocate anything.
const MAXC = 16, MAXP = 30, MAXI = MAXC * MAXP;

// mulberry32 — the project's standard deterministic stream (weather.js, vents.js).
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// STATE. All of it typed arrays sized at module load; `deal()` rewrites in place.
// ---------------------------------------------------------------------------
// per cluster
const cX = new Float32Array(MAXC), cY = new Float32Array(MAXC), cZ = new Float32Array(MAXC);
const cR = new Float32Array(MAXC);            // half-width
const cN = new Int32Array(MAXC);              // puff count
const cB = new Int32Array(MAXC);              // first puff index
const cA = new Float32Array(MAXC);            // per-cluster alpha (spawn fade-in)
const cLay = new Int32Array(MAXC);            // 0 = high torn cumulus, 1 = the LOW DECK
// per puff, static for the day
const pX = new Float32Array(MAXI), pY = new Float32Array(MAXI), pZ = new Float32Array(MAXI);
const pNX = new Float32Array(MAXI), pNY = new Float32Array(MAXI), pNZ = new Float32Array(MAXI);
const pRad = new Float32Array(MAXI), pPh = new Float32Array(MAXI);
const pHgt = new Float32Array(MAXI), pYS = new Float32Array(MAXI);
// SELF-SHADOW (ref-cloud-selfshadow): how much of each puff is shaded by the puffs of
// its own cluster that sit between it and the sun. Walked on the CPU only when the sun
// has moved (~0.6 degrees) or the deal changed; 480 x 30 compares, a few times a minute.
const pSh = new Float32Array(MAXI);
let shSunX = 9, shSunY = 9, shSunZ = 9;
// per puff, per frame
const wX = new Float32Array(MAXI), wY = new Float32Array(MAXI), wZ = new Float32Array(MAXI);
const key = new Float32Array(MAXI);
const order = new Int32Array(MAXI);
// map from a frame slot back to its puff / cluster (the sort permutes slots, not data)
const srcI = new Int32Array(MAXI), srcC = new Int32Array(MAXI);

let nC = 0, nI = 0, dealtDay = -999;
let mesh = null, mat = null, geo = null;
let matOcc = null, occMesh = null, occScene = null;
let aPos, aOffN, aP, aMod;   // InstancedBufferAttributes
let hand = null, storm = 0;
let rnd = null;
const _v = new THREE.Vector3();   // dev-surface scratch only

// ---------------------------------------------------------------------------
// THE SOFT DISC. One 64x64 luminance-alpha texture, generated here — the brief forbids
// external assets and a gradient is cheaper than loading one anyway. The profile is
// pow(1 - r, 1.7): a fat soft core with a long tail, which is what lets 20-odd of these
// overlap into something with an interior instead of into a ring of visible discs. A
// touch of low-frequency wobble on the radius keeps the silhouette of a single puff off
// perfect-circle, so a small cluster still tears at its edge.
// ---------------------------------------------------------------------------
function makePuffTex() {
  const N = 64, cv = document.createElement('canvas');
  cv.width = cv.height = N;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
    const ang = Math.atan2(v, u);
    // three low harmonics: a dent, a lobe and a wrinkle. Deterministic, no rng.
    const wob = 1 + 0.055 * Math.sin(ang * 3 + 0.7) + 0.035 * Math.sin(ang * 5 - 1.9)
              + 0.022 * Math.sin(ang * 8 + 2.4);
    const r = Math.hypot(u, v) / wob;
    const a = r >= 1 ? 0 : Math.pow(1 - r, 1.7);
    const i = (y * N + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = Math.round(255 * a);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------------------
// THE DEAL. Deterministic in the day index alone.
//
// GATHERED LOW comes free: the clusters are dealt AREA-UNIFORMLY over the 130..540
// annulus (sqrt of the uniform, not the uniform), so most of them are far, and real
// perspective compresses a far cluster into a small shape low in the sky. Nothing here
// biases elevation — that was the dome's problem and it needed a zenith term to fake it.
//
// A CLUSTER'S SHAPE is a rejection-sampled disc with a domed ceiling: the vertical extent
// allowed at horizontal distance q from the axis is sqrt(1 - q^2), so the body towers on
// the axis and feathers out at the rim, and the FLOOR is flat at -0.16 everywhere. That
// flat floor is the photo's dark base, and it is a shape fact, not a shading trick.
// ---------------------------------------------------------------------------
function deal(dayIndex, camX, camZ) {
  const P = GLASS.puff;
  rnd = mulberry32((0x0C10D0 ^ Math.imul(dayIndex | 0, 2654435761)) >>> 0);
  const clouds = hand ? clamp(hand.clouds, 0, 1) : 0.22;
  const nMin = Math.min(MAXC, Math.max(1, P.nMin | 0));
  const nMax = Math.min(MAXC, Math.max(nMin, P.nMax | 0));
  nC = Math.round(nMin + (nMax - nMin) * clouds);
  const pMin = Math.min(MAXP, Math.max(3, P.pMin | 0));
  const pMax = Math.min(MAXP, Math.max(pMin, P.pMax | 0));
  // THE TWO-LAYER DECK (crepuscular-sky). The hand's `layers` turns a share of the SAME
  // pool into a low, flat, dark stratus layer under the cumulus: bigger and flatter
  // clusters, dealt nearer so they sit at the elevations a low sun has to shine through,
  // drifting slower. The pool is split, never grown — still one instanced draw. The
  // low clusters are dealt LAST so the high layer's own draws are the ones that shipped.
  const layers = clamp((hand ? hand.layers : 0) * (GLASS.rays ? GLASS.rays.lowDeck : 1), 0, 1);
  const nLow = Math.min(nC - 1, Math.round(nC * P.lowShare * layers));

  let k = 0;
  for (let i = 0; i < nC; i++) {
    const low = i >= nC - nLow;
    cLay[i] = low ? 1 : 0;
    // The low deck is dealt across the SUN'S SWEEP (azimCenter +/- 90 degrees, a
    // config constant, so still a pure function of the day): a stratus layer that the
    // day's sun has to pass behind is the whole reason it exists. The high layer keeps
    // its all-round deal.
    const ang = low ? GLASS.sun.azimCenter * (Math.PI / 180) + (rnd() * 2 - 1) * 1.57 : rnd() * TAU;
    // area-uniform over the annulus -> most clusters far -> a low band, by perspective
    const rr = Math.sqrt(0.05 + 0.95 * rnd());
    // The low deck is dealt NEAR (0.6..0.42 of the cumulus annulus): at 80..230 units a
    // 60..85-unit altitude subtends 15..45 degrees, which is the band a late sun crosses.
    const rad = low ? P.rIn * 0.6 + (P.rOut * 0.42 - P.rIn * 0.6) * rr
                    : P.rIn + (P.rOut - P.rIn) * rr;
    cX[i] = camX + Math.cos(ang) * rad;
    cZ[i] = camZ + Math.sin(ang) * rad;
    cY[i] = low ? P.lowYLo + (P.lowYHi - P.lowYLo) * rnd() : P.yLo + (P.yHi - P.yLo) * rnd();
    // far clusters get to be bigger, so the annulus does not read as "everything shrinks"
    cR[i] = (P.sizeMin + (P.sizeMax - P.sizeMin) * rnd()) * (0.72 + 0.55 * rr) * (low ? P.lowSize : 1);
    cA[i] = 1;
    const np = pMin + Math.floor(rnd() * (pMax - pMin + 1));
    cB[i] = k;
    cN[i] = np;
    const R = cR[i];
    for (let j = 0; j < np; j++, k++) {
      let ux, uz, q;
      do { ux = rnd() * 2 - 1; uz = rnd() * 2 - 1; q = ux * ux + uz * uz; } while (q > 1);
      const dome = Math.sqrt(1 - q);
      // the low deck is a SLAB: a shallow dome over the same flat floor
      const yBot = -0.16, yTop = low ? 0.02 + 0.20 * dome : 0.10 + 0.62 * dome;
      // pow < 1 crowds the draw toward the top, which is where the volume actually is —
      // a uniform draw put as many puffs in the skirt as in the massif and read as a ball
      const hg = Math.pow(rnd(), 0.72);
      const oy = yBot + (yTop - yBot) * hg;
      pX[k] = ux * R; pY[k] = oy * R; pZ[k] = uz * R;
      pHgt[k] = clamp((oy - yBot) / (yTop - yBot + 1e-6), 0, 1);
      // The outward normal of the puff on its cluster — the ONLY thing the sun dot needs,
      // and the reason the shading follows a live sun with no re-deal. y is stretched so a
      // crown puff reads as facing up rather than sideways.
      const nx = ux, ny = oy * 1.7 + 0.10, nz = uz;
      const nl = Math.hypot(nx, ny, nz) || 1;
      pNX[k] = nx / nl; pNY[k] = ny / nl; pNZ[k] = nz / nl;
      // bases are bigger and flatter, crowns smaller and rounder
      pRad[k] = R * (P.puffLo + (P.puffHi - P.puffLo) * rnd()) * (1.18 - 0.34 * pHgt[k]);
      pYS[k] = low ? P.lowFlat : P.flatBase + (1 - P.flatBase) * pHgt[k];
      pPh[k] = rnd() * TAU;
    }
  }
  nI = k;
  dealtDay = dayIndex;
  shSunX = 9;   // force the self-shadow walk on the next frame
}

// SELF-SHADOW WALK. For every puff, the puffs of its own cluster that lie sunward of it
// (positive projection on the sun axis) and whose disc the sun line passes through
// shade it; each such occluder takes a share, multiplied through so a deep interior
// puff ends up dark and a rim puff stays lit. Cluster-local, so it never depends on the
// wind drift, and the storm flattening is ignored (a lid is shadeless anyway). Runs only
// when the sun has moved by ~0.6 degrees since the last walk.
function selfShadow() {
  const sx = SUN.dir.x, sy = SUN.dir.y, sz = SUN.dir.z;
  const d = Math.abs(sx - shSunX) + Math.abs(sy - shSunY) + Math.abs(sz - shSunZ);
  if (d < 0.01) return false;
  shSunX = sx; shSunY = sy; shSunZ = sz;
  for (let i = 0; i < nC; i++) {
    const b = cB[i], n = cN[i];
    for (let j = 0; j < n; j++) {
      const s = b + j;
      let vis = 1;
      for (let m = 0; m < n; m++) {
        if (m === j) continue;
        const o = b + m;
        const dx = pX[o] - pX[s], dy = pY[o] - pY[s], dz = pZ[o] - pZ[s];
        const proj = dx * sx + dy * sy + dz * sz;
        if (proj <= pRad[o] * 0.25) continue;                  // not sunward of us
        const ex = dx - sx * proj, ey = dy - sy * proj, ez = dz - sz * proj;
        const perp = Math.sqrt(ex * ex + ey * ey + ez * ez);
        // soft disc: full inside 0.45 r, gone at 0.95 r
        const cov = clamp((pRad[o] * 0.95 - perp) / (pRad[o] * 0.5), 0, 1);
        if (cov > 0) vis *= 1 - 0.42 * cov;
      }
      pSh[s] = 1 - vis;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
export function buildClouds() {
  if (mesh) return;
  const base = new THREE.PlaneGeometry(1, 1);
  geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.attributes.position = base.attributes.position;
  geo.attributes.uv = base.attributes.uv;
  aPos = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
  aOffN = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 3), 3);
  aP = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 4), 4);
  // (cluster alpha, cluster shade, layer 0/1, self-shadow 0..1)
  aMod = new THREE.InstancedBufferAttribute(new Float32Array(MAXI * 4), 4);
  for (const a of [aPos, aOffN, aP, aMod]) a.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('aPos', aPos);
  geo.setAttribute('aOffN', aOffN);
  geo.setAttribute('aP', aP);
  geo.setAttribute('aMod', aMod);
  geo.instanceCount = 0;
  // Never let three cull the whole mesh on a stale box.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

  const P = GLASS.puff;
  mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: makePuffTex() },
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uLit: { value: new THREE.Vector3(0.5, 0.5, 0.55) },
      uBase: { value: new THREE.Vector3(0.2, 0.2, 0.24) },
      uBak: { value: 0 },
      uFrm: { value: new THREE.Vector4(P.shade, P.base, P.crown, 0) },
      uFade: { value: new THREE.Vector2(P.fadeNear, P.fadeFar) },
      uHaze: { value: new THREE.Vector2(GLASS.cloud.hazeUp, GLASS.cloud.hazeK) },
      // SILVER LINING (crepuscular-sky): rim colour (the sun disc's hue at the lit
      // cloud's brightness) and (lining strength, self-shadow depth, low-deck shade).
      uSil: { value: new THREE.Vector3(0.6, 0.58, 0.5) },
      uLin: { value: new THREE.Vector3(GLASS.rays.lining, P.selfShadow, P.lowShade) }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    fog: false,
    side: THREE.DoubleSide,
    // ONE draw call, not two. Since r163 three renders a transparent DoubleSide material
    // in two passes (back faces, then front) unless this is set. These puffs are
    // camera-facing billboards built in view space, so back and front are the same
    // picture and the second pass buys nothing but a submission.
    forceSinglePass: true,
    blending: THREE.NormalBlending,
    vertexShader: `
      attribute vec3 aPos;    // puff world position
      attribute vec3 aOffN;   // outward normal of the puff on its cluster
      attribute vec4 aP;      // radius, phase, height 0..1, vertical squash
      attribute vec4 aMod;    // cluster alpha, cluster shade, layer, self-shadow
      uniform float uTime, uBak;
      uniform vec3 uSunDir, uLit, uBase, uLin;
      uniform vec4 uFrm;      // flank shade, base darkening, crown highlight
      uniform vec2 uFade;     // fade near, fade far
      uniform vec2 uHaze;     // milky band top (upness), milky band strength
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vA, vBak;
      void main() {
        vUv = uv;
        // THE BILLOW. Tiny on purpose: a cloud that visibly breathes is a cartoon. This
        // is a few percent of a puff radius over a ~57 second period, enough that a
        // still frame and the frame a minute later are not the same picture.
        vec3 wp = aPos;
        wp.y += sin( uTime * 0.11 + aP.y ) * aP.x * 0.05;
        wp.x += cos( uTime * 0.087 + aP.y * 1.3 ) * aP.x * 0.04;

        // THE FORM. Read the same way the dome's dimension pass reads it, against the
        // LIVE sun, so the two agree about which flank is lit and both flip together as
        // the sun travels. There is nothing baked in here.
        float sd = dot( aOffN, uSunDir );
        float lit = smoothstep( -0.55, 0.70, sd );
        float hgt = aP.z;
        float k = mix( 1.0 - uFrm.x, 1.0, lit );          // leeward flank in shadow
        k *= mix( 1.0 - uFrm.y, 1.0, hgt );               // dark flat base
        k = clamp( k + uFrm.z * hgt * hgt * lit, 0.0, 1.0 );   // sunward crown
        // BACKLIT BASES at the day's edges — the identical curve water.js bakes into
        // skyRadiance (pow 2.2 * 0.88), driven by the identical uCloudBak. At noon uBak
        // is 0 and this line does nothing.
        k = mix( k, pow( k, 2.2 ) * 0.88, uBak );
        // SELF-SHADOW: the puffs sunward of this one in its cluster (CPU walk, aMod.w).
        k *= 1.0 - uLin.y * aMod.w;
        // THE LOW DECK sits in its own shade: a stratus underside seen from below.
        k *= mix( 1.0, uLin.z, aMod.z );

        vec3 rel = wp - cameraPosition;
        float dist = length( rel );
        float upn = rel.y / max( dist, 1e-4 );
        // SILVER LINING. When the sun is BEHIND this puff relative to the eye the light
        // leaks around its edge (forward scatter through the thin rim) while the body
        // stays dark: the rim is drawn in the fragment over the alpha 0.1..0.5 band, the
        // body is pulled down here. A puff shaded by its own cluster gets less rim.
        float bl = smoothstep( 0.55, 0.97, dot( rel / max( dist, 1e-4 ), uSunDir ) );
        vBak = bl * uLin.x * ( 1.0 - 0.7 * aMod.w );
        k *= 1.0 - 0.32 * bl * uLin.x;
        vCol = mix( uBase, uLit, k ) * aMod.y;
        float a = aMod.x;
        // DISTANCE HAZE, ours and not the global fog chunk's: the puffs dissolve into the
        // painted dome before the 700-unit far plane can ever clip one.
        a *= smoothstep( uFade.y, uFade.x, dist );
        // THE MILKY BAND, on the same curve and the same two constants as the dome's, so
        // a puff and the painted cloud behind it dissolve into the waterline together.
        a *= 1.0 - uHaze.y * ( 1.0 - smoothstep( 0.0, uHaze.x, upn ) );
        vA = a;

        float rad = aP.x * ( 1.0 + 0.045 * sin( uTime * 0.17 + aP.y * 1.7 ) );
        vec4 mv = viewMatrix * vec4( wp, 1.0 );
        mv.xy += position.xy * rad * vec2( 1.0, aP.w );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform vec3 uSil;
      varying vec2 vUv;
      varying vec3 vCol;
      varying float vA, vBak;
      void main() {
        float ta = texture2D( uMap, vUv ).a;
        float a = ta * vA;
        if ( a < 0.004 ) discard;
        // the rim band of the disc profile: thin cloud, where transmittance lets the
        // backlight through. Both smoothsteps ascend (reversed edges are UB).
        float rim = smoothstep( 0.05, 0.20, ta ) * ( 1.0 - smoothstep( 0.30, 0.55, ta ) );
        gl_FragColor = vec4( vCol + uSil * ( rim * vBak ), a );
      }`
  });
  // creatures.js's hazard: three silently shares a compiled program between materials
  // whose sources hash alike. Nothing else in the project looks like this, but the rule
  // is the rule.
  mat.customProgramCacheKey = () => 'abyssa-puffcloud-v1';

  mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -2;   // before the sea surface (-1); see the header
  mesh.visible = false;
  scene.add(mesh);

  // THE OCCLUDER (crepuscular-sky). A second mesh on the SAME instanced geometry, in its
  // own tiny scene, drawn by postfx.skyrays.js into its half-res sun-visibility mask:
  // the puffs as alpha, nothing else. Same billboard/fade maths (so a puff occludes the
  // sun exactly where it is drawn), darkening a white sky by its alpha. uOccK weights the
  // two layers -- holeBias hands the hole to the LOW deck by thinning the high torn layer
  // to a veil in the mask. Built here at boot, compiled by the pass at boot: no program
  // is ever created at runtime.
  matOcc = new THREE.ShaderMaterial({
    uniforms: {
      uMap: mat.uniforms.uMap, uTime: mat.uniforms.uTime,
      uFade: mat.uniforms.uFade, uHaze: mat.uniforms.uHaze,
      uOccK: { value: new THREE.Vector2(1, 1) }
    },
    transparent: true, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    side: THREE.DoubleSide, forceSinglePass: true, blending: THREE.NormalBlending,
    vertexShader: `
      attribute vec3 aPos; attribute vec4 aP; attribute vec4 aMod;
      uniform float uTime; uniform vec2 uFade, uHaze, uOccK;
      varying vec2 vUv; varying float vA;
      void main() {
        vUv = uv;
        vec3 wp = aPos;
        wp.y += sin( uTime * 0.11 + aP.y ) * aP.x * 0.05;
        wp.x += cos( uTime * 0.087 + aP.y * 1.3 ) * aP.x * 0.04;
        vec3 rel = wp - cameraPosition;
        float dist = length( rel );
        float upn = rel.y / max( dist, 1e-4 );
        float a = aMod.x * smoothstep( uFade.y, uFade.x, dist );
        a *= 1.0 - uHaze.y * ( 1.0 - smoothstep( 0.0, uHaze.x, upn ) );
        vA = a * mix( uOccK.x, uOccK.y, aMod.z );
        float rad = aP.x * ( 1.0 + 0.045 * sin( uTime * 0.17 + aP.y * 1.7 ) );
        vec4 mv = viewMatrix * vec4( wp, 1.0 );
        mv.xy += position.xy * rad * vec2( 1.0, aP.w );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; varying vec2 vUv; varying float vA;
      void main() {
        float a = texture2D( uMap, vUv ).a * vA;
        if ( a < 0.004 ) discard;
        gl_FragColor = vec4( 0.0, 0.0, 0.0, a );
      }`
  });
  matOcc.customProgramCacheKey = () => 'abyssa-puffcloud-occ-v1';
  occMesh = new THREE.Mesh(geo, matOcc);
  occMesh.frustumCulled = false;
  occMesh.visible = false;
  occScene = new THREE.Scene();
  occScene.add(occMesh);
}

// The occluder scene for postfx.skyrays.js (render it with the main camera into the
// mask target). null until buildClouds has run. `occK(high, low)` weights the layers.
export function cloudOccluder() { return occScene; }
export function cloudOccK(high, low) { if (matOcc) matOcc.uniforms.uOccK.value.set(high, low); }

// Called by game.js beside setWeatherHand. Storage only — the hand object is the one
// weather.js reuses forever, so this is a reference, never a copy.
export function setCloudWeather(h, envSky) {
  hand = h || null;
  storm = clamp(envSky || 0, 0, 1);
}

// ---------------------------------------------------------------------------
export function updateClouds(dt, t) {
  if (!mesh) return;
  const P = GLASS.puff;
  const camX = camera.position.x, camZ = camera.position.z;

  // Re-deal on a day change. Also the first frame (dealtDay starts impossible).
  const day = hand ? hand.dayIndex : 0;
  if (day !== dealtDay) deal(day, camX, camZ);

  // --- the whole system fades out under a storm lid and under a marine layer ---------
  // The painted dome comes UP to a full deck over exactly this band (uCloudDome in
  // water.js), so the sky is never missing cloud in the middle of the handoff.
  const stormFade = 1 - ms(storm, 0.55, 0.95);
  const fogFade = 1 - 0.95 * clamp(airAmbience.fog, 0, 1);
  const gAlpha = P.alpha * stormFade * fogFade;
  if (gAlpha < 0.004 || nC === 0) { mesh.visible = false; occMesh.visible = false; geo.instanceCount = 0; return; }
  mesh.visible = true; occMesh.visible = true;
  selfShadow();

  // --- live look, straight off water.js's palette ------------------------------------
  const u = mat.uniforms;
  u.uTime.value = t;
  u.uSunDir.value.set(SUN.dir.x, SUN.dir.y, SUN.dir.z);
  const kLit = P.litK;
  u.uLit.value.set(cloudLook.lit.x * kLit, cloudLook.lit.y * kLit, cloudLook.lit.z * kLit);
  u.uBase.value.copy(cloudLook.base);
  u.uBak.value = cloudLook.bak;
  // Storm collapses the form knobs the same way the dome's do — a gale's lid has no
  // lit flank, no crown and no readable base.
  const frm = 1 - storm;
  u.uFrm.value.set(P.shade * frm, P.base * frm * (1 - cloudLook.bak), P.crown * frm, 0);
  u.uFade.value.set(P.fadeNear, P.fadeFar);
  u.uHaze.value.set(GLASS.cloud.hazeUp, GLASS.cloud.hazeK);
  // SILVER LINING colour: the sun disc's hue (water.js's own palette, so dawn's rim is
  // amber and noon's is white) at a touch over the lit cloud's brightness, and dying
  // with the storm (a lid has no sun behind it) and with the marine layer's cut.
  {
    const d = skyState.disc, m = Math.max(d[0], d[1], d[2], 1e-4);
    const lum = (0.2126 * u.uLit.value.x + 0.7152 * u.uLit.value.y + 0.0722 * u.uLit.value.z) * 1.35;
    u.uSil.value.set(d[0] / m * lum, d[1] / m * lum, d[2] / m * lum);
    u.uLin.value.set(GLASS.rays.lining * (1 - storm) * skyState.discK, P.selfShadow * (1 - storm), P.lowShade);
  }

  // --- drift + wrap -------------------------------------------------------------------
  const w = windState();
  const spd = P.wind * w.speed;
  const dx = w.dx * spd * dt, dz = w.dz * spd * dt;
  // Sinking and merging toward one low deck as the storm builds.
  const sink = ms(storm, 0.20, 0.90);
  const shade = 1 - P.stormDark * storm;
  const flat = 1 - P.stormFlat * storm;
  const wrap2 = P.wrapR * P.wrapR;

  let k = 0;
  for (let i = 0; i < nC; i++) {
    const lowK = cLay[i] ? P.lowDrift : 1;   // the low deck drifts slower
    cX[i] += dx * lowK; cZ[i] += dz * lowK;
    let ox = cX[i] - camX, oz = cZ[i] - camZ;
    if (ox * ox + oz * oz > wrap2) {
      // RESPAWN UPWIND. Placed at the far edge, where its own distance fade already has
      // it at zero, and given a fresh angular offset and altitude so the sky does not
      // develop a conveyor belt. cA fades it in over its first seconds regardless.
      const bx = spd > 1e-4 ? -w.dx : -1, bz = spd > 1e-4 ? -w.dz : 0;
      const a = (rnd ? rnd() : Math.random()) * 2.2 - 1.1;   // +/- 63 degrees
      const ca = Math.cos(a), sa = Math.sin(a);
      const R = P.wrapR * 0.96;
      cX[i] = camX + (bx * ca - bz * sa) * R;
      cZ[i] = camZ + (bx * sa + bz * ca) * R;
      cY[i] = P.yLo + (P.yHi - P.yLo) * (rnd ? rnd() : Math.random());
      cA[i] = 0;
      ox = cX[i] - camX; oz = cZ[i] - camZ;
    }
    if (cA[i] < 1) cA[i] = Math.min(1, cA[i] + dt * 0.5);

    const cy = cY[i] + (P.deckY - cY[i]) * sink;
    const n = cN[i], b = cB[i];
    for (let j = 0; j < n; j++) {
      const s = b + j;
      wX[k] = cX[i] + pX[s];
      wY[k] = cy + pY[s] * flat;
      wZ[k] = cZ[i] + pZ[s];
      const ddx = wX[k] - camX, ddy = wY[k] - camera.position.y, ddz = wZ[k] - camZ;
      key[k] = ddx * ddx + ddy * ddy + ddz * ddz;
      order[k] = k;
      // stash the source index in the parallel arrays the write loop reads
      srcI[k] = s; srcC[k] = i;
      k++;
    }
  }
  const n = k;

  // --- depth sort, far first ----------------------------------------------------------
  // Insertion sort on an index array that is already nearly sorted every frame after the
  // first. Worst case is the first frame and a teleport (window.gotoZone / a voyage),
  // both of which are one-off frames; the steady state is ~n compares.
  for (let a = 1; a < n; a++) {
    const v = order[a], kv = key[v];
    let b = a - 1;
    while (b >= 0 && key[order[b]] < kv) { order[b + 1] = order[b]; b--; }
    order[b + 1] = v;
  }

  // --- write the instance buffers in sorted order ---------------------------------------
  const ap = aPos.array, an = aOffN.array, apr = aP.array, am = aMod.array;
  for (let o = 0; o < n; o++) {
    const q = order[o], s = srcI[q], c = srcC[q];
    let p3 = o * 3, p4 = o * 4;
    ap[p3] = wX[q]; ap[p3 + 1] = wY[q]; ap[p3 + 2] = wZ[q];
    an[p3] = pNX[s]; an[p3 + 1] = pNY[s]; an[p3 + 2] = pNZ[s];
    apr[p4] = pRad[s]; apr[p4 + 1] = pPh[s]; apr[p4 + 2] = pHgt[s];
    apr[p4 + 3] = pYS[s] * flat;
    am[p4] = gAlpha * cA[c]; am[p4 + 1] = shade; am[p4 + 2] = cLay[c]; am[p4 + 3] = pSh[s];
  }
  aPos.needsUpdate = aOffN.needsUpdate = aP.needsUpdate = aMod.needsUpdate = true;
  aPos.addUpdateRange(0, n * 3); aOffN.addUpdateRange(0, n * 3);
  aP.addUpdateRange(0, n * 4); aMod.addUpdateRange(0, n * 4);
  geo.instanceCount = n;
}

// Dev surface, namespaced and kept (the CLAUDE.md convention).
if (typeof window !== 'undefined') {
  window.__clouds = {
    P: GLASS.puff,
    r: renderer,          // for cost probes: renderer.info with autoReset off
    redeal() { dealtDay = -999; return nC; },
    // Renderer counters, so the cost claims in the report are measured and not asserted.
    info() {
      const r = renderer.info;
      return { calls: r.render.calls, tris: r.render.triangles,
               programs: r.programs ? r.programs.length : -1,
               geometries: r.memory.geometries, textures: r.memory.textures,
               cloudVisible: !!(mesh && mesh.visible), instances: geo ? geo.instanceCount : 0 };
    },
    // Screen-space position of each cluster centre, in CSS pixels. This is the parallax
    // instrument: move the camera laterally and the near clusters must shift further
    // than the far ones. A painted dome cannot produce a difference here at all.
    screen() {
      const out = [];
      const w = window.innerWidth, h = window.innerHeight;
      for (let i = 0; i < nC; i++) {
        _v.set(cX[i], cY[i], cZ[i]);
        const d = _v.distanceTo(camera.position);
        _v.project(camera);
        out.push({ i, d: +d.toFixed(1), x: +((_v.x * 0.5 + 0.5) * w).toFixed(2),
                   y: +((-_v.y * 0.5 + 0.5) * h).toFixed(2), front: _v.z < 1 });
      }
      return out;
    },
    // PARALLAX, measured exactly. Two projections of the SAME frame from two camera
    // positions `sep` apart laterally, so nothing else in the world can move between
    // them — no camera smoothing, no raft bob, no wind drift, no weather. The camera is
    // restored before this returns. A dome-painted sky returns 0 for every row by
    // construction; real geometry returns a shift that scales as 1/distance.
    parallax(sep) {
      const s = (sep === undefined ? 6 : sep) * 0.5;
      const w = window.innerWidth, h = window.innerHeight;
      const x0 = camera.position.x;
      const read = [];
      for (const side of [-1, 1]) {
        camera.position.x = x0 + s * side;
        camera.updateMatrixWorld(true);
        const row = [];
        for (let i = 0; i < nC; i++) {
          _v.set(cX[i], cY[i], cZ[i]);
          const d = _v.distanceTo(camera.position);
          _v.project(camera);
          row.push({ d, x: (_v.x * 0.5 + 0.5) * w, y: (-_v.y * 0.5 + 0.5) * h, front: _v.z < 1 });
        }
        read.push(row);
      }
      camera.position.x = x0;
      camera.updateMatrixWorld(true);
      const out = [];
      for (let i = 0; i < nC; i++) {
        if (!read[0][i].front || !read[1][i].front) continue;
        out.push({ d: +read[0][i].d.toFixed(1),
                   shiftPx: +(read[1][i].x - read[0][i].x).toFixed(2) });
      }
      out.sort((a, b) => a.d - b.d);
      return { sep: sep === undefined ? 6 : sep, viewportW: w, rows: out };
    },
    // The FORM instrument: the vertex shader's lighting term, evaluated on the CPU with
    // the identical constants, split by which flank of its cluster each puff sits on and
    // by whether it is a base puff or a crown puff. sunward must beat leeward, crown must
    // beat base, and the sunward/leeward split must FLIP as the sun crosses the sky.
    form() {
      const P = GLASS.puff, frm = 1 - storm;
      const fs = P.shade * frm, fb = P.base * frm * (1 - cloudLook.bak), fc = P.crown * frm;
      const sx = SUN.dir.x, sy = SUN.dir.y, sz = SUN.dir.z;
      let sw = 0, swN = 0, le = 0, leN = 0, top = 0, topN = 0, bot = 0, botN = 0;
      let ex = 0, exN = 0, we = 0, weN = 0;
      for (let s = 0; s < nI; s++) {
        const sd = pNX[s] * sx + pNY[s] * sy + pNZ[s] * sz;
        const tt = clamp((sd + 0.55) / 1.25, 0, 1), lit = tt * tt * (3 - 2 * tt);
        const hg = pHgt[s];
        let k = (1 - fs) + fs * lit;
        k *= (1 - fb) + fb * hg;
        k = clamp(k + fc * hg * hg * lit, 0, 1);
        k = k + (Math.pow(k, 2.2) * 0.88 - k) * cloudLook.bak;
        if (sd > 0.3) { sw += k; swN++; } else if (sd < -0.3) { le += k; leN++; }
        if (hg > 0.7) { top += k; topN++; } else if (hg < 0.25) { bot += k; botN++; }
        // FIXED WORLD BEARINGS. The sunward/leeward split above is defined RELATIVE to
        // the sun, so it can never move; these two cannot lie. +X-facing and -X-facing
        // puffs are the same puffs at every hour, so their means have to CROSS as the
        // sun's azimuth sweeps, or the shading is baked.
        if (pNX[s] > 0.5) { ex += k; exN++; } else if (pNX[s] < -0.5) { we += k; weN++; }
      }
      const r = v => +v.toFixed(4);
      return { elev: +SUN.elevDeg.toFixed(2), sunX: +sx.toFixed(3), sunZ: +sz.toFixed(3),
               bak: +cloudLook.bak.toFixed(3),
               sunward: r(sw / Math.max(1, swN)), leeward: r(le / Math.max(1, leN)),
               crown: r(top / Math.max(1, topN)), base: r(bot / Math.max(1, botN)),
               nSun: swN, nLee: leN, nTop: topN, nBot: botN,
               facingPlusX: r(ex / Math.max(1, exN)), facingMinusX: r(we / Math.max(1, weN)) };
    },
    probe() {
      let nLow = 0, shSum = 0;
      for (let i = 0; i < nC; i++) nLow += cLay[i];
      for (let s = 0; s < nI; s++) shSum += pSh[s];
      const out = { n: nC, nLow, layers: hand ? hand.layers : 0, meanShadow: +(shSum / Math.max(1, nI)).toFixed(3),
                    instances: nI, drawn: geo ? geo.instanceCount : 0,
                    day: dealtDay, storm, fog: airAmbience.fog,
                    dome: cloudLook.dome, bak: cloudLook.bak,
                    sun: [SUN.dir.x, SUN.dir.y, SUN.dir.z], elev: SUN.elevDeg,
                    lit: mat ? mat.uniforms.uLit.value.toArray() : null,
                    base: mat ? mat.uniforms.uBase.value.toArray() : null,
                    clusters: [] };
      for (let i = 0; i < nC; i++) {
        const dxx = cX[i] - camera.position.x, dzz = cZ[i] - camera.position.z;
        out.clusters.push({ x: +cX[i].toFixed(1), y: +cY[i].toFixed(1), z: +cZ[i].toFixed(1),
                            r: +cR[i].toFixed(1), n: cN[i], a: +cA[i].toFixed(2), low: cLay[i],
                            d: +Math.hypot(dxx, dzz).toFixed(1) });
      }
      return out;
    }
  };
}
