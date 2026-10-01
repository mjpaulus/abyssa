// The Mark V diver: model, materials, and pose animation. OWNED BY: diver/character agent.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { scene, envTex } from '../core.js';
import { SURFACE_Y } from '../config.js';
import { registerPaint, styleUniforms } from '../lib/paint.js';
// The deck is a MOVING GROUND. A stance anchor claimed on planks is stored relative to
// raft.position so it heaves and surges with the boat; a world-space anchor would leave
// the boot hanging in the air on the first swell. (No cycle: raft.js does not import us.)
import { raft, pumpPos } from '../systems/raft.js';
import { V3, clamp, lerp, rng, fbm } from '../lib/math.js';
// Exhaust bubbles die INTO the swell, not at a flat plane; survival's air fraction
// drives the breath cadence. (No cycles: neither module imports the diver.)
import { surfaceHeightAt, stormLevel, surfaceBoil } from '../world/water.js';
import { survival } from '../systems/survival.js';
// Per-foot ground height on the seabed (slope adaptation). terrain.js does not import us.
import { terrainH } from '../world/terrain.js';
import { makeGlow, canvas2d, toTexture, noiseCanvas, normalFromHeight, twillSet, castSet, dropletSet, braidSet, canvasSet } from '../lib/textures.js';
// SALSCULPT HOOK (1/2): the pipeline-built Mark V swaps onto this rig when assets/sal loads
import { installSalSculpt } from './salInstall.js';

const TAU = Math.PI * 2;
const ss = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Semi-implicit spring used for every bit of secondary motion (helmet lag, hose sway,
// lantern pendulum). dt is clamped so a stalled frame can't blow the integrator up.
function spring(s, target, dt, freq, damp) {
  const h = Math.min(dt, 0.022), k = freq * freq, c = 2 * damp * freq;
  s.v += (k * (target - s.x) - c * s.v) * h;
  s.x += s.v * h;
  return s.x;
}

// Catmull-Rom over a wrapping [phase, value] key list, so the gait is authored as real
// animation curves (contact / absorb / passing / push-off) instead of stacked sines.
function curve(keys) {
  const n = keys.length;
  return p => {
    p -= Math.floor(p);
    let i = 0;
    while (i < n && keys[i][0] <= p) i++;
    const i1 = (i - 1 + n) % n, i2 = i % n, i0 = (i1 - 1 + n) % n, i3 = (i2 + 1) % n;
    const t0 = keys[i1][0];
    let t1 = keys[i2][0];
    if (t1 <= t0) t1 += 1;
    let d = p - t0; if (d < 0) d += 1;
    const u = d / (t1 - t0);
    const v0 = keys[i0][1], v1 = keys[i1][1], v2 = keys[i2][1], v3 = keys[i3][1];
    return 0.5 * (2 * v1 + (v2 - v0) * u + (2 * v0 - 5 * v1 + 4 * v2 - v3) * u * u + (-v0 + 3 * v1 - 3 * v2 + v3) * u * u * u);
  };
}

// ---- THE LEG RIG ----
// Declared up here because the boot is built against them (the build runs before the gait
// block below). Keep them LITERALS: salSculpt.readRig parses them out of this source.
// THE ANKLE (2026-10-01, Michael: "fix the ankle rig so his stride lengthens"). The ankle
// joint sat 0.3665 above the sole, 26% of the 1.3935 hip-to-sole leg (a man's is ~8-10%):
// the joint was up at mid-shin, inside the gaiter, and every degree of foot pitch swung the
// sole round a 37 cm lever. Heel-off then pushed the ankle FORWARD 0.25 u and lifted it only
// 0.05, so the ball rocker gave the stance leg almost no extra reach and the stride could not
// lengthen without the pelvis bouncing. It now sits 0.15 above the sole (10.8%), inside the
// boot over the heel, with the shin 0.2165 longer: same hip-to-sole leg, same LIFT.
// THE THIGH (salprop, 2026-10-01): 0.562 -> 0.668. Hip-to-sole 1.39 -> 1.50 (+8% of the leg), all of it in
// the femur: the thigh was 0.68 of knee-to-sole (a man's is ~0.86) — a low knee under a short thigh, the
// proportion of a toy. The shank, the ankle and the boot are unchanged.
const UP_L = 0.668, LO_L = 0.6815, HIP_X = 0.225;
// THE HARD-HAT SCALE (salprop). The bonnet read 0.54 m wide (a Mark V's is ~0.43) and the breastplate
// as wide again: the biggest remaining toy cue. Helmet and corselet are built (and sculpted) at their old
// size and shrunk as one group, the corselet about the SHOULDER LINE (spine y CORS_Y), so the arm pivots
// keep their height and the brass comes down over them; the neck pivot follows the collar. Literals: the
// sculpt pipeline parses them (salSculpt readRig) and the installer refuses a bake made to another scale.
const HELM_S = 0.85, CORS_Y = 0.615;
// The lead sole plate's UNDERSIDE in the ankle frame — the IK plants on exactly this.
const SOLE_Y = -0.15;
// How far the boot rose up the ankle frame when the ankle came down (the boot was authored
// against the old -0.3665 sole and its parts are placed off that: old y + BOOT_D).
const BOOT_D = 0.3665 + SOLE_Y;

// Shared per-frame uniforms, written by updateDiver (two/three float writes a frame):
// uSalWet (dress soak 0..1), uSalRootY (sole height, world), uSalDrop (beads on the glass).
export const salShared = { uSalWet: { value: 0 }, uSalRootY: { value: 0 }, uSalDrop: { value: 0.15 },
  // (salprop) breath fogging the inside of the front light (0..1, the glass shader), the hands'
  // pose weights [relax, grip, knife, spread] per side, and what the face inside is looking at
  uSalFog: { value: 0 },
  hand: { L: new Float32Array([1, 0, 0, 0]), R: new Float32Array([0, 1, 0, 0]) },
  face: { have: false, x: 0, y: 0, z: 0, stress: 0, swim: 0 } };

// ---- procedural PBR maps ----
// One height field drives albedo, roughness and normal together, so verdigris and wear
// land in the same crevices the normal map actually shows.
function metalMaps(hi, lo, verd, rep, S = 256) {
  // Feature counts scale with canvas AREA and feature sizes with edge length, so a
  // 512 helmet set is the same brass, just resolved — not a sparser, finer one.
  const K = S / 256;
  const hc = noiseCanvas(S, 5, 1.0);
  const h = hc.getContext('2d');
  for (let i = 0; i < 90 * K * K; i++) {  // hammer dents
    const x = Math.random() * S, y = Math.random() * S, r = rng(5, 20) * K;
    const gr = h.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, Math.random() < 0.6 ? 'rgba(0,0,0,.34)' : 'rgba(255,255,255,.3)');
    gr.addColorStop(1, 'rgba(128,128,128,0)');
    h.fillStyle = gr; h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  h.lineCap = 'round';
  for (let i = 0; i < 240 * K * K; i++) {  // hairline scratches
    const x = Math.random() * S, y = Math.random() * S, a = rng(-0.45, 0.45) + (Math.random() < 0.5 ? 0 : 1.57), l = rng(8, 72) * K;
    h.strokeStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.24)' : 'rgba(0,0,0,.24)';
    h.lineWidth = rng(0.5, 1.7) * K;
    h.beginPath(); h.moveTo(x, y); h.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); h.stroke();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const pd = noiseCanvas(S, 2, 1.0).getContext('2d').getImageData(0, 0, S, S).data;  // patchiness
  const { canvas: ac, ctx: a } = canvas2d(S);
  const { canvas: rc, ctx: r } = canvas2d(S);
  const ai = a.createImageData(S, S), ri = r.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = hd[i * 4] / 255, patch = pd[i * 4] / 255;
    const cav = 1 - ss(0.30, 0.56, v);                       // cavity mask
    const green = cav * ss(0.42, 0.78, patch);               // verdigris only in patchy crevices
    let c = mix3(lo, hi, ss(0.34, 0.86, v));
    c = mix3(c, verd, green * 0.8);
    ai.data[i * 4] = c[0]; ai.data[i * 4 + 1] = c[1]; ai.data[i * 4 + 2] = c[2]; ai.data[i * 4 + 3] = 255;
    const rough = clamp(0.16 + 0.52 * cav + 0.30 * green + 0.10 * (1 - v), 0, 1) * 255;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough; ri.data[i * 4 + 3] = 255;
  }
  a.putImageData(ai, 0, 0); r.putImageData(ri, 0, 0);
  return { map: toTexture(ac, rep, true), rough: toTexture(rc, rep), nrm: toTexture(normalFromHeight(hc, 2.6), rep) };
}

function grainMaps(base, hi, rep, wet, S = 128) {
  const hc = noiseCanvas(S, 5, 1.4);
  const h = hc.getContext('2d');
  for (let i = 0; i < 700; i++) {                            // pebble grain
    const x = Math.random() * S, y = Math.random() * S, r = rng(1, 3.2);
    h.fillStyle = `rgba(${Math.random() < 0.5 ? 30 : 225},128,128,.14)`;
    h.beginPath(); h.arc(x, y, r, 0, TAU); h.fill();
  }
  const hd = h.getImageData(0, 0, S, S).data;
  const { canvas: ac, ctx: a } = canvas2d(S);
  const { canvas: rc, ctx: r } = canvas2d(S);
  const ai = a.createImageData(S, S), ri = r.createImageData(S, S);
  for (let i = 0; i < S * S; i++) {
    const v = hd[i * 4] / 255;
    const c = mix3(base, hi, ss(0.52, 0.95, v));             // worn/scuffed on the raised grain
    ai.data[i * 4] = c[0]; ai.data[i * 4 + 1] = c[1]; ai.data[i * 4 + 2] = c[2]; ai.data[i * 4 + 3] = 255;
    const rough = clamp(wet - 0.34 * ss(0.45, 0.95, v), 0, 1) * 255;
    ri.data[i * 4] = ri.data[i * 4 + 1] = ri.data[i * 4 + 2] = rough; ri.data[i * 4 + 3] = 255;
  }
  a.putImageData(ai, 0, 0); r.putImageData(ri, 0, 0);
  return { map: toTexture(ac, rep, true), rough: toTexture(rc, rep), nrm: toTexture(normalFromHeight(hc, 2.2), rep) };
}

// 512 for the two helmet metals only: Sal's helmet is read at ~2 units in close-up and
// 256 was the blur you could see. One-time boot cost; everything else stays 256/128.
const copperM = metalMaps([214, 138, 96], [98, 54, 37], [56, 110, 92], 3, 512);
const brassM = metalMaps([232, 196, 108], [112, 88, 38], [84, 114, 76], 4, 512);
// aged canvas duck: still warm, but pulled off the orange toward a salt-bleached tan-olive
const darkLeaM = grainMaps([96, 56, 32], [148, 98, 58], 2, 0.56);
const rubberM = grainMaps([34, 36, 41], [66, 70, 76], 3, 0.74);

// THE METALS no longer ride their primitives' UVs either (a stud and a bonnet had
// wildly different texel sizes, so small fittings wore giant smeared blotches and read
// as painted). Their maps are sampled TRIPLANAR in the bone's space by the metal shader
// below, which also adds cavity tarnish, polished edges and the bonnet's spun rings.
const copper = new THREE.MeshStandardMaterial({
  metalness: 0.94, roughness: 1, envMap: envTex, envMapIntensity: 0.5
});
const brass = new THREE.MeshStandardMaterial({
  metalness: 0.95, roughness: 1, envMap: envTex, envMapIntensity: 0.62
});
const steel = new THREE.MeshStandardMaterial({
  color: 0x3c4046, metalness: 0.78, roughness: 1, envMap: envTex, envMapIntensity: 0.2
});
// LEAD: the chest weight, the boot soles. Soft, dull, oxide-bloomed; metal, but a dead one.
const castM = castSet();
const lead = new THREE.MeshStandardMaterial({
  metalness: 0.55, roughness: 1, envMap: envTex, envMapIntensity: 0.22
});
const cloth = new THREE.MeshStandardMaterial({
  color: 0x22398c, roughness: 0.92, metalness: 0.02, vertexColors: true, envMap: envTex, envMapIntensity: 0.12
});
const trim = new THREE.MeshStandardMaterial({
  color: 0xe4ddca, roughness: 0.84, metalness: 0.02, envMap: envTex, envMapIntensity: 0.14
});
// the dress proper: rubberised twill, tan drill under a salt-bleached rubber coat
const leather = new THREE.MeshStandardMaterial({
  color: 0x806447, roughness: 0.90, metalness: 0.03, vertexColors: true, envMap: envTex, envMapIntensity: 0.30
});
const darkLeather = new THREE.MeshStandardMaterial({
  map: darkLeaM.map, roughnessMap: darkLeaM.rough, normalMap: darkLeaM.nrm, normalScale: new THREE.Vector2(0.95, 0.95),
  roughness: 1, metalness: 0.04, vertexColors: true, envMap: envTex, envMapIntensity: 0.28
});
const port = new THREE.MeshStandardMaterial({
  color: 0x121519, metalness: 0.55, roughness: 0.42, envMap: envTex, envMapIntensity: 0.3,
  roughnessMap: copperM.rough, normalMap: copperM.nrm, normalScale: new THREE.Vector2(0.3, 0.3)
});
// The regulator's gauge face: aged ivory enamel under glass. It used to be `blueLit`, an
// emissive 0x4db8ff lens at 2.4 plus a blue glow sprite — a prototype leftover that read
// as neon on the back of a brass-age suit (lighting audit). A gauge does not glow; it
// catches the lantern and the column's light like the rest of the brass.
const gaugeFace = new THREE.MeshStandardMaterial({
  color: 0xb9ab88, roughness: 0.28, metalness: 0.0,
  envMap: envTex, envMapIntensity: 0.55
});
const rubber = new THREE.MeshStandardMaterial({
  map: rubberM.map, roughnessMap: rubberM.rough, normalMap: rubberM.nrm, normalScale: new THREE.Vector2(0.8, 0.8),
  roughness: 1, metalness: 0.06, envMap: envTex, envMapIntensity: 0.16
});
// PORT GLASS: thick, wet, and actually glass. Transparent (alpha from a Fresnel term —
// near-clear face-on, a mirror at grazing), over a dark RECESS disc that is merged into
// the same draw (vertex colour black = the helmet's shadowed inside, opaque; it is
// emitted first in each port so the glass blends over it in index order). Beads of
// water sit on it in air (dropletSet, triplanar in the helmet's space), fading as the
// dress dries. Front faces only + forceSinglePass: no DoubleSide transparency sorting.
const glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x4f6a63, metalness: 0.0, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04,
  envMap: envTex, envMapIntensity: 0.8, side: THREE.FrontSide, transparent: true, forceSinglePass: true,
  vertexColors: true
});
const lantGlass = new THREE.MeshPhysicalMaterial({
  // the globe is GLASS round a flame, not a lamp shade: faint self-glow only, so the
  // flame cone and its white core read through it instead of one blown-out column
  // (and near-black DIFFUSE: the lamp's own light sits 8 cm from this surface, and a
  // pale diffuse glass caught it as a solid white wall — glass returns specular only)
  color: 0x1a140c, metalness: 0, roughness: 0.06, transparent: true, opacity: 0.30,
  emissive: 0xffca7a, emissiveIntensity: 0.18, side: THREE.DoubleSide, depthWrite: false, forceSinglePass: true,
  envMap: envTex, envMapIntensity: 0.8
});
// THE FEED HOSE: braided canvas over rubber (braidSet, on the tube's own UVs: u along,
// v round — v repeats by an integer so the braid closes), and it WETS like the dress:
// darker and glossy under water, drying on deck on the same uSalWet clock.
const braidM = braidSet();
for (const t of [braidM.map, braidM.rough, braidM.nrm]) t.repeat.set(7, 4);
const hoseMat = new THREE.MeshStandardMaterial({
  map: braidM.map, roughnessMap: braidM.rough, normalMap: braidM.nrm, normalScale: new THREE.Vector2(1.2, 1.2),
  roughness: 1, metalness: 0.02, envMap: envTex, envMapIntensity: 0.3
});
// ---- THE METAL SHADER ----
// Shared by copper, brass, steel and lead (one program; everything else is uniforms).
//  - triplanar albedo/roughness/normal from the metal's generated set, one texel size on
//    every fitting (uMetTile per unit, in the bone's space);
//  - CAVITY: baked per vertex (salCav.x, 0 open .. 1 crevice) where a fitting meets the
//    surface it is mounted on, plus screen-space CONCAVE curvature. Tarnish darkens,
//    verdigris (or lead's white oxide) blooms, the surface goes dead and rough;
//  - EDGES: screen-space CONVEX curvature (dN.dP / dP.dP ~ 1/radius) polishes every
//    rim, bolt head and wing to bright metal — the hands and the hose rub them bare;
//  - SPUN (salCav.y = 1 on the bonnet): the concentric lathe rings a spun dome carries,
//    as a roughness stretch plus a fine relief, faded out before it can alias.
// No backticks anywhere in this GLSL.
const MET_VS_COMMON = `
attribute vec2 salCav;
varying vec3 vMetP; varying vec3 vMetN; varying vec2 vMetC;`;
const MET_FS_COMMON = `
uniform sampler2D tMetA; uniform sampler2D tMetR; uniform sampler2D tMetN;
uniform float uMetTile; uniform float uMetNs; uniform float uMetAlbK; uniform float uMetEdge; uniform float uMetPaint;
uniform vec3 uMetTarn; uniform vec3 uMetVerd; uniform float uPaintK;
uniform mat3 normalMatrix;
varying vec3 vMetP; varying vec3 vMetN; varying vec2 vMetC;
vec4 metTri(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
vec3 metBump(vec3 sp, vec3 sn, vec2 dh) {
  vec3 sx = normalize(dFdx(sp)); vec3 sy = normalize(dFdy(sp));
  vec3 r1 = cross(sy, sn); vec3 r2 = cross(sn, sx);
  float det = dot(sx, r1);
  return normalize(abs(det) * sn - sign(det) * (dh.x * r1 + dh.y * r2));
}
vec3 metNo; vec3 metW; vec3 metPp; float metCav; float metEdge; float metVg; float metSg;`;
const MET_FS_COLOR = `
metNo = normalize(vMetN);
metW = pow(abs(metNo), vec3(4.0)); metW /= (metW.x + metW.y + metW.z);
metPp = vMetP * uMetTile;
{
  vec3 alb = metTri(tMetA, metPp, metW).rgb;
  diffuseColor.rgb *= mix(vec3(1.0), alb, uMetAlbK);
  vec3 vp = -vViewPosition; vec3 dpx = dFdx(vp); vec3 dpy = dFdy(vp);
  vec3 nv = normalize(vNormal); vec3 dnx = dFdx(nv); vec3 dny = dFdy(nv);
  float curv = (dot(dnx, dpx) + dot(dny, dpy)) / max(dot(dpx, dpx) + dot(dpy, dpy), 1e-9);
  metEdge = smoothstep(16.0, 60.0, curv);
  float conc = 1.0 - smoothstep(-45.0, -10.0, curv);
  metCav = clamp(vMetC.x + conc * 0.5, 0.0, 1.0);
  metVg = smoothstep(0.30, 0.70, metTri(tMetR, vMetP * (uMetTile * 0.31) + 0.21, metW).g);
  diffuseColor.rgb = mix(diffuseColor.rgb, uMetTarn, metCav * 0.72);
  diffuseColor.rgb = mix(diffuseColor.rgb, uMetVerd, metCav * metVg * 0.85);
  diffuseColor.rgb *= 1.0 + uMetEdge * metEdge * (1.0 - metCav);
  float sa = vMetP.y * 820.0;
  metSg = vMetC.y * sin(sa) * (1.0 - smoothstep(0.25, 0.6, fwidth(sa) * 0.16));
}`;
const MET_FS_ROUGH = `
roughnessFactor *= metTri(tMetR, metPp, metW).g;
roughnessFactor = mix(roughnessFactor, 0.88, metCav * (0.55 + 0.4 * metVg));
roughnessFactor *= 1.0 - 0.5 * metEdge * (1.0 - metCav);
roughnessFactor *= 1.0 + 0.14 * metSg;
roughnessFactor = clamp(roughnessFactor, 0.05, 1.0);`;
const MET_FS_METAL = `
metalnessFactor *= 1.0 - 0.75 * metCav * metVg;`;
const MET_FS_NORMAL = `
{
  vec3 tx = texture2D(tMetN, metPp.zy).xyz * 2.0 - 1.0;
  vec3 ty = texture2D(tMetN, metPp.xz).xyz * 2.0 - 1.0;
  vec3 tz = texture2D(tMetN, metPp.xy).xyz * 2.0 - 1.0;
  float ns = uMetNs * (1.0 - 0.65 * uPaintK * uMetPaint);
  vec3 d = metW.x * vec3(0.0, tx.y, tx.x) + metW.y * vec3(ty.x, 0.0, ty.y) + metW.z * vec3(tz.x, tz.y, 0.0);
  normal = normalize(normalMatrix * normalize(metNo + d * ns));
  normal = metBump(-vViewPosition, normal, vec2(dFdx(metSg), dFdy(metSg)) * 0.06);
}`;
function metalize(m, o) {
  const U = {
    tMetA: { value: o.set.map }, tMetR: { value: o.set.rough }, tMetN: { value: o.set.nrm },
    uMetTile: { value: o.tile }, uMetNs: { value: o.ns }, uMetAlbK: { value: o.albK ?? 1 },
    uMetEdge: { value: o.edge }, uMetPaint: { value: o.paint ? 1 : 0 },
    uMetTarn: { value: new THREE.Color(o.tarn) }, uMetVerd: { value: new THREE.Color(o.verd) },
    uPaintK: styleUniforms.uPaintK
  };
  m.userData.salMetal = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + MET_VS_COMMON)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMetP = position; vMetN = normal; vMetC = salCav;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + MET_FS_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + MET_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + MET_FS_ROUGH)
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + MET_FS_METAL)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + MET_FS_NORMAL);
  };
  m.customProgramCacheKey = () => 'salMetal1';
  return m;
}
metalize(copper, { set: copperM, tile: 5.0, ns: 0.22, edge: 0.45, tarn: 0x3a2014, verd: 0x2e5c4c });
metalize(brass, { set: brassM, tile: 6.0, ns: 0.12, edge: 0.55, tarn: 0x4a3a16, verd: 0x557a52 });
metalize(steel, { set: copperM, tile: 3.0, ns: 0.45, albK: 0, edge: 0.6, tarn: 0x2a1a10, verd: 0x3a2a1c, paint: true });
metalize(lead, { set: castM, tile: 4.0, ns: 0.9, edge: 0.12, tarn: 0x9a9890, verd: 0xc4c2b8, paint: true });

// ---- THE GLASS SHADER (port glass only) ----
const GL_FS_COMMON = `
uniform sampler2D tSalDrop; uniform float uSalDropK; uniform float uSalFog;
varying vec3 vGlP; varying vec3 vGlN;
float glDrop; float glFog;`;
// (salprop) BREATH ON THE GLASS: each exhale fogs the inside of the FRONT light a little —
// a soft bloom low in the port where the breath hits it, ragged at the edge, gone again on
// the inhale. Lit like the glass (a pale diffuse film, never emissive), faint: the face
// behind it must stay readable, and the faceplate must never go back to a white disc.
const GL_FS_FOG = `
{
  float front = step(0.30, vGlP.z) * (1.0 - step(0.24, abs(vGlP.x))) * step(0.5, vColor.r);
  vec2 q = vec2(vGlP.x, vGlP.y - 0.405);
  float rag = 0.5 + 0.5 * sin(vGlP.x * 61.0 + sin(vGlP.y * 47.0) * 2.0) * sin(vGlP.y * 53.0 - vGlP.x * 23.0);
  glFog = uSalFog * front * (1.0 - smoothstep(0.03 + 0.05 * uSalFog, 0.11 + 0.05 * uSalFog + 0.025 * rag, length(q)));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.45, 0.44), glFog * 0.75);
}`;
const GL_FS_NORMAL = `
{
  vec3 gn = normalize(vGlN);
  vec3 gw = pow(abs(gn), vec3(4.0)); gw /= (gw.x + gw.y + gw.z);
  vec3 gp = vGlP * 5.5;
  vec4 dx = texture2D(tSalDrop, gp.zy), dy = texture2D(tSalDrop, gp.xz), dz = texture2D(tSalDrop, gp.xy);
  glDrop = (dx.a * gw.x + dy.a * gw.y + dz.a * gw.z) * uSalDropK * step(0.5, vColor.r);
  vec3 d = gw.x * vec3(0.0, dx.y * 2.0 - 1.0, dx.x * 2.0 - 1.0) + gw.y * vec3(dy.x * 2.0 - 1.0, 0.0, dy.y * 2.0 - 1.0)
         + gw.z * vec3(dz.x * 2.0 - 1.0, dz.y * 2.0 - 1.0, 0.0);
  normal = normalize(normal + (normalMatrix * d) * 1.4 * uSalDropK * step(0.5, vColor.r));
}`;
const GL_FS_ALPHA = `
{
  float fr = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.2);
  float rec = 1.0 - step(0.5, vColor.r);
  diffuseColor.a = mix(clamp(mix(0.22, 0.94, fr) + glDrop * 0.35 + glFog * 0.30, 0.0, 1.0), 1.0, rec);
}`;
const _drops = dropletSet();
glassMat.onBeforeCompile = sh => {
  Object.assign(sh.uniforms, { tSalDrop: { value: _drops.nrm }, uSalDropK: salShared.uSalDrop, uSalFog: salShared.uSalFog });
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vGlP; varying vec3 vGlN;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlP = position; vGlN = normal;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform mat3 normalMatrix;\n' + GL_FS_COMMON)
    .replace('#include <color_fragment>', '#include <color_fragment>\n' + GL_FS_FOG)
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, glFog);')
    .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + GL_FS_NORMAL)
    .replace('#include <opaque_fragment>', GL_FS_ALPHA + '\n#include <opaque_fragment>');
};
glassMat.customProgramCacheKey = () => 'salGlass1';

// ---- THE DRESS SHADER ----
// One injected block shared by every canvas material on Sal (one program per
// vertex-colour variant; everything material-specific is a uniform). It samples the
// generated twill TRIPLANAR in the bone's own space, so the thread rides the limb and has
// one pitch everywhere, and reads three baked per-vertex terms from `salAux`:
//   x = WEAR   (0..1): knees, elbows, seat, shoulder rub. The rubber coat is scrubbed off
//                     there, so the drill shows lighter and the surface polishes smoother.
//   y = SEAM   (signed arc distance to the nearest sewn seam, units): taped seams — a
//                     band of rubber-solution tape, smoother and darker, with a stitch row
//                     each side. Signed and linear across a triangle, so the band is exact.
//   z = PATCH  (signed distance to a reinforcing patch outline, <0 inside).
// Pad value (0, 9, 9) = no wear, no seam, no patch (Part.bake pads missing geometry).
// WET: uSalWet (0 dry .. 1 soaked, driven by updateDiver) darkens and glosses the canvas;
// it dries from the helmet DOWN (vSalY is height above the soles), boots last.
// No backticks anywhere in this GLSL.
const SUIT_VS_COMMON = `
attribute vec3 salAux;
varying vec3 vSalP; varying vec3 vSalN; varying vec3 vSalA; varying float vSalY;
uniform float uSalRootY;`;
const SUIT_FS_COMMON = `
uniform sampler2D tSalTw; uniform sampler2D tSalTwN;
uniform float uSalTile; uniform float uSalWeave; uniform float uSalWeaveAlb; uniform float uSalWetDark;
uniform float uSalWet; uniform float uPaintK; uniform float uSalTapeMode;
uniform vec3 uSalWearCol; uniform vec3 uSalTapeCol;
uniform mat3 normalMatrix;
varying vec3 vSalP; varying vec3 vSalN; varying vec3 vSalA; varying float vSalY;
vec4 salTri(sampler2D t, vec3 p, vec3 w) {
  return texture2D(t, p.zy) * w.x + texture2D(t, p.xz) * w.y + texture2D(t, p.xy) * w.z;
}
vec3 salTriN(vec3 p, vec3 w) {
  vec2 tx = texture2D(tSalTwN, p.zy).xy * 2.0 - 1.0;
  vec2 ty = texture2D(tSalTwN, p.xz).xy * 2.0 - 1.0;
  vec2 tz = texture2D(tSalTwN, p.xy).xy * 2.0 - 1.0;
  return w.x * vec3(0.0, tx.y, tx.x) + w.y * vec3(ty.x, 0.0, ty.y) + w.z * vec3(tz.x, tz.y, 0.0);
}
vec3 salBump(vec3 sp, vec3 sn, vec2 dh) {
  vec3 sx = normalize(dFdx(sp)); vec3 sy = normalize(dFdy(sp));
  vec3 r1 = cross(sy, sn); vec3 r2 = cross(sn, sx);
  float det = dot(sx, r1);
  return normalize(abs(det) * sn - sign(det) * (dh.x * r1 + dh.y * r2));
}
vec3 salNo; vec3 salW; vec3 salPp; vec4 salPk;
float salMot; float salTape; float salStitch; float salWear; float salWetK; float salPatch; float salPEdge; float salTH;`;
const SUIT_FS_COLOR = `
salNo = normalize(vSalN);
salW = pow(abs(salNo), vec3(4.0)); salW /= (salW.x + salW.y + salW.z);
salPp = vSalP * uSalTile;
salPk = salTri(tSalTw, salPp, salW);
salMot = salTri(tSalTw, vSalP * (uSalTile * 0.071) + 0.37, salW).g;
{
  float d = abs(vSalA.y), aa = max(fwidth(vSalA.y), 1e-4);
  salTape = 1.0 - smoothstep(0.0125 - aa, 0.0125 + aa, d);
  float row = 1.0 - smoothstep(0.0011 - aa, 0.0011 + aa, abs(d - 0.0085));
  float al = vSalP.y * 105.0;
  float dash = smoothstep(0.22, 0.34, fract(al)) * (1.0 - smoothstep(0.70, 0.82, fract(al)));
  salStitch = row * dash * (1.0 - smoothstep(0.18, 0.5, fwidth(al)));
  float pa = max(fwidth(vSalA.z), 1e-4);
  salPatch = 1.0 - smoothstep(-pa, pa, vSalA.z);
  salPEdge = 1.0 - smoothstep(0.0045 - pa, 0.0045 + pa, abs(vSalA.z + 0.0045));
}
// TAPE MODE (the white trim): salAux is the tape's own frame, y = across (-1..1 edge to
// edge), z = along in weave repeats. A herringbone twill tape: diagonal ribs that turn
// at the centre line, rolled selvedges, and a lock-stitch row sewn down each side.
salTH = 0.0;
if (uSalTapeMode > 0.5) {
  float tc = abs(vSalA.y), ta = vSalA.z;
  float dd = ta + tc * 5.0;
  float rib = 0.5 + 0.5 * sin(dd * 6.2831853) * (1.0 - smoothstep(0.35, 0.7, fwidth(dd)));
  float sel = smoothstep(0.80, 0.97, tc);
  float ca = max(fwidth(tc), 1e-4);
  float srow = 1.0 - smoothstep(0.045 - ca, 0.045 + ca, abs(tc - 0.64));
  float sl = ta * 0.5;
  float sdash = smoothstep(0.16, 0.28, fract(sl)) * (1.0 - smoothstep(0.62, 0.74, fract(sl)));
  salStitch = srow * sdash * (1.0 - smoothstep(0.3, 0.6, fwidth(sl)));
  salTape = 0.0; salPEdge = 0.0; salPatch = 0.0;
  salTH = rib * 0.45 + sel * 0.55;
  diffuseColor.rgb *= (0.84 + 0.26 * rib) * (1.0 - 0.10 * sel);
}
salWear = smoothstep(0.12, 0.85, vSalA.x + (salMot - 0.5) * 0.8) * (0.5 + 0.5 * salPk.r);
salWetK = clamp(uSalWet * 1.6 - vSalY * 0.22, 0.0, 1.0);
diffuseColor.rgb *= mix(1.0 - uSalWeaveAlb, 1.0 + uSalWeaveAlb, salPk.r * 0.55 + salPk.b * 0.45) * (0.80 + 0.40 * salMot);
diffuseColor.rgb = mix(diffuseColor.rgb, uSalWearCol * (0.78 + 0.44 * salPk.r), salWear * 0.72);
diffuseColor.rgb *= mix(vec3(1.0), uSalTapeCol, max(salTape, salPEdge));
diffuseColor.rgb *= 1.0 - 0.13 * salPatch;
diffuseColor.rgb *= 1.0 - 0.45 * salStitch;
diffuseColor.rgb *= 1.0 - uSalWetDark * salWetK;`;
const SUIT_FS_ROUGH = `
roughnessFactor *= 0.82 + 0.34 * salPk.b * (1.0 - 0.35 * salPk.r);
roughnessFactor = mix(roughnessFactor, 0.48, max(salTape, salPEdge) * 0.85);
roughnessFactor -= 0.24 * salWear;
roughnessFactor = mix(roughnessFactor, 0.30, salWetK * 0.8);
roughnessFactor = clamp(roughnessFactor, 0.08, 1.0);`;
const SUIT_FS_NORMAL = `
{
  float ws = uSalWeave * (1.0 - 0.65 * uPaintK) * (1.0 - 0.75 * salTape) * (1.0 - 0.6 * uSalTapeMode);
  vec3 nt = normalize(salNo + salTriN(salPp, salW) * ws);
  normal = normalize(normalMatrix * nt);
  float bh = salTape * 0.7 + salPEdge * 0.6 - salStitch * 0.5 + salTH * 0.6;
  normal = salBump(-vViewPosition, normal, vec2(dFdx(bh), dFdy(bh)) * 0.55);
}`;
const _tw = twillSet();
function suitify(m, o) {
  const tw = o.set || _tw;                                  // the fabric (same packing: twillSet / canvasSet)
  const U = {
    tSalTw: { value: tw.pack }, tSalTwN: { value: tw.nrm }, uSalTapeMode: { value: o.tapeMode || 0 },
    uSalTile: { value: o.tile }, uSalWeave: { value: o.weave }, uSalWeaveAlb: { value: o.alb },
    uSalWetDark: { value: o.wetDark }, uSalWearCol: { value: new THREE.Color(o.wear) },
    uSalTapeCol: { value: new THREE.Vector3(...o.tape) },   // a LINEAR multiplier, not a colour
    uSalWet: salShared.uSalWet, uSalRootY: salShared.uSalRootY, uPaintK: styleUniforms.uPaintK
  };
  m.userData.salSuit = true;
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + SUIT_VS_COMMON)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSalP = position; vSalN = normal; vSalA = salAux;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSalY = (modelMatrix * vec4(transformed, 1.0)).y - uSalRootY;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SUIT_FS_COMMON)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + SUIT_FS_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + SUIT_FS_ROUGH)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + SUIT_FS_NORMAL);
  };
  m.customProgramCacheKey = () => 'salSuit1';
  return m;
}
// thread pitch ~2 mm on the dress (tile 0.077 u); the webbing straps a finer, fainter weave
suitify(leather, { tile: 13.0, weave: 0.60, alb: 0.13, wetDark: 0.40, wear: 0xb49c7c, tape: [0.74, 0.68, 0.60] });
// the blue underlayer is HEAVY DUCK (canvasSet, a 2/2 basket of doubled yarns, ~3 mm pitch),
// not the dress twill; the trim is a woven herringbone TAPE with stitched edges (tape mode)
suitify(cloth, { set: canvasSet(), tile: 11.0, weave: 0.95, alb: 0.24, wetDark: 0.42, wear: 0x7a8cc0, tape: [0.72, 0.74, 0.80] });
suitify(trim, { tile: 22.0, weave: 0.30, alb: 0.06, wetDark: 0.30, wear: 0xefe9dc, tape: [0.82, 0.80, 0.76], tapeMode: 1 });
suitify(darkLeather, { tile: 18.0, weave: 0.40, alb: 0.08, wetDark: 0.28, wear: 0x86603f, tape: [0.80, 0.76, 0.72] });

// PAINT LAW (lib/paint.js). The suit goes matte with the dial: cloth, trim, leathers,
// rubber, steel (its 0.78 metalness is real metal and stays; only its normal map and
// roughness floor move). HERO, untouched at every k: copper and brass (the Mark V's
// bonnet and fittings), the port and lantern glass, the blue helmet lamp, the bubbles.
hoseMat.onBeforeCompile = sh => {
  sh.uniforms.uSalWet = salShared.uSalWet;
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uSalWet;')
    .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - 0.35 * uSalWet;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.26, uSalWet * 0.85);');
};
hoseMat.customProgramCacheKey = () => 'salHose1';
for (const m of [steel, lead, cloth, trim, leather, darkLeather, rubber, hoseMat]) registerPaint(m);
for (const m of [copper, brass, port, gaugeFace, glassMat, lantGlass]) registerPaint(m, { hero: true });
// the blade's water-drag streak: additive, opacity animated by the slash clock
const dragMat = new THREE.MeshBasicMaterial({
  color: 0x9fd8f0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
  depthWrite: false, side: THREE.DoubleSide
});
const flameMat = new THREE.MeshBasicMaterial({ color: 0xffd489, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

// ---- geometry helpers ----
const _o = new THREE.Object3D();
function xf(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.setScalar(1); _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}
const lathe = (pts, seg = 26) => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg);

// Bucket primitives by material and emit one merged mesh each: hundreds of rivets,
// grille bars and studs stay at a handful of draw calls.
// cavFn (optional): (x, y, z) -> 0..1, evaluated in the Part's space on every METAL
// piece added without its own salCav — "how deep in a crevice is this vertex", usually
// the distance to the host surface the fitting is mounted on.
function Part(node, cavFn = null) {
  const b = new Map();
  return {
    node,
    add(geo, mat) {
      if (cavFn && mat.userData.salMetal && !geo.attributes.salCav) cav(geo, cavFn);
      let a = b.get(mat); if (!a) b.set(mat, a = []); a.push(geo); return geo;
    },
    bake(shadow = true) {
      for (const [mat, list] of b) {
        // merging demands identical attribute sets; pad plain primitives mixed with folded cloth
        if (mat.vertexColors || list.some(g => g.attributes.color)) for (const g of list) if (!g.attributes.color)
          g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
        // the dress shader reads salAux on EVERY vertex; an unbound attribute reads 0,
        // which is "on a seam" — so every suit bucket is padded to (no wear, no seam, no patch)
        if (mat.userData.salSuit || list.some(g => g.attributes.salAux)) for (const g of list) if (!g.attributes.salAux) aux(g, null);
        if (mat.userData.salMetal || list.some(g => g.attributes.salCav)) for (const g of list) if (!g.attributes.salCav) cav(g, 0);
        // extruded and prototype fittings are non-indexed; a bucket that mixes them with
        // indexed primitives merges as non-indexed throughout
        if (list.some(g => g.index) && list.some(g => !g.index))
          for (let i = 0; i < list.length; i++) if (list[i].index) list[i] = list[i].toNonIndexed();
        const m = new THREE.Mesh(list.length > 1 ? mergeGeometries(list) : list[0], mat);
        m.castShadow = shadow; m.receiveShadow = true;
        node.add(m);
      }
      b.clear();
      return node;
    }
  };
}

// Bake the dress shader's per-vertex terms (see THE DRESS SHADER). fn(x, y, z, out)
// writes [wear, seam, patch] for a vertex in the geometry's current (bone) space;
// fn = null writes the pad. Build-time only.
const _ax = [0, 9, 9];
function aux(geo, fn) {
  const pos = geo.attributes.position, n = pos.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    _ax[0] = 0; _ax[1] = 9; _ax[2] = 9;
    if (fn) fn(pos.getX(i), pos.getY(i), pos.getZ(i), _ax);
    a[i * 3] = _ax[0]; a[i * 3 + 1] = _ax[1]; a[i * 3 + 2] = _ax[2];
  }
  geo.setAttribute('salAux', new THREE.BufferAttribute(a, 3));
  return geo;
}
// Metal cavity (0 = open face .. 1 = deep crevice): tarnish and verdigris pool here.
// v is a number (uniform) or fn(x, y, z) in the geometry's own space.
// spun = 1 marks the bonnet's spun copper (the metal shader's lathe rings).
function cav(geo, v, spun = 0) {
  const pos = geo.attributes.position, n = pos.count, a = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    a[i * 2] = typeof v === 'function' ? clamp(v(pos.getX(i), pos.getY(i), pos.getZ(i)), 0, 1) : v;
    a[i * 2 + 1] = spun;
  }
  geo.setAttribute('salCav', new THREE.BufferAttribute(a, 2));
  return geo;
}
const gau = t => Math.exp(-t * t);
// Seam distance for a limb segment lathed round its own Y axis: nseams evenly spaced seams
// starting on +X. r*sin(n*theta)/n is the arc distance near each seam and stays smooth
// (and so interpolates exactly) all the way round.
const seamD = (x, z, nseams) => Math.hypot(x, z) * Math.sin(nseams * Math.atan2(z, x)) / nseams;

// Displace cloth along its normals and bake grime into vertex colours, so dirt genuinely
// pools in the creases the geometry has rather than in an unrelated texture.
// `mask` (optional) scales the displacement per vertex. It exists for solids of
// revolution: at a lathe's POLE every column's vertex is coincident but carries a
// DIFFERENT normal, so one shared displacement fans them out into a starburst of bright
// slivers — visible as a white spray at the crotch, elbows and ankles, exactly where the
// limb caps sit. Masking the amplitude to zero near the axis removes the cause.
function fold(geo, amp, freq, tone = 1, mask = null) {
  const pos = geo.attributes.position, nrm = geo.attributes.normal, n = pos.count;
  const col = new Float32Array(n * 3);
  // WELD THE DISPLACEMENT DIRECTION across coincident vertices before moving anything.
  // A lathe, capsule or sphere POLE is several vertices sharing one position but carrying
  // DIFFERENT normals — one per column of the seam. Push each along its own normal and the
  // pole tears open into a starburst of bright slivers. It showed as a white spray at the
  // crotch (the pelvis capsule's lower pole) and at every limb joint. Averaging first makes
  // every copy of a point move as the single point it actually is. Build-time only.
  const key = i => `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
  const acc = new Map();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let a = acc.get(k);
    if (!a) acc.set(k, a = [0, 0, 0]);
    a[0] += nrm.getX(i); a[1] += nrm.getY(i); a[2] += nrm.getZ(i);
  }
  for (const a of acc.values()) {
    const L = Math.hypot(a[0], a[1], a[2]) || 1;
    a[0] /= L; a[1] /= L; a[2] /= L;
  }
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const dir = acc.get(key(i));
    const a = fbm(x * freq + 11, z * freq + 3) - 0.5;
    const b = fbm(y * freq * 1.7 + 5, (x + z) * 0.7 * freq * 1.7 + 9) - 0.5;
    const c = fbm(y * freq * 4.1 + 21, (x - z) * freq * 4.1 + 2) - 0.5;
    const d = (a * 1.1 + b * 0.9 + c * 0.45) * amp * (mask ? mask(x, y, z) : 1);
    pos.setXYZ(i, x + dir[0] * d, y + dir[1] * d, z + dir[2] * d);
    const g = clamp(tone * (0.80 + (d / amp) * 0.24 - clamp(-y * 0.09, 0, 0.16)), 0.34, 1.1);
    col[i * 3] = g; col[i * 3 + 1] = g * 0.98; col[i * 3 + 2] = g * 0.93;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function rivetRing(p, mat, n, r, y, rad = 0.032, zs = 1, phase = 0.5) {
  const g = new THREE.SphereGeometry(rad, 6, 4);
  for (let i = 0; i < n; i++) {
    const a = (i + phase) / n * TAU;
    p.add(xf(g.clone(), Math.cos(a) * r, y, Math.sin(a) * r * zs), mat);
  }
}

// A WING NUT, as cast: a chamfered hub on a threaded stub, two thumb wings flaring up
// from it with rounded ears, every edge bevelled so the metal shader has a rim to
// polish. Built once (unit scale, shaft along +Z, wings in the XY plane) and cloned.
// ~190 tris. The stud end shows proud of the hub like a real thread does.
const WING_PROTO = (() => {
  const hub = lathe([[0, 0], [0.031, 0], [0.033, 0.006], [0.033, 0.030], [0.027, 0.040], [0.014, 0.044],
    [0.011, 0.044], [0.011, 0.058], [0.008, 0.062], [0, 0.062]], 10).rotateX(Math.PI / 2).toNonIndexed();
  const wing = sx => {
    const sh = new THREE.Shape();
    sh.moveTo(sx * 0.024, -0.012);
    sh.quadraticCurveTo(sx * 0.046, -0.016, sx * 0.058, 0.004);
    sh.quadraticCurveTo(sx * 0.066, 0.030, sx * 0.050, 0.036);
    sh.quadraticCurveTo(sx * 0.034, 0.036, sx * 0.024, 0.016);
    sh.lineTo(sx * 0.024, -0.012);
    return new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: true, bevelThickness: 0.0035,
      bevelSize: 0.003, bevelSegments: 1, curveSegments: 3 }).translate(0, 0, 0.012);
  };
  return mergeGeometries([hub, wing(1), wing(-1)]);
})();
function wingnut(p, x, y, z, ry, s = 1) {
  const g = WING_PROTO.clone().scale(s, s, s);
  p.add(xf(g, x, y, z, 0, ry, 0), brass);
}
// Place a +Z-facing prototype at pos, facing along dir (roll about that axis).
const _pq = new THREE.Vector3();
function faceAlong(geo, pos, dir, roll = 0) {
  _o.position.copy(pos); _o.scale.setScalar(1); _o.rotation.set(0, 0, 0);
  _o.lookAt(_pq.copy(pos).add(dir)); _o.rotateZ(roll); _o.updateMatrix();
  return geo.applyMatrix4(_o.matrix);
}
// A roller-less frame buckle: a torus with four tubular segments IS a square loop.
// w x h outer size, t bar radius; lies in XY, faces +Z. Optional prong across it.
function buckleGeo(w, h, t = 0.005, prong = true) {
  const parts = [new THREE.TorusGeometry(0.5, t / Math.max(w, h) * 1.4, 4, 4).rotateZ(Math.PI / 4)
    .scale(w * 0.707, h * 0.707, Math.max(w, h) * 0.707).toNonIndexed()];
  if (prong) parts.push(new THREE.CylinderGeometry(t * 0.7, t * 0.7, w * 0.62, 5).rotateZ(Math.PI / 2)
    .translate(w * 0.06, 0, t * 0.9).toNonIndexed());
  return mergeGeometries(parts);
}

// One arced guard bar bowing out over a porthole, in the port's local frame (+Z outward).
function guardBar(off, rimR, tube) {
  const c = new THREE.CatmullRomCurve3([
    V3(off, -rimR * 0.98, 0.002), V3(off * 1.06, -rimR * 0.55, 0.048), V3(off * 1.09, 0, 0.062),
    V3(off * 1.06, rimR * 0.55, 0.048), V3(off, rimR * 0.98, 0.002)
  ]);
  return new THREE.TubeGeometry(c, 9, tube, 6, false);
}

// A raised trim strip following a lathe profile's front (or back) face — panel/centre seams.
function seamTube(pts, zs, r, sign = 1, xoff = 0, rad = 0.014) {
  const c = new THREE.CatmullRomCurve3(pts.map(pt => V3(xoff, pt[1], sign * (pt[0] * zs + r))));
  return new THREE.TubeGeometry(c, pts.length * 2, rad, 5, false);
}
// Flattened ring band (sock cuffs, thigh straps, gauntlet bands).
const band = (r, h, t = 0.9, seg = 14) => new THREE.CylinderGeometry(r, r, h, seg, 1, true).scale(1, 1, t);

// WOVEN TAPE (the white trim; polish-followups). Not an open cylinder: a strip with a
// thickness, its two selvedges rolled over and tucked into the cloth under it, lying a
// little slack round the limb (never a perfect ring). salAux is the tape's own frame for
// the dress shader's TAPE MODE: y = across (-1 .. 1, edge to edge), z = along, in weave
// repeats — an integer round the ring, so the herringbone closes on itself.
function tapeBand(r, h, zs = 0.95, t = 0.0065, seg = 26, ph = 0) {
  const hh = h / 2;
  const prof = [[r - t * 0.6, -hh + t * 0.1], [r + t * 0.55, -hh + t * 0.3], [r + t, -hh * 0.3],
    [r + t, hh * 0.3], [r + t * 0.55, hh - t * 0.3], [r - t * 0.6, hh - t * 0.1]];
  const g = lathe(prof, seg), pos = g.attributes.position, uv = g.attributes.uv;
  const reps = Math.max(8, Math.round(TAU * r / 0.012));
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), th = Math.atan2(z, x);
    const k = 1 + 0.010 * Math.sin(3 * th + ph) + 0.006 * Math.sin(5 * th + 2 * ph);   // slack, not turned
    pos.setXYZ(i, x * k, y + 0.0025 * Math.sin(2 * th + ph), z * k);
    a[i * 3] = 0.25 * Math.max(0, Math.sin(th + ph));                              // rubbed on one side
    a[i * 3 + 1] = clamp(y / hh, -1, 1);
    a[i * 3 + 2] = uv.getX(i) * reps;
  }
  g.setAttribute('salAux', new THREE.BufferAttribute(a, 3));
  g.computeVertexNormals();
  return g.scale(1, 1, zs);
}

// A PLEATED CUFF (wrists and ankles; polish-followups): canvas gathered by a drawstring.
// keys = [[y, r], ...] top to bottom; yg is the gather line. The radius folds into `n`
// knife pleats — a long slope and a short sharp return, so each fold throws a crease
// shadow and breaks the silhouette — whose depth is zero at the cord and opens out either
// side of it (fade(y) can close them again where a tape or a welt binds the edge).
// Returns the cuff (position/normal/uv/colour, the attribute set the cloth bucket merges)
// and the cord: a tarred drawstring riding the pleat crests, a knot and two short tails.
function pleatCuff(keys, yg, n, depth, fade = () => 1, cordR = 0.0055, seg = 0, rows = 8, zs = 0.95) {
  seg = seg || n * 4;
  const ks = keys.slice().sort((a, b) => a[0] - b[0]);
  const rAt = y => {
    let i = 1;
    while (i < ks.length - 1 && ks[i][0] < y) i++;
    const [y0, r0] = ks[i - 1], [y1, r1] = ks[i], u = clamp((y - y0) / (y1 - y0), 0, 1);
    return r0 + (r1 - r0) * u * u * (3 - 2 * u);
  };
  const yT = ks[ks.length - 1][0], yB = ks[0][0], span = yT - yB;
  const pleat = th => { const w = ((th / TAU * n) % 1 + 1) % 1; return w < 0.78 ? w / 0.78 : (1 - w) / 0.22; };   // 0 valley .. 1 crest
  const pos = [], uv = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const y = yT - span * i / rows, dg = Math.abs(y - yg);
    const open = ss(0.004, 0.045, dg) * fade(y), r = rAt(y);
    for (let j = 0; j <= seg; j++) {
      const th = (j % seg) / seg * TAU + 0.10 * (y - yg) / span * Math.sin(3 * j / seg * TAU);   // pleats drift a little
      const pl = pleat(th), rr = r + (pl - 0.55) * depth * open;
      pos.push(Math.cos(th) * rr, y, Math.sin(th) * rr * zs);
      uv.push(j / seg, i / rows);
      const g = 0.74 * (0.72 + 0.36 * (open > 0.05 ? pl : 0.6) - 0.10 * (1 - open));
      col.push(g, g * 0.98, g * 0.93);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < seg; j++) {
    const a = i * (seg + 1) + j, b = a + seg + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);                // rows run top to bottom: faces out
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the cord: round the gather, standing just proud of the cinched canvas
  const rc = rAt(yg) + cordR * 0.9, q = [];
  for (let k = 0; k < 24; k++) {
    const th = k / 24 * TAU;
    q.push(V3(Math.cos(th) * rc, yg + 0.0015 * Math.sin(n * th), Math.sin(th) * rc * zs));
  }
  const parts = [new THREE.TubeGeometry(new THREE.CatmullRomCurve3(q, true), 28, cordR, 4, true)];
  // the knot on the outside, and two tails hanging off it, one longer
  const kx = rc * 1.02, kz = 0;
  parts.push(new THREE.SphereGeometry(cordR * 2.0, 6, 4).scale(1, 0.8, 1.1).translate(kx + cordR, yg, kz));
  for (const [dz, L] of [[-0.010, 0.040], [0.009, 0.028]]) {
    const c = new THREE.CatmullRomCurve3([V3(kx + cordR * 1.4, yg - cordR, kz + dz * 0.4),
      V3(kx + cordR * 2.2, yg - L * 0.5, kz + dz), V3(kx + cordR * 2.0, yg - L, kz + dz * 1.3)]);
    parts.push(new THREE.TubeGeometry(c, 4, cordR * 0.95, 4, false));
    parts.push(new THREE.SphereGeometry(cordR * 1.3, 4, 3).translate(kx + cordR * 2.0, yg - L, kz + dz * 1.3));   // whipped end
  }
  const cord = mergeGeometries(parts.map(q2 => q2.index ? q2.toNonIndexed() : q2));
  return { cuff: g, cord };
}

// ---- limb sculpting ----
// A LIMB IS NOT A TUBE. Every segment is a solid of revolution whose radius is keyed
// along its length, so the girth story reads at nine units (the only distance any deck
// detail is ever seen from): deltoid > elbow, forearm belly > wrist, thigh > knee,
// calf > ankle. The suit is canvas OVER that anatomy, so the keys are soft — the twill
// smooths a bicep into a swell — but the swell has to be there or the eye reads pipe.
//
// profOf: piecewise keys [s, radius-multiplier], smoothstepped between, s = 0 at the
// joint above and 1 at the joint below. Smoothstep (not linear) gives flat tangents at
// every key, which is exactly how slack cloth drapes over a taper.
function profOf(keys) {
  return s => {
    let i = 1;
    while (i < keys.length - 1 && keys[i][0] < s) i++;
    const [s0, k0] = keys[i - 1], [s1, k1] = keys[i];
    const u = clamp((s - s0) / (s1 - s0), 0, 1);
    return k0 + (k1 - k0) * (u * u * (3 - 2 * u));
  };
}

// Lathe a profiled segment of length `len`, hung from y = 0 down to y = -len, with
// rounded caps at both ends so consecutive segments read continuous through a bend
// instead of showing a hard disc at the joint.
function segGeo(len, r, prof, seg = 22, rings = 16) {   // 16x13 faceted the fold into crumpled paper
  const pts = [];
  const rT = r * prof(0), rB = r * prof(1);
  for (let k = 0; k <= 3; k++) {                             // bottom cap, pole first
    const a = (k / 4) * (Math.PI / 2);
    pts.push([rB * Math.sin(a), -len - rB * 0.62 * Math.cos(a)]);
  }
  for (let i = rings; i >= 0; i--) pts.push([r * prof(i / rings), -len * (i / rings)]);
  for (let k = 3; k >= 0; k--) {                             // top cap, back to the pole
    const a = (k / 4) * (Math.PI / 2);
    pts.push([rT * Math.sin(a), rT * 0.45 * Math.cos(a)]);
  }
  return lathe(pts, seg);
}

// Flat vertex tint. fold() is the wrong tool on a small torus — its displacement is
// per-vertex noise, and on a 5-segment ring that reads as spikes rather than slack. This
// just darkens the gather so grime pools where cloth doubles over, and keeps the geometry
// smooth. Also supplies the `color` attribute the merge needs in a vertexColors bucket.
function tint(geo, g) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = g; c[i * 3 + 1] = g * 0.98; c[i * 3 + 2] = g * 0.93; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

// Canvas has nowhere to go when a joint folds, so it GATHERS: a few soft rings of slack
// stacked where the elbow, knee and groin crease. These sit only just proud of the limb
// surface — a ring standing 20% of the radius off the leg is a hose, not a suit — and are
// tinted down so the crease reads as shadow first and silhouette second.
function bunch(p, mat, r, y, n = 3, dy = 0.052, tube = 0.019, zs = 0.95) {
  const mid = (n - 1) / 2;
  for (let i = 0; i < n; i++) {
    const k = 1 - Math.abs(i - mid) / n, R = r * 0.985, ph = i * 2.1 + r * 37 + y * 13;
    const g = new THREE.TorusGeometry(R, tube * (0.7 + 0.6 * k), 5, 18).rotateX(Math.PI / 2);
    // (polish-followups) a fold, not a hose ring: the slack swells and pinches out round
    // the limb and rides up and down it, so adjacent gathers cross and merge like canvas
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const x = pos.getX(v), yy = pos.getY(v), z = pos.getZ(v), th = Math.atan2(z, x);
      const cx = Math.cos(th) * R, cz = Math.sin(th) * R;
      const sw = clamp(0.62 + 0.30 * Math.sin(2 * th + ph) + 0.22 * Math.sin(5 * th + ph * 1.7), 0.18, 1.2);
      const lift = tube * (0.9 * Math.sin(th + ph) + 0.4 * Math.sin(3 * th + ph * 0.6));
      pos.setXYZ(v, cx + (x - cx) * sw, yy * sw * 0.85 + lift, cz + (z - cz) * sw);
    }
    g.computeVertexNormals();
    g.scale(1, 1, zs);
    const gg = tint(xf(g, 0, y + (i - mid) * dy), 0.80);
    p.add(p.auxFn ? aux(gg, p.auxFn) : gg, mat);
  }
}

// Raised piping down a segment's seam, riding the profile so it swells with the limb.
// A tube of 4 radial segments: ~110 tris buys the single line that says "this was sewn".
function piping(p, mat, len, r, prof, sx, sz = 0, rad = 0.013, n = 7) {
  const q = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n, rr = r * prof(s) * 0.99;
    q.push(V3(sx * rr, -len * s, sz * rr));
  }
  const tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(q), n * 2, rad, 4, false);
  p.add(p.auxFn ? aux(tg, p.auxFn) : tg, mat);
}

// The four segment profiles. Arms r = 0.150, legs r = 0.186.
const P_UPARM = profOf([[0, 1.00], [0.16, 1.17], [0.45, 1.00], [0.80, 0.86], [1, 0.80]]);   // deltoid/bicep -> elbow
const P_FOREARM = profOf([[0, 0.80], [0.22, 0.93], [0.55, 0.80], [0.85, 0.66], [1, 0.60]]); // belly -> hard wrist taper
const P_THIGH = profOf([[0, 1.06], [0.14, 1.14], [0.42, 1.02], [0.78, 0.85], [1, 0.80]]);
// The shank is 0.6815 now (the ankle came down into the boot): the old calf keys are
// rescaled by 0.465/0.6815 so the visible calf above the gaiter is the same leg, and the
// last third tapers on inside the boot to the new, lower ankle.
const P_SHANK = profOf([[0, 0.80], [0.095, 0.86], [0.205, 0.95], [0.396, 0.80], [0.587, 0.64], [0.682, 0.60], [1, 0.56]]); // calf belly -> ankle

// ---- Sal's dive knife ----
// Local frame: the grip's base sits at the origin, the blade runs down -Y. The same
// builder feeds both copies (sheathed on the thigh, held in the fist) so they are
// literally the same object; only the parent transform differs.
function knifeGeo(p) {
  p.add(xf(new THREE.SphereGeometry(0.026, 8, 6).scale(1, 0.78, 1), 0, 0.082), brass);      // pommel
  p.add(xf(new THREE.CylinderGeometry(0.030, 0.030, 0.020, 10), 0, 0.066), brass);          // butt ferrule
  p.add(xf(new THREE.CylinderGeometry(0.0235, 0.0275, 0.132, 10), 0, 0.002), darkLeather);  // wrapped grip
  for (let i = 0; i < 6; i++)                                                               // wrap ridges
    p.add(xf(new THREE.TorusGeometry(0.0272, 0.0044, 4, 10).rotateX(Math.PI / 2), 0, -0.048 + i * 0.021), darkLeather);
  p.add(xf(new THREE.CylinderGeometry(0.0325, 0.0285, 0.026, 10), 0, -0.058), brass);       // bolster
  p.add(xf(new THREE.BoxGeometry(0.108, 0.021, 0.038), 0, -0.077), brass);                  // guard
  for (const sx of [-1, 1]) p.add(xf(new THREE.SphereGeometry(0.0125, 6, 5), sx * 0.050, -0.077), brass);
  p.add(xf(new THREE.BoxGeometry(0.036, 0.030, 0.016), 0, -0.100), steel);                  // ricasso
  // tapered blade: a 4-gon cylinder squashed in Z gives a real diamond cross-section
  p.add(xf(new THREE.CylinderGeometry(0.0295, 0.0255, 0.170, 4).scale(1, 1, 0.34), 0, -0.190), steel);
  p.add(xf(new THREE.CylinderGeometry(0.0255, 0.0012, 0.078, 4).scale(1, 1, 0.34), 0, -0.314), steel);  // spear point
  return p;
}

// Leather scabbard with a brass throat and chape. Throat mouth sits at local y = +0.09,
// so the knife copy parented here at that height rides fully home.
function sheathGeo(p) {
  p.add(xf(new THREE.CylinderGeometry(0.047, 0.033, 0.365, 8).scale(1, 1, 0.60), 0, -0.093), darkLeather);
  p.add(xf(new THREE.BoxGeometry(0.014, 0.350, 0.014), 0.045, -0.093), leather);           // stitched welt
  p.add(xf(new THREE.CylinderGeometry(0.052, 0.050, 0.052, 8).scale(1, 1, 0.62), 0, 0.072), brass);   // throat
  p.add(xf(new THREE.TorusGeometry(0.051, 0.008, 5, 12).rotateX(Math.PI / 2).scale(1, 1, 0.62), 0, 0.096), brass);
  p.add(xf(new THREE.CylinderGeometry(0.035, 0.021, 0.062, 8).scale(1, 1, 0.62), 0, -0.246), brass);  // chape
  p.add(xf(new THREE.SphereGeometry(0.020, 7, 5).scale(1, 0.8, 0.70), 0, -0.276), brass);
  p.add(xf(new THREE.TorusGeometry(0.030, 0.009, 5, 12).rotateY(Math.PI / 2), 0, 0.112, -0.030), darkLeather);   // belt loop
  for (let i = 0; i < 3; i++)                                                              // face rivets
    p.add(xf(new THREE.SphereGeometry(0.010, 6, 5), 0, 0.020 - i * 0.092, 0.027), brass);
  return p;
}

// sOff: distance along the port's axis from its centre to the bonnet's outer surface,
// so the bezel, the recess and the glass all sit ON the copper rather than inside it.
function porthole(p, rimR, glassR, bars, x, y, z, rx, ry, nb = 8, sOff = 0.045) {
  const put = g => xf(g, x, y, z, rx, ry, 0);
  p.add(put(new THREE.CylinderGeometry(rimR, rimR * 1.06, 0.07, 22, 1, true).rotateX(Math.PI / 2).translate(0, 0, sOff - 0.025)), brass);
  p.add(put(new THREE.TorusGeometry(rimR, rimR * 0.15, 9, 24).translate(0, 0, sOff + 0.012)), brass);     // bezel
  p.add(put(new THREE.TorusGeometry(rimR * 1.22, rimR * 0.1, 5, 24).translate(0, 0, sOff - 0.012)), copper); // flange
  // the recess first (dark, opaque), then the glass over it: one draw, index order
  p.add(put(tint(new THREE.CircleGeometry(rimR * 0.98, 20).translate(0, 0, sOff + 0.003), 0.02)), glassMat);
  const capZ = sOff + 0.008 - glassR * 1.9 * Math.cos(0.56);
  p.add(put(new THREE.SphereGeometry(glassR * 1.9, 18, 6, 0, TAU, 0, 0.56).rotateX(Math.PI / 2).translate(0, 0, capZ)), glassMat);
  for (let i = 0; i < nb; i++) {                             // bezel bolts: hex heads
    const a = i / nb * TAU;
    p.add(put(new THREE.CylinderGeometry(rimR * 0.10, rimR * 0.10, rimR * 0.09, 6).rotateX(Math.PI / 2)
      .translate(Math.cos(a) * rimR * 1.06, Math.sin(a) * rimR * 1.06, sOff + 0.022)), brass);
  }
  if (bars) for (let i = -1; i <= 1; i++) p.add(put(guardBar(i * rimR * 0.56, rimR, rimR * 0.085).translate(0, 0, sOff + 0.004)), brass);
}

// A short corrugated hose length running up its own +Y, baked to one mesh per joint.
function hoseSeg(len, r) {
  const parts = [new THREE.CylinderGeometry(r * 0.86, r * 0.86, len, 9, 1, true).translate(0, len / 2, 0)];
  const n = Math.max(2, Math.round(len / 0.085));
  for (let i = 0; i < n; i++) parts.push(new THREE.TorusGeometry(r * 0.88, r * 0.2, 5, 9).rotateX(Math.PI / 2).translate(0, (i + 0.5) * len / n, 0));
  return mergeGeometries(parts);
}

export const diver = (() => {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body); g.body = body;
  const hips = new THREE.Group(); hips.position.y = -0.10; body.add(hips); g.hips = hips;
  const spine = new THREE.Group(); spine.position.y = 0.20; hips.add(spine); g.spine = spine;
  // neck: the old 0.76 brought in with the corselet's collar: CORS_Y + (0.76 - CORS_Y) * HELM_S
  const neck = new THREE.Group(); neck.position.y = 0.73825; spine.add(neck); g.neck = neck;
  // the corselet group: everything that was the breastplate (and the dress under it), shrunk about the
  // shoulder line (see HELM_S)
  const cors = new THREE.Group(); cors.position.y = CORS_Y * (1 - HELM_S); cors.scale.setScalar(HELM_S); spine.add(cors); g.cors = cors;

  // ---- helmet: lathed bonnet with a real Mark V profile ----
  // Parented to its own group so an authored glTF helmet (entities/helmetSwap.js) can
  // replace it wholesale: hide this group, add the loaded model to `neck`.
  const helmGroup = new THREE.Group();
  helmGroup.scale.setScalar(HELM_S);
  neck.add(helmGroup);
  g.helmGroup = helmGroup;
  {
    const HP = [
      [0.000, 0.000], [0.246, 0.000], [0.256, 0.045], [0.262, 0.085], [0.300, 0.115], [0.352, 0.165],
      [0.400, 0.235], [0.430, 0.315], [0.444, 0.400], [0.448, 0.480], [0.440, 0.560], [0.418, 0.635],
      [0.382, 0.705], [0.330, 0.775], [0.262, 0.838], [0.176, 0.892], [0.086, 0.936], [0.000, 0.952]
    ];
    const hR = y => {
      for (let i = 2; i < HP.length; i++) if (y <= HP[i][1]) {
        const [r0, y0] = HP[i - 1], [r1, y1] = HP[i];
        return r0 + (r1 - r0) * clamp((y - y0) / (y1 - y0), 0, 1);
      }
      return 0;
    };
    // every helmet fitting's crevice depth = its distance off the bonnet's surface
    const p = Part(helmGroup, (x, y, z) => y < 0 ? 0 : 1 - ss(0.004, 0.030, Math.hypot(x, z) - hR(y)));
    // THE BONNET: spun copper (salCav.y = 1), its crevice term baked where water and
    // verdigris collect — round every port flange, the spun ridges, the neck ring, and
    // under the exhaust and inlet bosses.
    const PORTS = [[0.198, 0, 0.455, 0.402, -0.08, 0], [0.132, 0.376, 0.470, 0.128, 0, 1.245],
      [0.132, -0.376, 0.470, 0.128, 0, -1.245], [0.126, 0, 0.818, 0.172, -1.16, 0]];
    const pAx = PORTS.map(q => new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(q[4], q[5], 0)));
    const _pv = new THREE.Vector3();
    p.add(cav(lathe(HP, 56), (x, y, z) => {
      let c = 1 - ss(0.07, 0.13, y);
      for (let k = 0; k < 4; k++) {
        const q = PORTS[k]; _pv.set(x - q[1], y - q[2], z - q[3]);
        const al = _pv.dot(pAx[k]), rad = Math.sqrt(Math.max(0, _pv.lengthSq() - al * al));
        c = Math.max(c, gau((rad - q[0] * 1.30) / 0.030) * 0.9);
      }
      for (const yy of [0.235, 0.400, 0.520, 0.635, 0.775]) c = Math.max(c, 0.45 * gau((y - yy) / 0.012));
      c = Math.max(c, 0.8 * gau(Math.hypot(x + 0.36, y - 0.315, z - 0.245) / 0.085), 0.8 * gau(Math.hypot(x + 0.30, y - 0.40, z + 0.28) / 0.10));
      return c;
    }, 1), copper);
    // neck ring / breastplate lock
    p.add(xf(new THREE.CylinderGeometry(0.268, 0.276, 0.09, 32), 0, 0.035), brass);
    p.add(xf(new THREE.TorusGeometry(0.272, 0.028, 6, 32).rotateX(Math.PI / 2), 0, 0.082), brass);
    for (let i = 0; i < 12; i++) {                           // neck-ring bolts: washer + hex head
      const a = (i + 0.5) / 12 * TAU, pos = V3(Math.cos(a) * 0.281, 0.036, Math.sin(a) * 0.281), dir = V3(Math.cos(a), 0, Math.sin(a));
      p.add(faceAlong(new THREE.CylinderGeometry(0.023, 0.023, 0.005, 12).rotateX(Math.PI / 2), pos, dir), brass);
      p.add(faceAlong(new THREE.CylinderGeometry(0.017, 0.017, 0.016, 6).rotateX(Math.PI / 2).translate(0, 0, 0.009), pos, dir), brass);
    }
    for (let i = 0; i < 4; i++) {                            // interrupted-thread lugs
      const a = i / 4 * TAU + 0.4;
      p.add(xf(new THREE.BoxGeometry(0.10, 0.036, 0.05), Math.cos(a) * 0.29, 0.005, Math.sin(a) * 0.29, 0, -a, 0), brass);
    }
    const sOff = k => {                                       // march out along the axis to the copper
      const q = PORTS[k], a = pAx[k];
      for (let t = -0.05; t < 0.2; t += 0.001) if (Math.hypot(q[1] + a.x * t, q[3] + a.z * t) > hR(q[2] + a.y * t)) return t;
      return 0.045;
    };
    porthole(p, 0.198, 0.160, false, 0, 0.455, 0.402, -0.08, 0, 12, sOff(0));    // open front faceplate, 12-bolt bezel
    porthole(p, 0.132, 0.104, true, 0.376, 0.470, 0.128, 0, 1.245, 8, sOff(1));  // side ports
    porthole(p, 0.132, 0.104, true, -0.376, 0.470, 0.128, 0, -1.245, 8, sOff(2));
    porthole(p, 0.126, 0.100, true, 0, 0.818, 0.172, -1.16, 0, 8, sOff(3));      // top port
    for (let i = 0; i < 3; i++) {                            // faceplate dog clamps
      const a = i * 2.094;
      wingnut(p, Math.sin(a) * 0.300, 0.455 + Math.cos(a) * 0.300, 0.300, 0, 0.85);
    }
    // The Mark V signature: the faceplate is a DOOR. Hinge lug on the diver's right of
    // the front port, swing-bolt hasp on the left — the two fittings that say this
    // window opens for air on deck and dogs shut before the water.
    {
      const HX = 0.225, Y = 0.455, HZ = 0.345;               // just outside the bezel ring
      for (const dy of [-0.055, 0.055])                      // hinge knuckles
        p.add(xf(new THREE.BoxGeometry(0.052, 0.042, 0.040), HX, Y + dy, HZ, 0, 0.55, 0), brass);
      p.add(xf(new THREE.CylinderGeometry(0.013, 0.013, 0.175, 8), HX + 0.012, Y, HZ + 0.012), brass); // hinge pin
      p.add(xf(new THREE.SphereGeometry(0.017, 8, 5), HX + 0.012, Y + 0.088, HZ + 0.012), brass);      // pin head
      // hasp: a slotted lug the swing bolt lies into, bolt pivoted below, wingnut on top
      p.add(xf(new THREE.BoxGeometry(0.046, 0.075, 0.036), -HX, Y + 0.010, HZ, 0, -0.55, 0), brass);   // lug
      p.add(xf(new THREE.CylinderGeometry(0.011, 0.011, 0.115, 8), -HX - 0.006, Y - 0.012, HZ + 0.006, 0.16, 0, -0.10), brass); // swing bolt
      wingnut(p, -HX - 0.014, Y + 0.052, HZ + 0.014, -0.55, 0.7);                                      // dogged down
    }
    // The bonnet is RAISED COPPER — beaten up out of sheet over a former and spun true —
    // and spinning leaves ridges. Five rings sitting exactly on the lathe profile give the
    // dome a scale and a set of specular lines it otherwise has no way to earn.
    for (const [rr, yy] of [[0.402, 0.235], [0.446, 0.400], [0.442, 0.520], [0.420, 0.635], [0.334, 0.775]])
      p.add(cav(xf(new THREE.TorusGeometry(rr, 0.0085, 5, 32).rotateX(Math.PI / 2), 0, yy), 0.2), copper);
    // four wing-nut dogs round the neck ring, clamping the bonnet down onto the corselet.
    // ry = PI/2 - a points each nut's shaft radially outward from the ring.
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + 0.785;
      wingnut(p, Math.cos(a) * 0.302, 0.068, Math.sin(a) * 0.302, Math.PI / 2 - a, 0.9);
    }
    // brass crest strip, front faceplate to top port
    p.add(xf(new THREE.TorusGeometry(0.40, 0.019, 5, 20, 1.15).rotateZ(0.42).rotateY(Math.PI / 2), 0, 0.455, 0), brass);
    // exhaust valve, right of the faceplate — bubbles vent here
    const ex = new THREE.Group(); ex.position.set(-0.352 * HELM_S, 0.315 * HELM_S, 0.245 * HELM_S); neck.add(ex); g.exhaust = ex;
    // THE EXHAUST VALVE as a fitting: a chamfered base flange sweated to the bonnet, the
    // valve barrel, a hex body, the knurled adjusting cap the diver screws down with his
    // chin-side hand, and the spitcock lever. Axis radial off the bonnet at the vent.
    {
      const d = V3(-0.375, 0, 0.245).normalize(), B = V3(d.x * hR(0.315), 0.315, d.z * hR(0.315));
      const along = (geo, t) => faceAlong(geo.rotateX(Math.PI / 2).translate(0, 0, t), B, d);
      p.add(along(lathe([[0, 0], [0.070, 0], [0.074, 0.006], [0.066, 0.014], [0, 0.014]], 18), -0.004), brass);
      p.add(along(lathe([[0.050, 0], [0.054, 0.006], [0.054, 0.040], [0.049, 0.048], [0.040, 0.050]], 16), 0.008), brass);
      p.add(along(new THREE.CylinderGeometry(0.046, 0.046, 0.020, 6), 0.068), brass);
      const kn = new THREE.CylinderGeometry(0.036, 0.036, 0.032, 28, 1);
      const kp = kn.attributes.position;
      for (let i = 0; i < kp.count; i++) {                   // knurl: alternate the rim radius
        const ang = Math.atan2(kp.getZ(i), kp.getX(i)), r = Math.hypot(kp.getX(i), kp.getZ(i));
        if (r > 0.03) { const k = 1 + 0.07 * Math.sign(Math.cos(ang * 14)); kp.setX(i, kp.getX(i) * k); kp.setZ(i, kp.getZ(i) * k); }
      }
      kn.computeVertexNormals();
      p.add(along(kn, 0.094), copper);
      p.add(along(new THREE.SphereGeometry(0.018, 10, 6, 0, TAU, 0, Math.PI / 2), 0.110), brass);
      // spitcock: a small lever off the barrel, pointing forward
      p.add(faceAlong(new THREE.CapsuleGeometry(0.006, 0.05, 3, 6).rotateX(Math.PI / 2).translate(0, 0, 0.03),
        V3(B.x + d.x * 0.04, 0.315 - 0.045, B.z + d.z * 0.04), V3(0.15, -0.2, 1).normalize()), brass);
    }
    // THE AIR INLET: a gooseneck elbow out of the back of the bonnet turning down to meet
    // the feed hose, with a hex coupling nut at each end and the non-return valve body.
    {
      const P0 = V3(-0.323, 0.452, -0.306), P3 = V3(-0.352, 0.378, -0.338);
      const gc = new THREE.CatmullRomCurve3([P0, V3(-0.352, 0.476, -0.338), V3(-0.380, 0.452, -0.366), V3(-0.372, 0.408, -0.358), P3]);
      p.add(new THREE.TubeGeometry(gc, 14, 0.030, 10, false), brass);
      p.add(faceAlong(new THREE.CylinderGeometry(0.046, 0.050, 0.020, 6).rotateX(Math.PI / 2), P0, V3(-0.72, 0.05, -0.69).normalize()), brass);
      p.add(faceAlong(new THREE.CylinderGeometry(0.040, 0.040, 0.030, 6).rotateX(Math.PI / 2), P3, gc.getTangentAt(1)), brass);
      p.add(faceAlong(lathe([[0.034, 0], [0.042, 0.008], [0.042, 0.030], [0.034, 0.038]], 14).rotateX(Math.PI / 2),
        gc.getPointAt(0.5), gc.getTangentAt(0.5).negate()), brass);
    }
    p.add(xf(new THREE.CylinderGeometry(0.05, 0.056, 0.10, 8).rotateZ(0.5), 0.28, 0.30, -0.30, 0, 0.6, 0), brass);
    p.add(xf(new THREE.SphereGeometry(0.042, 8, 6), 0.30, 0.365, -0.325), copper);
    rivetRing(p, brass, 16, 0.436, 0.24, 0.021);
    p.bake();
  }

  // ---- the corselet: a BRASS breastplate over the dress, the front weight below it ----
  // The breastplate is the rigid collar the helmet locks to. It covers the shoulders and
  // upper chest only and stops at a rolled SKIRT, where the dress's rubber gasket is
  // clamped by four brass BRAILS on twelve studs, every stud dogged down with a wing nut —
  // the corselet's signature read at any distance. Below the skirt it is dress canvas
  // (the full-height lathe stays, in the dress, as what the brass is bolted over), and on
  // that canvas hangs the cast-lead FRONT WEIGHT, hooked to two of the studs. The old
  // pair of vent bosses that sat on the chest (a Mark V breastplate has none, and they
  // read as a pair of eyes) is gone.
  const BP = [
    [0.392, 0.055], [0.414, 0.092], [0.432, 0.158], [0.462, 0.240], [0.524, 0.328], [0.588, 0.424], [0.612, 0.500],
    [0.594, 0.578], [0.530, 0.648], [0.420, 0.706], [0.322, 0.746], [0.276, 0.772], [0.274, 0.816]
  ];
  const bpR = y => {                                          // profile radius at height y
    if (y <= BP[0][1]) return BP[0][0];
    for (let i = 1; i < BP.length; i++) if (y <= BP[i][1]) {
      const [r0, y0] = BP[i - 1], [r1, y1] = BP[i];
      return r0 + (r1 - r0) * (y - y0) / (y1 - y0);
    }
    return BP[BP.length - 1][0];
  };
  {
    const ZS = 0.78, SX = 0.93, SKIRT = 0.395;
    // crevice depth = how close a fitting sits to the corselet's (elliptical) surface
    const p = Part(cors, (x, y, z) => 1 - ss(0.004, 0.034, Math.hypot(x / SX, z / (SX * ZS)) - bpR(y)));
    // the dress under the brass, full height
    p.add(aux(lathe(BP, 30).scale(SX * 0.985, 1, ZS * 0.985), (x, y, z, o) => { o[1] = seamD(x, z, 1); }), leather);
    // the brass shell: the same profile from the skirt up, spun smooth (40 segments)
    const up = [[bpR(SKIRT) + 0.004, SKIRT]].concat(BP.filter(q => q[1] > SKIRT + 0.01));
    const shell = lathe(up, 40).scale(SX, 1, ZS);
    p.add(cav(shell, (x, y) => 0.55 * (1 - ss(0.0, 0.035, y - SKIRT)) + 0.6 * ss(0.765, 0.80, y)), brass);
    // rolled skirt edge and neck collar
    p.add(xf(new THREE.TorusGeometry(bpR(SKIRT) + 0.006, 0.013, 7, 40).rotateX(Math.PI / 2), 0, SKIRT).scale(SX, 1, ZS), brass);
    p.add(xf(new THREE.TorusGeometry(0.278, 0.026, 7, 28).rotateX(Math.PI / 2), 0, 0.804), brass);
    rivetRing(p, brass, 12, 0.284, 0.780, 0.020);
    // four BRAILS: flat brass straps pressing the gasket, broken at the shoulders
    const yb = SKIRT + 0.030, rb = bpR(yb);
    for (let k = 0; k < 4; k++) {
      const g = new THREE.TorusGeometry(rb + 0.012, 0.0085, 4, 12, TAU / 4 - 0.16).rotateZ(k * TAU / 4 + 0.08);
      p.add(g.rotateX(Math.PI / 2).scale(SX, 2.6, ZS).translate(0, yb, 0), brass);
    }
    // twelve studs, each with its wing nut, faced outward along the corselet normal
    for (let i = 0; i < 12; i++) {
      const a = (i + 0.5) / 12 * TAU, cx = Math.cos(a), sz = Math.sin(a);
      const pos = V3(cx * (rb + 0.022) * SX, yb, sz * (rb + 0.022) * SX * ZS);
      const dir = V3(cx / SX, 0, sz / (SX * ZS)).normalize();
      p.add(faceAlong(WING_PROTO.clone().scale(0.62, 0.62, 0.62), pos, dir, 0), brass);
    }
    // THE FRONT WEIGHT. ~16 kg of sand-cast lead, bent to the chest, hung on two hooks.
    {
      const W = 0.205, H = 0.29, Y0 = 0.035, Z0 = 0.43, BEND = 1.1;
      // a rounded slab (the rounding is the casting's draft), subdivided so it can BEND:
      // tapered toward the bottom, the top edge dipped to clear the skirt, the flanks
      // wrapped back round the chest
      const wg = new RoundedBoxGeometry(2 * W, H, 0.05, 4, 0.016);
      const wp = wg.attributes.position;
      for (let i = 0; i < wp.count; i++) {
        let x = wp.getX(i), y = wp.getY(i) + H / 2, z = wp.getZ(i);
        const u = x / W;
        x *= 0.84 + 0.16 * clamp(y / H, 0, 1) + 0.05 * ss(0.8, 1, y / H);
        y -= 0.018 * (1 - u * u) * ss(0.6, 1, y / H);
        z -= BEND * x * x + 0.10 * (1 - clamp(y / H, 0, 1));   // the bottom tucks in to the belly
        wp.setXYZ(i, x, y, z);
      }
      wg.computeVertexNormals();
      wg.translate(0, Y0, Z0);
      p.add(cav(wg, (x, y, z) => 0.35 * (1 - ss(0.0, 0.03, z - (Z0 - BEND * x * x - 0.10 * (1 - clamp((y - Y0) / H, 0, 1))) + 0.025))), lead);
      // cast boss with the two hanging eyes, and the brass hooks up to the skirt studs
      for (const hx of [-0.15, 0.15]) {
        const top = Y0 + H - 0.006, zf = Z0 + 0.012 - BEND * hx * hx;
        p.add(cav(xf(new THREE.TorusGeometry(0.020, 0.008, 6, 10), hx, top + 0.010, zf, 0, Math.PI / 2, 0), 0.25), lead);   // cast eye
        const hook = new THREE.CatmullRomCurve3([V3(hx, top + 0.004, zf + 0.004), V3(hx * 1.01, top + 0.040, zf + 0.030),
          V3(hx * 1.03, yb - 0.030, zf + 0.050), V3(hx * 1.03, yb - 0.004, zf + 0.056)]);
        p.add(new THREE.TubeGeometry(hook, 8, 0.0068, 5, false), brass);
      }
      // the webbing strap that holds the weight to the man, round the torso behind it
      p.add(aux(xf(band(0.500, 0.050, 0.665, 34), 0, 0.105), (x, y, z, o) => { o[0] = 0.4 * gau(x / 0.2); }), darkLeather);
      p.add(faceAlong(buckleGeo(0.07, 0.062, 0.0055), V3(0.494, 0.105, 0.03), V3(1, 0, 0.12).normalize(), Math.PI / 2), brass);
    }
    // Dress torso: slightly broader in x than the corselet so it reads at the sides. The
    // dress is AIR-FILLED, so the belly and flank balloon out below the corselet while
    // the twill pulls tauter across the shoulders where the breastplate pins it down.
    // (polish-followups) the profile is resampled finely enough to carry the BLOUSING: the
    // air-filled canvas between the corselet skirt and the belt is pushed down onto the
    // belt and folds over itself in soft horizontal creases that wander round the body —
    // the heavy duck (canvasSet) shows its weave on them, and they rub pale on the crests.
    const tk = [[0.000, -0.16], [0.336, -0.17], [0.398, -0.06], [0.464, 0.10], [0.536, 0.30], [0.582, 0.470], [0.556, 0.560], [0.000, 0.572]];
    const tp = [tk[0]];
    for (let i = 1; i < tk.length; i++) {
      const m = (i === 1 || i === tk.length - 1) ? 1 : (tk[i][1] < 0.35 ? 5 : 1);
      for (let k = 1; k <= m; k++) tp.push([tk[i - 1][0] + (tk[i][0] - tk[i - 1][0]) * k / m, tk[i - 1][1] + (tk[i][1] - tk[i - 1][1]) * k / m]);
    }
    const t = lathe(tp, 30);
    {
      const tpz = t.attributes.position;
      for (let i = 0; i < tpz.count; i++) {
        const x = tpz.getX(i), y = tpz.getY(i), z = tpz.getZ(i), rr = Math.hypot(x, z);
        if (rr < 1e-4) continue;
        const th = Math.atan2(z, x), env = ss(-0.15, -0.08, y) * (1 - ss(0.16, 0.30, y));
        const cr = Math.sin(y * 88 + 1.3 * Math.sin(2 * th + 0.4) + 0.7 * Math.sin(5 * th)) ;
        const k = 1 + env * (0.020 * Math.sign(cr) * Math.pow(Math.abs(cr), 0.6) + 0.012) / 0.5;
        tpz.setXYZ(i, x * k, y, z * k);
      }
      t.computeVertexNormals();
    }
    t.scale(1, 1, 0.66);
    p.add(aux(fold(t, 0.022, 7.5, 0.74), (x, y, z, o) => {
      o[1] = seamD(x, z, 1);
      const cr = Math.sin(y * 88 + 1.3 * Math.sin(2 * Math.atan2(z / 0.66, x) + 0.4) + 0.7 * Math.sin(5 * Math.atan2(z / 0.66, x)));
      o[0] = 0.55 * Math.max(0, cr) * ss(-0.15, -0.08, y) * (1 - ss(0.16, 0.30, y));
    }), cloth);
    p.bake();
  }

  // ---- pelvis, wide leather belt, pouches ----
  {
    const p = Part(hips);
    const pel = new THREE.CapsuleGeometry(0.338, 0.16, 6, 18);
    pel.scale(1, 1, 0.86);
    p.add(fold(xf(pel, 0, 0.02, 0), 0.034, 8, 0.74), cloth);
    // the dress sags at the seat, where the air in the suit can't reach and the canvas
    // just hangs on the man — the one place the silhouette should NOT be a smooth sweep
    const seatAux = (x, y, z, o) => {
      const rr = Math.hypot(x, z) || 1, bk = Math.max(0, -z) / rr;
      o[0] = 0.9 * gau((y + 0.24) / 0.13) * bk;
      o[1] = seamD(x, z, 1);
      if (z < 0) o[2] = (Math.hypot(x / 0.24, (y + 0.22) / 0.15) - 1) * 0.1;
    };
    // in the dress canvas, not the blue: it pokes through the trunks by design (the sag),
    // and in blue the poke-through read as a jagged tear
    const seat = new THREE.SphereGeometry(0.20, 12, 9);
    seat.scale(1.34, 0.80, 0.86);
    p.add(aux(fold(xf(seat, 0, -0.140, -0.140), 0.024, 9, 0.70), seatAux), leather);
    const trunk = new THREE.CapsuleGeometry(0.348, 0.13, 6, 18);       // leather trunks over the blue
    trunk.scale(1, 1, 0.86);
    // the seat takes every sit on a gunwale and every slide down a rock: worn pale, with
    // a reinforcing patch, and the side seams run down from the belt
    p.add(aux(xf(trunk, 0, -0.10, 0), seatAux), leather);
    // THE WEIGHT BELT: bridle leather, welted edges, a cast frame buckle with its prong
    // through the tongue at the front and a laced adjustment at the back.
    p.add(aux(xf(band(0.368, 0.20, 0.90, 32), 0, 0.03), (x, y, z, o) => { o[0] = 0.5 * gau((y - 0.03) / 0.12) * Math.max(0, -z) / 0.33; }), darkLeather);
    for (const yy of [-0.062, 0.122]) p.add(xf(new THREE.TorusGeometry(0.372, 0.014, 5, 32).rotateX(Math.PI / 2), 0, 0.03 + yy).scale(1, 1, 0.90), darkLeather);
    p.add(xf(new THREE.BoxGeometry(0.30, 0.118, 0.014), -0.02, 0.03, 0.336, 0, 0, 0), darkLeather);   // tongue under the frame
    p.add(xf(new THREE.CylinderGeometry(0.059, 0.059, 0.014, 14, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2), 0.13, 0.03, 0.336), darkLeather);
    p.add(xf(buckleGeo(0.205, 0.165, 0.011, false), 0, 0.03, 0.349), brass);
    p.add(xf(new THREE.CylinderGeometry(0.0075, 0.0075, 0.165, 7), -0.02, 0.03, 0.352), brass);       // centre bar
    p.add(xf(new THREE.CapsuleGeometry(0.0055, 0.085, 3, 6).rotateZ(Math.PI / 2), 0.030, 0.03, 0.357), brass);  // prong
    p.add(xf(new THREE.BoxGeometry(0.030, 0.140, 0.020), -0.13, 0.03, 0.343), darkLeather);          // keeper loop
    // back lacing: two rows of eyelets and a criss-cross thong
    {
      const bz = -0.334, ys = [-0.035, 0.005, 0.045, 0.085];
      for (const yy of ys) for (const lx of [-0.052, 0.052])
        p.add(xf(new THREE.TorusGeometry(0.0085, 0.0038, 5, 8), lx, yy, bz - 0.003), brass);
      for (let i = 0; i < ys.length - 1; i++) for (const sx of [-1, 1]) {
        const c = new THREE.LineCurve3(V3(sx * 0.052, ys[i], bz - 0.006), V3(-sx * 0.052, ys[i + 1], bz - 0.006));
        p.add(new THREE.TubeGeometry(c, 1, 0.0045, 4, false), darkLeather);
      }
      // (no loose tail: a 4.5 mm cord is nothing but rim, and the water's rim light made it neon)
    }
    for (const sx of [-1, 1]) {                              // hip D-rings on the belt
      p.add(xf(new THREE.TorusGeometry(0.042, 0.012, 5, 12), sx * 0.318, -0.02, 0.13, 0, sx * 1.1, 0), brass);
    }
    p.bake();
  }

  // ---- backpack shoulder straps + white trim flashes, lying on the carapace ----
  {
    const p = Part(cors);
    for (const sx of [-1, 1]) {
      // the harness straps lie ON the brass now and end above the skirt (buckled), instead
      // of hanging a brass block into the air under it
      p.add(xf(new THREE.BoxGeometry(0.072, 0.17, 0.016), sx * 0.20, 0.515, 0.432, -0.36, 0, sx * 0.05), darkLeather);
      p.add(xf(buckleGeo(0.086, 0.05, 0.006), sx * 0.20, 0.445, 0.440, -0.36, 0, sx * 0.05), brass);
    }
    p.bake();
  }

  // ---- backpack apparatus: tank, bottle, regulator box and its gauge ----
  {
    // (salprop) moved in with the shrunk corselet's back: the old (0, 0.40, -0.435) about CORS_Y x HELM_S
    const pk = new THREE.Group(); pk.position.set(0, 0.43225, -0.36975); spine.add(pk);
    g.pack = pk;
    const p = Part(pk);
    p.add(xf(new THREE.BoxGeometry(0.46, 0.60, 0.07), 0, 0.02, 0.075), darkLeather);      // back plate
    const tank = new THREE.CapsuleGeometry(0.148, 0.34, 6, 16);
    p.add(xf(tank, -0.03, 0.01, -0.10), steel);
    for (const yy of [-0.13, 0.15]) p.add(xf(new THREE.TorusGeometry(0.152, 0.020, 5, 16).rotateX(Math.PI / 2), -0.03, yy, -0.10), brass);
    p.add(xf(new THREE.CylinderGeometry(0.05, 0.058, 0.07, 10), -0.03, 0.235, -0.10), brass);
    p.add(xf(new THREE.CapsuleGeometry(0.072, 0.20, 5, 12), 0.215, -0.03, -0.045), copper);  // smaller bottle
    p.add(xf(new THREE.TorusGeometry(0.076, 0.016, 5, 12).rotateX(Math.PI / 2), 0.215, 0.075, -0.045), brass);
    p.add(xf(new THREE.BoxGeometry(0.30, 0.17, 0.16), -0.02, 0.30, -0.02), steel);          // regulator box
    p.add(xf(new THREE.BoxGeometry(0.32, 0.035, 0.175), -0.02, 0.375, -0.02), darkLeather);
    for (const sx of [-1, 1]) p.add(xf(new THREE.BoxGeometry(0.055, 0.62, 0.02), sx * 0.20, 0.02, 0.115), darkLeather);
    // the regulator's pressure gauge on its upper corner: brass bezel, ivory face, a
    // dark needle standing at working pressure. No emissive, no glow sprite.
    p.add(xf(new THREE.TorusGeometry(0.054, 0.015, 6, 16), 0.195, 0.352, -0.158), brass);
    p.add(xf(new THREE.CylinderGeometry(0.047, 0.047, 0.06, 16).rotateX(Math.PI / 2), 0.195, 0.352, -0.146), gaugeFace);
    p.add(xf(new THREE.BoxGeometry(0.0055, 0.034, 0.004).translate(0, 0.014, 0), 0.195, 0.352, -0.1775, 0, 0, -0.6), darkLeather);
    p.bake();
    // hose attachment point: shoulder/top of the main tank, where the feed hose rises off
    const hoseInlet = new THREE.Group();
    hoseInlet.position.set(-0.03, 0.33, -0.15);
    pk.add(hoseInlet);
    g.hoseInlet = hoseInlet;
  }

  // ---- corrugated feed hose: backpack regulator up to the helmet inlet ----
  {
    const p = Part(spine);
    const c = new THREE.CatmullRomCurve3([
      // regulator (pack + (-0.155, 0.355, -0.01)) up to the gooseneck's lower nut (neck + HELM_S x P3)
      V3(-0.155, 0.78725, -0.37975), V3(-0.215, 0.890, -0.360), V3(-0.282, 1.000, -0.318), V3(-0.2992, 1.0595, -0.2873)
    ]);
    p.add(new THREE.TubeGeometry(c, 24, 0.052, 12, false), hoseMat);
    // brass ferrules crimped on at both ends, and the union nut where it meets the regulator
    for (const t of [0, 1]) {
      const q = c.getPointAt(t), tan = c.getTangentAt(t);
      if (t === 0) tan.negate();
      p.add(faceAlong(lathe([[0.056, -0.05], [0.062, -0.044], [0.062, -0.006], [0.058, 0.0], [0.050, 0.004]], 16).rotateX(Math.PI / 2), q, tan), brass);
      for (let k = 0; k < 2; k++)                             // crimp ridges
        p.add(faceAlong(new THREE.TorusGeometry(0.0625, 0.0035, 4, 16).translate(0, 0, -0.036 + k * 0.018), q, tan), brass);
    }
    p.bake();
  }

  // ---- limbs ----
  // Joint hierarchy is CONTRACT: root (shoulder/hip) -> mid (elbow/knee) -> end
  // (wrist/ankle), with mid at -upLen and end at -loLen. The gait poses exactly these
  // three groups; only the skin hung on them changes here.
  function limb(parent, x, y, upLen, loLen, r, taper, inward, upProf, loProf) {   // inward 0 = no fabric gusset
    const root = new THREE.Group(); root.position.set(x, y, 0); parent.add(root);
    const mid = new THREE.Group(); mid.position.y = -upLen; root.add(mid);
    const end = new THREE.Group(); end.position.y = -loLen; mid.add(end);
    const pu = Part(root), pl = Part(mid);
    // capMask fences the fold into the segment's BODY (y in [-len, 0]) and fades it out
    // over the last 55mm at each end, so the rounded caps — whose poles starburst under
    // displacement, see fold() — are left perfectly smooth. Nothing is lost: both caps sit
    // buried inside the neighbouring segment and its gather rings.
    const capMask = len => (_x, y) => ss(0, 0.055, -y) * ss(0, 0.055, y + len);
    // WEAR, SEAMS AND PATCHES, baked in the segment's own frame (+Z forward, -Z back;
    // the elbow points back, the knee forward). rr normalises "which side of the limb".
    const sx = x > 0 ? 1 : -1, arm = inward !== 0, ns = arm ? 1 : 2;   // arms: under+outer seam; legs: four panels
    pu.auxFn = (px, py, pz, o) => {
      const rr = Math.hypot(px, pz) || 1, fr = Math.max(0, pz) / rr, bk = Math.max(0, -pz) / rr;
      o[1] = seamD(px, pz, ns);
      o[0] = arm
        ? 0.85 * gau((py + 0.03) / 0.07) * Math.max(0, px * sx) / rr + 0.9 * gau((py + upLen * 0.95) / 0.07) * bk
        : 0.7 * gau((py + upLen * 0.93) / 0.07) * fr + 0.8 * gau((py + 0.05) / 0.10) * bk;
    };
    pl.auxFn = (px, py, pz, o) => {
      const rr = Math.hypot(px, pz) || 1, fr = Math.max(0, pz) / rr, bk = Math.max(0, -pz) / rr;
      o[1] = seamD(px, pz, ns);
      if (arm) {
        o[0] = 1.0 * gau((py + 0.03) / 0.08) * bk + 0.35 * gau((py + loLen * 0.6) / 0.12) * Math.max(0, -px * sx) / rr;
        // elbow reinforcing patch: an ellipse on the back of the joint
        if (pz < 0) o[2] = (Math.hypot(px / 0.078, (py + 0.075) / 0.105) - 1) * 0.08;
      } else {
        o[0] = 1.0 * gau((py + 0.03) / 0.09) * fr + 0.55 * gau((py + 0.25) / 0.09) * fr;
      }
    };
    pu.add(aux(fold(segGeo(upLen, r, upProf), 0.024, 11, 1, capMask(upLen)), pu.auxFn), leather);
    pl.add(aux(fold(segGeo(loLen, r, loProf), 0.021, 12, 1, capMask(loLen)), pl.auxFn), leather);
    // blue fabric underlayer: a gusset down the inner limb and a ring at the joint
    if (inward) {
      pu.add(fold(xf(new THREE.CapsuleGeometry(r * 0.42, upLen * 0.44, 5, 10), inward * r * 0.80, -upLen * 0.54, 0), 0.020, 13, 0.74), cloth);
      // clears the sleeve's fold displacement so the band never breaks into patches
      pu.add(xf(tapeBand(r * upProf(0.20) * 1.09, 0.058, 0.98, 0.0065, 26, x * 7), 0, -upLen * 0.20), trim);
    }
    // the joint filler is the SAME canvas as the sleeve: in blue it poked through the
    // folded segment caps as a jagged zig-zag at every knee and elbow
    pl.add(aux(fold(xf(new THREE.CapsuleGeometry(r * loProf(0.02) * 1.0, 0.05, 6, 14), 0, 0.015, 0), 0.018, 14, 0.74), pl.auxFn), leather);
    return { root, mid, end, pu, pl, r, upLen, loLen, taper, up: upProf, lo: loProf };
  }
  // the diver faces +Z, so his right side is -X
  g.armR = limb(spine, -0.460, 0.615, 0.50, 0.42, 0.150, 0.86, 1, P_UPARM, P_FOREARM);
  g.armL = limb(spine, 0.460, 0.615, 0.50, 0.42, 0.150, 0.86, -1, P_UPARM, P_FOREARM);
  g.legR = limb(hips, -0.225, 0.0, 0.668, 0.6815, 0.186, 0.88, 0, P_THIGH, P_SHANK);
  g.legL = limb(hips, 0.225, 0.0, 0.668, 0.6815, 0.186, 0.88, 0, P_THIGH, P_SHANK);

  // sleeves: piping down the outer seam, and the canvas bunching at the elbow
  for (const [arm, sx] of [[g.armR, -1], [g.armL, 1]]) {
    const { pu, pl, r, upLen, loLen } = arm;
    // in `leather`, not darkLeather: the sleeve Parts carry no dark bucket, and a second
    // bucket here is a second draw call per arm. A raised ridge in the same canvas still
    // reads as a seam off its own shading — it does not need a contrasting colour.
    piping(pu, leather, upLen, r, P_UPARM, sx, 0, 0.012);
    piping(pl, leather, loLen, r, P_FOREARM, sx, 0, 0.011);
    bunch(pu, leather, r * P_UPARM(0.90), -upLen * 0.90, 2, 0.055, 0.026);
    bunch(pl, leather, r * P_FOREARM(0.10), -loLen * 0.10, 3, 0.050, 0.028);
  }

  // trousers: panel seams, stitched knee pads, thigh + under-knee straps
  for (const leg of [g.legR, g.legL]) {
    const { pu, pl, r, upLen, loLen } = leg;
    const rU = s => r * P_THIGH(s), rL = s => r * P_SHANK(s);   // surface radius at a given s
    // outer and back seam piping, riding the thigh's swell instead of cutting straight down it
    for (const sx of [1, -1]) piping(pu, darkLeather, upLen, r, P_THIGH, sx, 0, 0.013);
    for (const sz of [1, -1]) piping(pu, darkLeather, upLen, r, P_THIGH, 0, sz, 0.011);
    piping(pl, darkLeather, loLen, r, P_SHANK, 1, 0, 0.011);
    piping(pl, darkLeather, loLen, r, P_SHANK, -1, 0, 0.011);
    // the dress gathers into the groin at the top of the thigh, and above the knee
    bunch(pu, leather, rU(0.06), -upLen * 0.06, 3, 0.056, 0.032);
    bunch(pu, leather, rU(0.90), -upLen * 0.90, 2, 0.052, 0.026);
    bunch(pl, leather, rL(0.10), -loLen * 0.10, 3, 0.048, 0.030);
    for (const s of [0.356, 0.712]) {                        // thigh straps with tiny buckles
      const yy = -upLen * s;
      pu.add(xf(band(rU(s) * 1.04, 0.048, 0.95, 14), 0, yy), darkLeather);
      pu.add(xf(buckleGeo(0.062, 0.056, 0.0055), 0, yy, rU(s) * 1.055), brass);
    }
    const kz = rL(0.118);                                     // knee pad rides the shank's surface
    const pad = new THREE.SphereGeometry(0.10, 12, 8);        // stitched knee pad, flattened
    pad.scale(1.42, 1.72, 0.40);
    pl.add(xf(pad, 0, -0.055, kz * 1.04), darkLeather);   // proud of the knee gather, which cut through it
    for (let i = 0; i < 12; i++) {                           // stitch dots round the pad
      const a = i / 12 * TAU;
      pl.add(xf(new THREE.SphereGeometry(0.011, 5, 4), Math.cos(a) * 0.128, -0.055 + Math.sin(a) * 0.155, kz * 1.10), leather);
    }
    pl.add(xf(band(rL(0.43) * 1.05, 0.042, 0.95, 14), 0, -0.20), darkLeather);
    pl.add(xf(buckleGeo(0.056, 0.05, 0.005), 0, -0.20, rL(0.43) * 1.06), brass);
  }
  for (const l of [g.armR, g.armL]) { l.pu.bake(); l.pl.bake(); }   // the legs bake after the boot (its cuff rides the shin)

  // GAUNTLETS. The forearm now tapers hard into a 0.090 wrist, so the cuff FLARES back
  // out over it — a laced canvas bell, a lace band with brass eyelets, then a mitten with
  // a real knuckle ridge and an opposed thumb. Hands are half of what makes a silhouette
  // read as a man; a rounded stump at the end of a sleeve reads as a mannequin.
  for (const [arm, s] of [[g.armR, -1], [g.armL, 1]]) {
    const p = Part(arm.end);
    // the cuff bell: canvas gathered at the wrist by a drawstring (a ruffle above the cord,
    // knife pleats flaring below it), its lower edge bound in a woven tape that carries
    // the lace eyelets (polish-followups: real pleats, not a smooth lathe and a torus)
    const wc = pleatCuff([[0.150, 0.098], [0.118, 0.101], [0.100, 0.118], [0.060, 0.146], [0.030, 0.148],
      [0.004, 0.140], [-0.018, 0.126], [-0.034, 0.114]], 0.118, 12, 0.020, y => ss(0.030, 0.056, y), 0.0055, 48, 8, 1);
    p.add(wc.cuff, cloth);
    p.add(wc.cord.rotateY(s > 0 ? 0.5 : Math.PI - 0.5), darkLeather);
    p.add(xf(tapeBand(0.150, 0.032, 1, 0.0065, 26, s * 3), 0, 0.034), trim);   // lace tape
    for (let i = 0; i < 6; i++) {                            // lace eyelets
      const a = i / 6 * TAU;
      p.add(xf(new THREE.TorusGeometry(0.0085, 0.0034, 5, 8).rotateY(-a + Math.PI / 2), Math.cos(a) * 0.1575, 0.034, Math.sin(a) * 0.1575), brass);
    }
    p.add(xf(new THREE.TorusGeometry(0.126, 0.015, 5, 14).rotateX(Math.PI / 2), 0, -0.032), darkLeather);   // cuff welt
    p.add(xf(new THREE.CylinderGeometry(0.120, 0.112, 0.05, 12), 0, -0.058), rubber);                       // glove mouth
    // the mitten mass, cocked slightly forward as a relaxed hand hangs
    const mitt = new THREE.CapsuleGeometry(0.100, 0.112, 6, 14);
    mitt.scale(0.92, 1, 0.76);
    p.add(xf(mitt, 0, -0.150, 0.020, 0.22), rubber);
    for (let i = 0; i < 4; i++)                              // knuckle ridge across the back of the hand
      p.add(xf(new THREE.SphereGeometry(0.030, 7, 6).scale(1, 0.80, 1), (-1.5 + i) * 0.046, -0.196, 0.050), rubber);
    p.add(xf(new THREE.CapsuleGeometry(0.042, 0.142, 5, 10).rotateZ(Math.PI / 2), 0, -0.244, 0.038), rubber);   // curled fingers, one roll
    p.add(xf(new THREE.CapsuleGeometry(0.033, 0.126, 4, 9).rotateZ(Math.PI / 2), 0, -0.282, 0.012), rubber);
    // opposed thumb, outboard: two phalanges and a knuckle
    p.add(xf(new THREE.CapsuleGeometry(0.036, 0.058, 4, 8), s * 0.080, -0.168, 0.048, 0.45, 0, s * 0.85), rubber);
    p.add(xf(new THREE.CapsuleGeometry(0.030, 0.048, 4, 8), s * 0.100, -0.218, 0.076, 0.95, 0, s * 0.55), rubber);
    p.add(xf(new THREE.SphereGeometry(0.027, 6, 5), s * 0.090, -0.198, 0.062), darkLeather);
    p.bake();
  }

  // BOOTS. The shank now tapers to a 0.112 ankle, so the boot flares back out over it:
  // sock cuff, a lathed leather ankle flare, then a foot with actual form — a vamp, a
  // domed toe box, a stacked heel block under a lead sole. The sole's underside sits at
  // exactly SOLE_Y in the ankle frame: LIFT is derived against it.
  // THE BOOT IS TWO PIECES since the ankle came down (THE LEG RIG). Everything that is
  // tied to the LEG — the pleated gaiter, its tape, the leather ankle flare, the ankle
  // strap — rides the SHIN (leg.mid), because the joint is now below them; the FOOT — vamp,
  // laces, instep strap, toe box and cap, heel, sole — rides the ankle (leg.end). Both are
  // the old shapes at the old heights over the sole (old y + BOOT_D): the boot looks the
  // same standing, and now creases at the instep when the foot pitches, like a boot.
  for (const leg of [g.legR, g.legL]) {
    const p = Part(leg.end), pc = leg.pl;                   // the cuff merges into the shin's own buckets
    const CY = -leg.loLen + BOOT_D;                          // the shin frame's y of an old ankle-frame 0
    // (polish-followups) a pleated canvas gaiter over the boot top: gathered at the ankle by a
    // drawstring, a ruffle standing above the cord, knife pleats flaring below it into a
    // woven tape that binds its lower edge over the boot's cuff
    const ac = pleatCuff([[0.100, 0.122], [0.066, 0.132], [0.036, 0.118], [0.000, 0.140], [-0.045, 0.146], [-0.080, 0.140]],
      0.036, 14, 0.022, y => 1 - ss(0.028, 0.040, -y), 0.0058, 56, 8, 0.95);
    pc.add(ac.cuff.translate(0, CY, 0), cloth);
    pc.add(ac.cord.rotateY(leg === g.legL ? 0.35 : Math.PI - 0.35).translate(0, CY, 0), darkLeather);
    pc.add(xf(tapeBand(0.150, 0.040, 0.95, 0.0065, 26, leg === g.legL ? 1 : 4), 0, CY - 0.058), trim);
    // Ankle flare: the boot's leather cuff opening out from the narrow ankle. A CLOSED
    // solid, not an open lathe skirt — an open lathe here showed its back faces through
    // the mouth and read as a lampshade hung round the leg.
    pc.add(xf(new THREE.CylinderGeometry(0.120, 0.170, 0.20, 22, 1).scale(1, 1, 0.96), 0, CY - 0.095), darkLeather);
    pc.add(xf(new THREE.TorusGeometry(0.168, 0.021, 6, 16).rotateX(Math.PI / 2).scale(1, 1, 0.96), 0, CY - 0.176), darkLeather);
    // ankle strap round the top of the boot, buckled on the outside
    pc.add(xf(band(0.157, 0.040, 0.96, 24), 0, CY - 0.118), darkLeather);
    pc.add(faceAlong(buckleGeo(0.048, 0.042, 0.0045), V3(0.160, CY - 0.118, 0.0), V3(1, 0, 0), Math.PI / 2), brass);
    leg.pu.bake(); leg.pl.bake();
    // ---- the foot, in the ankle frame: every old height + BOOT_D ----
    const F = BOOT_D;
    // vamp: the body of the foot, broader at the ball than at the ankle. These are
    // WEIGHTED boots — a hundredweight of brass and lead between the two of them — so the
    // foot has to out-mass the ankle by a lot or it reads as a slipper under a heavy leg.
    const vamp = new THREE.CapsuleGeometry(0.120, 0.21, 6, 12).rotateX(Math.PI / 2);
    vamp.scale(1.06, 0.90, 1);
    p.add(xf(vamp, 0, F - 0.238, 0.070), darkLeather);   // boots are leather, not dress canvas
    // the boot's throat over the ankle bone: fills the crease between the flare (on the
    // shin) and the vamp (on the foot) so a pitched foot never opens a gap at the instep
    p.add(xf(new THREE.SphereGeometry(0.128, 14, 9).scale(1.0, 0.85, 1.05), 0, F - 0.205, -0.01), darkLeather);
    for (let i = 0; i < 4; i++) {                            // laces over the instep
      p.add(xf(new THREE.CylinderGeometry(0.011, 0.011, 0.21, 5).rotateZ(Math.PI / 2), 0, F - 0.150 + i * 0.012, 0.05 + i * 0.054, 0.28, 0, 0), darkLeather);
      for (const sx of [1, -1]) p.add(xf(new THREE.SphereGeometry(0.015, 5, 4), sx * 0.106, F - 0.150 + i * 0.012, 0.05 + i * 0.054), brass);
    }
    // instep strap: a real strap arched over the vamp, square frame buckle on the outside
    p.add(xf(new THREE.TorusGeometry(0.128, 0.013, 4, 16, Math.PI).scale(1.08, 0.94, 2.3), 0, F - 0.236, 0.112), darkLeather);
    p.add(faceAlong(buckleGeo(0.052, 0.046, 0.0045), V3(0.139, F - 0.222, 0.112), V3(1, 0.25, 0).normalize(), Math.PI / 2), brass);
    const toe = new THREE.SphereGeometry(0.124, 14, 9);       // toe box: wider than it is tall
    toe.scale(1.10, 0.80, 1.26);
    p.add(xf(toe, 0, F - 0.244, 0.185), darkLeather);
    // BRASS TOE CAP: a spun shell over the front of the toe box, standing 5% proud of it
    // (a co-surfaced cap z-fights, which is why the old build fell back to a steel rand),
    // with a rolled rim and a line of cap rivets. It is the Mark V boot's signature.
    {
      const capG = new THREE.SphereGeometry(0.124, 18, 8, Math.PI * 0.10, Math.PI * 0.80, 0, Math.PI * 0.60);
      capG.scale(1.10 * 1.05, 0.80 * 1.05, 1.26 * 1.05);
      p.add(cav(xf(capG, 0, F - 0.244, 0.185), (x, y, z) => 0.7 * (1 - ss(F - 0.33, F - 0.29, y)) + 0.5 * (1 - ss(0.13, 0.16, z))), brass);
      // rim: follows the cap's open edge (theta = 0.6 PI) round the front
      const rim = [];
      for (let i = 0; i <= 12; i++) {
        const ph = Math.PI * (0.10 + 0.80 * i / 12), th = Math.PI * 0.60, R = 0.124 * 1.05;
        rim.push(V3(-R * Math.cos(ph) * Math.sin(th) * 1.10, F - 0.244 + R * Math.cos(th) * 0.80, 0.185 + R * Math.sin(ph) * Math.sin(th) * 1.26));
      }
      p.add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rim), 16, 0.006, 5, false), brass);
      for (let i = 1; i < 12; i += 2) p.add(xf(new THREE.SphereGeometry(0.0065, 5, 4), rim[i].x * 1.02, rim[i].y + 0.008, rim[i].z + 0.004), brass);
    }
    p.add(xf(new THREE.BoxGeometry(0.210, 0.085, 0.150), 0, F - 0.286, -0.085), darkLeather);                // stacked heel block
    // THE LEAD SOLE: one casting in the outline of the foot (heel, waist, ball, toe),
    // chamfered all round, nailed through to the welt. Its underside is the contract:
    // it sits at exactly SOLE_Y in the ankle frame, which the IK plants on.
    {
      const sh = new THREE.Shape(), outline = [
        [0.000, -0.185], [0.070, -0.176], [0.100, -0.140], [0.104, -0.060], [0.098, 0.030], [0.122, 0.130],
        [0.130, 0.215], [0.112, 0.285], [0.066, 0.328], [0.000, 0.338]];
      const pts = outline.concat(outline.slice(1, -1).reverse().map(q => [-q[0], q[1]]));
      sh.moveTo(pts[0][0], -pts[0][1]);
      sh.splineThru(pts.slice(1).map(q => new THREE.Vector2(q[0], -q[1])).concat([new THREE.Vector2(pts[0][0], -pts[0][1])]));
      const SOLE = SOLE_Y, BT = 0.009, DEP = 0.048;
      const sole = new THREE.ExtrudeGeometry(sh, { depth: DEP, bevelEnabled: true, bevelThickness: BT, bevelSize: 0.008,
        bevelSegments: 2, curveSegments: 3, steps: 1 });
      sole.rotateX(-Math.PI / 2).translate(0, SOLE + BT, 0);
      p.add(cav(sole, (x, y) => 0.45 * ss(SOLE + 0.05, SOLE + 0.066, y)), lead);
      // leather welt where the upper meets the lead, and the brass sole nails through it
      const wc = new THREE.CatmullRomCurve3(pts.map(q => V3(q[0] * 1.01, SOLE + DEP + 2 * BT + 0.003, q[1] * 1.01)), true);
      p.add(new THREE.TubeGeometry(wc, 40, 0.0105, 5, true), darkLeather);
      for (let i = 0; i < 14; i++) {
        const q = wc.getPointAt(i / 14);
        p.add(xf(new THREE.SphereGeometry(0.0072, 5, 4), q.x * 1.04, SOLE + DEP * 0.62, q.z * 1.04), brass);
      }
    }
    p.bake();
  }

  // ---- knife rig: scabbard strapped to the LEFT thigh (the right hand holds the lantern) ----
  {
    const { r } = g.legL;
    // TH swings the whole rig round to the outboard-rear quarter of the thigh: dead
    // outboard puts the hilt inside the hanging fist, and the draw wants it behind the palm.
    const TH = 0.62, ct = Math.cos(TH), st = Math.sin(TH);
    // two retaining straps over the trouser, offset from the existing thigh straps
    const p = Part(g.legL.root);
    for (const yy of [-0.155, -0.335]) {
      p.add(xf(band(r * 1.10, 0.040, 0.95, 14), 0, yy), darkLeather);
      for (const sz of [1, -1]) p.add(xf(new THREE.SphereGeometry(0.013, 6, 5), r * 1.02, yy, sz * 0.055), brass);
      // the same strap carries on over the scabbard's outboard face, with a stud
      p.add(xf(new THREE.BoxGeometry(0.022, 0.038, 0.130), r * 1.46 * ct, yy, -r * 1.46 * st, 0, TH, 0.10), darkLeather);
      p.add(xf(new THREE.SphereGeometry(0.013, 6, 5), r * 1.50 * ct + 0.04 * st, yy, -r * 1.50 * st + 0.04 * ct), brass);
    }
    p.bake();

    // scabbard frame: outboard-rear face of the thigh, hilt canted forward to the hand.
    // Outer group carries the cant; the inner one turns the scabbard's flat faces
    // outboard (its geometry is flattened in Z), so it lies against the thigh.
    const sh = new THREE.Group();
    sh.position.set(r * 1.24 * ct, -0.235, -r * 1.24 * st);
    sh.rotation.set(0.16, TH, 0.10);
    // the suit is a big, stylised silhouette: the knife is widened (not lengthened) so it
    // still reads as a heavy dive knife from the gameplay camera
    sh.scale.set(1.40, 1.06, 1.40);
    g.legL.root.add(sh);
    const sh2 = new THREE.Group();
    sh2.rotation.y = Math.PI / 2 + 0.10;
    sh.add(sh2);
    sheathGeo(Part(sh2)).bake();
    g.knifeSheath = sh;

    // the knife itself, twice: home in the scabbard, and gripped in the left fist.
    // triggerSlash() just swaps which one is visible — no reparenting, no allocation.
    const home = new THREE.Group();
    home.position.y = 0.090;
    sh2.add(home);
    knifeGeo(Part(home)).bake();
    g.knifeHome = home;

    const held = new THREE.Group();
    held.position.set(0.030, -0.208, 0.062);
    held.rotation.set(-1.62, 0, 0.16);          // blade forward out of the fist
    held.scale.set(1.40, 1.06, 1.40);
    held.visible = false;
    g.armL.end.add(held);
    knifeGeo(Part(held)).bake();
    g.knifeHeld = held;

    // faint water-drag arc: one flattened ring segment in the swing plane, additive,
    // opacity driven only while the blade is moving. Single mesh, no shadow.
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.13, 0.34, 12, 1, 1.05, 1.35), dragMat);
    arc.rotation.set(Math.PI / 2, 0, 0);
    arc.position.set(0, -0.235, 0.10);
    arc.castShadow = arc.receiveShadow = false;
    arc.visible = false;
    g.armL.end.add(arc);
    g.slashArc = arc;
  }

  // The old 5-segment "surface umbilical" stub that dangled off the neck is gone:
  // the real verlet tether (systems/tether.js) now docks at the backpack inlet, and
  // the stub just clipped through the torso next to it.

  // ---- lantern: brass cage, glass panes, live flame ----
  {
    const pivot = new THREE.Group();
    // (salprop) under the middle of the fist: the bail's top is the rigged hand's grip bar
    pivot.position.set(0.004, -0.285, 0.062);
    g.armR.end.add(pivot);
    g.lantPivot = pivot;
    const bail = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.011, 5, 14, Math.PI), brass);
    bail.rotation.y = Math.PI / 2; pivot.add(bail);
    const lantern = new THREE.Group();
    lantern.position.y = -0.085;
    lantern.scale.setScalar(1.25);
    pivot.add(lantern);

    // THE LANTERN as a made thing: round brass posts and bowed guard wires (the members
    // that cast the streaked light), a blown glass globe on a brass fount with its wick,
    // and a vented crown that lets the heat out. The flame, core and halo are unchanged.
    const cage = Part(lantern);
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * TAU + Math.PI / 4;
      cage.add(xf(new THREE.CylinderGeometry(0.0085, 0.0085, 0.25, 6), Math.cos(a) * 0.098, -0.145, Math.sin(a) * 0.098), brass);
      const b = a + Math.PI / 4;                              // a guard wire between each pair of posts
      const w = new THREE.CatmullRomCurve3([V3(Math.cos(b) * 0.094, -0.088, Math.sin(b) * 0.094),
        V3(Math.cos(b) * 0.110, -0.145, Math.sin(b) * 0.110), V3(Math.cos(b) * 0.094, -0.202, Math.sin(b) * 0.094)]);
      cage.add(new THREE.TubeGeometry(w, 6, 0.0045, 4, false), brass);
    }
    for (const yy of [-0.085, -0.205]) cage.add(xf(new THREE.TorusGeometry(0.098, 0.009, 6, 24).rotateX(Math.PI / 2), 0, yy), brass);
    cage.add(xf(new THREE.TorusGeometry(0.106, 0.005, 5, 24).rotateX(Math.PI / 2), 0, -0.145), brass);
    cage.bake(true);

    const shell = Part(lantern);  // bulky caps: no shadow, they'd swallow the seafloor light
    shell.add(lathe([[0.000, 0.02], [0.055, 0.015], [0.075, -0.005], [0.118, -0.03], [0.128, -0.048], [0.106, -0.055], [0.100, -0.062]], 24), brass);
    // vented crown on the cap: a short stack with a hood, the vents dark (deep crevice)
    shell.add(lathe([[0.000, 0.078], [0.030, 0.078], [0.044, 0.068], [0.046, 0.060], [0.034, 0.056], [0.034, 0.030], [0.052, 0.022], [0.056, 0.014]], 18), brass);
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU;
      shell.add(cav(faceAlong(new THREE.CircleGeometry(0.0075, 8), V3(Math.cos(a) * 0.0345, 0.043, Math.sin(a) * 0.0345), V3(Math.cos(a), 0, Math.sin(a))), 1), brass);
    }
    shell.add(lathe([[0.000, -0.315], [0.105, -0.312], [0.118, -0.295], [0.112, -0.255], [0.100, -0.245]], 24), brass);
    // the fount and burner, and the wick (a crevice-dark stub under the flame)
    shell.add(lathe([[0.000, -0.245], [0.062, -0.245], [0.066, -0.236], [0.052, -0.214], [0.024, -0.205], [0.021, -0.193], [0.000, -0.193]], 18), brass);
    shell.add(cav(xf(new THREE.CylinderGeometry(0.010, 0.011, 0.016, 8), 0, -0.186), 1), brass);
    // the blown globe, bellied, open top and bottom
    shell.add(lathe([[0.050, -0.242], [0.068, -0.228], [0.082, -0.200], [0.087, -0.160], [0.084, -0.118], [0.072, -0.084], [0.056, -0.064]], 20), lantGlass);
    shell.bake(false);

    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.030, 0.10, 7), flameMat);
    flame.position.y = -0.15; lantern.add(flame);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.026, 8, 6), new THREE.MeshBasicMaterial({ color: 0xfff2cf }));
    core.position.y = -0.175; lantern.add(core);
    const glow = makeGlow(0xffdf9e, 0.75);
    glow.position.y = -0.16; lantern.add(glow);

    const lant = new THREE.Group();   // lanternWorldPos() resolves through this
    lant.position.y = -0.16;
    lantern.add(lant);
    g.lant = lant; g.flame = flame; g.glow = glow; g.core = core;
  }

  scene.add(g);
  return g;
})();

// ---- exhaust bubbles ----
// A Mark V vents through the one-way valve by the faceplate in BURSTS, one per exhale:
// one or two large lead bubbles then a ~half-second trail of small ones, and near
// silence between breaths. The cycle is the single breath clock (breathPh below) that
// also lifts the shoulders, so chest and water agree. Bubbles rise toward a
// size-dependent terminal velocity, corkscrew (small = fast tight helix, big = slow
// wide one), expand as the pressure comes off on a long climb, and die into the actual
// swell surface rather than a flat plane.
const BUBN = 200;
const bubMat = new THREE.MeshStandardMaterial({
  color: 0xd6ecff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.62,
  depthWrite: false, envMap: envTex, envMapIntensity: 2.0
});
registerPaint(bubMat, { hero: true });   // a bubble is a mirror at grazing incidence: hero
// Silvery fresnel rim — a real bubble is a mirror at grazing incidence, and at the
// 9-unit third-person distance the flat translucent ball read as nothing at all. An
// emissive rim (NOT additive glow: it still fogs, still darkens with depth via the
// per-channel fog chunk applied after) puts a bright edge on every bubble that
// catches whatever the water's own light is doing. No backticks live in this GLSL.
// The rim is REFLECTED light, so it scales with the light the bubble receives (the same
// diffuse irradiance proxy the kelp uses: lit diffuse / albedo), not a constant: as a
// fixed emissive it lit every bubble the same pale blue-white in zone 2's black water,
// where a lead bubble passing the lens read as a glowing white polygon. Beside the
// lantern the rim now catches the flame; in the dark it is gone. The ball is 12 x 8
// (was 7 x 5, whose heptagon silhouette showed on every bubble near the camera).
// uBubAmb: the water's own radiance at the camera against the zone-0 floor (1 there, a
// trace in the deep zones) — the same normalisation the marine snow uses — so the
// shallows keep the rim they were tuned with and the abyss does not.
const uBubAmb = { value: 1 };
bubMat.onBeforeCompile = (sh) => {
  sh.uniforms.uBubAmb = uBubAmb;
  sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uBubAmb;')
    .replace('#include <lights_fragment_end>',
    '#include <lights_fragment_end>\n' +
    'float bubFr = pow( 1.0 - abs( dot( normalize( vNormal ), normalize( vViewPosition ) ) ), 3.0 );\n' +
    'vec3 bubIrr = ( reflectedLight.directDiffuse + reflectedLight.indirectDiffuse ) / max( diffuseColor.rgb, vec3( 0.05 ) );\n' +
    'float bubD = min( dot( reflectedLight.directDiffuse / max( diffuseColor.rgb, vec3( 0.05 ) ), vec3( 0.2126, 0.7152, 0.0722 ) ) * 3.1416, 1.2 );\n' +
    'reflectedLight.indirectSpecular += vec3( 0.60, 0.71, 0.80 ) * bubFr * 0.60 * uBubAmb\n' +
    '  + bubIrr / max( dot( bubIrr, vec3( 0.333 ) ), 1e-4 ) * bubFr * 0.45 * bubD;');
};
bubMat.customProgramCacheKey = () => 'salBubbleRim';
const bubbles = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 8), bubMat, BUBN);
bubbles.frustumCulled = false;
bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
bubbles.castShadow = bubbles.receiveShadow = false;
scene.add(bubbles);
const bub = [];
for (let i = 0; i < BUBN; i++) bub.push({ p: V3(), v: V3(), r: 0, y0: 0, wf: 1, wa: 0, life: 0, max: 1, ph: rng(0, 7) });

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _sv = V3(1, 1, 1), _tmp = V3(), _ex = V3();
const _drift = V3();                  // per-burst emission bias (head-turn column drift)
let bubCursor = 0, trickle = 1.2;

// Deterministic per-breath hash — the per-frame trail path never touches Math.random.
const h01 = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// wobK scales the helix radius — the occasional big "gulp" bubble wobbles hard.
function emitBubble(at, vel, rMin, rMax, seed, wobK = 1) {
  const b = bub[bubCursor]; bubCursor = (bubCursor + 1) % BUBN;
  const j1 = h01(seed) - 0.5, j2 = h01(seed + 17.3) - 0.5, j3 = h01(seed + 41.7) - 0.5;
  b.p.copy(at).add(_tmp.set(j1 * 0.09, j2 * 0.05, j3 * 0.09));
  b.v.set(j2 * 0.35, 0.55 + h01(seed + 5.1) * 0.5, j1 * 0.35)
    .addScaledVector(vel, 0.22).add(_drift);
  b.r = rMin + (rMax - rMin) * h01(seed + 9.7);
  b.y0 = b.p.y;
  // Helix: frequency inversely proportional to size, radius growing with size.
  b.wf = clamp(0.14 / b.r, 3.0, 11.0);
  b.wa = clamp((0.09 + b.r * 2.2) * wobK, 0.1, 0.55);
  b.ph = h01(seed + 23.9) * TAU;
  b.max = 24; b.life = b.max;         // long enough to make the surface from depth
}

function updateBubbles(dt, t, vel) {
  const storm = stormLevel();
  for (let i = 0; i < BUBN; i++) {
    const b = bub[i];
    if (b.life > 0) {
      b.life -= dt;
      // Rise toward a size-dependent terminal velocity — the big lead bubbles of a
      // burst pull away from their own trail, which is most of the read.
      const vT = clamp(0.55 + b.r * 30, 0.6, 2.6);
      b.v.y += (vT - b.v.y) * Math.min(1, dt * 1.6);
      const hd = Math.exp(-2.4 * dt);
      b.v.x *= hd; b.v.z *= hd;
      b.p.addScaledVector(b.v, dt);
      const w = b.ph + t * b.wf;
      b.p.x += Math.cos(w) * b.wa * dt;             // helical corkscrew on the rise
      b.p.z += Math.sin(w) * b.wa * dt;
      // Expansion with altitude: ~1.5x over a 30 u climb as the pressure comes off.
      const grow = 1 + 0.5 * clamp((b.p.y - b.y0) / 30, 0, 1);
      // A bubble that reaches the surface vanishes INTO it — sampled at the real
      // swell height, not the flat datum, so none linger under a trough or pop
      // through a crest into the sky.
      if (b.p.y >= SURFACE_Y + surfaceHeightAt(b.p.x, b.p.z, t, storm)) {
        b.life = 0;
        // The death site BOILS: every bubble that makes the ceiling feeds the water
        // shader's boil patch, sized by the bubble that burst. A dense burst arriving
        // over ~a second holds the patch seething; a stray trickle barely dimples it.
        surfaceBoil(b.p.x, b.p.z, clamp(b.r * grow * 2.6, 0.05, 0.45));
      }
      const k = b.life / b.max;
      _sv.setScalar(b.r * grow * ss(0, 0.04, 1 - k) * ss(0, 0.06, k));
    } else _sv.setScalar(0);
    _m4.compose(b.p, _q, _sv);
    bubbles.setMatrixAt(i, _m4);
  }
  bubbles.instanceMatrix.needsUpdate = true;
}

// ---- the breath clock ----
// ONE oscillator drives the shoulders (poseWalk's brS), the exhaust bursts and the
// audio hook. Phase 0..PI is the inhale, PI..TAU the exhale; the burst fires as the
// exhale opens the valve. Cycle length is context: ~4.1 s at rest, shortening toward
// ~2.2 s under exertion (hard swimming / thruster), shortening AND shallowing further
// as the air runs out — a fast thin panic read near drowning.
const BR_REST = 4.1, BR_WORK = 2.2, BR_PANIC = 1.7;
let exert = 0;                 // EMA of effort so the cadence winds up, never snaps
let breathAmp = 1;             // shoulder-lift scale, read by poseWalk
let breathIdx = 0;             // completed-cycle counter (audio sync + hashes)
let burstT = -1, burstDur = 0.5, burstNext = 0, burstStep = 0.05, burstSeed = 0;
let ascVent = 0, _phPrev = 0;               // extra venting while rising fast — expanding air
// Per-breath character, all phase-hashed off breathIdx (deterministic, no Math.random
// in the frame path). cycMul spreads the rest cadence across ~3.2-5.2 s; a held breath
// (about one in ten) stretches to ~6 s and releaseK makes the release that follows it
// visibly BIGGER. dblT schedules the occasional valve-chatter double burst.
let cycMul = 1, releaseK = 1, dblT = -1, dblSeed = 0;

export function breathPhase() { return breathPh % TAU; }
export function breathCount() { return breathIdx; }
export function breathStress() {
  return clamp(Math.max(exert * 0.7, 1 - clamp(survival.oxygen / 0.35, 0, 1)), 0, 1);
}

// ---- walk cycle: authored curves, phase 0 = right heel strike ----
// Re-keyed for DUTY 0.60 (toe-off at 0.60, not 0.56). Under the IK these curves only own
// the SWING and the hand-offs either side of it — stance is the ground's — so what matters
// is the air: the knee folds to ~57 deg a beat after toe-off (Winter's swing peak is
// 60-65; a lead boot is lifted no higher than it must be), the heavy boot then swings
// through on the thigh like a pendulum and the knee is all but straight before the heel
// goes down. The old knee peaked at 50 deg AT toe-off and spent its swing at ~40.
const W = {
  hip: curve([[0, .46], [.12, .33], [.25, .12], [.40, -.14], [.54, -.36], [.62, -.28], [.71, -.02], [.82, .34], [.92, .52]]),
  knee: curve([[0, .05], [.10, .26], [.22, .14], [.40, .06], [.52, .22], [.60, .66], [.68, 1.10], [.76, 1.00], [.87, .40], [.96, .04]]),
  ankle: curve([[0, -.24], [.10, .06], [.30, .02], [.50, .30], [.60, .10], [.70, -.28], [.80, -.34], [.92, -.28]]),
  bob: curve([[0, -.05], [.09, -.088], [.16, -.045], [.26, .036], [.38, .004], [.50, -.05], [.59, -.088], [.66, -.045], [.76, .036], [.88, .004]]),
  sway: curve([[0, -.025], [.20, -.082], [.34, -.03], [.50, .025], [.70, .082], [.84, .03]]),
  list: curve([[0, 0], [.25, -.09], [.50, 0], [.75, .09]]),
  yaw: curve([[0, .175], [.25, .04], [.50, -.175], [.75, -.04]]),
  // Arm swing gets its OWN curve instead of borrowing the hip's. A hip reverses fast
  // (the leg is driven); an arm is a pendulum hung off a shoulder inside stiff canvas, so
  // it dwells at each end of the swing and moves quickest through the passing position.
  // Normalised to +/-1 and symmetric, extremes at p=0 and p=0.5.
  arm: curve([[0, -1.0], [.06, -.96], [.14, -.78], [.25, 0], [.36, .78], [.44, .96],
  [.50, 1.0], [.56, .96], [.64, .78], [.75, 0], [.86, -.78], [.94, -.96]])
};
// frog kick: slow tuck (0-.45), snap (.45-.62), long glide
const S = {
  hip: curve([[0, .10], [.22, .52], [.45, .92], [.55, .40], [.64, .04], [.80, .06], [.92, .08]]),
  knee: curve([[0, .18], [.22, .78], [.45, 1.45], [.55, .60], [.64, .06], [.80, .10], [.92, .14]]),
  abd: curve([[0, .05], [.22, .22], [.45, .44], [.55, .30], [.64, .04], [.80, .04], [.92, .05]]),
  ankle: curve([[0, 0], [.30, -.30], [.48, -.34], [.58, .26], [.70, .06], [.88, .02]])
};

const CH = {
  bobY: 0, shiftX: 1, shiftZ: 2, pYaw: 3, pRoll: 4, pPitch: 5, sYaw: 6, sPitch: 7, sRoll: 8, nYaw: 9, nPitch: 10,
  Rhx: 11, Rhz: 12, Rk: 13, Ra: 14, Lhx: 15, Lhz: 16, Lk: 17, La: 18,
  Rsx: 19, Rsz: 20, Rsy: 21, Re: 22, Lsx: 23, Lsz: 24, Lsy: 25, Le: 26, N: 27
};
const pw = new Float32Array(CH.N), psw = new Float32Array(CH.N), po = new Float32Array(CH.N);

// Phase offsets, in cycles. At a walking cadence of ~1.1 cycles/s these are the timings
// that stop the gait reading as one rigid marionette: the pelvis leads, the shoulders
// answer it through THE SPINE CHAIN's spring, the arms trail further still.
const ARM_LAG = 0.02;      // arms trail the opposing leg; the shoulder spring adds ~0.07 more

// tanh(2.2) — normalises the weight-shift clip so the shift still reaches +/-1
const TANH22 = 0.975743;
let breathPh = 0;

// Per-kick asymmetry, redrawn on every wrap of the swim clock. THE TWO LEGS OF A FROG
// KICK ARE NEVER TWINS: one knee comes up further, one snaps a beat earlier, one foot
// sweeps wider. The old pose had a single hard-coded 0.03 phase offset, which is
// symmetry with a constant added to it — the eye reads that as one leg and its mirror.
let kAmpR = 1, kAmpL = 1, kPhL = 0.03, kAbdR = 1, kAbdL = 1, kickIdx = 0;
function drawKick(i) {
  kAmpR = 1 + 0.075 * sSym(i, 21);
  kAmpL = 1 + 0.075 * sSym(i, 22);
  kPhL = 0.030 + 0.026 * sSym(i, 23);      // the left knee snaps up to 55 ms off the right
  kAbdR = 1 + 0.13 * sSym(i, 24);
  kAbdL = 1 + 0.13 * sSym(i, 25);
}

function poseWalk(o, p, a, t, deck) {
  const idle = 1 - a;                                        // at a standstill every cyclic term falls away
  // ---- idle, SPLIT BY GROUND. Planks are not water. ----
  // SEA idle (deck=0): he is standing in a moving column, so the sway survives — but the
  // vertical is HALVED from the old value. A man in lead boots on the bottom is heavy;
  // he does not float.
  // DECK idle (deck=1): terrestrial and planted. Zero vertical bob. Weight shifts foot to
  // foot on a ~30 s period with a dwell at each foot (tanh-clipped sine), the pelvis lists
  // onto the loaded leg and the shoulders counter it, breathing lives in the SHOULDERS
  // rather than the pelvis, and the head turns occasionally. The head gate is a sparse
  // deterministic function of t — never Math.random(), which would make the turn
  // frame-rate dependent and unrepeatable between sessions.
  const wob = Math.sin(t * 0.47);
  // Breathing DRIFTS. A fixed 0.90 rad/s was a metronome in his chest — the one idle
  // signal you can watch for thirty seconds, and it never varied by a millisecond. The
  // rate now wanders +/-13% on a ~80 s period, integrated as a phase so it never jumps.
  const brS = Math.sin(breathPh);                            // ~8.6 breaths a minute, wandering
  const wsh = Math.tanh(2.2 * Math.sin(t * 0.21)) / TANH22;  // +1 = weight on his left foot
  const look = 0.30 * ss(0.88, 1, Math.sin(t * 0.137)) - 0.26 * ss(0.88, 1, Math.sin(t * 0.0912 + 2.1));
  const dk = deck * idle, sw = (1 - deck) * idle;
  // The seabed gets the weight shift too, at 60% — the column's sway rides on top of it.
  // Standing in lead boots is standing; the planks were never the only floor he had.
  const ws = dk + 0.6 * sw;

  o[CH.bobY] = W.bob(p) * a + Math.sin(t * 1.15) * 0.007 * sw;
  // Lateral sway at 65% and pelvic yaw at 80% of the old curves: +/-82 mm of sway on a
  // 1.39 u leg was 2.3x a man's, and it was half of the waddle that read as a toddler.
  // He still rolls over each boot — just as far as the boot's weight explains.
  o[CH.shiftX] = W.sway(p) * a * 0.65 + wob * 0.028 * sw + wsh * 0.030 * ws;
  o[CH.shiftZ] = 0;
  o[CH.pYaw] = W.yaw(p) * a * 0.8 + wsh * 0.020 * ws;
  o[CH.pRoll] = W.list(p) * a + wob * 0.032 * sw + wsh * 0.038 * ws;
  o[CH.pPitch] = 0;
  // The thorax's counter-rotation and lateral bend are no longer authored here: THE SPINE
  // CHAIN (updateDiver, after compliance) derives them from the pelvis actually posed.
  o[CH.sYaw] = brS * 0.006 * dk * breathAmp;
  // Breathing reads at the SHOULDERS (rigid canvas and brass over the chest): the same
  // phase that times the exhaust bursts, scaled by breathAmp so low air shallows it.
  // The walking term used to be -0.11 * a: the spine tipped BACK 6 deg the moment he
  // walked, on top of the rest -0.07 — with the knees bent under him, that was a man
  // sitting down. Walking he now carries the corselet over his boots (the body's own
  // forward lean is added in accLean, where acceleration and slope already live).
  o[CH.sPitch] = -0.07 + 0.02 * a + Math.sin(t * 1.15 + 0.6) * 0.022 * sw + brS * (0.020 * dk + 0.011 * sw) * breathAmp;
  o[CH.sRoll] = 0;
  o[CH.nYaw] = look * (dk + sw); o[CH.nPitch] = 0.05 * a - 0.02 * Math.abs(look) * (dk + sw)
    - 0.20 * ss(0.93, 1, Math.sin(t * 0.061 + 0.8)) * sw;   // now and then, a look up the line toward the light
  o[CH.Rhx] = -W.hip(p) * a; o[CH.Rhz] = 0.075;
  o[CH.Rk] = W.knee(p) * a + 0.07 * idle + 0.022 * wsh * ws; o[CH.Ra] = W.ankle(p) * a;
  o[CH.Lhx] = -W.hip(p + 0.5) * a; o[CH.Lhz] = 0.075;
  o[CH.Lk] = W.knee(p + 0.5) * a + 0.07 * idle - 0.022 * wsh * ws; o[CH.La] = W.ankle(p + 0.5) * a;
  // ARMS. Each trails the opposing leg on W.arm's eased pendulum profile (+1 = forward).
  // Measured on the old build: the free arm swung +/-13 deg and peaked 0.21 cycle after
  // the opposite heel strike (0.125 of authored offset plus the shoulder spring's own
  // ~0.08 lag), so it read as a stiff arm being pushed rather than one hanging and
  // swinging; the elbow also bent on the BACK swing, which is backwards. Now: the free
  // (knife) arm hangs close to the dress and swings +/-19 deg, peaking ~0.1 cycle after
  // the opposite heel strike (ARM_LAG plus the spring); the elbow folds on the forward
  // swing and opens behind. The lantern arm keeps its carry — held a little forward and
  // out — but still swings +/-10 deg with the gait, the lantern's bail riding on it.
  const ra = W.arm(p - ARM_LAG - 0.02) * a;
  const la = W.arm(p + 0.5 - ARM_LAG) * a;
  o[CH.Rsx] = -0.10 - 0.17 * ra - wsh * 0.012 * ws; o[CH.Rsz] = 0.15 - 0.04 * a; o[CH.Rsy] = -0.10;
  o[CH.Re] = -(0.44 + 0.14 * Math.max(0, ra) - 0.05 * Math.max(0, -ra));
  o[CH.Lsx] = -0.33 * la + 0.03 * a + wsh * 0.012 * ws; o[CH.Lsz] = 0.15 - 0.05 * a; o[CH.Lsy] = 0.05;
  o[CH.Le] = -(0.20 + 0.06 * a + 0.30 * Math.max(0, la) * a);
}

// A limb dragging through water reverses SLOWLY — drag is largest exactly where the
// velocity is largest, so the stroke flattens at its turnarounds. Peak is still 1.0, so
// every amplitude this replaces keeps its old range.
const dragS = x => { const s = Math.sin(x); return s * (1.15 - 0.15 * s * s); };
const SWIM_DRAG = 0.28;    // seconds the arms trail the body's roll/yaw

function poseSwim(o, p, t0, drive) {
  // HEAVIER (2026-10-01). Every free oscillation of the floating body runs on a clock
  // 0.72x the old one and at ~0.7 of the amplitude: a hundredweight of brass and lead
  // hanging under an air-filled helmet does not bob and wander like a frogman. The kick
  // itself is slowed in its own clock (swimP, updateDiver).
  const t = t0 * 0.72;
  const td = t - SWIM_DRAG;
  // The kick's phase is warped so the tuck and the glide — the two extremes — take longer
  // than the transit between them. Pure reparametrisation: every S curve keeps its range.
  const pk = p - 0.022 * Math.sin(4 * Math.PI * (p - 0.45));
  o[CH.bobY] = Math.sin(t * 0.9) * 0.024;
  o[CH.shiftX] = Math.sin(t * 0.62) * 0.02;
  o[CH.shiftZ] = 0;
  o[CH.pYaw] = Math.sin(t * 0.5) * 0.035;
  o[CH.pRoll] = Math.sin(t * 0.71) * 0.04;
  o[CH.pPitch] = -0.10 - S.hip(pk) * 0.10;
  o[CH.sYaw] = Math.sin(t * 0.44 + 1) * 0.05;
  o[CH.sPitch] = 0.10 + S.hip(pk) * 0.06;
  o[CH.sRoll] = Math.sin(t * 0.58) * 0.05;
  o[CH.nYaw] = Math.sin(t * 0.33) * 0.045; o[CH.nPitch] = -0.06;
  const k = 0.45 + 0.55 * drive;
  const kr = k * kAmpR, kl = k * kAmpL, pl = pk + kPhL;
  o[CH.Rhx] = -S.hip(pk) * kr; o[CH.Rhz] = 0.06 + S.abd(pk) * kr * kAbdR;
  o[CH.Rk] = S.knee(pk) * kr; o[CH.Ra] = S.ankle(pk) * kr;
  o[CH.Lhx] = -S.hip(pl) * kl; o[CH.Lhz] = 0.06 + S.abd(pl) * kl * kAbdL;
  o[CH.Lk] = S.knee(pl) * kl; o[CH.La] = S.ankle(pl) * kl;
  // arms on the delayed clock: they answer the roll the torso had a third of a second ago
  o[CH.Rsx] = -0.42 - dragS(td * 0.8) * 0.10; o[CH.Rsz] = 0.34; o[CH.Rsy] = -0.22;
  o[CH.Re] = -(0.85 + dragS(td * 0.8 + 0.6) * 0.10);
  o[CH.Lsx] = -0.22 + dragS(td * 0.66 + 2) * 0.30; o[CH.Lsz] = 0.42 + dragS(td * 0.5) * 0.10; o[CH.Lsy] = 0.18;
  o[CH.Le] = -(0.55 + dragS(td * 0.66 + 1.2) * 0.28);
  // THE FREE HAND SCULLS WITH THE KICK. As the knees draw up (recovery) the left hand
  // reaches forward with the elbow bent; on the snap it pulls down and back past the
  // hip, straightening; through the glide it trails. Keyed off the kick's own warped
  // phase a beat early (the arm leads the legs), so the stroke IS the push the player
  // feels in player.js, not a second clock. The lantern arm only answers it a little.
  // Hanging in the column with no way on, nothing is locked: the knees soften and the
  // legs sit a little forward of the hips, the way a relaxed body floats.
  // The boots are lead: with no way on they hang almost straight down under him, knees
  // only a little soft — not the drawn-up float of a man in fins.
  const relax = 1 - drive;
  o[CH.Rhx] -= 0.04 * relax; o[CH.Lhx] -= 0.02 * relax;
  o[CH.Rk] += 0.16 * relax; o[CH.Lk] += 0.22 * relax;
  o[CH.Ra] -= 0.10 * relax; o[CH.La] -= 0.08 * relax;
  const st = S.hip(pk + 0.06), sk = S.knee(pk + 0.06) / 1.45;
  const dv = 0.35 + 0.65 * drive;
  o[CH.Lsx] += dv * (0.28 - 0.80 * st);
  o[CH.Le] -= dv * 0.55 * sk;
  o[CH.Lsz] += dv * 0.14 * st;
  o[CH.Rsx] += dv * (0.08 - 0.22 * st);
  o[CH.Re] -= dv * 0.15 * sk;
}

// ---- knife slash: a one-shot keyed overlay on the LEFT arm ----
// Authored as explicit keys with a per-segment ease so the weight reads right: the draw
// and windup ease OUT (the suit fights him, the arm settles into the cock), the sweep
// eases IN (power builds into contact at 0.220 — game.js checks the hit at t+0.22), the
// follow-through overshoots and the recovery is slow.
const SLASH_DUR = 0.55, SLK_ST = 7;
// t, Lsx (back+), Lsy (yaw, out+), Lsz (abduct+), Le (elbow), spine twist, ease-into-key
const SLK = new Float32Array([
  0.000, 0.00, 0.05, 0.15, -0.20, 0.00, 0,
  0.070, 0.16, 0.34, 0.10, -0.62, 0.06, 0,   // fist closes on the hilt at the thigh
  0.110, 0.34, 0.52, 0.30, -1.55, 0.12, 1,   // knife clears the throat, elbow folds
  0.150, 0.60, 0.62, 0.86, -1.42, 0.22, 3,   // cocked high and outboard — anticipation
  0.220, -0.56, -0.72, -0.34, -0.30, -0.26, 2,   // CONTACT, arm driven across the body
  0.300, -0.82, -1.02, -0.66, -0.52, -0.34, 3,   // heavy follow-through overshoot
  0.420, -0.12, -0.20, 0.12, -1.24, -0.10, 4,   // slow recovery, elbow back to the hip
  0.500, 0.14, 0.30, 0.16, -0.72, 0.05, 4,   // hilt back at the scabbard throat
  0.550, 0.00, 0.05, 0.15, -0.20, 0.00, 0
]);
const SLN = SLK.length / SLK_ST;
const slA = new Float32Array(5);
let slashT = -1;

function easeSeg(u, m) {
  if (m === 1) return 1 - (1 - u) * (1 - u);                 // ease-out quad
  if (m === 2) return u * u * u;                             // ease-in cubic: power builds
  if (m === 3) { const k = 1 - u; return 1 - k * k * k; }     // ease-out cubic: heavy arrival
  if (m === 4) { const s = u * u * (3 - 2 * u); return s * s * (3 - 2 * s); }   // very soft
  return u * u * (3 - 2 * u);
}

function evalSlash(ts) {
  let i = 0;
  while (i < SLN - 1 && SLK[(i + 1) * SLK_ST] <= ts) i++;
  const a = i * SLK_ST, b = Math.min(i + 1, SLN - 1) * SLK_ST;
  const t0 = SLK[a], t1 = SLK[b];
  const u = t1 > t0 ? easeSeg(clamp((ts - t0) / (t1 - t0), 0, 1), SLK[b + 6]) : 1;
  for (let c = 0; c < 5; c++) slA[c] = SLK[a + 1 + c] + (SLK[b + 1 + c] - SLK[a + 1 + c]) * u;
}

// ---- runtime state ----
// Legs are 8% longer and the boots deeper than the old build, so LIFT is re-derived to keep
// the soles planted on player.pos - 1.35 (the collision floor) in the rest pose.
const LIFT = 0.269;   // (salprop) +0.106 with the thigh
// gb boots at 1 (standing), not 0: every session now opens with Sal on the raft's deck
// behind the title, and a 0 boot meant the first thing anyone ever saw was the frog-kick
// pose easing out — legs drawn up, boots half a metre off the planks he is standing on.
let walkP = 0, swimP = 0, gb = 1, yawF = 0, yawInit = false;
// deckF boots at 1 for the same reason gb does: the title opens on Sal standing on planks.
let deckF = 1, ampS = 0;
// ladderF: blend weight for the boarding-ladder climb (player.onLadder). Blends in and
// out over ~0.25 s so the grab and the step over the rail never snap.
let ladderF = 0;
// Ground covered by one full walk cycle (two steps) is GAIT.stride (below), read live.
// History: 2.35 -> 2.27 -> 1.95, each time cut to fit a pelvis that had been lowered
// into a permanent crouch. See THE PELVIS for why that budget was the wrong way round.
// 2.24 -> 2.70 (2026-10-01, the ankle pass): 113 steps/min at the seabed's 2.47 u/s (was 134),
// step 0.95 of leg length (was 0.79), pelvis bounce 0.10 (was 0.15). The longer step was
// blocked by the ankle, not by taste: see THE LEG RIG and the roll-through constants.

// ===========================================================================
// FOOT PLANTING — the structural answer to "the movements aren't real".
//
// The gait above is curve-keyed FK: the legs swing through authored poses while the root
// slides underneath, and NOTHING makes the planted boot stick. Measured intra-stance slip
// at the best possible stride divisor was ~0.5x walk speed (~1.3 u per stance) — the tell the
// eye catches even when it can't name it.
//
// What follows nails the stance foot to a WORLD anchor and solves the leg to it. The
// authored curves survive: they still drive the swing (they're good in the air) and they
// still drive everything above the pelvis. What changed is who is boss during contact —
// the ground is, and the hip/knee/ankle bend to obey it.
// ===========================================================================

// UP_L, LO_L, HIP_X and SOLE_Y live at the top of the file (THE LEG RIG): they must equal
// limb(hips, +/-0.225, 0, 0.562, 0.6815, ...) and the boot's lead sole underside.
const EYE_H = 1.35;                 // player.js's own constant: pos.y - EYE_H is the floor
// Duty factor: the fraction of one cycle a foot spends on the ground. 0.60 puts 10% of the
// cycle in each double support — a slow, deliberate walk under load (a man's normal walk
// is ~0.62; 0.56 was a hurried one). Stance for the right foot is [0, DUTY); heel strikes
// stay at walkP 0 and 0.5 so stepCount() is untouched.
const DUTY = 0.60;
// Roll-through windows within stance, and the foot's absolute pitch at each.
// With the ankle down in the boot the foot is a real lever, and the lead sole is a RIGID
// plate: it pivots on its heel's back edge as it lands and on its toe's front edge as it
// leaves. Heel-off starts at 52% of stance (31% of the cycle, as a walker's does) and the heel
// rises to 45 deg by toe-off on a q^1.5 ramp. The toe rocker is what buys the stride: at the
// trailing foot's toe-off the ankle now rises 0.11 and comes forward 0.27 over the toe edge
// (the old ball pivot under a high ankle gave 0.05 and 0.25), which is the reach the pelvis
// used to drop 15 cm to find. Measured at the old stride: pelvis bounce 0.185 -> 0.101.
const HS_END = 0.10, HO_START = 0.52, TH_POW = 1.5;
const TH_STRIKE = -0.30, TH_OFF = 0.78;
// Sole points along the foot (+z toe) in the ankle frame: the heel's back edge (the outline
// ends at -0.185, rounded), the flat-foot reference, the toe's front edge (outline 0.338).
const CZ_HEEL = -0.16, CZ_FLAT = 0.02, CZ_BALL = 0.315;

// THE PELVIS — set by the legs, not authored onto them.
//
// Michael, 2026-10-01: "focus on Sal's walking... it's really weird." Measured: the
// stance knee averaged 54 deg at MID-STANCE (a man's is 5-15), the pelvis rode at 0.88
// of leg length (a walker's is ~0.97 at mid-stance), the steps were 0.69 L at 149/min,
// and the swing knee folded LESS than the stance knee. He walked half-sitting.
// The cause was the old budget, which ran backwards: the pelvis path was an authored bob
// (W.bob x PEND_M x vault) around a fixed drop (IK_DROP), and the drop was sized so the
// TROUGH of that bob could reach a foot 0.55 ahead of the hip. Michael then (rightly)
// called the full vault odd, the vault knob scaled the bob to 0.45 — and the mean, which
// the trough had set, stayed where it was. The pelvis kept the trough's height for the
// whole stride: every step a crouch. Shortening the stride (2.35 -> 1.95) to fit it only
// made a shuffle out of the crouch.
//
// Now the pelvis is the HIGHEST it can be, every frame, such that:
//   - each loaded foot is reachable with the knee no straighter than GAIT.kCap (a stance
//     leg vaults nearly straight, as a real one does), the swing foot's landing point
//     fading in as its IK takes over, so the pelvis sinks to meet the step it is about
//     to take rather than leaving the boot to land short;
//   - and never above GAIT.kMid of knee at mid-stance (kIdle standing): a heavy man does
//     not lock out, he carries the weight on a soft knee.
// Those ceilings are combined with a smooth minimum, so double support is a rounded
// trough and not the compass gait's cusp; it falls fast (it is a ceiling — a late fall
// is an overreach) and rises on a softer spring (a man rises over his boot, he does not
// pop). The rise and fall that results is the TRUE pendulum of these legs at this
// stride, ~0.1 u: the bob is an output, not a style choice, and the slope, the deck,
// the start, the stop and the shuffle all get it for free from their own anchors.
// Live knobs: window.__gait.{stride, kMid, kIdle, kCap, soft}.
// 2.70 -> 2.90 (salprop, the longer thigh): measured on the fixed-step harness, the same
// seabed run, 118 -> 110 steps/min, step / leg 0.89 -> 0.95 (the leg is 1.50 now, not 1.39).
const GAIT_STRIDE0 = 2.9;
const GAIT = { stride: GAIT_STRIDE0, kMid: 13, kIdle: 8, kCap: 4, soft: 0.03, rise: 30 };
window.__gait = GAIT;
// Hip-to-ankle reach at a knee angle (degrees): the law of cosines on the two bones.
const reachAt = deg => Math.sqrt(UP_L * UP_L + LO_L * LO_L + 2 * UP_L * LO_L * Math.cos(deg * Math.PI / 180));
// Polynomial smooth minimum (always <= min(a, b), so it can only lower the pelvis).
function smin(a, b, k) { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; }

// Deterministic per-step variation. mulberry32's mixer, but STATELESS — keyed on (step
// index, channel) so any step's draws are reproducible from its index alone and two legs
// asking for the same step get the same numbers. NOTHING IS CLOCKWORK, but nothing here
// is random either: the same walk replays identically every session.
function sHash(i, c) {
  let s = (Math.imul(i, 0x9e3779b1) ^ Math.imul(c + 1, 0x85ebca6b)) | 0;
  s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const sSym = (i, c) => sHash(i, c) * 2 - 1;      // -1..1

// ---- two-bone analytic IK ----
// The chain is root.rotation = (hx, 0, hz) [three's XYZ order => Rx*Ry*Rz] and
// mid.rotation.x = k, so the ankle offset from the hip is
//     d = Rx(hx) * Rz(hz) * ( (0,-up,0) + Rx(k)*(0,-lo,0) )
// The bracket q always has q.x = 0, so |q| = D is the law of cosines in k alone, hz falls
// straight out of d.x, and hx is a single 2-D rotation fit. Exact, branchless, allocation
// free, and it inverts the forward pose exactly (IK(FK(p)) === p) — which is what lets the
// same code path drive both stance and swing with no seam between them.
const _ik = new Float32Array(3);                  // hx, hz, k
// The solver's clamp is the TRUE anatomical limit, a hair short of locked. It is NOT the
// place to enforce style: an earlier 0.985 here also rewrote poses the IK was not even
// driving — the frog kick's long glide reaches 1.011 between the hip and ankle, and the
// clamp was folding both knees to a matched 20 deg and quietly deleting the per-kick
// asymmetry. The "never lock the knee" margin belongs in the pendulum budget above, which
// is where the stance target is generated, not in the round trip that must reproduce an
// authored pose exactly.
const REACH_MAX = (UP_L + LO_L) * 0.9995, REACH_MIN = 0.30;
let ikClamped = 0, ikOver = 0;                    // 1 / by how much the last solve shortened d
function solveLeg(dx, dy, dz) {
  let D = Math.hypot(dx, dy, dz);
  ikClamped = 0; ikOver = 0;
  if (D > REACH_MAX) { ikOver = D - REACH_MAX; const s = REACH_MAX / D; dx *= s; dy *= s; dz *= s; D = REACH_MAX; ikClamped = 1; }
  else if (D < REACH_MIN) { const s = REACH_MIN / (D || 1e-6); dx *= s; dy *= s; dz *= s; D = REACH_MIN; ikClamped = 1; }
  const ck = clamp((D * D - UP_L * UP_L - LO_L * LO_L) / (2 * UP_L * LO_L), -1, 1);
  const k = Math.acos(ck);
  const qy = -(UP_L + LO_L * ck), qz = -LO_L * Math.sin(k), m = -qy;
  const sh = clamp(dx / m, -0.985, 0.985);
  const chz = Math.sqrt(1 - sh * sh);
  let hx = Math.atan2(dz, dy) - Math.atan2(qz, qy * chz);
  if (hx > Math.PI) hx -= TAU; else if (hx < -Math.PI) hx += TAU;
  _ik[0] = hx; _ik[1] = Math.asin(sh); _ik[2] = k;
}
// The same chain forwards, used to read the authored curves' ankle position.
function fkAnkle(hx, hz, k, out) {
  const qy = -(UP_L + LO_L * Math.cos(k)), qz = -LO_L * Math.sin(k);
  const sh = Math.sin(hz), chz = Math.cos(hz);
  const y0 = qy * chz, cx = Math.cos(hx), sx = Math.sin(hx);
  return out.set(-qy * sh, y0 * cx - qz * sx, y0 * sx + qz * cx);
}
// Where the ankle joint must sit for a given contact point and foot pitch. The contact
// point stays nailed; the ankle rises and eases forward across heel-off exactly as a real
// ankle does when the foot rolls over the ball. Total ankle excursion through a whole
// stance is ~0.05 u vertical / ~0.07 u fore-aft, and DEAD ZERO across the flat window.
function ankleOverContact(th, cz, out) {
  const c = Math.cos(th), s = Math.sin(th);
  return out.set(0, -(SOLE_Y * c - cz * s), -(SOLE_Y * s + cz * c));
}

// ---- per-foot anchor state ----
// A foot in stance owns an anchor: a CONTACT POINT expressed in its ground's frame. On
// planks that frame is raft.position (translation only — player.js's deck collision is a
// flat plane at raft.position.y + DECK_TOP and ignores the boat's roll, so honouring the
// roll here would slide the feet against the body he actually stands with). On the seabed
// the frame is the world and the height is frozen at the moment of the plant, which is
// what makes a step onto a slope keep its own level instead of dragging.
function foot() {
  return {
    planted: false, deck: false, seed: false, step: 0, span: false,
    ax: 0, ay: 0, az: 0,           // contact point in the ground frame
    duty: DUTY, stride: 1, lat: 0, // this step's variation draws
    slip: 0,                       // accumulated travel through the flat window (the probe)
    wx: 0, wy: 0, wz: 0,           // last resolved world contact (probe + re-plant seed)
    stT: -1, dur: 0.42, sfx: 0, sfz: 0, stx: 0, stz: 0, lift: 0, d2: 0,  // turn step: from angle/radius, sweep/radius
    cz: CZ_FLAT,                   // the sole point last in contact (the roll-through's pivot)
    tx: 0, ty: 0, tz: 0, tw: 0,    // last world ANKLE target and its IK weight (the pelvis reads these)
    px: 0, pz: 0,                  // how far the root travels before that target is reached (swing)
    ox: 0, oy: 0, oz: 0, oth: 0, ocz: CZ_FLAT, swp: 0,   // the stance's last ankle target and pitch (toe-off)
    ln: false, lnU: 0, lnX: 0, lnY: 0, lnZ: 0,  // first step off a stand: launch point + swing progress at launch
    ex: 0, ez: 0, pin: false       // the slip probe's last anchor-equivalent point, and whether it was planted
  };
}
const ftR = foot(), ftL = foot();
let stepSeq = 0;                   // monotonic plant index; seeds every per-step draw
let strideK = 1;                   // the live step's stride multiplier, read by the clock
// THE STRIDE FOLLOWS THE SPEED. GAIT.stride is the cycle at full walking pace; slower he
// shortens his steps as well as slowing them (a walker's step length and cadence both fall
// with speed), and backing up — blind, heel-first, with no toe rocker to vault off — he
// takes shorter steps still, and crabbing (hips turned off the travel) a little shorter. Without this the long stride the low ankle bought was kept at
// a dawdle, a back-up and a crab: measured, those three bounced 0.19-0.20 u.
let strideNow = GAIT_STRIDE0;

// ---- gait state machine: transitions are EVENTS, not fades ----
// 0 = standing, 1 = start lean (anticipation), 2 = walking, 3 = catch step (stopping).
let gaitState = 0, gaitT = 0, catchFrom = 0, catchTo = 0;
// BACKING UP IS FORWARD WALKING RUN BACKWARDS IN TIME. That is not a shortcut, it is
// the biomechanics: the joint-angle traces of backward walking are close to the time
// reversal of forward walking (Thorstensson 1986; Grasso et al. 1998). So the phase
// clock simply runs the other way. What the reversal gets right for free: the swing
// foot reaches BEHIND, lands on the ball of the foot with the heel up (the roll-through
// curve read from its far end), rolls down to the flat, and leaves the ground heel-last
// out in front. The body-relative foot track at any phase is the same in both
// directions, so the inverted-pendulum reach budget holds unchanged.
// What it does NOT get for free, and is handled where it lives: the IK hand-off windows
// (they sit at the far end of each phase span), the swing's landing target (behind,
// toe-down), the catch step's target phase, and the footfall event (a reverse plant is
// at lp = DUTY, not lp = 0 — the strike clock below re-bases for it).
// gaitDir is the clock's sign; revF eases 0..1 for the few pose terms that must blend.
let gaitDir = 1, revF = 0, wgtNow = 1;
const revS = { x: 0, v: 0 };
// The strike clock: 0 and 0.5 are footfalls in either direction (to within the per-step
// duty draw — the exact reverse footfall fires on the plant). Forward it IS walkP.
// Published to player.js, which lands the per-stride water resistance on it.
const strikeP = () => gaitDir > 0 ? walkP : (walkP - DUTY + 1) % 1;
const START_LEAN = 0.15, CATCH_DUR = 0.30;
const leanP = { x: 0, v: 0 };      // body pitch for lean/catch, in radians
let bankG = 0;                     // grounded bank into a turn
let prevGrounded = true, landImp = 0;

const _mH = new THREE.Matrix4(), _mHi = new THREE.Matrix4();
// THE SOLE IS LEVEL IN THE WORLD, not in the hips. The foot pitch used to be written as a
// pitch relative to the hip chain alone, so the body's forward lean (3-4 deg at a walk), the
// pelvis list (+/-4 deg) and the stance leg's abduction all tipped the planted sole: the
// toe dug 7 cm into the seabed at every heel-off and the outside edge lifted. The planted
// foot's orientation is now solved in the world (heading yaw, roll-through pitch, no roll)
// and expressed back through the hips, thigh and shank. Module temps: no allocation.
const _qH = new THREE.Quaternion(), _qA = new THREE.Quaternion(), _qB = new THREE.Quaternion(), _qC = new THREE.Quaternion();
const _eA = new THREE.Euler(), _X1 = new THREE.Vector3(1, 0, 0);
const _vA = V3(), _vB = V3(), _vC = V3(), _vD = V3();
// Live probe surface for the slip test — game.js never reads it, but the browser can.
export const ikDebug = { slipR: 0, slipL: 0, clampR: 0, clampL: 0, overR: 0, overL: 0, state: 0, stepSeq: 0, limR: 0, limL: 0, top: 0, pel: 0, plR: 0, plL: 0, dR: 0, dL: 0, gd: 0, gdd: 0 };

// ===========================================================================
// COMPLIANCE — the spring-driven skeleton.
//
// Michael: "he just feels a little robotic." The cause is that every joint WAS its
// authored pose, exactly and instantly: zero compliance anywhere in the body, so a turn
// or a stop arrives at all 27 channels on the same frame. Real mass cannot do that.
//
// Every composed channel now passes through its own semi-implicit spring before it
// reaches a joint — the same integrator the helmet lag has always used, which is the
// reference feel, applied to the whole skeleton. Frequencies are keyed to LIMB MASS:
// the pelvis and torso are slow and stiff, the shanks and elbows quick, and the distal
// joints are deliberately UNDER-damped (0.76-0.85) so a hard stop over-travels a few
// degrees and settles, and momentum ripples shoulder -> elbow -> wrist with real lag at
// each link. This is partial ragdoll, not ragdoll: nothing here is free to fall, every
// spring converges exactly on its authored target, and at a standstill the rest pose is
// bit-identical to the authored one.
//
// TWO EXCEPTIONS, both load-bearing:
//  - THE PLANTED LEG. A stance foot must satisfy its anchor EXACTLY or the whole slip
//    contract smears back to where it was. The springs are computed for every leg channel
//    but blended out by the stance weight, so the swing leg is fully compliant and the
//    planted leg is not compliant at all.
//  - THE SLASHING ARM. game.js checks the hit at t+0.22s, so the blade has to be exactly
//    where the animation says at that instant. The left arm's four channels are BYPASSED
//    for the duration of the swing. Stiffening them 3x was tried first and measured: at
//    3 x 21 = 63 rad/s the semi-implicit integrator sits at w*h ~ 1.05 and RANG, the blade
//    tip alternating 0.8 u frame to frame through contact. The spring state keeps tracking
//    the pose while bypassed, so it re-engages without a step. The slash is authored with
//    its own eases (easeSeg) and does not need borrowed compliance.
// Underwater every frequency drops 30% — water damps a limb, and the same table run wet
// and dry is one of the reasons the swim and the walk used to feel like the same man.
const SPF = new Float32Array(CH.N), SPD = new Float32Array(CH.N);
{
  const set = (list, f, d) => { for (const c of list) { SPF[c] = f; SPD[c] = d; } };
  // ROOT TRANSLATION IS EXEMPT (freq 0 = pass through). It looked like the obvious place
  // to start, and it was the one place compliance must not go: the pelvis dip is not a
  // stylistic bob, it is the inverted pendulum the leg's REACH is budgeted against. A
  // spring at 26 rad/s took 27% off it at walking cadence and shifted its phase, which
  // starved the stance leg and pinned it against the reach clamp for a third of every
  // step — measured, and the reason the knee locked straight through late stance.
  set([CH.bobY, CH.shiftX, CH.shiftZ], 0, 1);
  set([CH.pYaw, CH.pRoll, CH.pPitch], 18, 0.92);               // pelvis: heavy, slow, stiff
  set([CH.sYaw, CH.sPitch, CH.sRoll], 13, 0.88);               // torso in a corselet
  set([CH.nYaw, CH.nPitch], 9, 0.80);                          // head (helmet lag rides on top)
  set([CH.Rhx, CH.Rhz, CH.Lhx, CH.Lhz], 22, 0.90);             // thighs
  set([CH.Rk, CH.Lk], 28, 0.85);                               // shanks
  set([CH.Ra, CH.La], 34, 0.82);                               // feet (was the old ankle spring)
  set([CH.Rsx, CH.Rsz, CH.Rsy, CH.Lsx, CH.Lsz, CH.Lsy], 19, 0.80);   // upper arms
  set([CH.Re, CH.Le], 21, 0.76);                               // forearms: the loosest link
}
const spx = new Float32Array(CH.N), spv = new Float32Array(CH.N);
let spInit = false;
// Integrate the whole table in one pass. `stiff` is the per-channel multiplier the slash
// window raises; `wet` scales every frequency for the water.
function compliance(dst, src, dt, wet, slashW) {
  const h = Math.min(dt, 0.022);
  if (!spInit) { spInit = true; for (let i = 0; i < CH.N; i++) { spx[i] = src[i]; spv[i] = 0; } }
  // Stability ceiling on the integrator. Semi-implicit Euler goes unstable as w*h
  // approaches 2 and rings visibly well before that; 0.55/h keeps every channel inside
  // the well-behaved band even when a stalled frame pushes h to its 22 ms clamp.
  const fMax = 0.55 / h;
  for (let i = 0; i < CH.N; i++) {
    const bypass = SPF[i] === 0 ||
      (slashW > 0 && (i === CH.Lsx || i === CH.Lsy || i === CH.Lsz || i === CH.Le));
    if (bypass) { spx[i] = dst[i] = src[i]; spv[i] = 0; continue; }
    let f = Math.min(SPF[i] * wet, fMax);
    const d = src[i] - spx[i];
    // A respawn or a zone teleport can move a channel by radians in one frame; snapping
    // there costs one frame of compliance and saves a visible whip through the pose.
    if (d > 1.6 || d < -1.6) { spx[i] = src[i]; spv[i] = 0; dst[i] = src[i]; continue; }
    spv[i] += (f * f * d - 2 * SPD[i] * f * spv[i]) * h;
    spx[i] += spv[i] * h;
    dst[i] = spx[i];
  }
}
const pc = new Float32Array(CH.N);   // the composed pose AFTER compliance
// Sustained-yaw bank: a swimmer turning leans into the turn and holds the lean while the
// turn lasts. sRollT's existing term is a LAG (yaw minus the body's filtered yaw), which
// decays to nothing the moment the turn is steady — the very case that wants a bank. This
// is the rate channel: smoothed d(yaw)/dt, eased in and out by the same spring.
let prevYaw = 0, yawRate = 0, prevYawInit = false;
// Scull arm bias, eased so the posture arrives and leaves rather than snapping.
const scX = { x: 0, v: 0 }, scZ = { x: 0, v: 0 };
const sPitch = { x: 0, v: 0 }, sRollT = { x: 0, v: 0 };
// heel-strike knee soften, and the trailing wrists/ankles (secondary motion, sprung rather
// than keyed — same idiom as the helmet lag). Wrist targets are REST-RELATIVE so the rest
// pose, and with it the knife's held geometry and the lantern bail, is untouched.
const kneeSoft = { x: 0, v: 0 };
let kneeSide = 0;
const wrR = { x: 0, v: 0 }, wrL = { x: 0, v: 0 };
const REST_RE = -0.44, REST_LE = -0.20;
// The ankles' own spring is gone: the compliance table's Ra/La channels (34 / 0.82) are
// the same integrator at the same numbers, and running both would have put two lags in
// series on the one joint the IK needs to place precisely.

const lnX = { x: 0, v: 0 }, lnZ = { x: 0, v: 0 };
const hdY = { x: 0, v: 0 }, hdX = { x: 0, v: 0 };
const settle = { x: 0, v: 0 };
const prevHand = V3(), handV = V3();
let lastStepSide = 0;
// Monotonic count of actual heel strikes. game.js diffs it to fire footstep audio in
// sync with the animation, instead of guessing the cadence from a fixed frequency.
let steps = 0;
export function stepCount() { return steps; }
// WHERE the boot went down on the last footfall: the sole's centre in the world, its heading
// and side (+1 right, -1 left, footfx's convention). game.js puts the silt and the print
// there instead of at a fixed offset from his centre — at a 1.35 u step that offset left the
// print up to 0.6 u from the boot that made it.
const footfallAt = { x: 0, z: 0, yaw: 0, side: 1 };
export function lastFootfall() { return footfallAt; }
const SOLE_MID = 0.077;            // the lead sole's centre along the foot (outline -0.185..0.338)
function markFootfall(ft, sgn, ox, oz) {
  const sy = Math.sin(yawF), cy = Math.cos(yawF), d = SOLE_MID - CZ_FLAT;
  footfallAt.x = ft.ax + ox + sy * d; footfallAt.z = ft.az + oz + cy * d; footfallAt.yaw = yawF; footfallAt.side = -sgn;
}

// Channel index triples per leg, so driveLegs can run one body of code twice with no
// branching on side and no array literal per frame.
const LEG_CH = [
  [CH.Rhx, CH.Rhz, CH.Rk, CH.Ra, -1],    // right: root.rotation.z = -pc[Rhz]
  [CH.Lhx, CH.Lhz, CH.Lk, CH.La, 1]
];

// The stance roll-through: absolute foot pitch and the point of the sole in contact,
// as a function of progress through this foot's stance. Heel strikes, slaps flat, sits
// flat for half the contact, then breaks at the heel and rolls over the toe.
// THE SOLE IS A RIGID LEAD PLATE, so whenever the foot is pitched it stands on an EDGE: the
// heel's back edge (toe up) or the toe's front edge (heel up), never a point that slides
// along the sole between them. The contact therefore jumps straight to the edge — which is
// seamless, because at zero pitch the ankle sits over the anchor whatever cz says (the
// contact is anchor + cz - CZ_FLAT, the ankle is that minus cz). The old sliding contact
// let the leading part of the sole rotate down through the ground: 4-7 cm of toe in the
// seabed at every heel-off, measured once the toe was probed.
// Written into _vA.x/_vA.y purely to avoid a return allocation.
function rollThrough(u, out) {
  let th, cz;
  if (u < HS_END) {
    const q = u / HS_END, e = q * q * (3 - 2 * q);
    th = TH_STRIKE * (1 - e); cz = CZ_HEEL;
  } else if (u < HO_START) {
    th = 0; cz = CZ_FLAT;
  } else {
    const q = (u - HO_START) / (1 - HO_START);
    th = TH_OFF * Math.pow(q, TH_POW);                    // the heel breaks slowly, then goes
    cz = CZ_BALL;
  }
  return out.set(th, cz, 0);
}

const SHUF_DUR = 0.42, SHUF_LIFT = 0.075;
let shufX = 0;                     // weight roll onto the planted boot during a shuffle step
// hoisted: two array literals per frame were the rig's last allocations
const LEGS = [diver.legR, diver.legL], FTS = [ftR, ftL];
// ---- the ground is boss ----
function driveLegs(dt, player, ikOn, amp, stepRate) {
  const legs = LEGS, fts = FTS;

  // The hips' world matrix, composed by hand from the three transforms we just wrote.
  // Everything above the pelvis is authored and already final, so this is exact — and it
  // costs three matrix composes rather than a walk of the whole 40k-tri hierarchy.
  diver.updateMatrix(); diver.body.updateMatrix(); diver.hips.updateMatrix();
  _mH.multiplyMatrices(diver.matrix, diver.body.matrix).multiply(diver.hips.matrix);
  _mHi.copy(_mH).invert();
  _qH.setFromRotationMatrix(_mH);

  // The ground under the soles, and the FRAME the anchors live in. On planks that frame
  // is raft.position: player.js pins pos.y rigidly to raft.position.y + DECK_TOP and
  // ignores the boat's roll, so anchors that tracked the roll would slide against the
  // very body he is standing with. Translation is the honest frame here — he heaves and
  // surges with the boat, which is the part the eye reads.
  const onDeck = !!player.onDeck;
  const soleY = (player.grounded ? player.pos.y : player.groundY) - EYE_H;
  const ox = onDeck ? raft.position.x : 0, oy = onDeck ? raft.position.y : 0, oz = onDeck ? raft.position.z : 0;
  const cy = Math.cos(yawF), sy = Math.sin(yawF);

  // SLOPE. The collision floor is one height at his centre; on a 25% grade the downhill
  // boot wants ground 10-15 cm under that and the uphill boot above it. The rig samples
  // the seabed under each boot and plants it there. Only on the bare seabed: a rock top
  // or a wreck deck is not terrain, and there the centre height stops matching the
  // floor, which is exactly the test that switches this off.
  gdOn = false;
  if (SAL.slope && !onDeck && player.grounded) {
    const px = player.pos.x, pz = player.pos.z;
    let hC = terrainH(px, pz, slopeZi);
    if (Math.abs(hC - soleY) > 0.6) {
      for (let z = 0; z < 3; z++) { const h = terrainH(px, pz, z); if (Math.abs(h - soleY) < Math.abs(hC - soleY)) { hC = h; slopeZi = z; } }
    }
    if (Math.abs(hC - soleY) < 0.6) { gdOn = true; gdC = hC; gdFx = sy; gdFz = cy; }
  }
  // On the bare seabed the boots stand on the SEABED, not on player.js's collision floor:
  // that floor is smoothed and trails the terrain on a grade (measured on a 24% climb:
  // planted boots 3-7 cm into the hill going up, 5 cm off it coming down). The pelvis
  // reaches for wherever the boots really are.
  const soleB = gdOn ? gdC : soleY;
  soleBase = soleB; ikDebug.gd = gdOn ? 1 : 0; ikDebug.gdd = soleB - soleY;

  // Landing. The knees can genuinely absorb now — the feet are pinned and the pelvis is
  // free to drop between them — so a drop to the seabed gets a real impulse instead of a
  // cosmetic dip, and both boots re-find the ground on contact rather than blending to it.
  if (player.grounded && !prevGrounded) {
    const hit = clamp(-player.vel.y * 0.55, 0, 4.2);
    settle.v -= 1.2 + hit;
    landImp = hit;
    // the arms come out for balance and the bonnet nods into the impact
    rcA.v += 0.9 * hit * SAL.react; rcH.v += 0.6 * hit * SAL.react; rcD.v -= 0.5 * hit * SAL.react;
    ftR.planted = ftL.planted = false;
  }
  prevGrounded = !!player.grounded;

  // Standing: the phase clock is stopped, so stance/swing is meaningless. Both boots stay
  // where they were put. THIS is what killed the old "idle slides with the raft" read —
  // the feet are anchored objects, not a pose evaluated at a stalled phase.
  // State 1 is the lean BEFORE the first push-off: both boots are still down whatever the
  // gait envelope says. (Keyed on amp it let a quick start fall through to a stale phase
  // clock for a frame or two, which swung a planted boot to wherever that clock said.)
  const standing = gaitState <= 1;
  const turnWide = clamp(Math.abs(yawRate) * 0.07, 0, 0.10);
  const turnBias = clamp(yawRate * 0.05, -0.08, 0.08);

  for (let i = 0; i < 2; i++) {
    const seg = legs[i], ft = fts[i], ch = LEG_CH[i], sgn = ch[4];
    const hxF = pc[ch[0]], hzF = sgn * pc[ch[1]], kF = pc[ch[2]];
    // where the authored curves put this ankle, in the hips frame
    fkAnkle(hxF, hzF, kF, _vA);
    const fkx = sgn * HIP_X + _vA.x, fky = _vA.y, fkz = _vA.z;

    const lp = (walkP - (i ? 0.5 : 0) + 1) % 1;
    let inStance, sp;
    if (standing) { inStance = true; sp = 0.30; }          // parked in the flat window
    else { inStance = lp < ft.duty; sp = inStance ? lp / ft.duty : 0; }

    // ---- CLAIM. A foot entering stance takes the ground where it already is. ----
    if (inStance && !ft.planted) {
      stepSeq++;
      ft.step = stepSeq;
      // NOTHING IS CLOCKWORK. Small, deterministic, keyed on the step index alone.
      // Stance duration +/-3% (was 8: a long draw kept the boot down for 0.11 u more
      // ground than any other step, and the pelvis had to sink to let the leg reach it).
      ft.duty = DUTY * (1 + 0.03 * sSym(stepSeq, 1));
      // Backing, the claim happens at the TOP of the stance span (lp falling through
      // duty), so a fresh, shorter draw would drop the foot straight back out of stance
      // and re-plant it a frame later. The span can never start below where it started.
      if (gaitDir < 0 && ft.duty < lp) ft.duty = lp + 1e-4;
      ft.stride = 1 + 0.06 * sSym(stepSeq, 2);             // stride length +/-6%
      ft.lat = 0.05 * sSym(stepSeq, 3) + sgn * turnWide + turnBias;   // placement +/-0.05
      ft.slip = 0;
      strideK = ft.stride;
      // The anchor is the foot's OWN last resolved contact — the swing delivered it there,
      // so the plant cannot pop by construction. The fallback covers boot, respawn, a
      // zone teleport and the first contact out of a swim, where there is no history.
      const dx = ft.wx - player.pos.x, dz = ft.wz - player.pos.z;
      if (!ft.seed || dx * dx + dz * dz > 2.6) {
        const latL = sgn * HIP_X + ft.lat;
        ft.wx = player.pos.x + cy * latL; ft.wz = player.pos.z - sy * latL;
        ft.seed = true; ft.cz = CZ_FLAT;
      }
      // The anchor is the FLAT-FOOT reference point; the sole point actually touching
      // rolls along the ground from it (heel behind, ball ahead — see TARGET). A boot
      // that lands on its heel is anchored a heel's length further on, so the heel it
      // landed on stays exactly where it touched down.
      const rs = ft.cz - CZ_FLAT;
      ft.ax = ft.wx - sy * rs - ox; ft.az = ft.wz - cy * rs - oz;
      ft.ay = soleB + groundD(ft.ax + ox, ft.az + oz) - oy;   // the ground at the ANCHOR (the rockers add the rest)
      ft.deck = onDeck; ft.planted = true; ft.ln = false;
      if (!ft.span) markFootfall(ft, sgn, ox, oz);
      // A reverse plant IS the footfall (toe down behind him), and it lands at lp = duty,
      // which the per-step duty draw moves — so backing up fires its footfall here, on
      // the claim itself, rather than off a phase boundary. Same weight, same knee, same
      // counter: audio, silt and prints stay on the frame the boot goes down.
      // Only the FIRST claim of a stance span is a footfall: a boot released for overreach
      // is re-claimed inside the same span (the walk-off from a stand does this for a
      // few frames), and that is a foot re-finding its grip, not another step.
      if (gaitDir < 0 && !ft.span && !standing && (gaitState === 2 || gaitState === 3)) {
        settle.v -= 2.25 * (0.45 + 0.75 * wgtNow) * gb * amp;
        kneeSoft.v += 4.0 * gb * amp;
        kneeSide = i;
        if (gb > 0.5 && amp > 0.08) steps++;
      }
    } else if (!inStance && ft.planted) {
      ft.planted = false;
    }
    ft.span = inStance;
    // A ground that changed frame under a planted foot (stepping off the deck) has to be
    // re-based or the boot is left standing on a memory of the raft.
    if (ft.planted && ft.deck !== onDeck) { ft.planted = false; }
    // ...and so does an anchor that is suddenly nowhere near him. A voyage, a zone jump or
    // a drowning respawn moves the root hundreds of units between frames; without this the
    // stance leg spends one frame solving toward the last world he was in.
    if (ft.planted) {
      const gx = ft.ax + ox - player.pos.x, gz = ft.az + oz - player.pos.z;
      if (gx * gx + gz * gz > 4) ft.planted = false;
    }
    // THE SHUFFLE. Standing still, the anchors are absolute — so turning on the spot, or
    // being pushed off a wreck, would drag the boots sideways under him and twist the legs
    // out of the rig. When a planted foot ends up more than ~0.27 u from where the hip now
    // wants it, he STEPS it there: the boot that is further out goes first (never both),
    // lifts a few centimetres — lead boots do not get picked up high — travels on a soft
    // ease with a little overshoot into the turn, and lands as a real footfall. The weight
    // rolls onto the other boot while it is in the air. (This replaced a 2.2 u/s creep:
    // honest to the anchors, but it read as a man sliding on ice.)
    if (standing && ft.planted) {
      const latL = sgn * HIP_X + ft.lat;
      const nx = player.pos.x + cy * latL, nz = player.pos.z - sy * latL;
      const dx = nx - (ft.ax + ox), dz = nz - (ft.az + oz);
      const d2 = dx * dx + dz * dz;
      ft.d2 = d2;
      const other = i ? ftR : ftL;
      // The other boot may be in its last third (all but down) — a fast turn is a quick
      // run of steps, never both boots off the ground.
      const otherDown = other.stT < 0 || other.stT > other.dur * 0.66;
      if (ft.stT < 0 && otherDown && d2 > 0.075 && (d2 >= other.d2 * 0.8 || other.stT >= 0)) {
        // further to go, quicker step: 0.42 s for a nudge, down to 0.30 s for a big turn
        ft.dur = SHUF_DUR - 0.12 * clamp((Math.sqrt(d2) - 0.27) / 0.4, 0, 1);
        // The boot travels ROUND him, not across: the path is interpolated in polar form
        // about his centre (angle and radius separately), so a big turn cannot drag one
        // boot through the other leg. One step turns at most ~50 degrees; a bigger turn
        // is a run of them.
        ft.stT = 0;
        const ax0 = ft.ax + ox - player.pos.x, az0 = ft.az + oz - player.pos.z;
        const os = 0.12 + clamp(Math.abs(yawRate) * 0.06, 0, 0.18);   // lead into a turn that is still going
        const ax1 = nx + dx * os - player.pos.x, az1 = nz + dz * os - player.pos.z;
        ft.sfx = Math.atan2(ax0, az0); ft.sfz = Math.hypot(ax0, az0);
        let dA = Math.atan2(ax1, az1) - ft.sfx;
        dA = Math.atan2(Math.sin(dA), Math.cos(dA));
        ft.stx = clamp(dA, -0.9, 0.9); ft.stz = Math.hypot(ax1, az1);
      }
      if (ft.stT >= 0) {
        ft.stT += dt;
        const u = Math.min(1, ft.stT / ft.dur), e = u * u * u * (u * (u * 6 - 15) + 10);
        const ang = ft.sfx + ft.stx * e, rad = ft.sfz + (ft.stz - ft.sfz) * e;
        ft.ax = player.pos.x + Math.sin(ang) * rad - ox; ft.az = player.pos.z + Math.cos(ang) * rad - oz;
        ft.lift = SHUF_LIFT * Math.sin(Math.PI * u) * (1 - 0.35 * u);
        shufX = -sgn * 0.034 * Math.sin(Math.PI * u);
        if (u >= 1) {
          ft.stT = -1; ft.lift = 0; shufX = 0;
          settle.v -= 1.1; kneeSoft.v += 2.2; kneeSide = i;
          markFootfall(ft, sgn, ox, oz);
          if (gb > 0.5) steps++;           // a boot put down is a footfall: sound, silt, print
        }
      }
      ft.ay = soleB + groundD(ft.ax + ox, ft.az + oz) - oy;   // keeps its footing as the deck heaves
    } else if (ft.stT >= 0) { ft.stT = -1; ft.lift = 0; shufX = 0; }

    // ---- TARGET. One world-space ankle point, however it was arrived at. ----
    let th, cz, wIK;
    if (inStance) {
      rollThrough(sp, _vB); th = _vB.x + groundPitch(ft.ax + ox, ft.az + oz); cz = _vB.y;
      ankleOverContact(th, cz, _vC);
      // THE ROCKERS. The point in contact is not the anchor: the foot pivots on its HEEL
      // as it slaps down and on its BALL as the heel lifts, and a pivot does not move. The
      // old target kept the contact point itself nailed while the contact moved along the
      // sole, which dragged the heel back 0.145 u through every strike (3.7 u/s, faster
      // than he walks) and the ball back 0.19 u through every push-off. Both measured.
      const rs = cz - CZ_FLAT;
      // ...and the ground under the rolling contact, not the anchor's: on a grade the heel
      // and ball rest on seabed a few cm above or below the flat-foot point.
      const gRoll = rs !== 0 ? groundD(ft.ax + ox + sy * rs, ft.az + oz + cy * rs) - groundD(ft.ax + ox, ft.az + oz) : 0;
      _vD.set(ft.ax + ox + sy * (_vC.z + rs), ft.ay + oy + gRoll + _vC.y + ft.lift, ft.az + oz + cy * (_vC.z + rs));
      // The ground keeps the boot to the very end of stance, in either direction, and the
      // hand-back to the curves happens in the AIR (early swing, below). Handing back on
      // the ground let the authored pose push the ball 6-8 cm into the seabed at every
      // push-off, and backing up, skid the leaving heel 0.3 u back toward him.
      wIK = 1;
      ft.ox = _vD.x; ft.oy = _vD.y; ft.oz = _vD.z; ft.oth = th; ft.ocz = cz;
    } else {
      // ---- SWING. Authored in the air, aimed at the ground. ----
      // The next plant is where the root will BE when this foot lands (velocity x the
      // swing time still to run) plus half a stance's worth of ground ahead of it — which
      // is exactly the offset that makes the coming stance hold still.
      const swp = (lp - ft.duty) / (1 - ft.duty);
      ft.swp = swp;
      // Backing, the clock runs down: the swing ends at lp = duty, not at 1, and the boot
      // lands BEHIND him, toe first with the heel still up — exactly the pose the stance
      // roll-through opens with when it is read from its far end (sp = 1).
      const rev = gaitDir < 0;
      const tRem = clamp((rev ? lp - ft.duty : 1 - lp) / Math.max(stepRate, 0.25), 0, 0.9);
      // Where the coming stance must START for the foot to pass symmetrically under the
      // hip: the flat-foot anchor half a stance ahead (less 0.05, which centres the ANKLE's
      // excursion once the heel and ball rockers are counted), and the heel — which is
      // what lands — a heel's length short of that. Backing up lands on the ball, behind.
      const halfS = DUTY * strideNow * ft.stride * slopeK * 0.5;
      const aF = halfS - 0.05 + (CZ_HEEL - CZ_FLAT), aR = -halfS - 0.05 + (CZ_BALL - CZ_FLAT);
      const ahead = aF + (aR - aF) * revF + (gaitState === 3 ? 0.18 : 0) * (1 - 2 * revF);
      const latL = sgn * HIP_X + ft.lat;
      let lx = player.pos.x + player.vel.x * tRem + sy * ahead + cy * latL;
      let lz = player.pos.z + player.vel.z * tRem + cy * ahead - sy * latL;
      th = TH_STRIKE + (TH_OFF - TH_STRIKE) * revF + groundPitch(lx, lz); cz = CZ_HEEL + (CZ_BALL - CZ_HEEL) * revF;
      // CLEARANCE. Blending the authored swing toward a target ON the ground pulled the
      // boot down through mid-swing: measured, the swinging sole skimmed the seabed at 2.4
      // u/s at ~70% of every swing. The landing target rides on an arc that only comes
      // down over the last part of the swing, so the boot is carried, then set down.
      let lift = 0.19 * (1 - ss(0.66, 1.0, swp)) * (1 - revF);
      // the pelvis judges a landing against where the hips will BE when it lands
      ft.px = player.vel.x * tRem; ft.pz = player.vel.z * tRem;
      // Ease onto the landing line over the back half of the swing: early swing is pure
      // authored curve (which is good in the air), late swing is pure ground truth.
      wIK = ss(0.40, 0.97, swp) + (ss(0.40, 0.97, 1 - swp) - ss(0.40, 0.97, swp)) * revF;
      // THE FIRST STEP OFF A STAND. This boot was standing flat beside the other one; the
      // clock has been started at the phase that matches where the PLANTED boot really is
      // (see the start in updateDiver), which drops this one into mid-swing. Rather than
      // snap it to the authored mid-swing pose, it is lifted from where it stands and
      // carried to its landing on its own arc, heel coming up for the strike as it goes.
      if (ft.ln) {
        const q = rev ? 1 - swp : swp;                 // swing progress, either direction
        if (ft.lnU < 0) ft.lnU = Math.min(q, 0.9);
        const u = clamp((q - ft.lnU) / (1 - ft.lnU), 0, 1), e = u * u * u * (u * (u * 6 - 15) + 10);
        lx = ft.lnX + (lx - ft.lnX) * e; lz = ft.lnZ + (lz - ft.lnZ) * e;
        ft.px *= e; ft.pz *= e;   // judged against the hips as the boot gets there
        const r = ss(0.30, 1.0, u);
        th = groundPitch(lx, lz) + (th - groundPitch(lx, lz)) * r; cz = CZ_FLAT + (cz - CZ_FLAT) * r;
        lift = 0.12 * Math.sin(Math.PI * Math.min(1, u * 1.08));
        wIK = 1;
      }
      ankleOverContact(th, cz, _vC);
      _vD.set(lx + sy * _vC.z, soleB + groundD(lx, lz) + _vC.y + lift, lz + cy * _vC.z);
      // TOE-OFF, in the air: the boot leaves from where the stance left it (ball pivot,
      // heel up) and rises off it, handing over to the authored swing by 30% of the swing.
      const qs = rev ? 1 - swp : swp;
      const wOff = ft.ln ? 0 : 1 - ss(0.0, 0.30, qs);
      if (wOff > 1e-3) {
        const up = 0.10 * ss(0.0, 0.30, qs);
        const wl = wIK, ws = wOff + wl;
        _vD.set((_vD.x * wl + ft.ox * wOff) / ws, (_vD.y * wl + (ft.oy + up) * wOff) / ws, (_vD.z * wl + ft.oz * wOff) / ws);
        if (wOff > wl) { th = ft.oth; cz = ft.ocz; }
        ft.px *= wl / ws; ft.pz *= wl / ws;
        wIK = Math.min(1, ws);
      }
    }
    ft.tx = _vD.x; ft.ty = _vD.y; ft.tz = _vD.z; ft.tw = wIK * ikOn;
    if (inStance) { ft.px = 0; ft.pz = 0; }
    _vD.applyMatrix4(_mHi);

    // Blend against the authored pose by the IK weight and by how grounded he is at all.
    const w = wIK * ikOn;
    let tx = fkx + (_vD.x - fkx) * w, ty = fky + (_vD.y - fky) * w, tz = fkz + (_vD.z - fkz) * w;
    // THE GROUND IS A FLOOR FOR THE SWING TOO. The authored swing is scaled by gait
    // amplitude, so a slow step (or the decay of a stop) swings a nearly straight leg —
    // which, under a pelvis that now stands at its true height, put the swinging boot
    // 8 cm into the seabed and dragged it. A swinging sole is held a few cm clear.
    let lifted = false;
    if ((!inStance || w < 0.999) && ikOn > 1e-3 && !standing) {
      _vB.set(tx, ty, tz).applyMatrix4(_mH);
      const fa = hxF + kF + pc[ch[3]], thE = fa + (th - fa) * w;
      const c = Math.cos(thE), s = Math.sin(thE);
      // heel and ball each over their OWN ground: on a climb the ball is over higher seabed
      const zH = CZ_HEEL * c + SOLE_Y * s, zB = CZ_BALL * c + SOLE_Y * s;
      const gH = groundD(_vB.x + sy * zH, _vB.z + cy * zH), gB = groundD(_vB.x + sy * zB, _vB.z + cy * zB);
      const clr = inStance ? 0 : 0.035 * ss(0.0, 0.15, ft.swp) * (1 - ss(0.85, 1.0, ft.swp));
      const minY = soleB + clr + Math.max(gH - (SOLE_Y * c - CZ_HEEL * s), gB - (SOLE_Y * c - CZ_BALL * s));
      if (_vB.y < minY) {
        _vB.y = minY; _vB.applyMatrix4(_mHi);
        tx = _vB.x; ty = _vB.y; tz = _vB.z; lifted = true;
      }
    }
    if (w < 1e-3 && !lifted) {
      // Nothing to solve: he is swimming, or this leg is in the authored part of its
      // swing. Write the curves through untouched — a round trip that is merely
      // near-exact still costs the pose its finest detail.
      _ik[0] = hxF; _ik[1] = hzF; _ik[2] = kF; ikClamped = 0; ikOver = 0;
    } else {
      solveLeg(tx - sgn * HIP_X, ty, tz);
    }
    if (i === 0) { ikDebug.clampR = ikClamped; ikDebug.overR = ikOver; } else { ikDebug.clampL = ikClamped; ikDebug.overL = ikOver; }
    // A stance anchor the leg genuinely CANNOT reach — he was shoved, the ground moved,
    // the raft dropped away — releases early and takes a new step. The threshold is 60 mm
    // of overrun, not merely touching the clamp: at the ends of a long stance the leg is
    // meant to run right up against full extension (that is what a straightening leg IS),
    // and releasing there re-anchored every frame and chewed through the per-step
    // variation draws for nothing.
    // The guard is on PHASE, not on time-in-stance: the overrun it forgives is the
    // geometry of sp < 0.18 (foot far ahead, pelvis in its dip), which backing up reaches
    // at the END of its stance, just before the heel leaves. Releasing there re-claimed
    // the same boot a frame later and doubled the footfall.
    if (inStance && ikOver > 0.06 && sp > 0.18 && !standing) ft.planted = false;

    seg.root.rotation.set(_ik[0], 0, _ik[1]);
    seg.mid.rotation.x = _ik[2];
    // Absolute foot pitch minus what the hip and knee already contribute. During stance
    // that is the roll-through curve, so the sole stays flat on the ground plane; in the
    // air it eases toward toe-up for the coming strike.
    const fkAbs = hxF + kF + pc[ch[3]];
    const thAbs = fkAbs + (th - fkAbs) * w;
    seg.end.rotation.set(thAbs - _ik[0] - _ik[2], 0, 0);
    if (w > 1e-3) {
      _qA.setFromEuler(_eA.set(_ik[0], 0, _ik[1], 'XYZ')).multiply(_qB.setFromAxisAngle(_X1, _ik[2])).premultiply(_qH);
      _qB.setFromEuler(_eA.set(th, yawF, 0, 'YXZ'));
      _qC.copy(_qA).invert().multiply(_qB);                 // the world-level foot, in the shank's frame
      seg.end.quaternion.slerp(_qC, w);
    }

    // Resolve the contact this pose actually produced, for the next claim and the probe.
    ankleOverContact(thAbs, cz, _vC);
    fkAnkle(_ik[0], _ik[1], _ik[2], _vA);
    _vB.set(sgn * HIP_X + _vA.x, _vA.y, _vA.z).applyMatrix4(_mH);
    const nx = _vB.x - sy * _vC.z, nz = _vB.z - cy * _vC.z;
    // The probe follows the ANCHOR-EQUIVALENT point (the contact less its roll along the
    // sole), so the heel and toe rockers are measured too and the contact's jump onto an
    // edge is not mistaken for travel. Whole stance, from the frame after the claim.
    const ex = nx - sy * (cz - CZ_FLAT), ez = nz - cy * (cz - CZ_FLAT);
    if (inStance && ft.pin) ft.slip += Math.hypot(ex - ft.ex, ez - ft.ez);   // accumulated intra-stance travel
    ft.ex = ex; ft.ez = ez; ft.pin = inStance && ft.planted;
    ft.wx = nx; ft.wy = _vB.y - _vC.y; ft.wz = nz; ft.cz = cz;
    if (i === 0) { ikDebug.slipR = ft.slip; ikDebug.plR = (ft.planted ? 1 : 0) + (inStance ? 2 : 0); ikDebug.dR = ft.duty; }
    else { ikDebug.slipL = ft.slip; ikDebug.plL = (ft.planted ? 1 : 0) + (inStance ? 2 : 0); ikDebug.dL = ft.duty; }
  }
  ikDebug.state = gaitState; ikDebug.stepSeq = stepSeq;
}

// ===========================================================================
// THE LIFE LAYER — intention, reaction and distress, on top of the gait.
//
// Everything above makes Sal MOVE correctly. None of it makes him a man with a reason:
// the head only ever turned on a sine gate, a shark bite landed in the lens and the
// lantern but not in his body, the thruster shoved a statue, a grab by an arm the size
// of a mast left him standing in his walk pose, and running out of air changed nothing
// but the breathing rate. This layer is those, in two kinds:
//   INTENT  (written into `po`, so the compliance springs carry it like any authored
//            pose): look-at, turn anticipation, the valve check, grab struggle, low-air
//            hunch, the burst streamline, idle weight shifts on the seabed.
//   REACTION (post-compliance, additive, under-damped springs kicked by impulses):
//            recoil and recovery. Impulses are velocities, never positions, so nothing
//            can pop — a hit arrives as acceleration and leaves through the spring.
// Contracts it keeps: the slash overlay is applied AFTER intent so the blade still
// owns the left arm through contact, and reactions skip the left arm while it swings.
// ===========================================================================
// Live knobs (-1 = auto). vp is the valve pose (Lsx, Lsz, Lsy, Le): the hand to the
// bonnet's side port, tuned on the rig from a contact sheet of six candidates.
const SAL = { look: true, react: 1, lean: 1, valve: -1, peer: -1, slope: true, grab: -1, vp: [-1.35, 1.2, -0.85, -2.05],
  pp: [-1.3, -0.1, 0.3, -0.7] };   // pp: the peer pose (Rsx, Rsz, Rsy, Re) — lantern up and forward
window.__sal = SAL;
// look-at: game.js hands over the nearest thing worth looking at (or null)
const lookT = V3();
let lookHave = false, lookW = 0;
export function diverLookAt(p) { if (p) { lookT.copy(p); lookHave = true; } else lookHave = false; }
// reactions
const rcP = { x: 0, v: 0 }, rcR = { x: 0, v: 0 }, rcY = { x: 0, v: 0 };
const rcH = { x: 0, v: 0 }, rcA = { x: 0, v: 0 }, rcD = { x: 0, v: 0 };
let grabOn = false, grabW = 0, grabT = 0;
// hit: (dx, dz) is the world direction FROM Sal TOWARD what struck him. mag ~1 = a bite.
export function diverImpulse(kind, dx = 0, dz = 0, mag = 1) {
  const k = mag * SAL.react;
  if (kind === 'grab') { rcA.v += 3.0 * k; rcH.v -= 2.4 * k; rcP.v += 1.2 * k; return; }
  const n = Math.hypot(dx, dz);
  const cy = Math.cos(yawF), sy = Math.sin(yawF);
  // local frame: +z forward (sin yaw, cos yaw), +x his left (cos yaw, -sin yaw)
  let fz = 0.6, lx = 0;
  if (n > 1e-4) { fz = (dx * sy + dz * cy) / n; lx = (dx * cy - dz * sy) / n; }
  rcP.v -= 3.3 * fz * k;              // struck from ahead: rocks back; from behind: pitched on
  rcR.v += 2.8 * lx * k;              // struck from his left: the top goes right
  rcY.v -= 3.2 * lx * k;              // the shoulders twist away from it
  rcH.v -= 4.4 * fz * k + 1.0 * k;    // the helmet whips a beat later and further
  rcA.v += 3.6 * k;                   // arms thrown out for balance
  rcD.v -= 2.2 * k;                   // the knees buckle under it
}
export function diverGrab(on) { grabOn = !!on; }
// blend one composed channel toward a target (module function: no per-frame closure)
function poMix(ch, v, w) { po[ch] += (v - po[ch]) * w; }
let idleT = 0, valveT = -1, valveNext = 11, valveIdx = 0, valveW = 0;
const VALVE_DUR = 2.7;
const HEAD_CTR = 0.8;           // how much of the spine's yaw the neck takes back out
// THE SPINE CHAIN's knobs (window.__chain): kH = how far the neck base follows the pelvis'
// lateral shift; yawK = thorax counter-rotation (world) per unit of pelvis yaw; headK = the
// share of the thorax's gait yaw/roll the neck takes back out; f/d = the trunk's spring;
// lag/lagF = the carried bonnet's pitch lag behind the body's lean.
// kH 0.6 -> 0.5 (salprop): the longer stride swung the bonnet to 31% of the hips; 0.5 holds it at ~22%
const CHAIN = { on: 1, kH: 0.5, yawK: 0.5, headK: 0.8, f: 22, d: 0.9, lag: 0.5, lagF: 5 };
window.__chain = CHAIN;
const chR = { x: 0, v: 0 }, chY = { x: 0, v: 0 }, hdC = { x: 0, v: 0 };
let peerT = -1, peerW = 0;
const PEER_DUR = 4.2;
let prevBurstT = 0, burstW = 0;
const brP = { x: 0, v: 0 };
let fwdSpdPrev = 0, accF = 0;
const strafeS = { x: 0, v: 0 };
let hoseLean = 0, hoseRoll = 0, hoseTautWas = 0;
const accLean = { x: 0, v: 0 };
// swim pendulum: last velocity, smoothed body-frame acceleration, and the two swings
let pdVx = 0, pdVz = 0, pdAf = 0, pdAl = 0;
const pendP = { x: 0, v: 0 }, pendR = { x: 0, v: 0 };
const lkY = { x: 0, v: 0 }, lkX = { x: 0, v: 0 };
// slope adaptation state
let slopeZi = 0;
let gdOn = false, gdC = 0, gdFx = 0, gdFz = 0;
let slopeK = 1;                    // stride shortening on a grade (1 = level)
let soleBase = 0;                  // the ground the boots stand on at his centre (last driveLegs)

// Where the seabed is under (x, z), RELATIVE to where player.js put the floor. Relative,
// because player.js owns the absolute floor (colliders, the deck, groundY smoothing); the
// rig only adds what the slope does between one boot and the other.
function groundD(x, z) {
  if (!gdOn) return 0;
  return clamp(terrainH(x, z, slopeZi) - gdC, -0.42, 0.42);
}
// Absolute foot pitch that lays a sole on the slope along his heading (toe-down +).
function groundPitch(x, z) {
  if (!gdOn) return 0;
  const a = terrainH(x + gdFx * 0.22, z + gdFz * 0.22, slopeZi), b = terrainH(x - gdFx * 0.22, z - gdFz * 0.22, slopeZi);
  return clamp(-Math.atan((a - b) / 0.44), -0.45, 0.45);
}

// THE FIRST STEP: start the clock where the feet ARE. Starting from a stand always
// opened at walkP 0.5 (left heel strike), which declared the left boot — standing beside
// the hip — to be a foot that had just landed half a stance AHEAD. It then had to hold
// for a whole stance from a point half a stance too far back, overran the leg's reach,
// was released and re-planted: the walk-off slid a boot ~0.33 u over ~15 frames. Now the
// FRONT boot keeps its plant and the clock opens at the stance phase that matches where
// it actually stands; the other boot is in the air from the first frame, lifted from
// where it stood and carried to its landing (ft.ln, in driveLegs).
function startPhase(player) {
  const sy = Math.sin(yawF), cy = Math.cos(yawF);
  const fR = (ftR.wx - player.pos.x) * sy + (ftR.wz - player.pos.z) * cy;
  const fL = (ftL.wx - player.pos.x) * sy + (ftL.wz - player.pos.z) * cy;
  // Forward, the front boot has the most stance left to give; backing, the rear one.
  const R = gaitDir > 0 ? fR >= fL : fR <= fL, f = R ? fR : fL, st = R ? ftR : ftL, sw = R ? ftL : ftR;
  const halfS = DUTY * strideNow * 0.5, A = halfS - 0.05;
  // stance progress at which a flat foot sits f ahead of the hip: A at sp 0, A - 2*halfS at 1
  const sp0 = clamp((A - f) / (2 * halfS), 0.20, 0.78);
  const lp = sp0 * st.duty;
  sw.ln = true; sw.lnU = -1; sw.lnX = sw.wx; sw.lnY = sw.wy; sw.lnZ = sw.wz;
  return R ? lp : (lp + 0.5) % 1;
}

// THE PELVIS (see the block at GAIT): how far below LIFT the hips must ride this frame.
// Reads the feet's world ankle targets from the last driveLegs (anchors do not move, so a
// frame old is exact for every planted boot) against the hips posed THIS frame.
const pelS = { x: 0, v: 0 };
let pelInit = false;
const _hj = V3();
function pelvisDrop(dt, player, gw) {
  diver.updateMatrix(); diver.body.updateMatrix(); diver.hips.updateMatrix();
  _mH.multiplyMatrices(diver.matrix, diver.body.matrix).multiply(diver.hips.matrix);
  const soleY = (player.grounded ? player.pos.y : player.groundY) - EYE_H;
  // Mid-stance / standing ceiling: the knee never straighter than kMid walking, kIdle
  // standing, over the floor at his centre.
  const kM = GAIT.kIdle + (GAIT.kMid - GAIT.kIdle) * gw;
  const hipTop = (pelInit ? soleBase : soleY) - SOLE_Y + reachAt(kM);
  const dCap = reachAt(GAIT.kCap);
  let need = 1e9, hc = 0;
  for (let i = 0; i < 2; i++) {
    const ft = FTS[i], sgn = LEG_CH[i][4];
    _hj.set(sgn * HIP_X, 0, 0).applyMatrix4(_mH);
    hc += _hj.y * 0.5;
    if (ft.tw < 0.02) continue;
    const dx = ft.tx - ft.px - _hj.x, dz = ft.tz - ft.pz - _hj.z, dh2 = dx * dx + dz * dz;
    // how high this hip may be and still reach this ankle with the knee at kCap
    const top = ft.ty + Math.sqrt(Math.max(dCap * dCap - dh2, 0.01));
    // a swing boot's claim fades in with its IK weight (squared: it only binds late)
    const lim = top - _hj.y + (1 - ft.tw * ft.tw) * 0.6;
    if (i === 0) ikDebug.limR = lim; else ikDebug.limL = lim;
    need = need > 1e8 ? lim : smin(need, lim, GAIT.soft);
  }
  let tgt = hipTop - hc;
  ikDebug.top = tgt;
  if (need < 1e8) tgt = smin(tgt, need, GAIT.soft);
  // Never more than a quarter unit down: an anchor further than that is not a step to
  // crouch for, it is one to release and re-take (driveLegs does, on overreach).
  tgt = clamp(tgt, -0.25, 0.02);
  if (!pelInit) { pelInit = true; pelS.x = tgt; pelS.v = 0; }
  // A ceiling: it falls fast (a late fall is an overreach, which the IK's reach clamp
  // absorbs for a frame or two) and rises on a softer spring. Falling at once was a 5 cm
  // single-frame drop whenever a step's claim landed.
  spring(pelS, tgt, dt, tgt < pelS.x ? 42 : GAIT.rise, 1.0);
  ikDebug.pel = pelS.x;
  return pelS.x;
}

// Pose the diver from player state. grounded => weighted lead-boot walk; else => frog kick.
export function updateDiver(dt, t, player) {
  diver.position.copy(player.pos);
  const speed = player.vel.length();
  const flat = Math.hypot(player.vel.x, player.vel.z);

  if (!yawInit) { yawF = player.yaw; yawInit = true; }
  // the body trails the look direction: tight on the seafloor, loose and laggy in water
  // Standing, the body comes round SLOWER than walking (4.5/s against 9): a man in lead
  // boots turns by stepping, and the look direction runs ahead of him — the helmet and
  // shoulders take up the difference (turn anticipation, in the life layer below).
  // STRAFE BLEND. Walking sideways on forward-keyed legs flung the boots out at the
  // hip (measured on a contact sheet: a leg abducted near 45 degrees every other step).
  // A man in lead boots does not side-step across a seabed, he turns his hips to the
  // way he is going and keeps his eyes where he was looking. So the BODY heading bends
  // toward the travel direction (up to ~70 degrees), and the look-lead below counter-
  // rotates the spine and helmet back onto player.yaw. Backing up keeps its facing and
  // only takes a diagonal's share. Grounded walking only; swimming sculls instead.
  {
    let off = 0;
    const fl = Math.hypot(player.vel.x, player.vel.z);
    if (player.grounded && fl > 0.25) {
      let a = Math.atan2(player.vel.x, player.vel.z) - player.yaw;
      a = Math.atan2(Math.sin(a), Math.cos(a));
      off = Math.abs(a) < 2.0 ? clamp(a, -1.2, 1.2) : clamp(a - Math.sign(a) * Math.PI, -0.5, 0.5);
      off *= clamp(fl * 1.2 - 0.3, 0, 1);
    }
    spring(strafeS, off, dt, 5, 1);
  }
  // THE SLASH SQUARES HIM UP. game.js checks the hit along the LOOK (forwardVec) at
  // t+0.22; the swing is authored in the BODY frame, and with the strafe blend (or the
  // loose swim yaw) the body can sit ~70 degrees off the look — the knife visibly cut
  // one way while the hit landed another. The one correct answer is that the man turns
  // into the cut: the draw and windup (0 -> 0.15 s) are exactly the time a fighter uses
  // to square his shoulders, so the body heading is driven hard onto the look through
  // the windup, held through contact and follow-through, and handed back to the strafe
  // blend during the slow recovery. The feet follow on their own: planted boots stay
  // nailed and the IK twists the legs under the turning hips; a standing turn this big
  // triggers the shuffle step, which is what a real squaring-up does. The hit timing
  // and the swing curves are untouched — only WHERE the swing points moves.
  const sqW = slashT >= 0 ? ss(0, 0.12, slashT) * (1 - ss(0.40, SLASH_DUR, slashT)) : 0;
  {
    let d = player.yaw + strafeS.x * (1 - sqW) - yawF;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const rate = (player.grounded ? 4.5 + 4.5 * clamp(ampS * 2, 0, 1) : 1.6) * (1 - sqW) + 26 * sqW;   // in water: 1.6/s (was 2.6), the mass comes round late
    yawF += d * Math.min(1, rate * dt);
  }
  diver.rotation.y = yawF;

  // Stepping onto planks kills the aquatic motion in ~0.15 s rather than half a second:
  // the deck is a hard, dry contract with the world, and swim bob leaking past the ladder
  // was the single most visible thing wrong with him. Off the deck the old soft 4.5/s
  // stands — settling onto the seabed IS gradual, you sink into it.
  gb = lerp(gb, player.grounded ? 1 : 0, Math.min(1, (player.onDeck ? 10 : 4.5) * dt));
  deckF = lerp(deckF, player.onDeck ? 1 : 0, Math.min(1, 10 * dt));
  ladderF = lerp(ladderF, player.onLadder ? 1 : 0, Math.min(1, 4 * dt));
  // Effective weight on the soles. Same expression player.js walks by (GROUND_BUOY 0.9,
  // A_BUOY_MIN -1.83); duplicated as two literals rather than imported, because diver.js
  // is a pose module and must stay loadable behind the title with no physics running.
  const wgt = player.onDeck ? 1 : clamp((0.9 - (player.buoy || 0)) / 2.73, 0, 1);
  wgtNow = wgt;

  // Gait amplitude envelope: a short attack (he leans into the walk) and a longer release
  // (he settles out of it and the last stride finishes). Hoisted above the phase clock
  // because the state machine below keys its transitions off it.
  const ampT = clamp(flat * 0.42 - 0.06, 0, 1);
  ampS = lerp(ampS, ampT, Math.min(1, (ampT > ampS ? 8.3 : 4.0) * dt));   // ~0.12 s / ~0.25 s
  const amp = ampS;
  // How grounded he is, and whether the gait clock is turning at all. The pendulum below
  // is keyed on `gw`, NOT on amp: the ground a stance foot has to hold is DUTY * GAIT.stride
  // whatever his speed — the cycle slows, the excursion does not — so a pelvis dip scaled
  // by speed would leave the leg short of its anchor at a dawdle.
  const ikOn = gb * clamp(deckF + (player.grounded ? 1 : 0), 0, 1);
  const gw = ss(0.02, 0.22, ampT) * ikOn;

  // ---- THE PHASE CLOCK, AND THE THREE EVENTS THAT INTERRUPT IT ----
  // Steady walking: the phase advances with GROUND COVERED, which is the only way the
  // anchors below can hold — a cycle carries him GAIT.stride, so a foot down for DUTY of a
  // cycle is down for exactly the ground its anchor must span.
  // Starting, stopping and turning are not that. They are events with their own clocks:
  //   START  — 150 ms of lean BEFORE the first push-off, so the body commits and then the
  //            foot answers. Velocity-keyed fade-in had the legs moving before the weight.
  //   STOP   — a catch step: the swinging foot is DRIVEN to its plant ahead of the centre
  //            of mass on its own clock even as the speed decays, the body pitches into it
  //            ~5 deg, then settles back upright. It arrests; it does not dissolve.
  // stepCount()'s contract is untouched throughout: heel strikes are still walkP 0 and 0.5,
  // and the catch step fires its own footfall exactly like any other plant.
  const wantWalk = ampT > 0.02;
  // ON A GRADE THE STEPS SHORTEN. Uphill the trailing boot is below him and the lead
  // above; downhill the reverse. Either way the same stride costs the legs more reach,
  // and a man shortens his step rather than crouch for it. Measured on a 24% climb at
  // the level stride: the pelvis hit its floor and the trailing boot was re-taken.
  {
    const sx = Math.sin(yawF) * 0.5, sz = Math.cos(yawF) * 0.5;
    const g = gdOn ? Math.abs(groundD(player.pos.x + sx, player.pos.z + sz) - groundD(player.pos.x - sx, player.pos.z - sz)) : 0;
    slopeK += (1 / (1 + 1.3 * g) - slopeK) * Math.min(1, 3 * dt);
  }
  {
    const sT = GAIT.stride * (0.55 + 0.45 * clamp(flat / 2.47, 0, 1)) * (1 - 0.18 * revF) * (1 - 0.15 * Math.min(1, Math.abs(strafeS.x)));
    strideNow += (sT - strideNow) * Math.min(1, 2.5 * dt);
  }
  let stepRate = 0;
  // Which way the clock turns: ground covered along the BODY's heading (the strafe blend
  // has already turned the hips toward a sideways walk, so only a genuine back-up reads
  // negative here). Chosen freely while he stands or leans in; mid-walk it needs a clear
  // reversal (hysteresis), and the flip is a pure time reversal — every planted boot
  // stays planted, every swinging boot goes back the way it came.
  {
    const fAlong = player.vel.x * Math.sin(yawF) + player.vel.z * Math.cos(yawF);
    const nd = gaitState <= 1 ? (fAlong < -0.02 ? -1 : 1)
      : fAlong < -0.35 ? -1 : fAlong > 0.35 ? 1 : gaitDir;
    if (nd !== gaitDir) {
      gaitDir = nd;
      // the strike clock re-bases by DUTY on a flip; do not let that read as a footfall
      lastStepSide = strikeP() < 0.5 ? 0 : 1;
    }
  }
  if (gaitState === 0) {
    if (wantWalk) { gaitState = 1; gaitT = 0; }
  } else if (gaitState === 1) {
    gaitT += dt;
    if (!wantWalk) gaitState = 0;
    else if (gaitT >= START_LEAN) {
      // Push-off. walkP 0.5 IS the left heel strike: he steps forward onto the leading
      // foot, both boots are briefly down, and the right toes off out of that double
      // support. Landing exactly on the strike keeps the footfall audio honest.
      // Backing off from a stand is the mirror: the left boot has just gone down BEHIND
      // (reverse plant at lp = DUTY) and the right is about to leave heel-last.
      gaitState = 2; walkP = startPhase(player); gaitT = 0;
      lastStepSide = strikeP() < 0.5 ? 0 : 1;   // a start is not a footfall
    }
  } else if (gaitState === 2) {
    stepRate = clamp(flat / (strideNow * strideK * slopeK), 0, 2.1);
    if (!wantWalk) {
      // Finish the step that is in the air, on a fixed clock, and land it long.
      gaitState = 3; gaitT = 0; catchFrom = walkP;
      // Backing, the next plant is the next lp = DUTY crossing going DOWN.
      if (gaitDir > 0) catchTo = walkP < 0.5 ? 0.5 : 1.0;
      else catchTo = walkP > DUTY ? DUTY : walkP > DUTY - 0.5 ? DUTY - 0.5 : DUTY - 1.0;
    }
  } else {
    gaitT += dt;
    const u = clamp(gaitT / CATCH_DUR, 0, 1);
    walkP = catchFrom + (catchTo - catchFrom) * (u * u * (3 - 2 * u));
    if (wantWalk) { gaitState = 2; }
    else if (u >= 1) {
      // The catch foot is down. Weight drops through it, and the body — which has been
      // pitched into the step for the last 300 ms — is released to rock back through
      // upright and settle. The under-damped spring does the settle; this is just the
      // shove that makes it a recoil rather than a fade.
      gaitState = 0; walkP = (walkP % 1 + 1) % 1;
      leanP.v -= 0.85 * gaitDir;
      settle.v -= 2.6;
    }
  }
  if (gaitState === 2) walkP = ((walkP + gaitDir * stepRate * dt) % 1 + 1) % 1;
  else if (gaitState === 3) walkP = (walkP % 1 + 1) % 1;
  spring(revS, gaitDir > 0 ? 0 : 1, dt, 14, 1);
  revF = clamp(revS.x, 0, 1);
  // Stroke commitment: from a near-standstill with way coming on, the kick cycle
  // spins up ~2.6x until the body reaches the speed the effort implies — pressing
  // forward means a kick NOW, not a throttle fading in. At cruise the term is zero
  // and the cadence is the shipped one.
  const spinUp = 1 + 1.6 * clamp(1 - speed / 14, 0, 1) * clamp(flat * 0.4 + Math.abs(player.vel.y) * 0.2, 0, 1);
  const swPrev = swimP;
  // Slow, effortful strokes: 0.52 Hz at cruise (was 0.73). The thrust pulse in player.js
  // is unit-mean per cycle, so a slower kick is a bigger shove with a longer glide after
  // it — not a slower swimmer.
  swimP = (swimP + (0.17 + speed * 0.020) * spinUp * dt) % 1;
  if (swimP < swPrev) drawKick(++kickIdx);   // one fresh pair of legs per kick
  // ---- breath clock: context-driven cadence, still drifting so it never metronomes.
  // Effort winds the rate up through an EMA — a sprint costs breaths for a while after
  // it ends, which is how lungs actually behave.
  {
    const effort = clamp(speed / 7, 0, 1) * 0.9 + (player.thrustOn ? 0.6 : 0);
    exert += (clamp(effort, 0, 1) - exert) * Math.min(1, dt * (effort > exert ? 0.55 : 0.16));
    const airLow = 1 - clamp(survival.oxygen / 0.35, 0, 1);   // bites below a third of a tank
    let cyc = lerp(BR_REST, BR_WORK, exert);
    cyc = lerp(cyc, BR_PANIC, airLow * 0.85);                 // starving for air: fast...
    breathAmp = (1 - 0.5 * airLow) * (1 + 0.25 * exert);      // ...and thin. Panic read.
    // cycMul is this breath's own length (set at each cycle wrap below): at rest it
    // spreads 3.2-5.2 s with occasional ~6 s held breaths. Exertion and low air narrow
    // the spread back toward the metered cadence — a sprinting diver cannot hold one.
    const varK = lerp(cycMul, 1, clamp(exert * 0.8 + airLow * 0.9, 0, 1));
    breathPh += (TAU / (cyc * varK)) * (1 + 0.09 * Math.sin(t * 0.079)) * dt;
  }
  // Published to player.js, which shapes the forward thrust on swimP (the visible kick IS
  // the push) and lands the per-stride water resistance on walkP's heel strike. Two scalar
  // stores; no allocation, no new clock, no second source of truth.
  player.walkP = strikeP(); player.swimP = swimP;

  poseWalk(pw, walkP, amp, t, deckF);
  poseSwim(psw, swimP, t, clamp(speed * 0.09, 0, 1));
  for (let i = 0; i < CH.N; i++) po[i] = psw[i] + (pw[i] - psw[i]) * gb;

  // ---- SCULLS. Backing up and crabbing sideways are not swimming, and they should not
  // look like it: the arms come out of the streamlined trail into a shallow paddle. This
  // is a BIAS on the existing swim pose, not a new animation — four channels, sprung so
  // it eases in and out, and it fades out entirely the moment his boots find the ground.
  const sw = 1 - gb;
  spring(scX, (player.scullX || 0) * sw, dt, 5, 0.85);
  spring(scZ, (player.scullZ || 0) * sw, dt, 5, 0.85);
  if (scX.x !== 0 || scZ.x !== 0) {
    // sideways: the leading arm sweeps across the chest, the trailing arm abducts out
    po[CH.Rsz] += 0.22 * scX.x; po[CH.Lsz] -= 0.22 * scX.x;
    po[CH.Rsy] += 0.14 * scX.x; po[CH.Lsy] += 0.14 * scX.x;
    // backing: both hands come forward and the elbows open, palms pushing ahead of him
    po[CH.Rsx] += 0.34 * scZ.x; po[CH.Lsx] += 0.34 * scZ.x;
    po[CH.Re] += 0.26 * scZ.x; po[CH.Le] += 0.26 * scZ.x;
  }

  // ---- THE LADDER. player.onLadder walks him up the rungs; without this the rig kept
  // frog-kicking through the climb — levitation with scenery. An overlay on the blended
  // pose, not a fourth pose: the swim's bob/roll are blended OUT, the knees tuck onto the
  // rungs, and the arms take an alternating reach-up phased off CLIMB PROGRESS (vertical
  // position), so the hands move rung to rung with the body, never on their own clock.
  if (ladderF > 0.003) {
    const w = ladderF;
    const s = Math.sin(player.pos.y * 3.4);        // +1 = right hand reaching for the next rung
    const rUp = 0.5 + 0.5 * s, lUp = 1 - rUp;
    const mix = poMix;   // (ch, v, w) — module function, no per-frame closure
    // squared to the rungs: swim bob, sway and roll die under the grip
    mix(CH.bobY, 0, w); mix(CH.shiftX, 0, w); mix(CH.pYaw, 0, w); mix(CH.pRoll, 0, w);
    mix(CH.pPitch, 0.10, w); mix(CH.sPitch, -0.16, w); mix(CH.sRoll, 0, w);
    mix(CH.nPitch, 0.22, w);                          // eyes up the ladder, where he is going
    // arms: the reaching arm goes long overhead, the holding arm stays bent on its rung
    mix(CH.Rsx, -1.15 - 0.75 * rUp, w); mix(CH.Rsz, 0.16, w); mix(CH.Rsy, -0.06, w);
    mix(CH.Re, -(0.95 - 0.60 * rUp), w);
    mix(CH.Lsx, -1.15 - 0.75 * lUp, w); mix(CH.Lsz, 0.16, w); mix(CH.Lsy, 0.06, w);
    mix(CH.Le, -(0.95 - 0.60 * lUp), w);
    // legs: knees tucked, stepping contralaterally (right hand up, left knee up)
    mix(CH.Rhx, -0.35 - 0.30 * lUp, w); mix(CH.Rhz, 0.07, w); mix(CH.Rk, 0.65 + 0.35 * lUp, w); mix(CH.Ra, 0.25, w);
    mix(CH.Lhx, -0.35 - 0.30 * rUp, w); mix(CH.Lhz, 0.07, w); mix(CH.Lk, 0.65 + 0.35 * rUp, w); mix(CH.La, 0.25, w);
  }

  // ---- THE LIFE LAYER: intent (see the block above diverLookAt) ----
  {
    // DRAG AND DESCENT, off the ground only. Moving fast, the water takes the legs back
    // behind him; sinking, the knees come up and the arms lift out for the landing he
    // can see coming, the helmet tipping down toward it in the last few units.
    const off = 1 - gb;
    if (off > 1e-3) {
      const hs = Math.hypot(player.vel.x, player.vel.z);
      const trail = clamp(hs / 14, 0, 1) * off;
      po[CH.Rhx] += 0.24 * trail; po[CH.Lhx] += 0.24 * trail;
      po[CH.Rk] += 0.10 * trail; po[CH.Lk] += 0.10 * trail;
      po[CH.Ra] -= 0.25 * trail; po[CH.La] -= 0.25 * trail;
      const sink = clamp((-player.vel.y - 0.5) / 3.0, 0, 1) * off;
      if (sink > 1e-3) {
        const near = 1 - ss(1.5, 6, player.pos.y - (player.groundY ?? -1e9));   // groundY is the standing eye height
        po[CH.Rhx] -= (0.22 + 0.25 * near) * sink; po[CH.Lhx] -= (0.18 + 0.25 * near) * sink;
        po[CH.Rk] += (0.30 + 0.35 * near) * sink; po[CH.Lk] += (0.26 + 0.35 * near) * sink;
        po[CH.Rsz] += 0.30 * sink; po[CH.Lsz] += 0.30 * sink;
        po[CH.nPitch] += 0.30 * near * sink;
      }
    }
  }
  const airLow = 1 - clamp(survival.oxygen / 0.35, 0, 1);
  let dYaw = player.yaw - yawF;
  dYaw = Math.atan2(Math.sin(dYaw), Math.cos(dYaw));
  {
    // TURN ANTICIPATION. The eyes go first, the shoulders follow, the hips come last:
    // yawF is the body's own lagging heading, so its gap to the look direction IS the
    // turn he is about to make. The head leads into it, the spine takes a share, the
    // pelvis holds back — a turn becomes a ripple down the body instead of a turret.
    const lead = clamp(dYaw, -1.25, 1.25);
    let hy = lead * 0.85, hp = 0;
    // LOOK-AT. Whatever game.js says is worth noticing (a creature, the sleeper, a light
    // in the dark). Heaviest at a standstill, lighter on the move, gone while he fights.
    const wantL = SAL.look && lookHave ? (0.95 - 0.55 * amp) * (1 - grabW) * (1 - ladderF) : 0;
    lookW += (wantL - lookW) * Math.min(1, 1.6 * dt);
    if (lookW > 1e-3) {
      const vx = lookT.x - diver.position.x, vy = lookT.y - (diver.position.y + 0.45), vz = lookT.z - diver.position.z;
      let ly = Math.atan2(vx, vz) - yawF;
      ly = Math.atan2(Math.sin(ly), Math.cos(ly));
      // behind him: he does not wrench his neck round, he gives up on it
      const behind = 1 - ss(1.5, 2.2, Math.abs(ly));
      const lp = Math.atan2(vy, Math.hypot(vx, vz));
      // ...and while he cuts, his eyes are on the cut.
      hy += clamp(ly, -1.15, 1.15) * lookW * behind * (1 - sqW);
      hp += clamp(lp, -0.45, 0.35) * lookW * behind * (1 - sqW);
    }
    // Head yaw/pitch are sprung here so the look drifts on rather than tracking a target
    // frame-perfectly — a man in a 25 kg helmet turns it slowly.
    // Squaring up for a slash the whole column turns as one, fast.
    spring(lkY, hy, dt, 4.2 + 12 * sqW, 0.9);
    spring(lkX, hp, dt, 3.6, 0.9);
    // Share out: the helmet can only turn so far on the corselet before the shoulders
    // have to come round too.
    const sY = clamp(lkY.x * 0.38, -0.34, 0.34);
    po[CH.sYaw] += sY;
    po[CH.nYaw] += lkY.x - sY * (1 - HEAD_CTR);
    po[CH.pYaw] -= lead * 0.12 * gb;
    po[CH.nPitch] -= lkX.x * 0.85;    // nPitch + is chin down
    po[CH.sPitch] -= lkX.x * 0.15;
  }
  {
    // THE VALVE CHECK. A hard-hat diver's hand goes to his air every so often without
    // thinking about it: stood still on the bottom for a while, the left hand comes up
    // to the side of the bonnet, rests there, turns a half-thought, comes down. Hashed
    // intervals (never Math.random), cancelled by any movement, never during a slash.
    const still = gaitState === 0 && amp < 0.05 && slashT < 0 && grabW < 0.05 && ladderF < 0.05;
    idleT = still ? idleT + dt : 0;
    // Two idle gestures share the one clock: the valve check, and (a bit under half the
    // time) THE PEER — the lantern comes up and forward, and the helmet sweeps slowly
    // across the dark it lights, then the arm sinks back.
    if (valveT < 0 && peerT < 0 && idleT > valveNext) {
      valveIdx++;
      if (sHash(valveIdx, 42) < 0.42) peerT = 0; else valveT = 0;
      valveNext = idleT + 9 + 16 * sHash(valveIdx, 41);
    }
    let vw = 0, pw2 = 0;
    if (valveT >= 0) {
      valveT += dt;
      vw = ss(0, 0.7, valveT) * (1 - ss(VALVE_DUR - 0.8, VALVE_DUR, valveT));
      if (valveT >= VALVE_DUR || !still) valveT = -1;
    }
    if (peerT >= 0) {
      peerT += dt;
      pw2 = ss(0, 0.9, peerT) * (1 - ss(PEER_DUR - 1.0, PEER_DUR, peerT));
      if (peerT >= PEER_DUR || !still) peerT = -1;
    }
    if (SAL.peer >= 0) pw2 = SAL.peer;
    peerW += (pw2 - peerW) * Math.min(1, 5 * dt);
    if (peerW > 1e-3) {
      const w = peerW, P = SAL.pp;
      const scan = peerT > 0.9 ? Math.sin((peerT - 0.9) * 1.5) * 0.30 : 0;   // one slow sweep
      poMix(CH.Rsx, P[0], w); poMix(CH.Rsz, P[1], w); poMix(CH.Rsy, P[2], w); poMix(CH.Re, P[3], w);
      po[CH.sYaw] -= 0.10 * w; po[CH.nYaw] += (-0.12 + scan) * w; po[CH.nPitch] -= 0.04 * w;
    }
    // low air: the hand keeps going back to it
    vw = Math.max(vw, airLow * 0.75 * (1 - amp));
    if (SAL.valve >= 0) vw = SAL.valve;
    valveW += (vw - valveW) * Math.min(1, 6 * dt);
    if (valveW > 1e-3) {
      const w = valveW;
      const twist = valveT > 0.8 ? Math.sin((valveT - 0.8) * 7) * 0.08 * (1 - ss(1.6, 2.0, valveT)) : 0;
      const V = SAL.vp;
      po[CH.Lsx] += (V[0] - po[CH.Lsx]) * w;
      po[CH.Lsz] += (V[1] - po[CH.Lsz]) * w;
      po[CH.Lsy] += (V[2] - po[CH.Lsy]) * w;
      po[CH.Le] += (V[3] + twist - po[CH.Le]) * w;
      po[CH.nYaw] += 0.16 * w;          // the head cocks toward the hand
      po[CH.nPitch] += 0.05 * w;
      po[CH.sRoll] -= 0.04 * w;
    }
  }
  {
    // GRAB: he fights it. Irregular, not a loop — four incommensurate rates per channel —
    // arms clawing, shoulders wrenching, the legs kicking at nothing. SAL.grab forces it.
    const g = SAL.grab >= 0 ? SAL.grab : grabOn ? 1 : 0;
    grabW += (g - grabW) * Math.min(1, (g > grabW ? 5 : 1.6) * dt);
    if (grabW > 1e-3) {
      grabT += dt;
      const w = grabW, q = grabT;
      const n1 = Math.sin(q * 5.3) + 0.6 * Math.sin(q * 8.9 + 1.3);
      const n2 = Math.sin(q * 4.1 + 2.0) + 0.6 * Math.sin(q * 7.3 + 0.4);
      const n3 = Math.sin(q * 3.3 + 0.7) + 0.5 * Math.sin(q * 11.1 + 2.2);
      po[CH.sYaw] += 0.30 * n1 * w; po[CH.sRoll] += 0.14 * n2 * w; po[CH.sPitch] += (0.12 + 0.08 * n3) * w;
      po[CH.pYaw] -= 0.14 * n1 * w; po[CH.pRoll] += 0.08 * n3 * w;
      po[CH.nYaw] += 0.35 * n2 * w; po[CH.nPitch] -= (0.10 + 0.10 * n1) * w;
      po[CH.Rsx] += (-1.2 + 0.55 * n2 - po[CH.Rsx]) * w * 0.8; po[CH.Rsz] += (0.55 + 0.25 * n3) * w;
      po[CH.Re] += (-1.3 + 0.45 * n1 - po[CH.Re]) * w * 0.8;
      po[CH.Lsx] += (-0.9 - 0.6 * n1 - po[CH.Lsx]) * w * 0.8; po[CH.Lsz] += (0.5 + 0.25 * n2) * w;
      po[CH.Le] += (-1.1 - 0.5 * n3 - po[CH.Le]) * w * 0.8;
      const kick = Math.sin(q * 6.2), kick2 = Math.sin(q * 6.2 + 2.6);
      po[CH.Rhx] += (-0.35 - 0.35 * kick) * w * (1 - gb * 0.7); po[CH.Rk] += (0.5 + 0.45 * kick) * w * (1 - gb * 0.7);
      po[CH.Lhx] += (-0.35 - 0.35 * kick2) * w * (1 - gb * 0.7); po[CH.Lk] += (0.5 + 0.45 * kick2) * w * (1 - gb * 0.7);
    } else grabT = 0;
  }
  {
    // THE HOSE. At the end of the line the umbilical is a bar pulling him back toward
    // the raft: he leans into it, head down, and the moment it comes up hard he is
    // yanked — a jolt through the torso and the helmet from the side the hose is on.
    const taut = survival.tautness || 0;
    const k = ss(0.88, 1.0, taut);
    hoseLean = 0; hoseRoll = 0;
    if (k > 1e-3) {
      const hx = pumpPos.x - player.pos.x, hz = pumpPos.z - player.pos.z, hn = Math.hypot(hx, hz) || 1;
      const sy = Math.sin(yawF), cy = Math.cos(yawF);
      const back = -(hx * sy + hz * cy) / hn, lat = (hx * cy - hz * sy) / hn;
      const strain = k * (0.35 + 0.65 * clamp(amp * 2 + (1 - gb) * clamp(speed * 0.3, 0, 1), 0, 1));
      hoseLean = 0.14 * strain * Math.max(0, back);
      hoseRoll = -0.07 * strain * lat;
      po[CH.sPitch] += 0.07 * strain; po[CH.nPitch] += 0.10 * strain;
      if (taut > 0.995 && hoseTautWas <= 0.995) {
        rcP.v -= 1.5 * back * SAL.react; rcR.v += 1.0 * lat * SAL.react; rcH.v -= 1.2 * SAL.react;
      }
    }
    hoseTautWas = taut;
  }
  {
    // LOW AIR: the posture goes before the man does. Shoulders round, the head drops and
    // then jerks up — looking for the surface he cannot see — on the panic breath clock.
    if (airLow > 0.01) {
      const gasp = Math.max(0, Math.sin(breathPh)) ** 3;
      po[CH.sPitch] += 0.16 * airLow;
      po[CH.nPitch] += (0.16 - 0.42 * gasp) * airLow;
      po[CH.Rsz] += 0.10 * airLow; po[CH.Rk] += 0.10 * airLow * gb; po[CH.Lk] += 0.10 * airLow * gb;
    }
  }
  {
    // BURST: the bottle dumps through the thruster on his back, so the rig is shoved from
    // BEHIND. The torso takes it, the helmet and limbs are left behind by it and trail
    // into a streamline for as long as the blowdown lasts, then swing back.
    const bt = player.burstT || 0;
    if (bt > prevBurstT + 0.05) {
      brP.v += 3.2 * SAL.react;           // pitch into the shove
      rcH.v -= 3.6 * SAL.react;            // the helmet snaps back
      rcA.v -= 2.2 * SAL.react;            // arms flung back along the body
    }
    prevBurstT = bt;
    burstW += ((bt > 0 ? 1 : 0) - burstW) * Math.min(1, (bt > 0 ? 9 : 2.2) * dt);
    if (burstW > 1e-3) {
      const w = burstW * (1 - ladderF);
      poMix(CH.Rsx, 0.55, w); poMix(CH.Rsz, 0.22, w); poMix(CH.Re, -0.30, w);
      if (slashT < 0) { poMix(CH.Lsx, 0.55, w); poMix(CH.Lsz, 0.18, w); poMix(CH.Le, -0.25, w); }
      poMix(CH.Rhx, 0.12, w); poMix(CH.Rk, 0.10, w); poMix(CH.Ra, -0.45, w);
      poMix(CH.Lhx, 0.18, w); poMix(CH.Lk, 0.16, w); poMix(CH.La, -0.40, w);
      poMix(CH.nPitch, -0.18, w);
    }
  }

  // Slash overlay: blends over the left-arm channels (plus a touch of spine twist) rather
  // than replacing the pose, so the gait keeps driving everything else and the arm eases
  // back into whatever it was doing when the swing ends.
  if (slashT >= 0) {
    slashT += dt;
    const w = ss(0, 0.055, slashT) * (1 - ss(SLASH_DUR - 0.075, SLASH_DUR, slashT));
    evalSlash(slashT);
    po[CH.Lsx] += (slA[0] - po[CH.Lsx]) * w;
    po[CH.Lsy] += (slA[1] - po[CH.Lsy]) * w;
    po[CH.Lsz] += (slA[2] - po[CH.Lsz]) * w;
    po[CH.Le] += (slA[3] - po[CH.Le]) * w;
    po[CH.sYaw] += slA[4] * w * 0.85;
    po[CH.sRoll] += slA[4] * w * 0.25;
    // 0.53, not 0.505: the sheath-return swap fires AFTER the hand has crossed the
    // scabbard throat (the 0.500 key), so the knife never teleports home mid-reach.
    const held = slashT >= 0.085 && slashT < 0.53;
    if (diver.knifeHeld.visible !== held) { diver.knifeHeld.visible = held; diver.knifeHome.visible = !held; }
    const dr = 0.30 * ss(0.135, 0.19, slashT) * (1 - ss(0.235, 0.34, slashT));
    diver.slashArc.visible = dr > 0.002;
    dragMat.opacity = dr;
    if (slashT >= SLASH_DUR) {
      slashT = -1;
      diver.knifeHeld.visible = false; diver.knifeHome.visible = true;
      diver.slashArc.visible = false; dragMat.opacity = 0;
    }
  }

  // a heel strike drops a little extra weight through the frame — the "settle"
  const side = strikeP() < 0.5 ? 0 : 1;
  if (side !== lastStepSide && gaitDir < 0) lastStepSide = side;   // backing: fired at the plant (driveLegs)
  if (side !== lastStepSide) {
    lastStepSide = side;
    // Weight through the frame, not a fixed thump: a vented dress puts the whole 170 kg
    // through the heel; a blown-up one lands like a man on the moon. `wgt` mirrors
    // player.js's walk law exactly (1 = planted, 0 = floating off the bottom), and on
    // planks it is 1 because air holds nothing up.
    settle.v -= 2.25 * (0.45 + 0.75 * wgt) * gb * amp;
    // the landing leg takes the weight: a short knee soften, ~5 degrees, peaking ~78 ms in
    kneeSoft.v += 4.0 * gb * amp;
    // Backing, the strike clock is re-based by DUTY so side 1 opens on the RIGHT plant.
    kneeSide = side;
    // Audio keys off the same event that drops the visual weight, so boot sounds can
    // never drift from the animation no matter how the gait is retimed.
    if (gb > 0.5 && amp > 0.08) steps++;
  }
  // A light dress settles SLOWER as well as less far — the recovery is the moon-walk.
  spring(settle, 0, dt, 7 + 4 * wgt, 0.34);
  spring(kneeSoft, 0, dt, 20, 0.55);
  const ks = Math.max(0, kneeSoft.x) * 0.42;
  if (kneeSide === 0) po[CH.Rk] += ks; else po[CH.Lk] += ks;

  // ---- COMPLIANCE. Nothing below reads `po` again; the body is driven from `pc`. ----
  // Water takes 30% off every frequency. slashW stiffens the striking arm (see the table).
  const slashW = slashT >= 0 && slashT < SLASH_DUR ? 1 : 0;
  compliance(pc, po, dt, 1 - 0.30 * (1 - gb), slashW);

  const b = diver.body;
  // ---- THE LIFE LAYER: reaction springs (post-compliance, additive, impulse-driven) ----
  const wf = 0.75 + 0.25 * gb;            // water slows every recovery
  spring(rcP, 0, dt, 5.0 * wf, 0.32); spring(rcR, 0, dt, 5.0 * wf, 0.32); spring(rcY, 0, dt, 5.5 * wf, 0.35);
  spring(rcH, 0, dt, 7.5 * wf, 0.28); spring(rcA, 0, dt, 4.5 * wf, 0.40); spring(rcD, 0, dt, 6.0, 0.45);
  spring(brP, 0, dt, 4.5, 0.40);
  // ACCELERATION LEAN. Lead boots and a column of water: to get going he leans into it,
  // to stop he has to sit back against his own momentum. Plus a constant lean into the
  // water's drag at walking pace. Read along his own heading, smoothed, sprung.
  {
    const fs = player.vel.x * Math.sin(yawF) + player.vel.z * Math.cos(yawF);
    const a = dt > 1e-5 ? (fs - fwdSpdPrev) / dt : 0;
    fwdSpdPrev = fs;
    accF += (clamp(a, -6, 6) - accF) * Math.min(1, 5 * dt);
    // Climbing, he leans into the hill; descending, he sits back against it.
    const sx = Math.sin(yawF) * 0.5, sz = Math.cos(yawF) * 0.5;
    const hill = gdOn ? Math.atan(groundD(player.pos.x + sx, player.pos.z + sz) - groundD(player.pos.x - sx, player.pos.z - sz)) : 0;
    spring(accLean, ((clamp(accF * 0.045, -0.11, 0.10) + 0.065 * amp * (1 - 2 * revF) + 0.30 * hill * amp) * gb + hoseLean) * (1 - ladderF) * SAL.lean, dt, 4.0, 0.85);
  }
  // LIFT plants the soles on player.pos - 1.35 (the collision floor) with the legs at
  // full stretch. Off the ground the authored bob rides on it; on the ground THE PELVIS
  // (pelvisDrop, below, once the hips are posed) brings him down onto his legs. The
  // heel-strike settle is allowed to travel twice as far grounded, because the knees can
  // genuinely absorb it against the ground instead of pushing the whole man through it.
  const yFree = LIFT + settle.x * (0.045 + 0.045 * ikOn) + rcD.x * 0.45 * gb;
  b.position.set(pc[CH.shiftX] + shufX, yFree + pc[CH.bobY] * (1 - ikOn), pc[CH.shiftZ]);
  // Lead boots below, a copper helmet full of air above: the centres of gravity and
  // buoyancy are a metre apart, so the righting moment is an order of magnitude larger
  // than any couple he can generate — and it GROWS with every litre in the dress. He
  // leans; he never tips like a frogman. The lean also reads off horizontal speed only,
  // so the ending's pure-vertical ascent cannot drive it.
  const upright = 0.22 + 0.30 * (1 - (player.fill || 0));
  const hsp = Math.hypot(player.vel.x, player.vel.z);
  // On the ladder he hangs vertical off the rungs whatever the camera pitch is doing.
  const pitchTarget = (gb > 0.5 ? 0 : clamp(-player.pitch * upright + hsp * 0.010, -0.55, 0.55)) * (1 - ladderF);
  spring(sPitch, pitchTarget, dt, 2.2, 0.90);
  // yaw rate, smoothed over ~0.25 s so a mouse jitter is not a bank
  if (!prevYawInit) { prevYaw = player.yaw; prevYawInit = true; }
  const dyaw = dt > 1e-5 ? (player.yaw - prevYaw) / dt : 0;
  prevYaw = player.yaw;
  yawRate = lerp(yawRate, dyaw, Math.min(1, 4 * dt));
  const bank = clamp(-yawRate * 0.13, -0.30, 0.30);
  spring(sRollT, (1 - gb) * (clamp(-(player.yaw - yawF) * 2.2, -0.5, 0.5) + bank), dt, 4, 0.8);
  // ON THE GROUND HE BANKS TOO. A man carrying a hundredweight of lead round a corner
  // leans into it or he goes over; the swim bank was gated to (1-gb) and left the walk
  // turning like a turret. Smaller than the swimmer's, and only while the turn lasts.
  bankG = lerp(bankG, clamp(-yawRate * 0.055, -0.13, 0.13) * gb * amp, Math.min(1, 5 * dt));
  // The lean/catch clock: a start pitches him forward BEFORE the first push-off, a stop
  // pitches him into the catch step and rocks back upright over ~0.4 s.
  spring(leanP,
    // Backing, the weight goes onto the heels first, and less of it: he cannot see
    // where he is putting his boots, so the commitment is smaller.
    gaitState === 1 ? (gaitDir > 0 ? 0.10 : -0.05) * ss(0, START_LEAN, gaitT)   // START: lean, THEN push off
      : gaitState === 3 ? (gaitDir > 0 ? 0.085 : -0.045)                       // STOP: pitch into the catch step
        : 0,
    dt, 7.5, 0.62);
  // THE PENDULUM. Off the bottom he hangs from an air-filled helmet with a hundredweight of
  // lead at his feet, so every change of way swings the body under the bonnet: a stroke
  // that gets him going leaves the boots behind and tips him into it, a stop swings them
  // through under him and he rocks back, a hard turn swings them out. Smoothed body-frame
  // acceleration drives an under-damped spring at roughly the period of a body that long.
  {
    const off = 1 - gb;
    let afw = 0, alt = 0;
    if (dt > 1e-5 && off > 1e-3) {
      const ax = (player.vel.x - pdVx) / dt, az = (player.vel.z - pdVz) / dt;
      const sy = Math.sin(yawF), cy = Math.cos(yawF);
      afw = ax * sy + az * cy; alt = ax * cy - az * sy;
    }
    pdVx = player.vel.x; pdVz = player.vel.z;
    pdAf += (clamp(afw, -40, 40) - pdAf) * Math.min(1, 3.5 * dt);
    pdAl += (clamp(alt, -40, 40) - pdAl) * Math.min(1, 3.5 * dt);
    spring(pendP, clamp(0.016 * pdAf, -0.26, 0.26) * off * (1 - ladderF), dt, 2.3, 0.32);
    spring(pendR, clamp(-0.014 * pdAl, -0.20, 0.20) * off * (1 - ladderF), dt, 2.3, 0.32);
  }
  b.rotation.set(sPitch.x + pc[CH.pPitch] * (1 - gb) + leanP.x * gb + accLean.x + rcP.x + brP.x + pendP.x, 0,
    sRollT.x + bankG + rcR.x + hoseRoll + pendR.x);

  const h = diver.hips;
  h.rotation.set(0, pc[CH.pYaw], pc[CH.pRoll]);
  const sp = diver.spine;
  // ---- THE SPINE CHAIN ----
  // Michael, 2026-10-01: "his upper body is rigid to his lower when he walks and it almost
  // looks like he is going to fall over going left to right." It was: the thorax took the
  // pelvis' list and shift whole (a 0.6 counter-roll, a beat late), so every step tipped
  // a metre of corselet and 25 kg of bonnet out over the stance boot — measured from
  // behind, the helmet swung 80% as far as the pelvis and rolled half as much, and its yaw
  // followed the pelvis' (the -0.8 head counter only undid the SPINE's share).
  // A walker's pelvis shifts and lists over the stance foot; above it the lumbar and
  // thoracic spine bend the other way so the chest stays nearly upright and the head is
  // carried over the centre of mass, the thorax counter-rotates against the pelvis (which
  // is what swings the shoulders against the arms), and the neck holds the head level and
  // on the heading — vestibular stabilisation. So, from the pelvis actually posed:
  //  - LATERAL BEND: the thorax world roll that puts the neck base at CHAIN.kH of the
  //    pelvis' shift (the spine pivot rides the list: x = shift - 0.20 sin(list));
  //  - COUNTER-ROTATION: thorax world yaw = -CHAIN.yawK x pelvis yaw;
  //  both on a stiff spring (the trunk's own inertia: a small lag, no wobble), and
  //  - THE NECK cancels CHAIN.headK of whatever gait yaw and roll reaches the thorax, IN
  //    PHASE (it reads the values posed this frame, not a spring), so the bonnet is level
  //    and steady over the corselet. Its weight shows as a lag on starts and stops (the
  //    carried-pitch spring below), never as a side-to-side wobble.
  // Grounded only (gb), not on the ladder, not through a slash; the swim keeps its pendulum.
  // While he squares up for a slash the column turns as one (sqW): the blade's direction
  // at contact stays exactly where the slash and game.js's t+0.22 hit check agree it is.
  const gC = gb * (1 - ladderF) * (1 - sqW) * CHAIN.on;
  {
    const py = pc[CH.pYaw], pr = pc[CH.pRoll], sx = b.position.x;
    const pivX = sx - 0.20 * Math.sin(pr);
    const thW = Math.asin(clamp((pivX - CHAIN.kH * sx) / 0.738, -0.3, 0.3));   // 0.738: the neck pivot over the spine's
    spring(chR, (thW - pr) * gC, dt, CHAIN.f, CHAIN.d);
    spring(chY, -(1 + CHAIN.yawK) * py * gC, dt, CHAIN.f, CHAIN.d);
  }
  sp.rotation.set(pc[CH.sPitch] - 0.4 * rcP.x, pc[CH.sYaw] + rcY.x + chY.x, pc[CH.sRoll] + 0.3 * rcR.x + chR.x);
  if (ikOn > 1e-3) b.position.y += pelvisDrop(dt, player, gw) * ikOn;
  else { pelS.x = 0; pelS.v = 0; pelInit = false; }

  // brass helmet lags the torso, then over-settles
  // Gaze stabilisation: HEAD_CTR takes the spine's INTENT yaw (look-lead, slash, peer) back
  // out as before; the gait's yaw is cancelled in phase below.
  spring(hdY, -HEAD_CTR * pc[CH.sYaw] + pc[CH.nYaw], dt, 7, 0.55);
  // ...and the weight of it: each heel strike's settle nods the bonnet forward a beat
  // late (the under-damped spring supplies the lag and the one small rebound).
  spring(hdX, -0.35 * pc[CH.sPitch] + pc[CH.nPitch] - settle.x * 0.12, dt, 6.5, 0.6);
  // CARRIED: the bonnet follows the body's lean into a start or a stop a beat late.
  const bodyPitch = b.rotation.x;
  spring(hdC, bodyPitch, dt, CHAIN.lagF, 1.0);
  const carry = (hdC.x - bodyPitch) * CHAIN.lag * gb;
  const gYaw = (pc[CH.pYaw] + chY.x) * CHAIN.headK * gC, gRoll = (pc[CH.pRoll] + chR.x) * CHAIN.headK * gC;
  diver.neck.rotation.set(hdX.x + rcH.x + carry, hdY.x - 0.4 * rcY.x - gYaw, 0.25 * rcR.x - gRoll);

  // ---- THE LEGS. Everything above is authored; from here the GROUND is boss. ----
  driveLegs(dt, player, ikOn, amp, stepRate);

  const AR = diver.armR, AL = diver.armL;
  AR.root.rotation.set(pc[CH.Rsx], pc[CH.Rsy], -pc[CH.Rsz]);
  AR.mid.rotation.x = pc[CH.Re];
  AL.root.rotation.set(pc[CH.Lsx], pc[CH.Lsy], pc[CH.Lsz]);
  AL.mid.rotation.x = pc[CH.Le];
  // arms thrown out by a hit (rcA > 0) or flung back by a burst (rcA < 0)
  if (rcA.x > 1e-3 || rcA.x < -1e-3) {
    const ra = rcA.x;
    AR.root.rotation.x += ra < 0 ? -ra * 0.5 : -ra * 0.35; AR.root.rotation.z -= Math.max(0, ra) * 0.45;
    AR.mid.rotation.x -= Math.abs(ra) * 0.25;
    if (slashT < 0) {
      AL.root.rotation.x += ra < 0 ? -ra * 0.5 : -ra * 0.30; AL.root.rotation.z += Math.max(0, ra) * 0.45;
      AL.mid.rotation.x -= Math.abs(ra) * 0.25;
    }
  }
  // wrists relax after the elbow, measured from the rest fold so nothing static moves.
  // Fed the COMPLIANT elbow now, so the lag compounds down the chain: shoulder, then
  // elbow a beat later, then the wrist after that — which is the ripple Michael was
  // missing when every joint arrived on the same frame.
  AR.end.rotation.x = spring(wrR, (pc[CH.Re] - REST_RE) * 0.30, dt, 26, 0.75);
  AL.end.rotation.x = spring(wrL, (pc[CH.Le] - REST_LE) * 0.30, dt, 26, 0.75);

  // hand velocity in the diver's own frame drives the lantern pendulum
  const c = Math.cos(-yawF), s = Math.sin(-yawF);

  // lantern swings on the bail with real inertia from the hand's motion
  diver.armR.end.getWorldPosition(_tmp);
  if (dt > 0) handV.copy(_tmp).sub(prevHand).multiplyScalar(1 / dt);
  prevHand.copy(_tmp);
  const hx = handV.x * c - handV.z * s, hz = handV.x * s + handV.z * c;
  spring(lnX, clamp(-hz * 0.055, -0.6, 0.6) - settle.x * 0.05, dt, 6.5, 0.24);
  spring(lnZ, clamp(hx * 0.055, -0.6, 0.6), dt, 6.5, 0.24);
  diver.lantPivot.rotation.set(lnX.x, 0, lnZ.x);

  // flame flicker, scaled by the player's remaining light
  const li = clamp(player.light, 0, 1);
  const fl = (0.82 + 0.18 * Math.sin(t * 11.3) + 0.10 * Math.sin(t * 27.7)) * (0.25 + 0.75 * li);
  diver.flame.scale.set(0.85 + fl * 0.3, fl * 1.15 + 0.2, 0.85 + fl * 0.3);
  diver.flame.material.opacity = 0.55 + 0.45 * fl;
  diver.core.scale.setScalar(0.7 + fl * 0.5);
  diver.glow.scale.setScalar(0.5 + fl * 0.55);
  diver.glow.material.opacity = 0.35 + 0.5 * fl;

  // breathing: exhaust BURSTS on the exhale of the shared breath clock — ONLY UNDER
  // WATER. The exhaust port is a one-way valve into the sea; standing on the raft deck
  // he was streaming bubbles up into the sky. Gated on the port's own world height
  // rather than the diver's, so the last of the exhale still leaves as he goes under.
  diver.exhaust.getWorldPosition(_ex);
  const submerged = _ex.y < SURFACE_Y + surfaceHeightAt(_ex.x, _ex.z, t, stormLevel());
  // THE DRESS SOAKS AND DRIES. Under water the canvas is soaked in ~half a second; on
  // deck it dries over ~75 s, helmet first (the shader dries it top-down). Two float
  // writes, no allocation, and nothing here feeds the breath clock below.
  salShared.uSalRootY.value = diver.position.y - EYE_H;
  {
    const bg = scene.background;
    if (bg && bg.isColor) uBubAmb.value = clamp((0.2126 * bg.r + 0.7152 * bg.g + 0.0722 * bg.b) / 0.029, 0.04, 1.25);
  }
  salShared.uSalWet.value = submerged ? Math.min(1, salShared.uSalWet.value + dt * 2.0)
    : Math.max(0, salShared.uSalWet.value - dt / 75);
  // beads on the port glass exist only in air: gone under water, thick just after he
  // surfaces, drying off with the dress down to a faint condensation film
  salShared.uSalDrop.value = submerged ? 0 : 0.15 + 0.85 * salShared.uSalWet.value;
  const phm = breathPh % TAU;
  if (phm < _phPrev) {                                  // wrapped: a cycle completed
    breathIdx++;
    // Roll the NEW cycle's character. About 1 in 10 breaths is HELD (~1.45-1.75x rest
    // length) and the release that ends it comes out half again as big; the rest
    // spread the cadence 0.78-1.27x (3.2-5.2 s at rest).
    const hh = h01(breathIdx * 5.13 + 0.7);
    if (hh < 0.10) { cycMul = 1.45 + 0.30 * h01(breathIdx * 9.1 + 3.3); releaseK = 1.55; }
    else { cycMul = 0.78 + 0.49 * hh; releaseK = 1; }
  }
  if (_phPrev < Math.PI && phm >= Math.PI && phm < _phPrev + 2) {
    // Exhale opens the valve. Per-breath character, all hashed off the seed —
    // repeatable, and nothing in the per-frame path touches Math.random:
    //   - burst CLASS: ~1 in 4 breaths is a thin sip (2-4 bubbles), ~1 in 5 a heavy
    //     dump (14-20), the rest in between;
    //   - lead bubbles: 1-3 of them, sized 0.11-0.17 with a further ±60% per breath;
    //   - ~1 in 8 breaths passes one big GULP bubble that wobbles hard on the rise;
    //   - trail runs 0.3-1.0 s;
    //   - a held breath's release (releaseK) is ~1.5x everything;
    //   - ~1 in 3 breaths while the head is turned drifts the whole column that way.
    burstSeed = breathIdx * 61.7 + 13.1;
    burstDur = 0.3 + 0.7 * h01(burstSeed + 1);
    const airLow = 1 - clamp(survival.oxygen / 0.35, 0, 1);
    const cls = h01(burstSeed + 4);
    let trailN = cls < 0.25 ? 2 + Math.round(2 * h01(burstSeed + 5))
      : cls > 0.80 ? 14 + Math.round(6 * h01(burstSeed + 5))
        : 6 + Math.round(6 * h01(burstSeed + 5));
    trailN = Math.max(2, Math.round(trailN * (1 - 0.5 * airLow) * (1 + 0.35 * exert) * releaseK));
    const leads = Math.max(1, Math.round((1 + h01(burstSeed + 2) * 2) * (cls < 0.25 ? 0.6 : 1) * releaseK));
    const leadMul = (0.4 + 1.2 * h01(burstSeed + 11)) * releaseK;   // ±60% lead size
    burstStep = burstDur / trailN;
    burstT = 0; burstNext = 0.06;
    // Head-turn column drift: bias this whole burst's emission toward where the head
    // points. Read from the posed neck yaw + body yaw, world-space.
    _drift.set(0, 0, 0);
    if (h01(burstSeed + 8) < 0.35) {
      const hy = diver.rotation.y + po[CH.nYaw] * 1.8;
      const dk = clamp(Math.abs(po[CH.nYaw]) * 4, 0, 1) * 0.35;
      _drift.set(Math.sin(hy) * dk, 0, Math.cos(hy) * dk);
    }
    if (submerged) {
      for (let i = 0; i < leads; i++)
        emitBubble(_ex, player.vel, 0.11 * leadMul, 0.17 * leadMul, burstSeed + 100 + i * 7.7);
      if (h01(burstSeed + 7) < 0.125)                    // the gulp: big, wobbling hard
        emitBubble(_ex, player.vel, 0.17, 0.23, burstSeed + 550, 2.4);
    }
    // Valve chatter: ~1 in 5 breaths fires a second, smaller spit shortly after.
    dblT = h01(burstSeed + 6) < 0.20 ? 0.22 + 0.18 * h01(burstSeed + 66) : -1;
    dblSeed = burstSeed + 700;
  }
  _phPrev = phm;
  if (dblT >= 0) {                                      // the chattering second spit
    dblT -= dt;
    if (dblT < 0 && submerged) {
      for (let i = 0; i < 3; i++)
        emitBubble(_ex, player.vel, 0.06, 0.11, dblSeed + i * 11.3);
    }
  }
  if (burstT >= 0) {                                    // the trail of the current exhale
    burstT += dt;
    while (burstNext <= burstT && burstNext <= burstDur) {
      if (submerged) emitBubble(_ex, player.vel, 0.018, 0.05, burstSeed + 200 + burstNext * 97);
      burstNext += burstStep * (0.7 + 0.6 * h01(burstSeed + 300 + burstNext * 53));
    }
    if (burstT > burstDur) { burstT = -1; _drift.set(0, 0, 0); }
  }
  // between breaths: a rare stray bubble leaking past the valve seat, nothing more
  trickle -= dt;
  if (trickle <= 0) {
    trickle = rng(1.4, 3.6);
    if (submerged) emitBubble(_ex, player.vel, 0.010, 0.022, breathIdx * 7.9 + trickle * 31);
  }
  // ascending fast, the air in the dress expands and the valve dumps the excess —
  // extra venting proportional to the climb rate, a detail every hard-hat diver knows
  if (submerged && player.vel.y > 1.2) {
    ascVent -= dt;
    if (ascVent <= 0) {
      ascVent = clamp(0.9 / (player.vel.y - 0.7), 0.06, 0.45);
      emitBubble(_ex, player.vel, 0.018, 0.05, breathIdx * 3.3 + t * 41);
    }
  }
  updateBubbles(dt, t, player.vel);

  // ---- (salprop) THE HANDS, THE FACE, THE BREATH ON THE GLASS (scalars for salInstall.js) ----
  {
    // left hand: the knife while it is out of the scabbard, a hand on the rung or the valve,
    // spread to scull off the bottom, an empty working hand on it. The right keeps the lantern.
    const kw = slashT >= 0 ? ss(0.05, 0.085, slashT) * (1 - ss(0.50, 0.535, slashT)) : 0;
    const gw2 = Math.max(ladderF, 0.65 * valveW);
    const sw2 = Math.max(1 - gb, grabW, burstW) * (1 - ladderF);
    const L = salShared.hand.L, r = Math.min(1, (kw > L[2] ? 30 : 9) * dt);
    const tg = _hTg;
    tg[1] = Math.min(gw2, 1 - kw); tg[2] = kw;
    tg[3] = Math.min(sw2, 1 - kw - tg[1]); tg[0] = Math.max(0, 1 - tg[1] - tg[2] - tg[3]);
    for (let i = 0; i < 4; i++) L[i] += (tg[i] - L[i]) * (i === 2 ? Math.min(1, 30 * dt) : r);
    const F = salShared.face;
    F.have = lookHave && lookW > 0.05; F.x = lookT.x; F.y = lookT.y; F.z = lookT.z;
    F.stress = breathStress(); F.swim = 1 - gb;
    // the exhale fogs the front light; the inhale clears it (a little more in the cold deep)
    const ph = breathPh % TAU, exh = ph > Math.PI && ph < Math.PI + 2.0;
    fogV += ((exh ? 1 : 0) - fogV) * Math.min(1, (exh ? 1.8 : 0.8) * dt);
    salShared.uSalFog.value = fogV * (submerged ? 0.85 : 0.6);
  }
  if (salShared.tick) salShared.tick(dt);   // salInstall: finger bones, the eyes
}
let fogV = 0;
const _hTg = new Float32Array(4);

// SALSCULPT HOOK (2/2): sculpted meshes replace the procedural ones group by group
// (salInstall.js); the rig, every timing and every anchor above stay exactly as built.
installSalSculpt(diver, salShared);

export function lanternWorldPos(target) {
  diver.lant.getWorldPosition(target);
  return target;
}

// The two spheres that shadow the lantern's glow in the water (water.js GLSL_LAMP):
// the chest (corselet + breastplate) and the bonnet, world centre + radius, written
// into out[0..7]. Radii are the rig's own extents (bonnet bbox 1.14 wide, corselet
// ~0.95), slightly inside them so the shadow never reads wider than the man. Both are
// measured in the frames of the groups that carry them (cors, helmGroup), so they shrink
// with HELM_S: centres through the groups' transforms, radii x HELM_S.
const _occV = V3();
export function diverOccluders(out) {
  const sw = diver.visible ? 1 : 0;
  diver.cors.updateWorldMatrix(true, false);
  _occV.set(0, 0.36, 0); diver.cors.localToWorld(_occV);
  out[0] = _occV.x; out[1] = _occV.y; out[2] = _occV.z; out[3] = 0.44 * HELM_S * sw;
  diver.helmGroup.updateWorldMatrix(true, false);
  _occV.set(0, 0.44, 0); diver.helmGroup.localToWorld(_occV);
  out[4] = _occV.x; out[5] = _occV.y; out[6] = _occV.z; out[7] = 0.40 * HELM_S * sw;
  return out;
}

export function airInletWorldPos(target) {
  diver.hoseInlet.getWorldPosition(target);
  return target;
}

// ---- knife (implemented by the diver-knife agent) ----
// triggerSlash(): play the draw-and-slash animation once; returns false while one is
// already in flight so game.js can gate the hit check to the anim's contact frame.
export function triggerSlash() {
  if (slashT >= 0) return false;      // already committed; no cancelling mid-swing
  slashT = 0;
  return true;
}
