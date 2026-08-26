// Sunken wrecks: one per zone, each cradling a relic tool. OWNED BY: wreck agent.
//
// Three landmarks from the hard-hat era, all procedural: a capsized fishing skiff in
// the shallows, an iron trawler broken in two in the twilight, and a crushed
// submersible in the abyss. Every wreck is built once at load and baked down to a
// handful of merged meshes (one per material, diver.js's Part idiom), so a wreck
// costs ~6 draw calls no matter how many rivets, planks and net strands it carries.
//
// Motion is shader-side: silt dust drifting through the hulls and the net's sway read
// off one shared uTime uniform, so updateWrecks() only writes a few floats and pulses
// three relic sprites. No allocation happens after build.
//
// Contract with game.js:
//   buildWrecks()             — once at world build.
//   reseedWrecks(toolsOwned)  — THE CHART: dispose + rebuild against the site current at
//                               call time. toolsOwned = {sonar,spear,thruster} booleans;
//                               a relic whose tool is already owned builds pre-taken.
//                               wreckColliders is emptied and repushed IN PLACE (game.js/
//                               player.js hold the array reference, not a copy).
//   updateWrecks(dt, t)       — ambient animation (sway, dust, glow).
//   wreckColliders            — array of {x,y,z,r} spheres, same shape as rockColliders;
//                               game.js adds them to the camera probe and player push-out.
//   wreckSites()              — the 3 site records (flora's exclusion read); returns the
//                               NEW sites once reseedWrecks has run.
//   nearRelic(pos)            — {zi, tool} if the player is within reach of an untaken
//                               relic ('sonar'|'spear'|'thruster'), else null.
//   takeRelic(zi)             — claims it (hides the relic prop, plays local VFX); returns
//                               the tool name or null if already taken.
//   setKeepsakeState(taken3)  — CHART V2: this site's per-wreck keepsake taken flags.
//                               No keepsakes at site 0; at remote sites builds/hides one
//                               small unbeaconed prop per wreck beside the relic berth.
//   nearKeepsake(pos)         — {zi} within RELIC_REACH of a present, untaken keepsake.
//   takeKeepsake(zi)          — hides it, returns { line } — the previous owner, in one
//                               line, or at THE UNSOUNDED SHELF something older.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera, envTex } from '../core.js';
import { WORLD_R, riftPos, zoneTop, zoneBottom } from '../config.js';
import { rng, clamp, fbm, V3 } from '../lib/math.js';
import { makeGlow, canvas2d, toTexture, noiseCanvas, normalFromHeight } from '../lib/textures.js';
import { terrainH, terrainNormal } from './terrain.js';
import { player } from '../player.js';
import { siteParams, currentSiteIndex } from './site.js';
import { keepsakeKind, keepsakeGeo } from '../lib/keepsakes.js';

const TAU = Math.PI * 2;
const UP = V3(0, 1, 0);
const _o = new THREE.Object3D();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const IDQ = new THREE.Quaternion();
const _v = V3();

export const wreckColliders = [];

// Reach for the [E] prompt, and how far the relic's halo carries.
const RELIC_REACH = 4.2;

// One shared uniform block: the whole ambient layer animates off two writes per frame.
const uni = { uTime: { value: 0 }, uFogD: { value: 0.016 } };

// ---------------------------------------------------------------- textures ---
// One height field per material drives albedo, roughness and normal together, so wear
// lands in the crevices the normal map actually shows (same approach as diver.js).

function shade(ctx, S, hd, lo, hi, contrast) {
  const img = ctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const h = Math.pow(hd[i * 4] / 255, contrast);
    img.data[i * 4] = (lo[0] + (hi[0] - lo[0]) * h) * 255;
    img.data[i * 4 + 1] = (lo[1] + (hi[1] - lo[1]) * h) * 255;
    img.data[i * 4 + 2] = (lo[2] + (hi[2] - lo[2]) * h) * 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

// Waterlogged planking: long grain, split seams, a scatter of worm bore.
function woodMaps(S = 256) {
  const hc = noiseCanvas(S, 4, 1.0);
  const h = hc.getContext('2d');
  h.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 260; i++) {           // grain runs along the plank (x)
    const y = Math.random() * S, l = rng(30, S);
    h.strokeStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.20)' : 'rgba(255,255,255,.13)';
    h.lineWidth = rng(0.6, 2.6);
    h.beginPath();
    const x0 = Math.random() * S;
    h.moveTo(x0, y);
    h.bezierCurveTo(x0 + l * 0.33, y + rng(-3, 3), x0 + l * 0.66, y + rng(-3, 3), x0 + l, y + rng(-2, 2));
    h.stroke();
  }
  for (let i = 0; i < 40; i++) {            // worm bore / rot pits
    const x = Math.random() * S, y = Math.random() * S, r = rng(1.5, 5);
    const gr = h.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,.6)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = gr; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas, ctx } = canvas2d(S);
  shade(ctx, S, hd, [0.26, 0.205, 0.145], [0.78, 0.63, 0.42], 1.15);
  return {
    map: toTexture(canvas, 3, true),
    normalMap: toTexture(normalFromHeight(hc, 1.6), 3)
  };
}

// Sheet iron: blistered rust, weld seams, streaks running with gravity (v).
function ironMaps(S = 256) {
  const hc = noiseCanvas(S, 5, 1.15);
  const h = hc.getContext('2d');
  for (let i = 0; i < 150; i++) {           // rust blisters
    const x = Math.random() * S, y = Math.random() * S, r = rng(3, 16);
    const gr = h.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.42)'); gr.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = gr; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  for (let i = 0; i < 70; i++) {            // vertical bleed streaks
    const x = Math.random() * S, y = Math.random() * S, l = rng(20, 110);
    h.strokeStyle = 'rgba(255,255,255,.16)';
    h.lineWidth = rng(1, 5);
    h.beginPath(); h.moveTo(x, y); h.lineTo(x + rng(-4, 4), y + l); h.stroke();
  }
  for (let i = 0; i < 90; i++) {            // pitting
    const x = Math.random() * S, y = Math.random() * S, r = rng(1, 4);
    h.fillStyle = 'rgba(0,0,0,.5)';
    h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas, ctx } = canvas2d(S);
  shade(ctx, S, hd, [0.155, 0.170, 0.190], [0.86, 0.50, 0.24], 1.0);
  return {
    map: toTexture(canvas, 4, true),
    normalMap: toTexture(normalFromHeight(hc, 2.2), 4)
  };
}

// Tarnished brass: fine turning marks with verdigris settled into the lows.
function brassMaps(S = 128) {
  const hc = noiseCanvas(S, 4, 1.0);
  const h = hc.getContext('2d');
  for (let i = 0; i < 120; i++) {
    const y = Math.random() * S;
    h.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.2)';
    h.lineWidth = rng(0.5, 1.4);
    h.beginPath(); h.moveTo(0, y); h.lineTo(S, y + rng(-2, 2)); h.stroke();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas, ctx } = canvas2d(S);
  shade(ctx, S, hd, [0.30, 0.31, 0.20], [1.0, 0.79, 0.36], 1.0);
  return { map: toTexture(canvas, 2, true), normalMap: toTexture(normalFromHeight(hc, 1.2), 2) };
}

// ---------------------------------------------------------------- materials --
// Silt settles on upward faces and downward faces fall away — the same trick props.js
// and flora.js use, so wrecks sit in the identical lantern-lit material family.
const F_SILT = `
float up = inverseTransformDirection(normal, viewMatrix).y;
diffuseColor.rgb = mix(diffuseColor.rgb, uSilt, smoothstep(0.30, 0.95, up) * 0.42);
diffuseColor.rgb *= mix(0.40, 1.0, smoothstep(-0.85, 0.25, up));`;

const SILT = [new THREE.Color(0x1d2a35), new THREE.Color(0x241e33), new THREE.Color(0x2b1e19)];

function siltify(m, zi, sway) {
  m.onBeforeCompile = sh => {
    sh.uniforms.uSilt = { value: SILT[zi] };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSilt;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n{' + F_SILT + '\n}');
    if (sway) {
      sh.uniforms.uTime = uni.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
        // Net strands hang from their anchors, so sway grows with how far a vertex sagged.
        float sag = max(-transformed.y, 0.0);
        float w = sag * sag * 0.055;
        transformed.x += sin(uTime * 0.55 + transformed.z * 0.7 + transformed.y) * w;
        transformed.z += cos(uTime * 0.41 + transformed.x * 0.6) * w * 0.8;`);
    }
  };
  m.customProgramCacheKey = () => 'wreck|' + zi + '|' + (sway ? 1 : 0);
  return m;
}

// Height maps AND the material sets built from them are site-invariant — a reseed
// changes the floor and the decorative rng, never the hull's paint. Cache both per zone
// so reseedWrecks rebuilds geometry only: zero texture regeneration, zero shader
// recompiles (customProgramCacheKey would dedupe the compile anyway, but reusing the
// instances outright means there is never a second material to key against).
let MAPS = null;
const PALETTES = new Map();
function palette(zi) {
  if (PALETTES.has(zi)) return PALETTES.get(zi);
  if (!MAPS) MAPS = { wood: woodMaps(), iron: ironMaps(), brass: brassMaps() };
  const std = o => new THREE.MeshStandardMaterial(o);
  const P = {
    wood: siltify(std({
      color: zi === 0 ? 0xffffff : 0xd8cec0, roughness: 0.96, metalness: 0.02,
      vertexColors: true, side: THREE.DoubleSide, ...MAPS.wood
    }), zi),
    iron: siltify(std({
      color: zi === 2 ? 0xe8ddd2 : 0xffffff, roughness: 0.86, metalness: 0.30,
      vertexColors: true, side: THREE.DoubleSide, envMap: envTex, envMapIntensity: 0.18,
      ...MAPS.iron
    }), zi),
    brass: siltify(std({
      color: 0xfff0d0, roughness: 0.42, metalness: 0.88, vertexColors: true,
      envMap: envTex, envMapIntensity: 0.9, ...MAPS.brass
    }), zi),
    rope: siltify(std({
      color: 0xb4a888, roughness: 1.0, metalness: 0.0, vertexColors: true
    }), zi, true),
    glass: siltify(std({
      color: 0x9fd8e8, roughness: 0.14, metalness: 0.1, vertexColors: true,
      emissive: 0x2a5a68, emissiveIntensity: 0.6, transparent: true, opacity: 0.55,
      depthWrite: false,   // transparent glass must not occlude what sorts behind it
      envMap: envTex, envMapIntensity: 0.7
    }), zi),
    lit: new THREE.MeshStandardMaterial({
      color: 0x2a2418, roughness: 0.3, metalness: 0.2, vertexColors: true,
      emissive: 0xffbe6a, emissiveIntensity: 1.5
    })
  };
  for (const k of ['wood', 'iron', 'brass', 'rope', 'glass', 'lit']) P[k].userData.persist = true;
  PALETTES.set(zi, P);
  return P;
}

// ------------------------------------------------------------- geo helpers ---
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(1); _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}

// Bucket primitives by material and emit one merged mesh each. Every geometry is padded
// with a colour attribute so mixed vertex-coloured and plain parts can merge.
function Part(node) {
  const b = new Map();
  return {
    node,
    add(geo, mat) { let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo; },
    bake() {
      for (const [mat, list] of b) {
        for (const g of list) {
          if (!g.attributes.color)
            g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
          if (!g.attributes.uv)
            g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
          if (g.index === null) g.setIndex([...Array(g.attributes.position.count).keys()]);
        }
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list, false) : list[0], mat);
        m.castShadow = false; m.receiveShadow = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

// Grime baked into vertex colours: fbm blotches, darker the lower a vertex sits.
function grime(geo, tone = 1, freq = 0.5, floorY = -99) {
  const pos = geo.attributes.position, n = pos.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const a = fbm(x * freq + 3.1, z * freq - 7.7) - 0.5;
    const b = fbm(y * freq * 2.3 + 11, (x + z) * freq * 2.3) - 0.5;
    let g = tone * (0.86 + a * 0.55 + b * 0.30);
    g *= clamp(0.55 + (y - floorY) * 0.10, 0.55, 1.0);   // buried ends go dark
    g = clamp(g, 0.24, 1.35);
    col[i * 3] = g; col[i * 3 + 1] = g * (0.97 - a * 0.06); col[i * 3 + 2] = g * (0.90 - b * 0.10);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

// Parametric quad-grid surface. fn(u,v) -> [x,y,z]. This is what makes the hulls hulls:
// one continuous skin with plank/strake ribbing folded into the radius.
function grid(nu, nv, fn) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((nu + 1) * (nv + 1) * 3);
  const uvs = new Float32Array((nu + 1) * (nv + 1) * 2);
  const idx = [];
  let k = 0;
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
    const u = i / nu, v = j / nv, p = fn(u, v);
    pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
    uvs[k * 2] = u * 4; uvs[k * 2 + 1] = v * 2;
    k++;
  }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Triangle wave in [0,1] — the plank/strake seam profile.
const tri = x => { const f = x - Math.floor(x); return f < 0.5 ? f * 2 : 2 - f * 2; };

// A sagging line between two points: real catenary droop, which is what sells netting
// and hanging rigging far more than any texture does.
function strand(a, b, sag, rad, seg = 12) {
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const s = Math.sin(Math.PI * t);
    pts.push(V3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - sag * s, a.z + (b.z - a.z) * t));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), seg, rad, 4, false);
}

function rivetRing(p, mat, n, r, y, rad = 0.09, axis = 'y', zs = 1) {
  const g = new THREE.SphereGeometry(rad, 5, 4);
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, c = Math.cos(a) * r, s = Math.sin(a) * r * zs;
    p.add(axis === 'y' ? xf(g.clone(), c, y, s) : xf(g.clone(), y, c, s), mat);
  }
}

// A brass porthole ring facing +Z in its local frame; `lit` swaps the glass for a
// dim ember so a hull can still show one light after everything else has died.
function porthole(p, M, R, x, y, z, ry, lit) {
  const put = g => xf(g, x, y, z, 0, ry, 0);
  p.add(put(new THREE.TorusGeometry(R, R * 0.20, 6, 14)), M.brass);
  p.add(put(new THREE.CylinderGeometry(R * 1.05, R * 1.05, R * 0.3, 14, 1, true).rotateX(Math.PI / 2)), M.brass);
  p.add(put(new THREE.CircleGeometry(R * 0.95, 14).translate(0, 0, 0.02)), lit ? M.lit : M.glass);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    p.add(put(new THREE.SphereGeometry(R * 0.13, 5, 4).translate(Math.cos(a) * R * 1.15, Math.sin(a) * R * 1.15, 0.03)), M.brass);
  }
}

// ------------------------------------------------------------------ dust -----
// Silt hanging in the hull: a static point cloud whose drift is entirely in the vertex
// shader, so the CPU never touches it after build.
function dustCloud(n, sx, sy, sz, color) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(n * 3), par = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = rng(-sx, sx); pos[i * 3 + 1] = rng(0, sy); pos[i * 3 + 2] = rng(-sz, sz);
    par[i * 3] = rng(0.2, 0.75);        // rise rate
    par[i * 3 + 1] = rng(0, TAU);       // phase
    par[i * 3 + 2] = rng(0.4, 1.0);     // size
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aP', new THREE.BufferAttribute(par, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: uni.uTime, uFogD: uni.uFogD, uH: { value: sy }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `uniform float uTime, uH, uFogD; attribute vec3 aP; varying float vA;
      void main(){
        vec3 p = position;
        p.y = mod(p.y + uTime * aP.x * 0.20, uH);
        p.x += sin(uTime * 0.23 + aP.y) * 0.55;
        p.z += cos(uTime * 0.19 + aP.y * 1.7) * 0.45;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        float d = -mv.z;
        gl_PointSize = clamp(aP.z * 34.0 / max(d, 0.6), 1.0, 7.0);
        // fade at both ends of the wrap so recycling never pops
        // uFogD tracks scene.fog.density per frame (house rule for fog:false additive
        // sprites) instead of a hardcoded boot-time density.
        vA = smoothstep(0.0, 0.18, p.y / uH) * (1.0 - smoothstep(0.72, 1.0, p.y / uH)) * exp(-d * uFogD);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 9.0) * vA * 0.55;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  const pts = new THREE.Points(g, m);
  pts.frustumCulled = false;
  return pts;
}

// ------------------------------------------------------------- relic + VFX ---
const relicGeo = new THREE.IcosahedronGeometry(0.34, 1);

// The pickup burst: 40 sprites shot outward on a fixed direction attribute, driven by
// one uniform. Built once per wreck, never allocated again.
function burstFX(color) {
  const N = 40, g = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3), dir = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const a = Math.random() * TAU, c = rng(-1, 1), s = Math.sqrt(1 - c * c), sp = rng(0.5, 1.6);
    dir[i * 3] = Math.cos(a) * s * sp; dir[i * 3 + 1] = (c * 0.6 + 0.5) * sp; dir[i * 3 + 2] = Math.sin(a) * s * sp;
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(dir, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: { value: 1 }, uColor: { value: new THREE.Color(color) } },
    vertexShader: `uniform float uT; attribute vec3 aDir; varying float vA;
      void main(){
        float e = uT * (2.0 - uT);                 // ease-out spread
        vec3 p = aDir * e * 4.0 + vec3(0.0, -uT * uT * 1.2, 0.0);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = clamp(30.0 / max(-mv.z, 0.6), 1.0, 26.0) * (1.0 - uT * 0.6);
        vA = 1.0 - uT;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform vec3 uColor; varying float vA;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float a = exp(-dot(q, q) * 8.0) * vA;
        if (a <= 0.004) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.visible = false;
  return p;
}

// Warm mechanical counterpart to the rifts' cold motes: a slow-turning brass shard with
// two haloes, readable well past the 25u the brief asks for.
function relicMarker(color) {
  const grp = new THREE.Group();
  const core = new THREE.Mesh(relicGeo, new THREE.MeshBasicMaterial({ color: 0xffe6b8, fog: false }));
  grp.add(core);
  const g1 = makeGlow(color, 2.4);
  const g2 = makeGlow(color, 5.0);
  g2.material.opacity = 0.30;
  grp.add(g1, g2);
  grp.userData = { core, g1, g2 };
  return grp;
}

// ------------------------------------------------------------------ hulls ----

// Zone 0 — a capsized clinker-built skiff. The hull is one parametric skin with the
// lapstrake seams folded into its radius, so the planking is real geometry, not a map.
function skiff(M) {
  const grp = new THREE.Group();
  const p = Part(grp);
  const L = 16, B = 3.0, D = 2.1;

  const hullFn = (u, v) => {
    // u: stern(0) -> bow(1); v: port gunwale(0) -> keel(0.5) -> starboard(1)
    const beam = B * Math.pow(Math.sin(Math.PI * (0.10 + u * 0.86)), 0.55) * (1 - 0.10 * u);
    const dep = D * (0.62 + 0.38 * Math.sin(Math.PI * Math.pow(u, 0.75)));
    const phi = (v - 0.5) * Math.PI;
    const cw = Math.sin(phi), ch = -Math.cos(phi);
    // lapstrake: 9 overlapping strakes, each stepping proud of the one below
    const lap = (tri(v * 9) - 0.5) * 0.13;
    const rot = fbm(u * 3.1, v * 3.0) * 0.10;   // waterlogged warp
    const k = 1 + lap + rot;
    return [L * (u - 0.5), ch * dep * k, cw * beam * k];
  };
  const hull = grime(grid(46, 30, hullFn), 1.0, 0.35, -2.4);
  p.add(hull, M.wood);

  // frames (ribs) showing through the open, upturned belly
  for (let i = 1; i < 9; i++) {
    const u = i / 9;
    const pts = [];
    for (let j = 0; j <= 14; j++) {
      const a = hullFn(u, j / 14);
      pts.push(V3(a[0], a[1] * 0.94, a[2] * 0.94));
    }
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 14, 0.10, 4, false), 0.8, 0.6, -2.4), M.wood);
  }
  // keel plus gunwale rails
  {
    const kp = [], gp = [], gs = [];
    for (let i = 0; i <= 20; i++) {
      const u = i / 20;
      const a = hullFn(u, 0.5), b = hullFn(u, 0.0), c = hullFn(u, 1.0);
      kp.push(V3(a[0], a[1] - 0.06, a[2]));
      gp.push(V3(b[0], b[1], b[2])); gs.push(V3(c[0], c[1], c[2]));
    }
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(kp), 22, 0.16, 5, false), 1.05, 0.4, -2.4), M.wood);
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gp), 22, 0.13, 5, false), 0.9, 0.4, -2.4), M.wood);
    p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(gs), 22, 0.13, 5, false), 0.9, 0.4, -2.4), M.wood);
  }
  // transom
  p.add(grime(xf(new THREE.BoxGeometry(0.22, 2.0, 2.0), -L * 0.5 + 0.1, -0.6, 0), 0.8, 0.5, -2.4), M.wood);

  // capsize: rolled onto her port side and heeled over, the way she'd settle
  grp.rotation.x = Math.PI * 0.62;   // roll about her own length
  grp.rotation.z = 0.09;             // slight bow-down trim
  grp.position.y = 2.2;

  // ---- everything below is upright on the seabed, so it lives outside the roll ----
  const deck = new THREE.Group();
  const q = Part(deck);

  // snapped mast: the stump still stepped, the broken length lying across the silt
  {
    const stump = new THREE.CylinderGeometry(0.24, 0.30, 3.2, 9);
    q.add(grime(xf(stump, 5.0, 1.3, 1.6, 0.20, 0, 0.42), 0.9, 0.5, 0), M.wood);
    // jagged break: three splinters
    for (let i = 0; i < 4; i++)
      q.add(grime(xf(new THREE.ConeGeometry(rng(0.05, 0.11), rng(0.5, 1.2), 4), 5.0 + rng(-0.2, 0.2) + 1.2, 2.9, 1.6 + rng(-0.2, 0.2), 0.2, rng(0, 3), 0.42), 0.8, 0.6, 0), M.wood);
    const fallen = new THREE.CylinderGeometry(0.20, 0.26, 9.5, 9);
    q.add(grime(xf(fallen, -3.0, 0.30, 5.4, 0, 0.42, Math.PI / 2 - 0.06), 0.85, 0.4, 0), M.wood);
    for (let i = 0; i < 4; i++)   // mast hoops
      q.add(xf(new THREE.TorusGeometry(0.28, 0.045, 4, 10).rotateY(Math.PI / 2), -6 + i * 2.3, 0.30, 5.4 + (i - 1.5) * 0.0, 0, 0.42, 0), M.brass);
  }

  // scattered crates, plus the one holding the sounding set
  const CRATES = [[-7.4, 0.55, -2.6, 0.6], [-5.9, 0.5, -4.2, 0.5], [6.2, 0.5, -3.0, 0.9], [8.0, 0.45, 0.6, 2.4], [-8.6, 0.5, 1.4, 1.1]];
  for (const [cx, cy, cz, ry] of CRATES) {
    const s = rng(0.85, 1.25);
    q.add(grime(xf(new THREE.BoxGeometry(1.5 * s, 1.05 * s, 1.15 * s), cx, cy * s, cz, rng(-0.12, 0.12), ry, rng(-0.14, 0.14)), 0.95, 0.7, 0), M.wood);
    for (let i = -1; i <= 1; i += 2)   // batten strips
      q.add(grime(xf(new THREE.BoxGeometry(1.55 * s, 0.14, 0.10), cx, cy * s + i * 0.34 * s, cz + 0.60 * s, rng(-0.12, 0.12), ry, rng(-0.14, 0.14)), 0.8, 0.7, 0), M.wood);
  }

  // the relic crate: lid pried off and leaning, the brass sounding set inside
  const RC = V3(3.4, 0, -5.0);
  q.add(grime(xf(new THREE.BoxGeometry(2.2, 1.3, 1.7), RC.x, 0.65, RC.z, 0, -0.35, 0), 1.0, 0.7, 0), M.wood);
  q.add(grime(xf(new THREE.BoxGeometry(2.3, 0.14, 1.8), RC.x + 1.2, 0.9, RC.z - 0.9, 0.5, -0.35, 0.25), 0.9, 0.7, 0), M.wood);

  // sounding set: a brass instrument box with a listening horn and a lead-line reel
  const rel = new THREE.Group();
  rel.position.set(RC.x, 1.42, RC.z);
  rel.rotation.y = -0.35;
  const r = Part(rel);
  r.add(new THREE.BoxGeometry(1.05, 0.62, 0.72), M.brass);
  r.add(xf(new THREE.BoxGeometry(1.10, 0.07, 0.77), 0, 0.33, 0), M.brass);
  rivetRing(r, M.brass, 8, 0.42, 0.30, 0.045);
  // horn
  r.add(xf(new THREE.CylinderGeometry(0.40, 0.12, 0.85, 12, 1, true), 0.15, 0.72, 0.30, -0.5, 0, 0.45), M.brass);
  r.add(xf(new THREE.TorusGeometry(0.40, 0.04, 4, 12), 0.15 + 0.33, 1.06, 0.48, -0.5 + Math.PI / 2, 0, 0.45), M.brass);
  // dial face, faintly alight
  r.add(xf(new THREE.CircleGeometry(0.20, 14), 0, 0.05, 0.37), M.lit);
  r.add(xf(new THREE.TorusGeometry(0.21, 0.035, 4, 14), 0, 0.05, 0.37), M.brass);
  // lead-line reel on the side
  r.add(xf(new THREE.CylinderGeometry(0.24, 0.24, 0.26, 12), -0.62, -0.05, 0, 0, 0, Math.PI / 2), M.brass);
  r.bake();

  q.bake();
  p.bake();

  // ---- the trawl net, still made fast to her, draped off the high gunwale ----
  // Every strand is a real catenary, and the rope material sways them in the vertex
  // shader by how far each vertex sagged, so the mesh drifts without any CPU cost.
  const net = new THREE.Group();
  {
    const nn = Part(net);
    const N = 24, top = [], bot = [];
    for (let i = 0; i < N; i++) {
      const u = i / (N - 1);
      top.push(V3(-5.4 + u * 11.4, 4.55 + Math.sin(u * 3.1) * 0.25, 1.35));
      bot.push(V3(-6.6 + u * 13.6, 0.25 + fbm(u * 4, 1.7) * 0.5, 6.4 + Math.sin(u * 2.2) * 0.9));
    }
    for (let i = 0; i < N; i++) nn.add(strand(top[i], bot[i], 0.95, 0.030, 10), M.rope);
    for (let r = 1; r <= 9; r++) {          // cross courses
      const t = r / 10;
      const row = top.map((a, i) => V3(
        a.x + (bot[i].x - a.x) * t, a.y + (bot[i].y - a.y) * t - 0.95 * Math.sin(Math.PI * t), a.z + (bot[i].z - a.z) * t));
      for (let i = 0; i < N - 1; i++) nn.add(strand(row[i], row[i + 1], 0.07, 0.026, 3), M.rope);
    }
    // head rope with its cork floats, still trying to lift
    for (let i = 0; i < N - 1; i++) nn.add(strand(top[i], top[i + 1], 0.10, 0.055, 4), M.rope);
    for (let i = 0; i < N; i += 5)
      nn.add(xf(new THREE.CylinderGeometry(0.17, 0.17, 0.30, 8), top[i].x, top[i].y + 0.22, top[i].z, Math.PI / 2, 0, 0), M.rope);
    nn.bake();
  }

  const root = new THREE.Group();
  root.add(grp, deck, rel, net);
  root.add(dustCloud(70, 8, 6, 4, 0x9ec8d8));
  return { root, relic: rel };
}

// Zone 1 — an iron trawler torn in half amidships. The gap is a real swimmable
// corridor: the colliders stop at the plating, not at the bounding box.
function trawler(M) {
  const root = new THREE.Group();
  const L = 26, B = 4.6, D = 4.2;

  // Fuller, harder cross-section than the skiff: near-vertical topsides over a
  // slack bilge, which is what makes an iron ship read as iron.
  const hullFn = (u, v) => {
    const beam = B * Math.pow(Math.sin(Math.PI * (0.06 + u * 0.90)), 0.36);
    const dep = D * (0.70 + 0.30 * Math.sin(Math.PI * Math.pow(u, 0.6)));
    const phi = (v - 0.5) * Math.PI;
    const cw = Math.sign(Math.sin(phi)) * Math.pow(Math.abs(Math.sin(phi)), 0.62);
    const ch = -Math.pow(Math.abs(Math.cos(phi)), 1.5) * Math.sign(Math.cos(phi));
    const strake = (tri(v * 7) - 0.5) * 0.05;   // riveted strake laps
    const buckle = fbm(u * 4.0 + 2, v * 2.4) * 0.09;
    const k = 1 + strake + buckle;
    return [L * (u - 0.5), ch * dep * k, cw * beam * k];
  };

  // --- bow half, listing to starboard ---
  const bow = new THREE.Group();
  {
    const p = Part(bow);
    const g = grime(grid(26, 26, (u, v) => hullFn(0.54 + u * 0.46, v)), 1.0, 0.3, -4.5);
    p.add(g, M.iron);
    // torn plating at the break: a ragged fringe of triangles
    for (let i = 0; i < 14; i++) {
      const v = i / 14, a = hullFn(0.54, v + 0.02), b = hullFn(0.54, v);
      const t = new THREE.BufferGeometry();
      const mx = (a[0] + b[0]) * 0.5 - rng(0.3, 1.4);
      t.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        a[0], a[1], a[2], b[0], b[1], b[2], mx, (a[1] + b[1]) * 0.5 + rng(-0.4, 0.4), (a[2] + b[2]) * 0.5 + rng(-0.3, 0.3)
      ]), 3));
      t.computeVertexNormals();
      p.add(grime(t, 0.7, 0.5, -4.5), M.iron);
    }
    // deck plate + bulwark rail with stanchions
    p.add(grime(xf(new THREE.BoxGeometry(11.5, 0.18, B * 1.6), 7.2, 0.05, 0), 0.9, 0.3, -4.5), M.iron);
    for (let i = 0; i < 9; i++) {
      const u = 0.58 + i * 0.045, e = hullFn(u, 0.02);
      for (const s of [1, -1]) {
        p.add(grime(xf(new THREE.CylinderGeometry(0.07, 0.07, 1.1, 6), e[0], 0.55, s * Math.abs(e[2])), 0.8, 0.4, -4.5), M.iron);
      }
    }
    for (const s of [1, -1]) {
      const rp = [];
      for (let i = 0; i <= 10; i++) { const e = hullFn(0.56 + i * 0.044, 0.02); rp.push(V3(e[0], 1.05, s * Math.abs(e[2]))); }
      p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 12, 0.075, 4, false), 0.85, 0.4, -4.5), M.iron);
    }
    // anchor hawse + windlass
    p.add(grime(xf(new THREE.CylinderGeometry(0.5, 0.5, 1.5, 10), 9.0, 0.6, 0, 0, 0, Math.PI / 2), 0.9, 0.4, -4.5), M.iron);
    for (const s of [1, -1]) porthole(Part(bow), M, 0.42, 8.2, -1.2, s * 2.6, s > 0 ? 0.3 : Math.PI - 0.3, false);
    p.bake();
    bow.rotation.x = 0.30;    // heeled to starboard
    bow.rotation.z = -0.12;   // bow lifted where the break holds her up
    bow.rotation.y = 0.10;
    bow.position.set(2.6, 4.3, -0.9);
  }
  root.add(bow);

  // --- stern half, heeled the other way, with the deckhouse and funnel ---
  const stern = new THREE.Group();
  {
    const p = Part(stern);
    p.add(grime(grid(26, 26, (u, v) => hullFn(u * 0.44, v)), 1.0, 0.3, -4.5), M.iron);
    for (let i = 0; i < 14; i++) {
      const v = i / 14, a = hullFn(0.44, v + 0.02), b = hullFn(0.44, v);
      const t = new THREE.BufferGeometry();
      t.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        a[0], a[1], a[2], b[0], b[1], b[2], (a[0] + b[0]) * 0.5 + rng(0.3, 1.5), (a[1] + b[1]) * 0.5 + rng(-0.4, 0.4), (a[2] + b[2]) * 0.5 + rng(-0.3, 0.3)
      ]), 3));
      t.computeVertexNormals();
      p.add(grime(t, 0.7, 0.5, -4.5), M.iron);
    }
    p.add(grime(xf(new THREE.BoxGeometry(11.0, 0.18, B * 1.5), -5.8, 0.05, 0), 0.9, 0.3, -4.5), M.iron);

    // deckhouse
    p.add(grime(xf(new THREE.BoxGeometry(4.6, 2.6, 4.0), -6.0, 1.35, 0), 1.0, 0.5, -4.5), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(5.0, 0.20, 4.4), -6.0, 2.72, 0), 0.85, 0.5, -4.5), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(0.9, 1.7, 0.14), -3.72, 0.90, 0.9), 0.8, 0.6, -4.5), M.iron);   // door
    const ph = Part(stern);
    porthole(ph, M, 0.40, -6.9, 1.7, 2.02, 0, true);
    porthole(ph, M, 0.40, -5.2, 1.7, 2.02, 0, false);
    porthole(ph, M, 0.40, -6.9, 1.7, -2.02, Math.PI, false);
    porthole(ph, M, 0.40, -8.32, 1.5, 0, -Math.PI / 2, false);

    // funnel, tilted where the stays let go
    p.add(grime(xf(new THREE.CylinderGeometry(0.85, 1.0, 4.4, 14, 1, true), -8.6, 4.2, 0.3, 0.16, 0, 0.42), 1.0, 0.4, -4.5), M.iron);
    p.add(grime(xf(new THREE.TorusGeometry(0.86, 0.12, 5, 14), -9.5, 6.2, 0.6, Math.PI / 2 + 0.16, 0, 0.42), 0.9, 0.4, -4.5), M.iron);
    rivetRing(p, M.iron, 14, 1.0, -0.0, 0.07);

    // davits over the side — the boats are long gone
    for (const s of [1, -1]) {
      const c = new THREE.CatmullRomCurve3([
        V3(-3.0, 0.1, s * 3.0), V3(-3.0, 2.0, s * 3.2), V3(-3.1, 2.9, s * 4.2), V3(-3.2, 2.6, s * 5.2)
      ]);
      p.add(grime(new THREE.TubeGeometry(c, 12, 0.11, 5, false), 0.85, 0.5, -4.5), M.iron);
    }
    // railings aft
    for (const s of [1, -1]) {
      const rp = [];
      for (let i = 0; i <= 8; i++) { const e = hullFn(0.05 + i * 0.045, 0.02); rp.push(V3(e[0], 1.05, s * Math.abs(e[2]))); }
      p.add(grime(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 10, 0.075, 4, false), 0.85, 0.4, -4.5), M.iron);
      for (let i = 0; i <= 7; i++) {
        const e = hullFn(0.06 + i * 0.05, 0.02);
        p.add(grime(xf(new THREE.CylinderGeometry(0.06, 0.06, 1.1, 6), e[0], 0.55, s * Math.abs(e[2])), 0.8, 0.4, -4.5), M.iron);
      }
    }
    // rudder + screw
    p.add(grime(xf(new THREE.BoxGeometry(0.25, 2.2, 1.6), -12.6, -1.6, 0, 0, 0, 0.1), 0.85, 0.5, -4.5), M.iron);
    for (let i = 0; i < 3; i++)
      p.add(grime(xf(new THREE.BoxGeometry(0.10, 1.3, 0.55).translate(0, 0.65, 0), -11.6, -2.0, 0, i * 2.09, 0, 0), 0.9, 0.5, -4.5), M.brass);

    // ---- the spear-gun rack against the deckhouse ----
    p.add(grime(xf(new THREE.BoxGeometry(0.16, 1.5, 2.2), -3.60, 0.85, -1.2), 0.9, 0.6, -4.5), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(0.5, 0.12, 2.3), -3.45, 1.45, -1.2), 0.9, 0.6, -4.5), M.iron);
    p.bake();

    stern.rotation.x = -0.34;  // she went over the other way
    stern.rotation.z = 0.10;
    stern.rotation.y = -0.16;
    stern.position.set(-4.0, 4.6, 1.1);
  }
  root.add(stern);

  // relic: a whaling-pattern spear gun racked butt-down
  const rel = new THREE.Group();
  rel.position.set(-3.30, 1.60, -1.20);   // in the stern's frame, propped in its rack
  rel.rotation.set(0.10, 0, 0.38);
  {
    const r = Part(rel);
    r.add(xf(new THREE.CylinderGeometry(0.075, 0.075, 1.9, 10), 0, 0, 0), M.brass);            // barrel
    r.add(xf(new THREE.BoxGeometry(0.22, 0.55, 0.14), 0, -0.75, 0.14), M.brass);               // stock
    r.add(xf(new THREE.CylinderGeometry(0.055, 0.055, 0.42, 8), 0, -1.0, 0.30, 0.5, 0, 0), M.brass); // grip
    r.add(xf(new THREE.TorusGeometry(0.12, 0.026, 4, 12), 0, -0.86, 0.24, Math.PI / 2, 0, 0), M.brass); // trigger guard
    r.add(xf(new THREE.CylinderGeometry(0.028, 0.028, 2.3, 6), 0.0, 0.15, -0.09), M.iron);     // the spear itself
    r.add(xf(new THREE.ConeGeometry(0.07, 0.30, 6), 0.0, 1.45, -0.09), M.iron);
    for (const s of [1, -1]) r.add(xf(new THREE.ConeGeometry(0.045, 0.22, 4), s * 0.045, 1.30, -0.09, 0, 0, s * 0.9), M.iron);  // barbs
    r.add(xf(new THREE.TorusGeometry(0.115, 0.02, 4, 10), 0, 0.55, 0, Math.PI / 2, 0, 0), M.brass);  // muzzle band
    r.add(xf(new THREE.CircleGeometry(0.06, 10), 0, -0.62, 0.215), M.lit);                     // maker's plate, alight
    r.bake();
  }
  stern.add(rel);
  root.add(dustCloud(90, 12, 9, 5, 0xa89ad0));

  return { root, relic: rel };
}

// Zone 2 — a crushed one-atmosphere submersible. The intact half still holds its
// sphere; the other half is folded inward. Everything about the read is pressure.
function submersible(M) {
  const root = new THREE.Group();
  const p = Part(root);
  const R = 2.9;

  // pressure sphere, imploded on the port-forward quarter: vertices inside a crush
  // cone are pulled toward the centre and creased, which is how real steel fails.
  {
    const g = new THREE.SphereGeometry(R, 26, 20);
    const pos = g.attributes.position;
    const dent = V3(-0.55, 0.25, -0.79).normalize();
    for (let i = 0; i < pos.count; i++) {
      _v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      const d = _v.clone().normalize().dot(dent);
      const k = clamp((d - 0.25) / 0.75, 0, 1);
      const crease = 0.30 * Math.sin(_v.y * 4.2) * Math.sin(_v.x * 3.4);
      const s = 1 - (k * k * (3 - 2 * k)) * (0.52 + crease * 0.4) + fbm(_v.x * 1.4, _v.z * 1.4) * 0.05;
      pos.setXYZ(i, _v.x * s, _v.y * s, _v.z * s);
    }
    g.computeVertexNormals();
    p.add(grime(g, 1.0, 0.5, -3.2), M.iron);
  }
  // riveted meridian and equator straps
  for (const yy of [-1.55, 0, 1.55]) {
    const rr = Math.sqrt(Math.max(0.2, R * R - yy * yy));
    p.add(grime(xf(new THREE.TorusGeometry(rr, 0.12, 6, 26), 0, yy, 0, Math.PI / 2), 0.9, 0.5, -3.2), M.iron);
    rivetRing(p, M.iron, 20, rr * 1.03, yy, 0.085);
  }
  p.add(grime(xf(new THREE.TorusGeometry(R * 0.99, 0.11, 6, 26), 0, 0, 0, 0, Math.PI / 2), 0.9, 0.5, -3.2), M.iron);

  // ballast/instrument cylinder running aft, half torn open
  p.add(grime(xf(new THREE.CylinderGeometry(1.5, 1.7, 6.4, 16, 1, true), 0, -0.35, -5.4, Math.PI / 2 + 0.10, 0, 0), 1.0, 0.4, -3.2), M.iron);
  p.add(grime(xf(new THREE.CylinderGeometry(1.72, 1.72, 0.24, 16), 0, -0.95, -8.5, Math.PI / 2, 0, 0), 0.9, 0.4, -3.2), M.iron);
  for (let i = 0; i < 4; i++)
    rivetRing(p, M.iron, 16, 1.62, -1.5 + i * 1.7, 0.085, 'x');
  // split seam peeled back along the cylinder
  for (let i = 0; i < 10; i++) {
    const z = -3.0 - i * 0.55;
    p.add(grime(xf(new THREE.BoxGeometry(0.10, rng(0.5, 1.3), 0.6), rng(1.3, 1.9), rng(0.4, 1.2), z, rng(-0.5, 0.5), 0, rng(-0.8, 0.8)), 0.7, 0.7, -3.2), M.iron);
  }

  // conning tower + hatch, with the dogs still thrown
  p.add(grime(xf(new THREE.CylinderGeometry(0.95, 1.10, 1.5, 14, 1, true), 0, R * 0.86, 0.2), 1.0, 0.5, -3.2), M.iron);
  p.add(grime(xf(new THREE.CylinderGeometry(1.0, 1.0, 0.16, 14), 0, R * 0.86 + 0.78, 0.2), 0.9, 0.5, -3.2), M.iron);
  rivetRing(p, M.iron, 12, 1.03, R * 0.86 + 0.6, 0.075);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU;
    p.add(xf(new THREE.BoxGeometry(0.42, 0.09, 0.13), Math.cos(a) * 1.0, R * 0.86 + 0.88, 0.2 + Math.sin(a) * 1.0, 0, -a, 0), M.brass);
  }

  // one porthole still lit — the whole point of the silhouette
  porthole(p, M, 0.62, 0.2, 0.45, R * 0.94, 0, true);
  porthole(p, M, 0.55, 2.30, 0.10, R * 0.60, 0.9, false);
  porthole(p, M, 0.55, -2.05, -0.35, R * 0.62, -0.9, false);

  // stabiliser fins and a bent skid, so she reads as a vehicle not a boiler
  for (const s of [1, -1]) {
    p.add(grime(xf(new THREE.BoxGeometry(0.14, 1.9, 2.6), s * 1.5, 0.4, -7.2, 0, 0, s * 0.25), 0.9, 0.5, -3.2), M.iron);
    p.add(grime(xf(new THREE.BoxGeometry(0.20, 0.28, 8.6), s * 2.0, -2.6, -3.0, 0.06, 0, s * 0.06), 0.85, 0.5, -3.2), M.iron);
    p.add(grime(xf(new THREE.CylinderGeometry(0.13, 0.13, 1.9, 6), s * 2.0, -1.7, 0.6, 0, 0, s * 0.35), 0.85, 0.5, -3.2), M.iron);
  }
  // severed lifting cable trailing off into the dark
  p.add(strand(V3(0.4, 4.6, 0.2), V3(6.5, 0.4, 4.2), 1.6, 0.055, 14), M.rope);

  p.bake();

  // relic: the finned brass air thruster, a backpack unit lying against the skid
  const rel = new THREE.Group();
  rel.position.set(2.55, 2.25, 1.95);   // propped against the sphere, clear of the silt
  rel.rotation.set(-0.22, 0.7, 0.95);
  {
    const r = Part(rel);
    for (const s of [-1, 1])
      r.add(xf(new THREE.CylinderGeometry(0.36, 0.36, 1.5, 12), s * 0.38, 0, 0), M.brass);   // twin bottles
    for (const s of [-1, 1]) {
      r.add(xf(new THREE.SphereGeometry(0.36, 12, 8, 0, TAU, 0, Math.PI / 2), s * 0.38, 0.75, 0), M.brass);
      r.add(xf(new THREE.SphereGeometry(0.36, 12, 8, 0, TAU, Math.PI / 2, Math.PI / 2), s * 0.38, -0.75, 0), M.brass);
      rivetRing(r, M.brass, 9, 0.38, 0.62, 0.04);
    }
    r.add(xf(new THREE.BoxGeometry(1.20, 0.14, 0.30), 0, 0.52, 0), M.brass);                 // yoke
    r.add(xf(new THREE.CylinderGeometry(0.10, 0.10, 1.05, 8), 0, 0.60, 0, 0, 0, Math.PI / 2), M.brass);
    // the nozzle and its fins
    r.add(xf(new THREE.CylinderGeometry(0.20, 0.34, 0.70, 12, 1, true), 0, -1.05, 0), M.brass);
    for (let i = 0; i < 5; i++)
      r.add(xf(new THREE.BoxGeometry(0.06, 0.55, 0.34).translate(0, 0, 0.24), 0, -1.05, 0, 0, i / 5 * TAU, 0), M.brass);
    r.add(xf(new THREE.TorusGeometry(0.34, 0.045, 4, 14), 0, -1.38, 0, Math.PI / 2), M.brass);
    // regulator dial, faintly alight
    r.add(xf(new THREE.CircleGeometry(0.13, 12), 0, 0.28, 0.40), M.lit);
    r.add(xf(new THREE.TorusGeometry(0.14, 0.03, 4, 12), 0, 0.28, 0.40), M.brass);
    r.add(xf(new THREE.BoxGeometry(0.30, 0.30, 0.16), 0, 0.28, 0.32), M.brass);
    r.bake();
  }
  root.add(rel);
  root.add(dustCloud(60, 6, 7, 6, 0xd0a080));

  return { root, relic: rel };
}

// ------------------------------------------------------------- placement -----
// Deterministic sweep for the flattest spot in the ring the brief allows, so wreck
// coordinates are stable between runs and can be quoted in a bug report.
function findSite(zi, minR, maxR, footprint) {
  const rp = riftPos(zi);
  let best = null;
  for (let ai = 0; ai < 48; ai++) {
    const a = ai / 48 * TAU;
    for (let ri = 0; ri < 9; ri++) {
      const rad = minR + (maxR - minR) * (ri / 8);
      const x = rp.x + Math.cos(a) * rad, z = rp.z + Math.sin(a) * rad;
      if (Math.hypot(x, z) > WORLD_R * 0.72) continue;         // stay off the basin rim
      if (zi === 0 && Math.hypot(x, z) < 55) continue;         // clear of the raft column
      const h0 = terrainH(x, z, zi);
      // Flatness decides where; the highest ground under the footprint decides how deep.
      // Bedding on the mean instead would let a mound swallow the hull whole.
      let dev = 0, hmax = h0;
      for (let k = 0; k < 8; k++) {
        const b = k / 8 * TAU;
        const h = terrainH(x + Math.cos(b) * footprint, z + Math.sin(b) * footprint, zi);
        dev = Math.max(dev, Math.abs(h - h0));
        hmax = Math.max(hmax, h);
      }
      if (!best || dev < best.dev) best = { x, z, y: hmax, dev };
    }
  }
  return best;
}

// ------------------------------------------------------------------ sites ----
// Where each wreck sits and how much ground it claims. `foot` feeds findSite's
// flatness sweep; `clear` is the keep-out radius flora honours (hull + deck
// clutter + net, measured from the authored geometry above).
const SITE_SPEC = [
  { minR: 70, maxR: 135, foot: 9, clear: 12 },
  { minR: 65, maxR: 138, foot: 13, clear: 17 },
  { minR: 62, maxR: 130, foot: 8, clear: 11 }
];

// Deterministic (findSite touches only the terrain field), so flora.js can ask for
// the sites before buildWrecks() has run without forcing a build order.
let SITES = null;
export function wreckSites() {
  if (!SITES) SITES = SITE_SPEC.map((s, zi) => {
    const site = findSite(zi, s.minR, s.maxR, s.foot);
    return { zi, x: site.x, y: site.y, z: site.z, clear: s.clear, site };
  });
  return SITES;
}

// ------------------------------------------------------------------ state ----
const WRECKS = [];
let built = false;

const WRECK_SPEC = [
  { make: skiff, tool: 'sonar', sink: 1.5, tilt: 0.55, glow: 0xffc472, cols: 6 },
  { make: trawler, tool: 'spear', sink: 2.2, tilt: 0.45, glow: 0xffb060, cols: 8 },
  { make: submersible, tool: 'thruster', sink: 1.0, tilt: 0.60, glow: 0xff9a52, cols: 5 }
];

export function buildWrecks() {
  if (built) return;
  built = true;

  // One fresh stream per build, keyed to the current site — layout (which decorative
  // rng call lands where: crates, worm bore, torn plating, splinters, dust) is a pure
  // function of the site, never of how many times this has run before. Every rng() and
  // Math.random() call under the hull builders below already funnels through global
  // Math.random, so redirecting it for the length of this synchronous build seeds the
  // whole tree without touching a single call site. Nothing yields inside this call
  // (no await, no rAF), so no other code can observe the swap.
  const siteRng = siteParams('wrecks').rng;
  const origRandom = Math.random;
  Math.random = siteRng;
  try {
    for (let zi = 0; zi < 3; zi++) {
      const S = WRECK_SPEC[zi];
      const site = wreckSites()[zi].site;
      const M = palette(zi);
      const W = S.make(M);

      const g = new THREE.Group();
      g.add(W.root);
      g.position.set(site.x, site.y - S.sink, site.z);
      // settle into the silt: partially align with the ground so she lies with the slope
      const n = terrainNormal(site.x, site.z, zi);
      _q.setFromUnitVectors(UP, n).slerp(IDQ, 1 - S.tilt);
      g.quaternion.copy(_q.multiply(_q2.setFromAxisAngle(UP, zi * 2.1 + 0.6)));
      g.visible = false;
      scene.add(g);

      // relic marker + burst, parented to the wreck so they inherit the settle transform
      // Marker and burst share the relic's own parent frame, so they follow whatever
      // transform the hull section they sit on already carries.
      const host = W.relic.parent;
      const marker = relicMarker(S.glow);
      marker.position.copy(W.relic.position).y += 0.5;
      host.add(marker);
      const burst = burstFX(S.glow);
      burst.position.copy(W.relic.position);
      host.add(burst);

      // world-space relic position, for the cheap per-frame proximity test
      g.updateMatrixWorld(true);
      const wp = W.relic.getWorldPosition(new THREE.Vector3());

      // hull colliders, authored in the wreck's local frame then baked to world
      const LOC = [
        [[-6, 2.6, 0, 3.4], [-1.5, 2.4, 0, 3.2], [3, 2.2, 0, 3.0], [7, 1.8, 0, 2.4], [-3.0, 0.4, 5.4, 1.2], [5.0, 1.4, 1.6, 1.6]],
        [[8.6, 3.6, -0.8, 3.6], [4.0, 3.4, -0.6, 3.6], [0.4, 3.2, 0.4, 2.6], [-4.4, 3.6, 0.9, 3.8], [-9.0, 3.8, 1.4, 3.6],
         [-6.0, 6.0, 1.1, 2.4], [-9.3, 8.4, 1.5, 1.6], [-12.6, 2.6, 1.1, 2.0]],
        [[0, 0.4, 0.3, 3.1], [0, 0.1, -3.2, 1.9], [0, -0.3, -6.4, 1.8], [0, 3.7, 0.2, 1.2], [0, -0.6, -8.6, 1.5]]
      ][zi];
      for (const [lx, ly, lz, lr] of LOC) {
        _v.set(lx, ly, lz).applyMatrix4(g.matrixWorld);
        wreckColliders.push({ x: _v.x, y: _v.y, z: _v.z, r: lr });
      }

      WRECKS.push({
        zi, grp: g, tool: S.tool, marker, burst, relic: W.relic,
        pos: wp, taken: false, burstT: 2, ph: zi * 2.1,
        // CHART V2: filled in by setKeepsakeState, which game.js calls after every reseed.
        keep: null, keepPos: null, keepLine: null, keepTaken: true
      });
    }
  } finally {
    Math.random = origRandom;
  }
}

// Disposes everything a rebuild would otherwise leak: geometries (every hull is re-carved
// per site) and per-instance materials (marker sprites, burst/dust shaders — none of them
// tagged `persist`). The palette materials (wood/iron/brass/rope/glass/lit) and relicGeo
// carry `persist`/are the shared module-scope primitive, so they survive untouched —
// disposing a material still in use by the next build would blank every future wreck.
function disposeGroup(g) {
  g.traverse(o => {
    if (o.geometry && o.geometry !== relicGeo) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (!m.userData || !m.userData.persist) m.dispose();
    }
  });
}

// THE CHART's reseed path: sail to a new site, the wrecks rebuild on the new floor.
// toolsOwned = {sonar, spear, thruster} — a relic whose tool is already in hand builds
// pre-taken (prop hidden from the start, no pickup burst; that burst is reserved for the
// moment of taking, not for a relic the diver walked in already holding).
export function reseedWrecks(toolsOwned) {
  for (const W of WRECKS) {
    scene.remove(W.grp);
    disposeGroup(W.grp);
  }
  WRECKS.length = 0;
  wreckColliders.length = 0;   // game.js/player.js hold this array's reference, not a copy
  SITES = null;                 // wreckSites() must recompute against the new terrain
  built = false;                 // let buildWrecks() run again through its normal gate

  buildWrecks();

  if (toolsOwned) {
    for (const W of WRECKS) {
      if (toolsOwned[W.tool]) {
        // Reuse takeRelic's hide statements, not the whole function — takeRelic() also
        // arms the pickup burst, which would fire on a relic nobody just picked up.
        W.taken = true;
        W.relic.visible = false;
        W.marker.visible = false;
      }
    }
  }
}

// ------------------------------------------------------------------ frame ----
export function updateWrecks(dt, t) {
  if (!built) return;
  uni.uTime.value = t;
  if (scene.fog) uni.uFogD.value = scene.fog.density;
  const cy = camera.position.y;
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    // Zone gating: nothing is visible from the neighbouring zone anyway, and this keeps
    // three wrecks' worth of geometry out of the culler for most of the game.
    const vis = cy < zoneTop(W.zi) + 110 && cy > zoneBottom(W.zi) - 130;
    W.grp.visible = vis;
    if (!vis) continue;
    if (!W.taken) {
      const u = W.marker.userData;
      const s = 1 + 0.16 * Math.sin(t * 1.7 + W.ph);
      u.core.rotation.y += dt * 0.8;
      u.core.rotation.x += dt * 0.31;
      u.g1.scale.setScalar(2.4 * s);
      u.g2.scale.setScalar(5.0 * (1.9 - s * 0.85));
      u.g2.material.opacity = 0.22 + 0.10 * Math.sin(t * 1.15 + W.ph);
    }
    // The keepsake's only motion: a turn so slow it is barely a tell, and no light at all.
    if (W.keep && !W.keepTaken) W.keep.rotation.y += dt * 0.16;
    if (W.burstT < 1) {
      W.burstT += dt * 0.9;
      W.burst.material.uniforms.uT.value = W.burstT;
      if (W.burstT >= 1) W.burst.visible = false;
    }
  }
}

// --------------------------------------------------------------- gameplay ----

// ---------------------------------------------------------------- keepsakes ---
// CHART V2. At the home mooring the relics are still in their berths and there is nothing
// else to find. At every REMOTE site the berth was emptied long before Sal got there — the
// tools are already in his hands — and what is left beside it is the small thing the
// previous chart-owner carried and did not take home. One per wreck, one line each.
//
// Deliberately UNBEACONED: no marker sprite, no halo, no glow of any kind, unlike the
// relics. A relic is a landmark the chart promises you; a keepsake is only found by being
// at the wreck and looking down. It reads at ~6 units off silhouette alone, which is why
// the shapes are taken at 2.2x their true size at the berth (1.0x on the raft shelf, where
// the eye is half a metre away).
const KEEP_SCALE = 2.2;
// Where the keepsake sits relative to the relic berth: a stride off it, laid down rather
// than stowed. Parented to the relic's own host, so it inherits the wreck's settle tilt.
const KEEP_OFF = [0.46, 0.10, 0.42];

// The lines. Sites 1 and 2 are one man, the owner whose chart Sal is now inking, told in
// nine words at a time and never in the first person — he does not get to speak, he only
// gets to have left things.
//
// SITE 3 IS NOT HIS. THE UNSOUNDED SHELF reads 'NO SOUNDINGS. THE OWNER NEVER CAME.' — so
// its berths carry things that were down there before any chart was drawn, and the lines
// have to say so without ever explaining it.
const KEEP_LINE = [
  null,
  [
    'A PIPE, BITTEN THROUGH. HE WAITED BADLY.',
    'A WATCH, STOPPED AT SLACK WATER. HE NEVER WOUND IT AGAIN.',
    'A TIN CUP, SCOURED THIN. HE TOOK HIS RATION COLD, AND ALONE.'
  ],
  [
    'A CLASP KNIFE, FOLDED SHUT. HE CUT HIMSELF FREE ONCE, AND KEPT IT.',
    'A BRASS BUTTON OFF A COAT HE DID NOT COME BACK FOR.',
    'A TOBACCO TIN OF ASH. HE WAS KEEPING SOMETHING BURNT.'
  ],
  [
    "A DOLL'S HEAD, SALT-WHITE. NO BOAT IN THIS REGISTER CARRIED CHILDREN.",
    'A COIN STRUCK WITH NO FACE AND NO YEAR. IT IS NOT WORN. IT WAS MADE SO.',
    'A KEY OF BLACK GLASS. THE OWNER NEVER CAME. SOMETHING ELSE DID.'
  ]
];

// Called by game.js after every reseedWrecks, with this site's per-wreck taken flags.
// Idempotent: builds the prop once per wreck build, then only toggles visibility.
export function setKeepsakeState(taken3) {
  if (!built) return;
  const si = currentSiteIndex();
  const lines = KEEP_LINE[si];
  for (const W of WRECKS) {
    const kind = lines ? keepsakeKind(si, W.zi) : null;
    const want = !!kind && !(taken3 && taken3[W.zi]);
    if (want && !W.keep) {
      const grp = new THREE.Group();
      const P = Part(grp);
      const M = palette(W.zi);
      // ONE material, so the whole keepsake is one draw call. Brass is the right read for
      // a thing a man kept in a pocket for years, and the odd one out (the doll, the glass
      // key) gains from being the same dull metal as everything else down here.
      for (const g of keepsakeGeo(kind, KEEP_SCALE)) P.add(g, M.brass);
      P.bake();
      const host = W.relic.parent;
      grp.position.copy(W.relic.position)
        .add(_v.set(KEEP_OFF[0], KEEP_OFF[1], KEEP_OFF[2]));
      grp.rotation.y = W.zi * 1.9 + 0.4;
      host.add(grp);
      W.grp.updateMatrixWorld(true);
      W.keep = grp;
      W.keepPos = grp.getWorldPosition(new THREE.Vector3());
      W.keepLine = lines[W.zi];
    }
    if (W.keep) { W.keep.visible = want; W.keepTaken = !want; }
  }
}

// Reach test, the relic's own pattern and the relic's own reach.
export function nearKeepsake(pos) {
  if (!built) return null;
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    if (!W.keep || W.keepTaken || !W.keep.visible) continue;
    const dx = pos.x - W.keepPos.x, dy = pos.y - W.keepPos.y, dz = pos.z - W.keepPos.z;
    if (dx * dx + dy * dy + dz * dz < RELIC_REACH * RELIC_REACH) return { zi: W.zi };
  }
  return null;
}

export function takeKeepsake(zi) {
  const W = WRECKS.find(w => w.zi === zi);
  if (!W || !W.keep || W.keepTaken) return null;
  W.keepTaken = true;
  W.keep.visible = false;
  return { line: W.keepLine };
}

export function nearRelic(pos) {
  if (!built) return null;
  for (let i = 0; i < WRECKS.length; i++) {
    const W = WRECKS[i];
    if (W.taken) continue;
    const dx = pos.x - W.pos.x, dy = pos.y - W.pos.y, dz = pos.z - W.pos.z;
    if (dx * dx + dy * dy + dz * dz < RELIC_REACH * RELIC_REACH) return { zi: W.zi, tool: W.tool };
  }
  return null;
}

export function takeRelic(zi) {
  const W = WRECKS.find(w => w.zi === zi);
  if (!W || W.taken) return null;
  W.taken = true;
  W.relic.visible = false;
  W.marker.visible = false;
  W.burst.visible = true;
  W.burstT = 0;
  W.burst.material.uniforms.uT.value = 0;
  return W.tool;
}

// Dev/automation surface, namespaced so it can't collide with the harness globals.
window.wrecks = {
  goto(zi) {
    const W = WRECKS[zi];
    if (!W) return 'no wreck ' + zi;
    player.pos.set(W.pos.x + 1.4, W.pos.y + 1.6, W.pos.z + 1.4);
    player.vel.set(0, 0, 0);
    return `wreck ${zi} @ ${W.pos.x.toFixed(1)}, ${W.pos.y.toFixed(1)}, ${W.pos.z.toFixed(1)}`;
  },
  // Park the diver at discovery range, looking at the silhouette through the fog.
  view(zi, dist = 45) {
    const W = WRECKS[zi];
    if (!W) return 'no wreck ' + zi;
    player.pos.set(W.pos.x + dist * 0.8, W.pos.y + 9, W.pos.z + dist * 0.6);
    player.vel.set(0, 0, 0);
    return 'viewing ' + zi;
  },
  list: () => WRECKS.map(W => ({
    zi: W.zi, tool: W.tool, taken: W.taken,
    x: +W.pos.x.toFixed(1), y: +W.pos.y.toFixed(1), z: +W.pos.z.toFixed(1)
  })),
  near: p => nearRelic(p || player.pos),
  // CHART V2: what the keepsake layer thinks is out there, for the same reason `list` exists.
  keeps: () => WRECKS.map(W => ({
    zi: W.zi, has: !!W.keep, taken: W.keepTaken, shown: !!W.keep && W.keep.visible,
    line: W.keepLine,
    x: W.keepPos && +W.keepPos.x.toFixed(1), y: W.keepPos && +W.keepPos.y.toFixed(1),
    z: W.keepPos && +W.keepPos.z.toFixed(1)
  })),
  nearKeep: p => nearKeepsake(p || player.pos),
  // Park the diver right on a keepsake, the way goto() parks him on a relic.
  gotoKeep(zi) {
    const W = WRECKS[zi];
    if (!W || !W.keepPos) return 'no keepsake ' + zi;
    player.pos.set(W.keepPos.x + 0.8, W.keepPos.y + 0.9, W.keepPos.z + 0.8);
    player.vel.set(0, 0, 0);
    return `keepsake ${zi} @ ${W.keepPos.x.toFixed(1)}, ${W.keepPos.y.toFixed(1)}, ${W.keepPos.z.toFixed(1)}`;
  },
  colliders: () => wreckColliders.slice()
};
