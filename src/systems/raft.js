// The surface raft: a working dive tender. OWNED BY: orchestrator.
//
// This used to be a prop seen from underneath. Now Sal stands on it, walks it, and steps
// off it to begin the dive, so it is a PLACE — and the job of every object on it is to
// say what happens here. It is assembled from four builders that each own a region of
// the deck, plus the pump, which is the fuel gauge made physical:
//
//   raft/hull.js     the barge itself: planking, bulwark, drums, mooring
//   raft/station.js  the dressing station, port wing — where Sal was suited up
//   raft/gear.js     working gear, starboard and aft — the bitumen the pump eats
//   raft/davit.js    the gallows the umbilical runs over, and the boarding ladder
//   raft/pump.js     oil engine belt-driving a compressor; six running/dead tells
//
// Every builder bakes merged geometry into THIS group, then consolidate() merges again
// ACROSS builders, so four files that each emit an iron bucket cost one iron draw call.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, camera, envTex, renderer } from '../core.js';
import { SURFACE_Y } from '../config.js';
import { registerPaint } from '../lib/paint.js';
import { V3 } from '../lib/math.js';
import { makeGlow, raftWoodSet, raftIronSet, raftBrassSet, raftPaintSet, raftRopeSet, raftCanvasSet,
  raftLeatherSet, raftSetsBench } from '../lib/textures.js';
import { survival } from './survival.js';
import { surfaceHeightAt, stormLevel, onSkyEnv } from '../world/water.js';
import { Part, xf, box, cyl, tor, weather, rivetRing, boltLine, rope, lash, DECK_SENTINEL, chamferBox, weldBead } from './raft/kit.js';
import { DECK_NAILS } from './raft/hull.js';
import { buildHull } from './raft/hull.js';
import { buildStation } from './raft/station.js';
import { buildGear } from './raft/gear.js';
import { buildDavit } from './raft/davit.js';
import { buildChart } from './raft/chart.js';
import { buildShelf } from './raft/shelf.js';
import { buildPump, updatePump, PUMP_POS } from './raft/pump.js';

export const raft = new THREE.Group();
// IT FLOATS. This sat at SURFACE_Y - 1.6 for the whole project, which put the deck top at
// y = -1.49 and the flotation drums entirely under water — nobody noticed because the
// camera had never once been above the waterline. At +0.55 the drums (r 0.85, local
// centre -0.75) sit about 62% submerged, which is where an oil drum floats, and the deck
// carries ~0.66 of freeboard. The bob is +-0.32 before storm gain, so the deck never
// dips under. Everything downstream is position-relative (pumpPos, nearRaft, the respawn
// point, the ending's arrival, the HUD bearing) and follows for free.
export const RAFT_POS = V3(0, SURFACE_Y + 0.55, 0);

// Where the umbilical actually leaves the raft: over the gallows sheave, outboard of
// the deck edge. RAFT-LOCAL; pumpPos is this transformed into world space each frame.
const hoseHead = V3();
// Where the umbilical leaves the pump.
export const pumpPos = V3();
// Raft-local standing spot in front of the chart table (world = raft.localToWorld of this).
export const chartAnchor = V3();

let pumpH = null, lampGlass = null, beaconGlow = null, lamp = null, lampLight = null;
// The keepsake shelf's dynamic-row setter, and anything game.js pushed in before the raft
// existed (it loads the saved chart and calls setKeepsakes at module scope).
let shelfSet = null, pendingKeeps = null;
// Ride state: the hull's eased height and attitude on the real wave field.
let rideY = RAFT_POS.y, rideRX = 0, rideRZ = 0;
const PUFFN = 7, puffs = [];
let puffT = 0, puffMesh = null;
const puffOrigin = V3();
const _puffM = new THREE.Matrix4();

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

// ---- palette ----------------------------------------------------------------------
// EVERY material is created exactly once, here, and passed to the builders. A builder
// that makes its own material makes its own draw call and breaks the merge. All of them
// carry vertexColors so kit.js's weather()/tint() can bake grime and waterline stain
// into whatever geometry wants it.
// ---- THE SURFACE PATCH (polish-raft) ----------------------------------------------
// One onBeforeCompile shared by every lit raft material, keyed so materials with the same
// maps still share a program. It reads three things no stock material can:
//   vColor.a  the baked SURFACE STATE (kit.js): 0.5 neutral, lower = wet / hand-polished
//             (smoother), higher = rust / dust (rougher, and dull: metalness falls away)
//   raftWet   rain wetness, pushed from updateRaft: upward faces go dark and slick first
//   the DECK MAP (wood only, RAFT_DECK): contact grime, iron stain, wet, foot polish,
//             baked once at build from a top-down render of the finished raft
// Inserted after normal_fragment_maps so the geometric normal is known; everything it
// touches (diffuseColor, roughnessFactor, metalnessFactor) is read only by the lights.
const RAFT_WET = { value: 0 };
const DECK_N = 256, DECK_EXT = 5.0;          // deck map texels, half-extent in raft metres
const deckData = new Uint8Array(DECK_N * DECK_N * 4);
for (let i = 0; i < DECK_N * DECK_N; i++) { deckData[i * 4] = 255; deckData[i * 4 + 3] = 0; }
const deckTex = new THREE.DataTexture(deckData, DECK_N, DECK_N, THREE.RGBAFormat, THREE.UnsignedByteType);
deckTex.magFilter = THREE.LinearFilter; deckTex.minFilter = THREE.LinearMipmapLinearFilter;
deckTex.generateMipmaps = true; deckTex.needsUpdate = true;
const SURF_FS = `#include <normal_fragment_maps>
{
  float rsK = 0.5;
  #ifdef USE_COLOR_ALPHA
    rsK = vColor.a;
  #endif
  vec3 rsUp = normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );
  float rsFace = clamp( dot( nonPerturbedNormal, rsUp ), 0.0, 1.0 );
  float rsWet = raftWet * ( 0.35 + 0.65 * rsFace );
  float rsDry = clamp( rsK * 2.0 - 1.0, 0.0, 1.0 );
  float rsSlick = clamp( 1.0 - rsK * 2.0, 0.0, 1.0 );
  roughnessFactor *= mix( 1.0, 0.36, rsSlick ) * mix( 1.0, 1.70, rsDry );
  metalnessFactor *= 1.0 - 0.85 * rsDry;
  #ifdef RAFT_DECK
    vec4 rdk = texture2D( raftDeckMap, vRaftDeck );
    diffuseColor.rgb *= mix( 0.38, 1.0, rdk.r );
    diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.62, 0.40, 0.26 ), rdk.g );
    diffuseColor.rgb *= ( 1.0 - 0.42 * rdk.b ) * ( 1.0 + 0.14 * rdk.a );
    roughnessFactor *= ( 1.0 - 0.58 * rdk.b ) * ( 1.0 - 0.34 * rdk.a );
    roughnessFactor = mix( roughnessFactor, 1.0, rdk.g * 0.5 );
  #endif
  diffuseColor.rgb *= 1.0 - 0.30 * rsWet;
  roughnessFactor = clamp( roughnessFactor * ( 1.0 - 0.60 * rsWet ), 0.04, 1.0 );
}`;
function raftSurf(m, deck = false) {
  if (deck) { m.defines = Object.assign({}, m.defines, { RAFT_DECK: '' }); m.userData.deckAttr = true; }
  m.onBeforeCompile = sh => {
    sh.uniforms.raftWet = RAFT_WET;
    if (deck) sh.uniforms.raftDeckMap = { value: deckTex };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n#ifdef RAFT_DECK\nattribute vec2 raftDeck;\nvarying vec2 vRaftDeck;\n#endif')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n#ifdef RAFT_DECK\nvRaftDeck = raftDeck;\n#endif');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float raftWet;\n#ifdef RAFT_DECK\nuniform sampler2D raftDeckMap;\nvarying vec2 vRaftDeck;\n#endif')
      .replace('#include <normal_fragment_maps>', SURF_FS);
  };
  // same key for every raft material: programs are still split by the maps/defines
  // three already keys on, and shared wherever those match
  m.customProgramCacheKey = () => 'raftSurf1';
  return m;
}

function palette() {
  const M = (color, o) => new THREE.MeshStandardMaterial(
    Object.assign({ color, envMap: envTex, vertexColors: true }, o));
  // Generated PBR sets (lib/textures.js, RAFT SURFACE SETS), laid on in metres by the
  // kit's metricUV. The albedo maps carry real value range now (the old ones were
  // near-white grain), so the palette hues were lifted to keep each material's mean.
  const set = (S, ns) => ({ map: S.map, roughnessMap: S.rough, normalMap: S.nrm, normalScale: new THREE.Vector2(ns, ns) });
  const WS = raftWoodSet(), IS = raftIronSet(), BS = raftBrassSet(), PS = raftPaintSet();
  const RS = raftRopeSet(), CS = raftCanvasSet(), LS = raftLeatherSet();
  const metric = m => { m.userData.uv = 'metric'; return m; };
  const strand = m => { m.userData.uv = 'strand'; return m; };
  const brassy = m => { m.userData.brass = true; return m; };
  const rusty = (m, k) => { m.userData.rustK = k; return m; };
  // ENGINE ENAMEL: the one painted surface on the boat, so it is the one clear-coat.
  // The colour lives in the map (enamel, primer rings, bare iron in the chips) and the
  // coat is masked off wherever the enamel has flaked.
  const paint = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, envMap: envTex, vertexColors: true, roughness: 1.0, metalness: 0.08,
    envMapIntensity: 0.55, ...set(PS, 0.8), clearcoat: 0.45, clearcoatRoughness: 0.30,
    clearcoatMap: PS.coat
  });
  return {
    wood: metric(M(0x8f7658, { roughness: 0.94, metalness: 0.02, envMapIntensity: 0.22, ...set(WS, 1.0) })),
    wood2: metric(M(0xa89878, { roughness: 0.96, metalness: 0.00, envMapIntensity: 0.16, ...set(WS, 1.0) })),
    iron: rusty(metric(M(0x60656a, { roughness: 1.0, metalness: 0.80, envMapIntensity: 0.50, ...set(IS, 1.0) })), 0.3),
    rust: rusty(metric(M(0x9c6c4a, { roughness: 1.0, metalness: 0.25, envMapIntensity: 0.20, ...set(IS, 1.2) })), 0.6),
    brass: brassy(metric(M(0xa8862f, { roughness: 0.62, metalness: 0.92, envMapIntensity: 0.75, ...set(BS, 1.0) }))),
    lead: metric(M(0x9ea3a8, { roughness: 1.0, metalness: 0.50, envMapIntensity: 0.28, ...set(IS, 0.8) })),
    // laid rope: one texture tile per lay, wrapped by the kit's 'strand' mapping
    rope: strand(M(0xae9a72, { roughness: 1.0, metalness: 0.00, envMapIntensity: 0.10, ...set(RS, 1.0) })),
    canvas: metric(M(0x8a806a, { roughness: 1.0, metalness: 0.00, envMapIntensity: 0.10, ...set(CS, 1.0) })),
    leather: metric(M(0x5c432c, { roughness: 1.0, metalness: 0.04, envMapIntensity: 0.18, ...set(LS, 1.0) })),
    paint: metric(paint),
    // Matched to tether.js's own hose material (0x33383b / 0.5) on purpose: the wound
    // reel, the lead over the sheave and the deployed umbilical have to read as ONE
    // continuous line, and a shade of difference at the block gives that away.
    hose: M(0x33383b, { roughness: 0.52, metalness: 0.00, envMapIntensity: 0.22 }),
    glass: M(0xc6d8de, { roughness: 0.10, metalness: 0.00, envMapIntensity: 0.9, transparent: true, opacity: 0.30 })
  };
}
// PAINT LAW (lib/paint.js): the deck's timber, iron, rope, canvas, leather, paint and
// hose go matte with the dial (the plank normal maps soften with it). Brass and the
// glass are HERO — wet brass is one of the few specular stories the style keeps.
function paintRaft(mats) {
  for (const k in mats) {
    registerPaint(mats[k], { hero: k === 'brass' || k === 'glass' });
    if (!mats[k].transparent) raftSurf(mats[k], k === 'wood');
  }
  return mats;
}

// ---- THE DECK MAP ------------------------------------------------------------------
// Baked once, after every builder has placed its gear: a top-down orthographic render of
// the raft's own geometry between the plank tops and 0.7 above them tells us exactly
// what stands on the deck and how tall it is. From that the deck gets what real planking
// has and no texture can know: contact grime pooled at every foot and bulwark, iron
// stain bleeding out of every nail and bolt, the wet the dive gap and the scuppers carry,
// and the burnished trails boots have worn between the stations. RGBA = grime (1 clean),
// iron stain, wet, polish. Costs one tiny render and a few box blurs at boot.
const DECK_TOP = 0.11;
let deckReadMs = 0;
function bakeDeckMap(group) {
  const N = DECK_N, E = DECK_EXT, px = (2 * E) / N;
  const rt = new THREE.WebGLRenderTarget(N, N, { depthBuffer: true });
  const cam = new THREE.OrthographicCamera(-E, E, E, -E, 0, 0.56);
  cam.position.set(0, 0.70, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(true);
  const hm = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    vertexShader: 'varying float vH; void main() { vec4 w = modelMatrix * vec4( position, 1.0 ); vH = w.y; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: 'varying float vH; void main() { gl_FragColor = vec4( clamp( ( vH - 0.14 ) / 0.56, 0.0, 1.0 ), 1.0, 0.0, 1.0 ); }'
  });
  const tmp = new THREE.Scene();
  const p0 = group.position.clone(), r0 = group.rotation.clone(), parent = group.parent;
  group.position.set(0, 0, 0); group.rotation.set(0, 0, 0);
  tmp.add(group); tmp.overrideMaterial = hm;
  const prevRT = renderer.getRenderTarget(), prevCC = renderer.getClearColor(new THREE.Color()), prevCA = renderer.getClearAlpha();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear();
  renderer.render(tmp, cam);
  const pix = new Uint8Array(N * N * 4);
  const tr0 = performance.now();
  renderer.readRenderTargetPixels(rt, 0, 0, N, N, pix);
  deckReadMs = performance.now() - tr0;
  renderer.setRenderTarget(prevRT); renderer.setClearColor(prevCC, prevCA);
  tmp.remove(group); tmp.overrideMaterial = null;
  if (parent) parent.add(group);
  group.position.copy(p0); group.rotation.copy(r0);
  hm.dispose(); rt.dispose();

  // occupancy / height, in DECK layout: texel (i, j) <-> x = -E + (i+.5)px, z = -E + (j+.5)px.
  // The camera's screen-up is world -Z, so render row r is z = +E - (r+.5)px.
  const occ = new Float32Array(N * N), low = new Float32Array(N * N);
  for (let r = 0; r < N; r++) for (let i = 0; i < N; i++) {
    const o = (r * N + i) * 4, j = N - 1 - r, k = j * N + i;
    if (pix[o + 3] === 0) continue;
    const h = pix[o] / 255 * 0.56;
    occ[k] = 0.55 + 0.45 * Math.min(1, h / 0.3);        // taller stands make deeper shade
    if (h < 0.06) low[k] = 1;                             // fittings flush with the planks
  }
  for (const [x, z] of DECK_NAILS) {
    const i = Math.floor((x + E) / px), j = Math.floor((z + E) / px);
    if (i >= 0 && j >= 0 && i < N && j < N) low[j * N + i] = 1;
  }
  const blur = (src, r, passes = 2) => {
    let a = src.slice(), b = new Float32Array(N * N);
    const w = 1 / (2 * r + 1);
    for (let p = 0; p < passes; p++) {
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let t = 0;
        for (let d = -r; d <= r; d++) { const ii = i + d; t += ii < 0 || ii >= N ? 0 : a[j * N + ii]; }
        b[j * N + i] = t * w;
      }
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
        let t = 0;
        for (let d = -r; d <= r; d++) { const jj = j + d; t += jj < 0 || jj >= N ? 0 : b[jj * N + i]; }
        a[j * N + i] = t * w;
      }
    }
    return a;
  };
  const aoN = blur(occ, 2), aoF = blur(occ, 7), stain = blur(low, 1), occS = blur(occ, 1, 1);
  // cheap smooth value noise over a 64^2 lattice table (hashed once)
  const LAT = new Float32Array(64 * 64);
  for (let k = 0; k < LAT.length; k++) { const h = Math.sin(k * 12.9898 + 4.1) * 43758.5453; LAT[k] = h - Math.floor(h); }
  const vn = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    const x0 = xi & 63, z0 = zi & 63, x1 = (xi + 1) & 63, z1 = (zi + 1) & 63;
    const a = LAT[z0 * 64 + x0], b = LAT[z0 * 64 + x1], c = LAT[z1 * 64 + x0], d = LAT[z1 * 64 + x1];
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  };
  // the trails: boots go from the ladder gap up the lane, then round the reel to the
  // stations. Distance to each segment, gaussian across, patchy along.
  const TRAILS = [
    [0, 4.6, 0, 1.6, 1.0], [0, 1.6, -1.35, 1.25, 0.8], [-1.35, 1.25, -3.2, 2.9, 0.7],
    [-1.35, 1.25, -1.45, -0.55, 0.7], [-1.45, -0.55, -3.4, -1.2, 0.6], [0, 1.6, 1.4, 1.25, 0.8],
    [1.4, 1.25, 1.55, -0.9, 0.7], [1.55, -0.9, 1.9, -2.6, 0.55], [1.9, -2.6, 3.0, -3.1, 0.5],
    [1.4, 1.25, 3.3, 0.2, 0.45], [1.55, -0.9, 0.9, -2.55, 0.5], [-1.45, -0.55, -1.0, -2.5, 0.4]
  ];
  // wet: the dive gap, and a fan round each scupper mouth (hull.js positions)
  const SCUP = [[-2.9, 4.7], [2.9, 4.7], [-1.6, -4.7], [1.6, -4.7], [4.7, -2.0], [4.7, 2.0], [-4.7, 1.4]];
  const segD = (x, z, s) => {
    const dx = s[2] - s[0], dz = s[3] - s[1], l2 = dx * dx + dz * dz;
    const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (z - s[1]) * dz) / l2));
    const ex = x - s[0] - dx * t, ez = z - s[1] - dz * t;
    return Math.sqrt(ex * ex + ez * ez);
  };
  const d = deckData;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i, o = k * 4, x = -E + (i + 0.5) * px, z = -E + (j + 0.5) * px;
    const n1 = vn(x * 2.3, z * 2.3), n2 = vn(x * 7.1 + 40, z * 7.1), n3 = vn(x * 0.9 + 13, z * 0.9 + 7);
    // grime: contact shade + a broad uneven dirt, heavier toward the bulwarks
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const toRail = Math.max(0, 1 - (4.62 - edge) / 0.30);
    let g = 1 - Math.min(0.85, aoN[k] * 0.80 + aoF[k] * 0.55) - toRail * 0.30 * (0.6 + 0.4 * n2) - (n3 - 0.5) * 0.12;
    // bitumen: drips from the tapped barrel's tap and a trodden-in smear toward the pump
    const tapD = Math.hypot(x - 3.97, z + 4.12), bit = Math.max(0, 1 - tapD / 0.34) * (0.6 + 0.4 * n2)
      + Math.max(0, 1 - segD(x, z, [3.8, -4.0, 1.7, -2.4]) / 0.10) * 0.25 * n1;
    g -= bit * 0.55;
    // foot polish
    let pol = 0;
    for (const s of TRAILS) { const dd = segD(x, z, s); pol = Math.max(pol, Math.exp(-(dd * dd) / (2 * 0.26 * 0.26)) * s[4]); }
    pol *= (0.55 + 0.45 * n1) * (1 - Math.min(1, occS[k] * 1.4));
    // wet
    let wet = 0;
    if (z > 3.2 && Math.abs(x) < 1.6) wet = Math.max(wet, Math.max(0, (z - 3.2) / 1.5) * Math.max(0, 1 - Math.abs(x) / 1.6) * (0.5 + 0.7 * n2));
    for (const [sx, sz] of SCUP) {
      const dd = Math.hypot((x - sx) * (Math.abs(sz) > 4 ? 0.7 : 1.3), (z - sz) * (Math.abs(sz) > 4 ? 1.3 : 0.7));
      wet = Math.max(wet, Math.max(0, 1 - dd / 0.55) * (0.6 + 0.5 * n2));
    }
    wet = Math.max(wet, toRail * 0.35 * n2, bit * 0.8);    // bitumen reads glossy-black
    d[o] = Math.max(0, Math.min(1, g)) * 255;
    d[o + 1] = Math.min(1, stain[k] * 1.6) * (1 - bit) * 255;
    d[o + 2] = Math.min(1, wet) * 255;
    d[o + 3] = Math.min(1, pol) * 255;
  }
  // the neutral corner the non-deck wood samples (kit.js DECK_SENTINEL)
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const o = (j * N + i) * 4; d[o] = 255; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0;
  }
  deckTex.needsUpdate = true;
}

// Second-pass merge across builders. Every mesh a Part baked is flagged and sits at
// identity in raft-local space, so this is a straight geometry concat — no matrices to
// apply, and the animated sub-groups (pump, flywheel, governor, lamp) are untouched
// because they are not direct children of the raft.
function consolidate(g) {
  const byMat = new Map();
  for (const c of g.children) {
    if (!c.isMesh || !c.userData.rmerge) continue;
    let a = byMat.get(c.material); if (!a) byMat.set(c.material, a = []);
    a.push(c);
  }
  let n = 0;
  for (const [mat, list] of byMat) {
    if (list.length < 2) { n++; continue; }
    const merged = mergeGeometries(list.map(o => o.geometry));
    if (!merged) { n += list.length; continue; }   // mismatched attributes: leave them be
    for (const o of list) g.remove(o);
    const m = new THREE.Mesh(merged, mat);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
    n++;
  }
  return n;
}

// ---- the hose reel ------------------------------------------------------------------
// Kept here rather than in a builder because the umbilical is the orchestrator's wire:
// the lead from this drum to the davit sheave is what makes the hose come FROM somewhere.
function buildReel(P, mats, head) {
  // PROPORTION. The first pass ran 1.02 cheeks on a 0.62 drum — a two-metre reel, which
  // next to a 1.8 m diver read as a boulder parked on the deck and swallowed its own
  // winding. At 0.70 over 0.40 the wound turns are a fifth of the cheek instead of a
  // sixteenth, so the thing you are meant to see — hose, coiled, ready to pay out — is
  // the thing that reads.
  const RY = 0.74, RZ = 0.60, HW = 0.46, DRUM = 0.40, CHEEK = 0.70;
  // A-frame standards. It floated in mid-air before, which is the kind of thing you
  // stop seeing after the twentieth look and the player sees on the first.
  for (const s of [-1, 1]) {
    for (const d of [-1, 1]) {
      P.add(xf(cyl(0.045, 0.065, RY - 0.11, 6), s * 0.60, (RY + 0.11) / 2, RZ + d * 0.30,
        -d * 0.30, 0, -s * 0.10), mats.iron);
    }
    P.add(weather(xf(chamferBox(0.18, 0.05, 0.78, 0.01, 3), s * 0.60, 0.14, RZ), { tone: 0.85, freq: 3, amp: 0.3, rust: 0.5 }), mats.iron);        // sole plate
    boltLine(P, mats.iron, s * 0.60, 0.165, RZ - 0.28, s * 0.60, 0.165, RZ + 0.28, 3, 0.030, 6, 4, true, true);
    P.add(xf(cyl(0.08, 0.08, 0.14, 8), s * 0.60, RY, RZ, 0, 0, Math.PI / 2), mats.brass);  // bearing
  }
  P.add(xf(cyl(0.05, 0.05, 1.32, 8), 0, RY, RZ, 0, 0, Math.PI / 2), mats.iron);            // axle
  // drum and cheeks
  P.add(xf(cyl(DRUM, DRUM, HW * 1.9, 28), 0, RY, RZ, 0, 0, Math.PI / 2), mats.iron);
  for (const s of [-HW, HW]) {
    P.add(weather(xf(cyl(CHEEK, CHEEK, 0.055, 40), s, RY, RZ, 0, 0, Math.PI / 2),
      { tone: 0.92, freq: 1.4, amp: 0.22, rust: 0.35 }), mats.iron);
    // rolled rim on the cheek (a flat disc edge reads as sheet, a bead reads as a flange)
    // and a raised hub boss with its weld
    P.add(weather(xf(tor(CHEEK, 0.034, 8, 56), s, RY, RZ, 0, Math.PI / 2), { tone: 0.88, freq: 3, amp: 0.25, rust: 0.45 }), mats.iron);
    P.add(weather(xf(cyl(0.13, 0.15, 0.09, 20), s + Math.sign(s) * 0.04, RY, RZ, 0, 0, Math.PI / 2), { tone: 0.85, rust: 0.3 }), mats.iron);
    P.add(xf(weldBead(0.15, 0.008, 28), s + Math.sign(s) * 0.004, RY, RZ, 0, Math.PI / 2), mats.iron);
    rivetRing(P, mats.iron, 8, s, RY, RZ, CHEEK - 0.16, 0.028, 'x');
  }
  // hose wound on in two layers, which is the only way a reel reads as loaded.
  // Radial 7 on the reel layers only: these turns are the closest fat rope on the deck,
  // and a pentagon cross-section at that range reads as extrusion, not hose.
  lash(P, mats.hose, 0, RY, RZ, 0.455, 'x', 7, 0.065, 0.118, 7);
  lash(P, mats.hose, 0, RY, RZ, 0.575, 'x', 5, 0.065, 0.118, 7);
  // crank, ratchet and pawl on the outboard cheek: a reel you cannot wind is a spool
  P.add(xf(cyl(0.034, 0.034, 0.24, 6), 0.52, RY + 0.26, RZ, 0, 0, Math.PI / 2), mats.iron);
  P.add(xf(cyl(0.030, 0.030, 0.20, 6), 0.64, RY + 0.26, RZ), mats.iron);
  P.add(xf(cyl(0.045, 0.045, 0.15, 8), 0.64, RY + 0.38, RZ), mats.wood);
  P.add(xf(cyl(0.034, 0.034, 0.34, 6), 0.58, RY + 0.13, RZ, 0, 0, Math.PI / 2), mats.iron);
  P.add(xf(tor(0.22, 0.030, 4, 14), -0.52, RY, RZ, 0, Math.PI / 2), mats.iron);  // ratchet ring
  P.add(xf(chamferBox(0.24, 0.045, 0.045, 0.01), -0.52, RY - 0.23, RZ - 0.13, 0, 0, 0.5), mats.iron);  // pawl

  // The lead from the drum up over the sheave. Without it the umbilical appears out of
  // thin air at the block, which is what the last round's bug actually looked like.
  const a = V3(0.06, RY + 0.62, RZ + 0.18);
  const mid = a.clone().lerp(head, 0.5); mid.y += 0.20;
  rope(P, mats.hose, [[a.x, a.y, a.z], [mid.x, mid.y, mid.z], [head.x, head.y, head.z]], 0.065, 18);
}

export function buildRaft() {
  const tb0 = performance.now();
  raft.position.copy(RAFT_POS);
  const mats = paintRaft(palette());
  const tMaps = performance.now() - tb0;
  // The raft is the one thing in the game that lives at the surface, so it is the one
  // thing whose reflections should be the game's OWN sky rather than core.js's neutral
  // RoomEnvironment. water.js captures the sky dome into a small PMREM on palette-stop
  // transitions and calls back here with each refresh; swapping envMap texture-for-
  // texture (same CubeUV mapping) never recompiles a program. Authored
  // envMapIntensity values are untouched — brass-age, never chrome. Everything
  // UNDERWATER (diver, leviathan, wrecks) deliberately keeps the RoomEnvironment:
  // sky glints at -500 through the fog-patched materials would be wrong.
  onSkyEnv(tex => { for (const k in mats) mats[k].envMap = tex; });

  // The davit runs first: it owns hoseHead, and the reel's lead has to be laid to it.
  const dav = buildDavit(raft, mats);
  hoseHead.copy(dav.hoseHead);
  // The lantern flame is the one unlit surface on this boat. A flame is EMISSION, not
  // albedo — a MeshStandardMaterial with nothing shining on it renders a dead lamp
  // black — and it needs its own material besides, because the builder handed it
  // mats.glass, which the pump's sight glass and oiler domes are also made of. Driving
  // the colour on a shared material would light those up along with it.
  lampGlass = dav.lampGlass;
  lampGlass.material = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  // The builder made the glass 45 mm to stop it blowing out at noon, which worked and
  // then left nothing to see at night — a halo with no bright thing at the middle of it
  // reads as fog, not as a lamp. 1.7x puts the flame at about 76 mm, still inside the
  // cage bars at 78 and still under the bloom threshold in daylight, because what keeps
  // it from blooming is the COLOUR the update drives, not the area.
  lampGlass.scale.setScalar(1.7);

  buildHull(raft, mats);
  buildStation(raft, mats);
  buildGear(raft, mats);
  // The chart table (port side, aft of the dressing station): THE CHART's physical
  // home. Its anchor is where game.js centres the [E] CONSULT prompt.
  chartAnchor.copy(buildChart(raft, mats).anchor);
  // The keepsake shelf shares that wall. Its board and brackets go into the static merge
  // below; the row of small things on it is dynamic and returns its own setter.
  shelfSet = buildShelf(raft, mats);
  if (pendingKeeps) { shelfSet(pendingKeeps); pendingKeeps = null; }

  const P = Part(raft);
  buildReel(P, mats, hoseHead);
  P.bake();

  const pumpGroup = new THREE.Group();
  raft.add(pumpGroup);
  pumpH = buildPump(pumpGroup, mats);
  puffOrigin.copy(pumpH.stackTip).add(PUMP_POS);
  // every static object is placed: bake the deck map before the sprites and lights exist
  const tDeck0 = performance.now();
  bakeDeckMap(raft);
  const tDeck = performance.now() - tDeck0;

  // exhaust: grey puffs that climb and fade, recycled. Only issued while it burns.
  // ONE InstancedMesh where seven meshes with seven cloned materials used to stand:
  // smoking cost 7 draw calls, now it costs 1. Per-instance fade rides instanceColor.r
  // through a two-line shader hook (the alpha channel instancing does not natively have);
  // a dead puff parks at scale 0.
  const puffMat = new THREE.MeshBasicMaterial({ color: 0x6b6f73, transparent: true, opacity: 0.32, depthWrite: false });
  puffMat.onBeforeCompile = s => {
    s.vertexShader = s.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vPuffA;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPuffA = instanceColor.r;');
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vPuffA;')
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );',
        'vec4 diffuseColor = vec4( diffuse, opacity * vPuffA );');
  };
  puffMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), puffMat, PUFFN);
  puffMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  puffMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PUFFN * 3).fill(1), 3);
  puffMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  puffMesh.castShadow = false; puffMesh.receiveShadow = false;
  puffMesh.frustumCulled = false;    // instances park at scale 0; the sphere's own bounds lie
  for (let i = 0; i < PUFFN; i++) {
    _puffM.makeScale(0, 0, 0);
    puffMesh.setMatrixAt(i, _puffM);
    puffs.push({ p: V3(), life: 0, max: 1, vy: 0, dz: 0 });
  }
  raft.add(puffMesh);

  // THE BEACON. It exists so a diver 200 m down can find his way home, and that job is
  // why it was a 7-unit additive sprite — which is also why it blew out to an enormous
  // halo the moment the camera came above water in daylight. It is now driven by how
  // deep the CAMERA is and by the time of day: a tight warm point on deck at noon, the
  // full long-range beacon once you are down in the fog, and warm again at night.
  beaconGlow = makeGlow(0xffb673, 1.2);
  beaconGlow.position.copy(dav.lampPos);
  raft.add(beaconGlow);

  // The lantern actually lights its own deck. Without this the raft at night is a dark
  // shape that Sal's hand lamp happens to be standing on, and the one warm object on it
  // throws nothing — which is the tell that it is a picture of a lamp rather than a lamp.
  // Short range on purpose: it pools around the davit and leaves the corners to the dark.
  lampLight = new THREE.PointLight(0xffc07a, 0, 15, 1.9);
  lampLight.position.copy(dav.lampPos);
  raft.add(lampLight);

  // downward lamp so the raft reads as a lit landmark from below
  lamp = new THREE.PointLight(0xffd2a0, 26, 90, 1.7);
  lamp.position.set(0, -0.6, 0);
  raft.add(lamp);

  const calls = consolidate(raft);
  raft.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  // Debug surface, kept: five builders compose into one frame and the only trustworthy
  // check that nobody strayed out of their box is a bounding-box probe on the real tree.
  window.__raft = raft;
  // Boot cost, kept: the surface maps are generated on the main thread at load, and the
  // polish pass budgets them (maps = palette + texture generation, total = whole build).
  window.__raftBoot = { maps: +tMaps.toFixed(1), deck: +tDeck.toFixed(1), deckRead: +deckReadMs.toFixed(1), total: +(performance.now() - tb0).toFixed(1), calls };
  // DEV bench: cold regeneration of the surface sets + a re-bake of the deck map, timed
  // warm (boot-time numbers above swing 2x with whatever else the main thread is doing)
  window.__raftBench = () => {
    const t0 = performance.now(); bakeDeckMap(raft);
    return { sets: raftSetsBench(), deck: +(performance.now() - t0).toFixed(1), deckRead: +deckReadMs.toFixed(1) };
  };
  scene.add(raft);
  raft.updateMatrixWorld(true);
  raft.localToWorld(pumpPos.copy(hoseHead));
  return calls;
}

// Storm intensity and daylight, pushed in by game.js from the weather system.
let storm = 0, day = 1, govK = 0;
// CHART V2 keepsakes: keeps is the full per-site/per-wreck taken matrix. The shelf on the
// port bulwark forward of the chart table shows one small prop per taken keepsake, in a
// FIXED site-major order — the slot a keepsake lands in never depends on the order they
// were found, so the gaps in the row are themselves the record of where Sal has not been.
// Idempotent and callable at any time: before buildRaft it is remembered, after it the
// shelf builder no-ops unless the set actually changed.
export function setKeepsakes(keeps) {
  if (shelfSet) shelfSet(keeps);
  else pendingKeeps = keeps;
}

export function setSwell(k, d = 1) { storm = k; day = d; }
// DEV: the surface state the patch reads, for the lab / captures.
export const raftSurface = { wet: RAFT_WET, deckTex };

// The flywheel's real speed, 0..1. Published so the audio hears the same coast-down the
// eye does — an engine whose sound and whose wheel disagree reads as two objects.
export function pumpSpeed() { return govK; }

export function updateRaft(dt, t) {
  // THE RAFT RIDES THE REAL SEA. It used to run its own decorative bob (+-0.32 sine)
  // while the wave MESH, since the choppy-sea round, heaves 2.5+ units in a gale —
  // so storm crests rolled straight THROUGH the deck and buried the standing camera
  // inside the wave (user-reported as "I don't see the improved water": he was IN it).
  // Now the hull samples the same surfaceHeightAt the mesh is built from — center,
  // bow and beam — averages them (a 9-unit hull low-passes chop shorter than itself)
  // and eases with a short time constant (mass; a barge does not follow ripples).
  // Pitch/roll come from the bow/beam differentials. Everything downstream (pumpPos,
  // tether, deckY in player.js, the camera) is position-relative and follows free.
  const st = stormLevel();
  const hC = surfaceHeightAt(RAFT_POS.x, RAFT_POS.z, t, st);
  const hF = surfaceHeightAt(RAFT_POS.x, RAFT_POS.z + 3.5, t, st);
  const hB = surfaceHeightAt(RAFT_POS.x + 3.5, RAFT_POS.z, t, st);
  const hTarget = RAFT_POS.y + (hC * 2 + hF + hB) * 0.25;
  // Framerate-independent ease (tether.js's MU_RATE idiom): dt/0.35 clamps at 1 and
  // over-tightens at low fps; the exp form is the same 0.35 s time constant everywhere.
  const ek = 1 - Math.exp(-dt / 0.35);
  rideY += (hTarget - rideY) * ek;
  raft.position.y = rideY;
  raft.position.x = RAFT_POS.x + Math.sin(t * 0.37) * 0.16 * (1 + storm * 2.1);
  // pitch into the swell off the bow/beam height differentials, softly clamped
  const pit = clamp01((hF - hC) / 3.5 + 0.5) - 0.5, rol = clamp01((hB - hC) / 3.5 + 0.5) - 0.5;
  rideRX += (-pit * 0.9 - rideRX) * ek;
  rideRZ += (rol * 0.9 - rideRZ) * ek;
  raft.rotation.x = rideRX + Math.cos(t * 0.44) * 0.012;
  raft.rotation.z = rideRZ + Math.sin(t * 0.52) * 0.014;
  // The anchor rides the sheave, so the hose stays on the block as the raft rolls.
  // The matrix has to be refreshed first — localToWorld reads matrixWorld, which three
  // would not rebuild until render, leaving the anchor a frame behind the swell.
  raft.updateMatrixWorld(true);
  raft.localToWorld(pumpPos.copy(hoseHead));

  // rain wets the whole boat (surface patch): storm drives it in, and it dries slowly
  const wetTo = storm > 0.25 ? Math.min(1, (storm - 0.25) / 0.45) : 0;
  RAFT_WET.value += (wetTo - RAFT_WET.value) * Math.min(1, dt * (wetTo > RAFT_WET.value ? 0.5 : 0.05));

  const running = survival.fuel > 0;
  govK = updatePump(pumpH, dt, t, running);

  // exhaust
  puffT -= dt;
  if (running && puffT <= 0) {
    puffT = 0.16 + Math.random() * 0.12;
    const p = puffs.find(q => q.life <= 0);
    if (p) {
      p.life = p.max = 1.7 + Math.random() * 0.9;
      p.vy = 0.9 + Math.random() * 0.5;
      p.dz = (Math.random() - 0.5) * 0.3;
      p.p.copy(puffOrigin);
    }
  }
  for (let i = 0; i < PUFFN; i++) {
    const p = puffs[i];
    if (p.life > 0) p.life -= dt;
    if (p.life <= 0) {
      _puffM.makeScale(0, 0, 0);
      puffMesh.setMatrixAt(i, _puffM);
      puffMesh.instanceColor.setXYZ(i, 0, 1, 1);
      continue;
    }
    const k = 1 - p.life / p.max;
    p.p.y += p.vy * dt;
    p.p.x += (0.35 + p.dz) * dt;               // drifts downwind off the stack
    p.p.z += p.dz * dt;
    const s = 0.10 + k * 0.42;
    _puffM.makeScale(s, s, s).setPosition(p.p);
    puffMesh.setMatrixAt(i, _puffM);
    // instanceColor.r is the per-puff alpha the shader hook reads (0.32 base opacity
    // times this reproduces the old 0.30 * (1-k)^2 fade to within a hair)
    puffMesh.instanceColor.setXYZ(i, 0.94 * (1 - k) * (1 - k), 1, 1);
  }
  puffMesh.instanceMatrix.needsUpdate = true;
  puffMesh.instanceColor.needsUpdate = true;

  // ---- the lantern -------------------------------------------------------------
  // Two separate reads out of one lamp. Underwater it has to punch through fog from
  // hundreds of units away, so the halo grows with the camera's depth. Above water it
  // is a brass object with a flame in it, and at noon that means the glass must sit
  // BELOW the bloom threshold or it becomes the brightest thing in the frame.
  const lit = running ? 1 : 0.22;
  const sub = clamp01((SURFACE_Y - camera.position.y) / 34);
  const night = 1 - day;
  const flick = 0.90 + 0.10 * Math.sin(t * 2.0) + 0.04 * Math.sin(t * 7.3);
  const warm = lit * flick * (0.30 + 0.70 * Math.max(sub, night));
  if (lampGlass) lampGlass.material.color.setRGB(1.00 * warm, 0.78 * warm, 0.46 * warm);
  // The glass itself is deliberately tiny — a few centimetres, shrouded by the cage —
  // because that is what stopped it blowing out to a halo at noon. At nine units that
  // makes it about two pixels, so the NIGHT read has to come from the halo instead: the
  // sprite carries it in the dark, and shrinks to almost nothing in daylight.
  beaconGlow.scale.setScalar((1.15 + 6.1 * sub + 1.30 * night * (1 - sub)) * flick);
  beaconGlow.material.opacity = 0.80 * lit * clamp01(0.10 + 0.90 * sub + 0.52 * night * (1 - sub));
  lampLight.intensity = 13 * lit * flick * night * (1 - sub);
  // The downward beacon exists to be seen FROM BELOW; in air it lit nothing visible
  // and never dimmed. Scale by sub the way lampLight scales by (1 - sub): full beacon
  // once the camera is under, fading out as it surfaces.
  lamp.intensity = 26 * lit * sub;
}

export function nearRaft(pos, radius = 12) {
  return pos.distanceTo(raft.position) < radius;
}
